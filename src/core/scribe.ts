import {
  TranscriptionOptions,
  TranscriptionLog
} from "./types.ts";
import {
  getFileExtensionFromMime,
  createTranscriptionHeader,
} from "../utils/utils.ts";
import { summarizeTranscript } from "../clients/gemini-client.ts";
import { PlatformAdapter } from "../adapters/platform-adapter.ts";
import {
  transcribeFile,
  type TranscriptionTimings,
} from "./transcribe-core.ts";
import { TempFileManager } from "../services/temp-file-manager.ts";
import { elapsedMs, logPerformance } from "../utils/performance.ts";

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

    if (transcript) {
      // Add header: URL takes precedence over filename when present
      const finalTranscript = sourceUrl || filename
        ? createTranscriptionHeader(filename, sourceUrl) + transcript
        : transcript;

      const transcriptUploadStartedAt = performance.now();
      try {
        await adapter.uploadTranscript(finalTranscript, filename);
      } finally {
        transcriptUploadMs = elapsedMs(transcriptUploadStartedAt);
      }
      if (options.summarize !== false) {
        const summaryStartedAt = performance.now();
        try {
          const summary = await summarizeTranscript(finalTranscript);
          await adapter.sendSummary(summary, { filename, options });
        } catch (error) {
          console.error("Failed to generate or send transcript summary:", error);
        } finally {
          summaryMs = elapsedMs(summaryStartedAt);
        }
      } else {
        console.log("Summary generation skipped by --no-summarize option");
      }
    } else {
      console.log("No transcript generated, sending error message");
      await adapter.sendErrorMessage("文字起こしの生成に失敗しました。もう一度お試しください。");
    }
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
      speakerIdentificationMs:
        transcriptionTimings?.speakerIdentificationMs ?? 0,
      transcriptUploadMs,
      summaryMs,
      cleanupMs,
      totalMs: elapsedMs(startedAt),
      success: Boolean(transcript),
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
  console.log("Transcription completed:", {
    ...logLine,
    transcriptLength: transcript ? transcript.length : 0,
    timestamp: new Date().toISOString()
  });
}
