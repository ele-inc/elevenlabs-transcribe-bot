import type {
  TranscriptionJob,
  TranscriptionJobResult,
} from "../api/transcription-job-types.ts";
import {
  createTranscriptionApiHandler,
  parseCreateRequest,
} from "./transcription-api-handler.ts";
import {
  JobAlreadyExistsError,
  type TranscriptionJobDispatcher,
  type TranscriptionJobStore,
  type TranscriptionResultStore,
} from "../services/transcription-job-contracts.ts";
import { assertEquals } from "@std/assert";

class MemoryJobStore implements TranscriptionJobStore {
  readonly values = new Map<string, TranscriptionJob>();
  getError: Error | null = null;

  create(job: TranscriptionJob): Promise<TranscriptionJob> {
    const existing = this.values.get(job.id);
    if (existing) return Promise.reject(new JobAlreadyExistsError(existing));
    this.values.set(job.id, structuredClone(job));
    return Promise.resolve(job);
  }

  get(id: string): Promise<TranscriptionJob | null> {
    if (this.getError) return Promise.reject(this.getError);
    return Promise.resolve(this.values.get(id) || null);
  }

  update(id: string, values: Partial<TranscriptionJob>): Promise<void> {
    const current = this.values.get(id);
    if (!current) throw new Error("missing job");
    const next = { ...current, updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    this.values.set(id, next);
    return Promise.resolve();
  }

  claim(): Promise<TranscriptionJob | null> {
    return Promise.resolve(null);
  }
}

class MemoryResultStore implements TranscriptionResultStore {
  readonly values = new Map<string, TranscriptionJobResult>();

  save(jobId: string, result: TranscriptionJobResult): Promise<string> {
    const name = `${jobId}.json`;
    this.values.set(name, result);
    return Promise.resolve(name);
  }

  get(objectName: string): Promise<TranscriptionJobResult> {
    const result = this.values.get(objectName);
    if (!result) throw new Error("missing result");
    return Promise.resolve(result);
  }
}

class FakeDispatcher implements TranscriptionJobDispatcher {
  readonly calls: string[] = [];
  error: Error | null = null;

  dispatch(jobId: string): Promise<string> {
    this.calls.push(jobId);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(`executions/${jobId}`);
  }
}

function createTestHandler() {
  const jobs = new MemoryJobStore();
  const results = new MemoryResultStore();
  const dispatcher = new FakeDispatcher();
  const handler = createTranscriptionApiHandler({
    jobs,
    results,
    dispatcher,
    isSupportedUrl: (url) => url.includes("example.com"),
    getCallerId: (req) =>
      Promise.resolve(req.headers.get("x-test-caller") || "caller-a"),
  });
  return { handler, jobs, results, dispatcher };
}

Deno.test("parseCreateRequest は API の既定値を適用する", () => {
  const parsed = parseCreateRequest(
    { sourceUrl: "https://example.com/audio.mp3" },
    () => true,
  );
  assertEquals(parsed, {
    sourceUrl: "https://example.com/audio.mp3",
    options: {
      diarize: true,
      showTimestamp: true,
      tagAudioEvents: true,
      summarize: false,
    },
  });
});

Deno.test("話者分離が無効なときは話者オプションを拒否する", () => {
  const parsed = parseCreateRequest(
    {
      sourceUrl: "https://example.com/audio.mp3",
      options: { diarize: false, numSpeakers: 2 },
    },
    () => true,
  );
  assertEquals(
    parsed,
    "話者オプションを使うには options.diarize を有効にしてください",
  );
});

Deno.test("空の speakerNames を拒否する", () => {
  const parsed = parseCreateRequest(
    {
      sourceUrl: "https://example.com/audio.mp3",
      options: { speakerNames: [] },
    },
    () => true,
  );
  assertEquals(
    parsed,
    "options.speakerNames は1〜32件の空でない文字列にしてください",
  );
});

Deno.test("永続化ジョブを作成し、別リクエストで状態を取得できる", async () => {
  const { handler, jobs, dispatcher } = createTestHandler();
  const createResponse = await handler(
    new Request(
      "https://api.test/v1/transcription-jobs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: "https://example.com/audio.mp3",
          options: { summarize: true },
        }),
      },
    ),
  );
  assertEquals(createResponse.status, 202);
  const created = await createResponse.json();
  assertEquals(created.status, "queued");
  assertEquals(dispatcher.calls, [created.id]);

  await jobs.update(created.id, { status: "processing" });
  const statusResponse = await handler(
    new Request(`https://api.test/v1/transcription-jobs/${created.id}`),
  );
  assertEquals(statusResponse.status, 200);
  assertEquals((await statusResponse.json()).status, "processing");
});

Deno.test("同じ Idempotency-Key は再ディスパッチせず元のジョブを返す", async () => {
  const { handler, dispatcher } = createTestHandler();
  const request = () =>
    new Request("https://api.test/v1/transcription-jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "meeting-123",
      },
      body: JSON.stringify({ sourceUrl: "https://example.com/audio.mp3" }),
    });

  const first = await handler(request());
  const second = await handler(request());
  assertEquals(first.status, 202);
  assertEquals(second.status, 202);
  assertEquals(dispatcher.calls.length, 1);
  assertEquals((await first.json()).id, (await second.json()).id);
});

Deno.test("呼び出し元が異なれば同じ Idempotency-Key でも別ジョブになる", async () => {
  const { handler, dispatcher } = createTestHandler();
  const request = (caller: string) =>
    new Request("https://api.test/v1/transcription-jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "meeting-123",
        "x-test-caller": caller,
      },
      body: JSON.stringify({ sourceUrl: "https://example.com/audio.mp3" }),
    });

  const first = await handler(request("caller-a"));
  const second = await handler(request("caller-b"));
  assertEquals(first.status, 202);
  assertEquals(second.status, 202);
  assertEquals(dispatcher.calls.length, 2);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assertEquals(firstBody.id === secondBody.id, false);
});

