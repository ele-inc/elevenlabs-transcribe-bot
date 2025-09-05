import {
  TranscriptionOptions,
  TranscriptionLog
} from "./types.ts";
import {
  getFileExtensionFromMime,
  createTranscriptionHeader,
} from "./utils.ts";
import {
  sendSlackMessage,
  uploadTranscriptToSlack,
  downloadSlackFileToPath,
} from "./slack.ts";
import {
  sendDiscordMessage,
  uploadTranscriptToDiscord,
} from "./discord.ts";
import { transcribeFile } from "./transcribe-core.ts";
import { transcribeViaTmpFile } from "./transcribe-stream.ts";

/**
 * Transcribe audio from a stream (memory efficient with tmp file spooling)
 */
export async function transcribeAudioFromStream({
  audioStream,
  fileType,
  channelId,
  timestamp,
  userId,
  options,
  filename,
  platform = "slack",
}: {
  audioStream: ReadableStream<Uint8Array>;
  fileType: string;
  channelId: string;
  timestamp: string;
  userId: string;
  options: TranscriptionOptions;
  filename?: string;
  platform?: "slack" | "discord";
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  const errorMsg: string | null = null;

  console.log("Streaming transcription called");
  console.log("fileType (MIME):", fileType);

  try {
    console.log("calling transcribe via tmp file with options:", options);

    // Use tmp file spooling to avoid OOM
    const result = await transcribeViaTmpFile(audioStream, options, filename);
    
    transcript = result.transcript;
    languageCode = result.languageCode;

    if (transcript) {
      // Add header with filename if provided
      const finalTranscript = filename
        ? createTranscriptionHeader(filename) + transcript
        : transcript;

      if (platform === "slack") {
        await uploadTranscriptToSlack(finalTranscript, channelId, timestamp);
      } else if (platform === "discord") {
        await uploadTranscriptToDiscord(finalTranscript, channelId);
      }
    } else {
      console.log("No transcript generated, sending error message");
      if (platform === "slack") {
        await sendSlackMessage(
          channelId,
          "Sorry, no transcript was generated. Please try again.",
          timestamp,
        );
      } else if (platform === "discord") {
        await sendDiscordMessage(
          channelId,
          "❌ 文字起こしの生成に失敗しました。もう一度お試しください。"
        );
      }
    }
  } catch (error) {
    console.error("Transcription error:", error);
    if (platform === "slack") {
      await sendSlackMessage(
        channelId,
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp,
      );
    } else if (platform === "discord") {
      await sendDiscordMessage(
        channelId,
        `❌ エラー: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  const logLine: TranscriptionLog = {
    file_type: fileType,
    duration: 0,
    channel_id: channelId,
    message_ts: timestamp,
    user_id: userId,
    language_code: languageCode,
    error: errorMsg,
  };

  // Log transcription completion to console
  console.log("Streaming transcription completed:", {
    ...logLine,
    transcriptLength: transcript ? transcript.length : 0,
    timestamp: new Date().toISOString()
  });
}

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
  platform = "slack",
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
  platform?: "slack" | "discord";
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  const errorMsg: string | null = null;
  let tempFilePath: string | null = null;

  console.log("fileURL", fileURL, "scribe called");
  console.log("fileType (MIME):", fileType);

  try {
    // Handle Google Drive files vs Slack files
    if (isGoogleDrive && tempPath) {
      // File is already downloaded from Google Drive
      tempFilePath = tempPath;
      console.log("Using Google Drive temp file:", tempFilePath);
    } else {
      // Download from Slack
      const tempDir = await Deno.makeTempDir();
      const fileExtension = getFileExtensionFromMime(fileType);
      tempFilePath = `${tempDir}/audio_${Date.now()}.${fileExtension}`;

      console.log("downloading file to temp path:", tempFilePath);
      await downloadSlackFileToPath(fileURL, tempFilePath);
    }

    console.log("calling transcribe-core with streaming, options:", options);

    // Use transcribeFile which now handles video conversion via streaming
    const result = await transcribeFile(tempFilePath, options);
    
    transcript = result.transcript;
    languageCode = result.languageCode;

    if (transcript) {

      // Add header with filename if provided
      const finalTranscript = filename
        ? createTranscriptionHeader(filename) + transcript
        : transcript;

      if (platform === "slack") {
        await uploadTranscriptToSlack(finalTranscript, channelId, timestamp);
      } else if (platform === "discord") {
        await uploadTranscriptToDiscord(finalTranscript, channelId);
      }
    } else {
      console.log("No transcript generated, sending error message");
      if (platform === "slack") {
        await sendSlackMessage(
          channelId,
          "Sorry, no transcript was generated. Please try again.",
          timestamp,
        );
      } else if (platform === "discord") {
        await sendDiscordMessage(
          channelId,
          "❌ 文字起こしの生成に失敗しました。もう一度お試しください。"
        );
      }
    }
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      if (!isGoogleDrive) {
        // Clean up Slack-downloaded files
        console.log("cleaning up temp file:", tempFilePath);
        await Deno.remove(tempFilePath).catch(() => {});
        const tempDir = tempFilePath.substring(
          0,
          tempFilePath.lastIndexOf("/"),
        );
        await Deno.remove(tempDir).catch(() => {});
      } else {
        // Clean up Google Drive downloaded files
        console.log("cleaning up Google Drive temp file:", tempFilePath);
        await Deno.remove(tempFilePath).catch(() => {});
        const tempDir = tempFilePath.substring(
          0,
          tempFilePath.lastIndexOf("/"),
        );
        await Deno.remove(tempDir).catch(() => {});
      }
    }
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
