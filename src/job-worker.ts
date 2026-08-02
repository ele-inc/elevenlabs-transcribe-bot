import { runTranscriptionJob } from "./services/transcription-job-worker.ts";

const jobId = Deno.env.get("TRANSCRIPTION_JOB_ID")?.trim();
if (!jobId) {
  console.error("TRANSCRIPTION_JOB_ID が必要です");
  Deno.exit(2);
}

try {
  await runTranscriptionJob(jobId);
} catch {
  // 0 以外で終了し、Cloud Run Jobs に設定した再試行を適用させる。
  Deno.exit(1);
}
