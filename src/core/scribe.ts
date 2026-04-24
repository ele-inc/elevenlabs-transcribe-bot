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
import { transcribeFile } from "./transcribe-core.ts";
import { TempFileManager } from "../services/temp-file-manager.ts";

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
  isGoogleDrive,
  tempPath,
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
  isGoogleDrive?: boolean;
  tempPath?: string;
  adapter: PlatformAdapter;
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  const errorMsg: string | null = null;
  let tempFilePath: string | null = null;
  const tempManager = new TempFileManager();

  console.log("fileURL", fileURL, "scribe called");
  console.log("fileType (MIME):", fileType);

  try {
    // Handle Google Drive files vs platform files
    if (isGoogleDrive && tempPath) {
      // File is already downloaded from cloud service
      tempFilePath = tempPath;
      console.log("Using cloud file temp path:", tempFilePath);
    } else {
      // Download from platform (Slack/Discord)
      const fileExtension = getFileExtensionFromMime(fileType);
      tempFilePath = await tempManager.createTempFile("audio", fileExtension);

      console.log("downloading file to temp path:", tempFilePath);
      await adapter.downloadFile(fileURL, tempFilePath);
    }

    // Use the unified transcribeFile function
    // It handles video detection and conversion internally
    const result = await transcribeFile(tempFilePath, options, fileType);

    transcript = result.transcript;
    languageCode = result.languageCode;

    if (transcript) {
      // Add header with filename if provided
      const finalTranscript = filename
        ? createTranscriptionHeader(filename) + transcript
        : transcript;

      await adapter.uploadTranscript(finalTranscript, filename);
      if (options.summarize !== false) {
        try {
          const summary = await summarizeTranscript(finalTranscript);
          await adapter.sendSummary(summary, { filename, options });
        } catch (error) {
          console.error("Failed to generate or send transcript summary:", error);
        }
      } else {
        console.log("Summary generation skipped by --no-summarize option");
      }
    } else {
      console.log("No transcript generated, sending error message");
      await adapter.sendErrorMessage("文字起こしの生成に失敗しました。もう一度お試しください。");
    }
  } finally {
    // Clean up temp file (transcribeFile handles its own converted audio cleanup)
    if (tempFilePath) {
      console.log("cleaning up temp file:", tempFilePath);
      await tempManager.cleanupFileAndDir(tempFilePath);
    }

    // Clean up all remaining temp files
    await tempManager.cleanupAll();
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
