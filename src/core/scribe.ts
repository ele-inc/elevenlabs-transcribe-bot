import { TranscriptionLog, TranscriptionOptions } from "./types.ts";
import { getFileExtensionFromMime } from "../utils/utils.ts";
import { PlatformAdapter } from "../adapters/platform-adapter.ts";
import {
  submitTranscriptionFileWebhook,
  transcribeFile,
  type TranscriptionTimings,
} from "./transcribe-core.ts";
import { TempFileManager } from "../services/temp-file-manager.ts";
import { elapsedMs, logPerformance } from "../utils/performance.ts";
import { deliverTranscriptionResult } from "../services/transcription-result-delivery.ts";
import { getElevenLabsWebhookConfig } from "./config.ts";
import { createTranscriptionWebhookMetadata } from "./transcription-webhook.ts";

/**
 * Transcribe audio/video file from Slack/Discord
 * Uses the unified transcribeFile function for processing
 */
export async function transcribeAudioFile({
  fileURL,
  fileType,
  duration,
  channelId,
  timestamp,
  userId,
  options,
  filename,
  sourceUrl,
  tempPath,
  performanceId = crypto.randomUUID(),
  adapter,
}: {
  fileURL: string;
  fileType: string;
  duration: number;
  channelId: string;
  timestamp: string;
  userId: string;
  options: TranscriptionOptions;
  filename?: string;
  sourceUrl?: string;
  tempPath?: string;
  performanceId?: string;
  adapter: PlatformAdapter;
}) {
  const startedAt = performance.now();
  let transcript: string | null = null;
  let languageCode: string | null = null;
  const errorMsg: string | null = null;
  let tempFilePath: string | null = null;
  let ownsTempFile = false;
  let inputBytes = 0;
  let downloadMs = 0;
  let transcriptUploadMs = 0;
  let summaryMs = 0;
  let cleanupMs = 0;
  let webhookRequestId: string | null = null;
  let transcriptionTimings: TranscriptionTimings | undefined;
  const tempManager = new TempFileManager();

  console.log("fileURL", fileURL, "scribe called");
  console.log("fileType (MIME):", fileType);

  try {
    if (tempPath) {
      // Reuse files already downloaded by the caller instead of copying them
      // through a file:// URL into another temporary file.
      tempFilePath = tempPath;
      console.log("Using existing temp path:", tempFilePath);
    } else {
      // Download from platform (Slack/Discord)
      const fileExtension = getFileExtensionFromMime(fileType);
      tempFilePath = await tempManager.createTempFile("audio", fileExtension);
      ownsTempFile = true;

      console.log("downloading file to temp path:", tempFilePath);
      const downloadStartedAt = performance.now();
      try {
        await adapter.downloadFile(fileURL, tempFilePath);
      } finally {
        downloadMs = elapsedMs(downloadStartedAt);
      }
    }
    inputBytes = (await Deno.stat(tempFilePath)).size;

    const webhookConfig = getElevenLabsWebhookConfig();
    if (webhookConfig) {
      const webhookMetadata = createTranscriptionWebhookMetadata({
        context: adapter.getWebhookDeliveryContext(),
        performanceId,
        filename,
        sourceUrl,
        fileType,
        duration,
        options,
      });
      const submission = await submitTranscriptionFileWebhook(
        tempFilePath,
        options,
        webhookConfig.webhookId,
        webhookMetadata as unknown as Record<string, unknown>,
        fileType,
        performanceId,
      );
      webhookRequestId = submission.requestId;
      transcriptionTimings = submission.timings;
      console.log("Transcription accepted for webhook delivery:", {
        performanceId,
        requestId: submission.requestId,
        transcriptionId: submission.transcriptionId,
      });
      return;
    }

    // Use the unified transcribeFile function
    // It handles video detection and conversion internally
    const result = await transcribeFile(
      tempFilePath,
      options,
      fileType,
      performanceId,
    );
    transcriptionTimings = result.timings;

    transcript = result.transcript;
    languageCode = result.languageCode;

    const delivery = await deliverTranscriptionResult({
      transcript,
      filename,
      sourceUrl,
      options,
      adapter,
    });
    transcriptUploadMs = delivery.transcriptUploadMs;
    summaryMs = delivery.summaryMs;
  } finally {
    const cleanupStartedAt = performance.now();
    // Clean up temp file (transcribeFile handles its own converted audio cleanup)
    if (tempFilePath && ownsTempFile) {
      console.log("cleaning up temp file:", tempFilePath);
      await tempManager.cleanupFileAndDir(tempFilePath);
    }

    // Clean up all remaining temp files
    await tempManager.cleanupAll();
    cleanupMs = elapsedMs(cleanupStartedAt);

    logPerformance("transcription_delivery", {
      performanceId,
      fileType,
      inputBytes,
      downloadMs,
      conversionMs: transcriptionTimings?.conversionMs ?? 0,
      fileReadMs: transcriptionTimings?.fileReadMs ?? 0,
      sttMs: transcriptionTimings?.sttMs ?? 0,
      speakerIdentificationMs: transcriptionTimings?.speakerIdentificationMs ??
        0,
      transcriptUploadMs,
      summaryMs,
      cleanupMs,
      totalMs: elapsedMs(startedAt),
      webhookRequestId,
      success: Boolean(transcript) || Boolean(webhookRequestId),
    });
  }

  const logLine: TranscriptionLog = {
    file_type: fileType,
    duration,
    channel_id: channelId,
    message_ts: timestamp,
    user_id: userId,
    language_code: languageCode,
    error: errorMsg,
  };

  // Log transcription completion to console
  console.log(
    webhookRequestId ? "Transcription submitted:" : "Transcription completed:",
    {
      ...logLine,
      webhookRequestId,
      transcriptLength: transcript ? transcript.length : 0,
      timestamp: new Date().toISOString(),
    },
  );
}
