import type { TranscriptionJobResult } from "../api/transcription-job-types.ts";
import { summarizeTranscript } from "../clients/gemini-client.ts";
import { transcribeFile } from "../core/transcribe-core.ts";
import { cloudServiceManager } from "./cloud-service-manager.ts";
import { FirestoreTranscriptionJobStore } from "./transcription-job-store.ts";
import { GcsTranscriptionResultStore } from "./transcription-result-store.ts";
import type {
  TranscriptionJobStore,
  TranscriptionResultStore,
} from "./transcription-job-contracts.ts";
import { resolveMediaMimeType } from "../utils/utils.ts";
import { getErrorMessage } from "../utils/errors.ts";

export interface TranscriptionWorkerDependencies {
  jobs: TranscriptionJobStore;
  results: TranscriptionResultStore;
}

export async function runTranscriptionJob(
  jobId: string,
  dependencies: TranscriptionWorkerDependencies = {
    jobs: new FirestoreTranscriptionJobStore(),
    results: new GcsTranscriptionResultStore(),
  },
): Promise<"completed" | "skipped"> {
  const workerExecution = Deno.env.get("CLOUD_RUN_EXECUTION") || undefined;
  const job = await dependencies.jobs.claim(jobId, 2, workerExecution);
  if (!job) {
    console.log(`Job ${jobId} is already owned, completed, or exhausted`);
    return "skipped";
  }

  let tempPath: string | undefined;
  try {
    const download = await cloudServiceManager.downloadFromUrl(job.sourceUrl, {
      performanceId: job.id,
    });
    tempPath = download.tempPath;
    if (!download.success || !download.metadata || !download.tempPath) {
      throw new Error(download.error || "Failed to download source media");
    }

    const mimeType = resolveMediaMimeType(
      download.metadata.mimeType,
      download.metadata.filename,
    ) || download.metadata.mimeType;
    const transcription = await transcribeFile(
      download.tempPath,
      job.options,
      mimeType,
      job.id,
    );

    const result: TranscriptionJobResult = {
      jobId: job.id,
      transcript: transcription.transcript,
      languageCode: transcription.languageCode,
      words: transcription.words,
      timings: transcription.timings,
    };
    if (job.options.summarize && transcription.transcript) {
      result.summary = await summarizeTranscript(transcription.transcript);
    }

    const resultObject = await dependencies.results.save(job.id, result);
    const completedAt = new Date().toISOString();
    await dependencies.jobs.update(job.id, {
      status: "succeeded",
      completedAt,
      filename: download.metadata.filename,
      mimeType,
      languageCode: transcription.languageCode,
      resultObject,
      error: undefined,
    });
    console.log(`Transcription job ${job.id} completed`);
    return "completed";
  } catch (error) {
    const message = getErrorMessage(error);
    await dependencies.jobs.update(job.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    console.error(`Transcription job ${job.id} failed:`, error);
    throw error;
  } finally {
    if (tempPath) {
      await cloudServiceManager.cleanupDownloadedFile(tempPath).catch(
        console.error,
      );
    }
  }
}
