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

/** ジョブを取得し、ダウンロード・文字起こし・結果保存まで実行する。 */
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
    console.log(`ジョブ ${jobId} は処理中、完了済み、または試行回数上限です`);
    return "skipped";
  }

  let tempPath: string | undefined;
  try {
    const download = await cloudServiceManager.downloadFromUrl(job.sourceUrl, {
      performanceId: job.id,
    });
    tempPath = download.tempPath;
    if (!download.success || !download.metadata || !download.tempPath) {
      throw new Error(
        download.error || "入力メディアのダウンロードに失敗しました",
      );
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
      try {
        result.summary = await summarizeTranscript(transcription.transcript);
      } catch (summaryError) {
        console.error(
          `ジョブ ${job.id} の要約生成に失敗しました:`,
          summaryError,
        );
      }
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
    console.log(`文字起こしジョブ ${job.id} が完了しました`);
    return "completed";
  } catch (error) {
    const message = getErrorMessage(error);
    await dependencies.jobs.update(job.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    console.error(`文字起こしジョブ ${job.id} が失敗しました:`, error);
    throw error;
  } finally {
    if (tempPath) {
      await cloudServiceManager.cleanupDownloadedFile(tempPath).catch(
        console.error,
      );
    }
  }
}