Deno.test("同じ Idempotency-Key の内容が異なる場合は409を返す", async () => {
  const { handler } = createTestHandler();
  const request = (sourceUrl: string) =>
    new Request("https://api.test/v1/transcription-jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "meeting-123",
      },
      body: JSON.stringify({ sourceUrl }),
    });

  assertEquals(
    (await handler(request("https://example.com/a.mp3"))).status,
    202,
  );
  assertEquals(
    (await handler(request("https://example.com/b.mp3"))).status,
    409,
  );
});

Deno.test("ディスパッチ失敗時は503を返しジョブを失敗状態にする", async () => {
  const { handler, jobs, dispatcher } = createTestHandler();
  dispatcher.error = new Error("dispatch failed");
  const response = await handler(
    new Request("https://api.test/v1/transcription-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl: "https://example.com/audio.mp3" }),
    }),
  );

  assertEquals(response.status, 503);
  const body = await response.json();
  assertEquals(jobs.values.get(body.id)?.status, "failed");
});

Deno.test("失敗済みジョブを同じ Idempotency-Key で再送すると再実行する", async () => {
  const { handler, jobs, dispatcher } = createTestHandler();
  const request = () =>
    new Request("https://api.test/v1/transcription-jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "retry-meeting",
      },
      body: JSON.stringify({ sourceUrl: "https://example.com/audio.mp3" }),
    });

  dispatcher.error = new Error("dispatch failed");
  const failedResponse = await handler(request());
  const failed = await failedResponse.json();
  const stored = jobs.values.get(failed.id)!;
  jobs.values.set(failed.id, { ...stored, attempts: 2 });

  dispatcher.error = null;
  const retriedResponse = await handler(request());
  assertEquals(retriedResponse.status, 202);
  assertEquals(jobs.values.get(failed.id)?.attempts, 0);
  assertEquals(jobs.values.get(failed.id)?.status, "queued");
  assertEquals(dispatcher.calls, [failed.id, failed.id]);
});

Deno.test("失敗したジョブを再試行すると試行回数をリセットする", async () => {
  const { handler, jobs, dispatcher } = createTestHandler();
  const now = new Date().toISOString();
  jobs.values.set("job-retry", {
    id: "job-retry",
    status: "failed",
    sourceUrl: "https://example.com/audio.mp3",
    options: { diarize: true, showTimestamp: true, tagAudioEvents: true },
    requestFingerprint: "fingerprint",
    createdAt: now,
    updatedAt: now,
    attempts: 2,
    error: "failed",
  });

  const response = await handler(
    new Request("https://api.test/v1/transcription-jobs/job-retry/retry", {
      method: "POST",
    }),
  );
  assertEquals(response.status, 202);
  assertEquals(
    response.headers.get("location"),
    "/v1/transcription-jobs/job-retry",
  );
  assertEquals(jobs.values.get("job-retry")?.attempts, 0);
  assertEquals(dispatcher.calls, ["job-retry"]);
});

Deno.test("失敗状態でないジョブの再試行は409を返す", async () => {
  const { handler, jobs } = createTestHandler();
  const now = new Date().toISOString();
  jobs.values.set("job-processing", {
    id: "job-processing",
    status: "processing",
    sourceUrl: "https://example.com/audio.mp3",
    options: { diarize: true, showTimestamp: true, tagAudioEvents: true },
    requestFingerprint: "fingerprint",
    createdAt: now,
    updatedAt: now,
    attempts: 1,
  });
  const response = await handler(
    new Request("https://api.test/v1/transcription-jobs/job-processing/retry", {
      method: "POST",
    }),
  );
  assertEquals(response.status, 409);
});

Deno.test("未知のパスは404、未対応メソッドは405を返す", async () => {
  const { handler } = createTestHandler();
  assertEquals(
    (await handler(new Request("https://api.test/v1/unknown"))).status,
    404,
  );
  assertEquals(
    (await handler(
      new Request("https://api.test/v1/transcription-jobs/job-1", {
        method: "POST",
      }),
    )).status,
    405,
  );
});

Deno.test("予期しない例外は JSON の500応答へ変換する", async () => {
  const { handler, jobs } = createTestHandler();
  jobs.getError = new Error("firestore unavailable");
  const response = await handler(
    new Request("https://api.test/v1/transcription-jobs/job-1"),
  );
  assertEquals(response.status, 500);
  assertEquals(response.headers.get("content-type"), "application/json");
  assertEquals((await response.json()).error, "INTERNAL_SERVER_ERROR");
});

Deno.test("完了結果を結果ストレージから取得する", async () => {
  const { handler, jobs, results } = createTestHandler();
  const now = new Date().toISOString();
  const job: TranscriptionJob = {
    id: "job-1",
    status: "succeeded",
    sourceUrl: "https://example.com/audio.mp3",
    options: {
      diarize: true,
      showTimestamp: true,
      tagAudioEvents: true,
    },
    requestFingerprint: "fingerprint",
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    resultObject: "job-1.json",
  };
  jobs.values.set(job.id, job);
  results.values.set("job-1.json", {
    jobId: job.id,
    transcript: "hello",
    languageCode: "en",
    timings: {
      conversionMs: 0,
      fileReadMs: 1,
      sttMs: 2,
      speakerIdentificationMs: 0,
      coreTotalMs: 2,
      totalMs: 3,
      inputBytes: 10,
      processedBytes: 10,
    },
  });

  const response = await handler(
    new Request(`https://api.test/v1/transcription-jobs/${job.id}/result`),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).transcript, "hello");
});
