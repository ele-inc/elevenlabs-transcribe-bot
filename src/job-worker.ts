import { runTranscriptionJob } from "./services/transcription-job-worker.ts";

const jobId = Deno.env.get("TRANSCRIPTION_JOB_ID")?.trim();
if (!jobId) {
  console.error("TRANSCRIPTION_JOB_ID is required");
  Deno.exit(2);
}

try {
  await runTranscriptionJob(jobId);
} catch {
  // A non-zero exit lets Cloud Run Jobs apply its configured retry policy.
  Deno.exit(1);
}
