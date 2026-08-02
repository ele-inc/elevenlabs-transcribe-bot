import type { TranscriptionJob } from "../api/transcription-job-types.ts";
import { canClaimTranscriptionJob } from "./transcription-job-contracts.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

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

Deno.test("a Cloud Run task retry can immediately reclaim its job", () => {
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

Deno.test("a duplicate execution cannot steal a live processing lease", () => {
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

Deno.test("a stale processing lease can be recovered", () => {
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
