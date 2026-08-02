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

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

class MemoryJobStore implements TranscriptionJobStore {
  readonly values = new Map<string, TranscriptionJob>();

  create(job: TranscriptionJob): Promise<TranscriptionJob> {
    const existing = this.values.get(job.id);
    if (existing) return Promise.reject(new JobAlreadyExistsError(existing));
    this.values.set(job.id, structuredClone(job));
    return Promise.resolve(job);
  }

  get(id: string): Promise<TranscriptionJob | null> {
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

  dispatch(jobId: string): Promise<string> {
    this.calls.push(jobId);
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
  });
  return { handler, jobs, results, dispatcher };
}

Deno.test("parseCreateRequest applies API defaults", () => {
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

Deno.test("parseCreateRequest rejects speaker options without diarization", () => {
  const parsed = parseCreateRequest(
    {
      sourceUrl: "https://example.com/audio.mp3",
      options: { diarize: false, numSpeakers: 2 },
    },
    () => true,
  );
  assertEquals(
    parsed,
    "speaker options require options.diarize to be enabled",
  );
});

Deno.test("create and reload a durable transcription job", async () => {
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

Deno.test("Idempotency-Key returns the original job without redispatch", async () => {
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

Deno.test("completed result is read from result storage", async () => {
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
