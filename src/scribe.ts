import {
  TranscriptionOptions,
  TranscriptionLog
} from "./types.ts";
import {
  getFileExtensionFromMime,
  createTranscriptionHeader,
  convertVideoToAudio,
  isVideoFile,
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
import { transcribeCore } from "./transcribe-core.ts";
import { TempFileManager } from "./temp-file-manager.ts";


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
  let audioFilePath: string | null = null;
  let originalVideoPath: string | null = null;
  const tempManager = new TempFileManager();

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
      const fileExtension = getFileExtensionFromMime(fileType);
      tempFilePath = await tempManager.createTempFile("audio", fileExtension);

      console.log("downloading file to temp path:", tempFilePath);
      await downloadSlackFileToPath(fileURL, tempFilePath);
    }

    // Check if the file is a video and convert to MP3 if needed
    if (isVideoFile(fileType)) {
      console.log("Detected video file, converting to MP3...");
      originalVideoPath = tempFilePath;
      audioFilePath = await convertVideoToAudio(tempFilePath);
      tempFilePath = audioFilePath;

      // Delete the original video file after conversion
      console.log("Deleting original video file:", originalVideoPath);
      await Deno.remove(originalVideoPath);
    }

    // Read file into memory
    const fileData = await Deno.readFile(tempFilePath);

    // Use the appropriate MIME type
    const mimeType = isVideoFile(fileType) ? "audio/mpeg" : fileType;

    // Call the core transcription function
    const result = await transcribeCore(fileData, mimeType, options);

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
    // Clean up audio file if it was created from video conversion
    if (audioFilePath) {
      console.log("cleaning up converted audio file:", audioFilePath);
      await tempManager.cleanupFileAndDir(audioFilePath);
    }

    // Clean up original temp file if no audio conversion was done
    if (tempFilePath && !audioFilePath) {
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
