import type { TranscriptionJob } from "../api/transcription-job-types.ts";
import { canClaimTranscriptionJob } from "./transcription-job-contracts.ts";
import { assertEquals } from "@std/assert";

function processingJob(): TranscriptionJob {
  return {
    id: "job-1",
    status: "processing",
    sourceUrl: "https://example.com/audio.mp3",
    options: {
      diarize: true,
      showTimestamp: true,
      tagAudioEvents: true,
    },
    requestFingerprint: "fingerprint",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    startedAt: "2026-08-02T00:00:00.000Z",
    attempts: 1,
    workerExecution: "execution-a",
  };
}

Deno.test("同じ Cloud Run 実行の再試行はすぐジョブを再取得できる", () => {
  const job = processingJob();
  assertEquals(
    canClaimTranscriptionJob(
      job,
      2,
      "execution-a",
      Date.parse("2026-08-02T00:01:00.000Z"),
    ),
    true,
  );
});

Deno.test("別実行は有効な処理リースを奪えない", () => {
  const job = processingJob();
  assertEquals(
    canClaimTranscriptionJob(
      job,
      2,
      "execution-b",
      Date.parse("2026-08-02T00:01:00.000Z"),
    ),
    false,
  );
});

Deno.test("期限切れの処理リースは再取得できる", () => {
  const job = processingJob();
  assertEquals(
    canClaimTranscriptionJob(
      job,
      2,
      "execution-b",
      Date.parse("2026-08-02T03:00:00.000Z"),
    ),
    true,
  );
});

Deno.test("試行回数上限に達したジョブは再取得できない", () => {
  const job = { ...processingJob(), attempts: 2 };
  assertEquals(
    canClaimTranscriptionJob(
      job,
      2,
      "execution-a",
      Date.parse("2026-08-02T00:01:00.000Z"),
    ),
    false,
  );
});

Deno.test("成功済みジョブは再取得できない", () => {
  const job: TranscriptionJob = { ...processingJob(), status: "succeeded" };
  assertEquals(
    canClaimTranscriptionJob(
      job,
      2,
      "execution-a",
      Date.parse("2026-08-02T00:01:00.000Z"),
    ),
    false,
  );
});
