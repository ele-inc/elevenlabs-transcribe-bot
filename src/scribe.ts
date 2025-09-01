import { ElevenLabsClient } from "npm:elevenlabs@1.59.0";
import {
  TranscriptionOptions,
  WordItem,
  TranscriptionLog
} from "./types.ts";
import {
  getFileExtensionFromMime,
  formatTimestamp,
  extractSentences,
  groupBySpeaker,
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
import { config } from "./config.ts";
import { identifySpeakers, replaceSpeakerLabels } from "./openai-client.ts";

const elevenlabs = new ElevenLabsClient({
  apiKey: config.elevenLabsApiKey,
});


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

    const fileInfo = await Deno.stat(tempFilePath);
    const fileSizeMB = fileInfo.size / (1024 * 1024);
    console.log(`File size: ${fileSizeMB.toFixed(2)}MB`);

    // Warn about large files
    if (fileSizeMB > 200) {
      console.warn(`Warning: Large file detected (${fileSizeMB.toFixed(2)}MB). This may exceed memory limits.`);

      if (platform === "slack") {
        await sendSlackMessage(
          channelId,
          `⚠️ 大きなファイル（${fileSizeMB.toFixed(0)}MB）を処理中です。メモリ制限により失敗する可能性があります。`,
          timestamp,
        );
      }
      // Discord warnings are handled in discord-handler.ts
    }

    console.log("calling elevenlabs with options:", options);

    // Read file into memory only if it's small enough
    // For large files, we need a different approach
    const file = await Deno.open(tempFilePath, { read: true });
    const fileData = await Deno.readFile(tempFilePath);
    file.close();

    // Use the appropriate MIME type for the blob
    const blobType = isVideoFile(fileType) ? "audio/mpeg" : fileType;
    const fileBlob = new Blob([fileData], {
      type: blobType,
    });

    console.log("Sending to ElevenLabs API...");
    const scribeResult = await elevenlabs.speechToText.convert({
      file: fileBlob,
      model_id: "scribe_v1",
      tag_audio_events: options.tagAudioEvents,
      diarize: options.diarize,
      language_code: "ja",
      ...(options.diarize && options.numSpeakers ? { num_speakers: options.numSpeakers } : {}),
    }, { timeoutInSeconds: 180 });

    const words: WordItem[] | undefined = (scribeResult as { words?: WordItem[] }).words;

    if (options.diarize && Array.isArray(words) && words.length > 0) {
      const grouped = groupBySpeaker(words);
      transcript = grouped
        .map((u) => {
          const speakerLabel = typeof u.speaker === "number"
            ? `speaker_${u.speaker}`
            : `${u.speaker}`;
          if (options.showTimestamp) {
            return `${formatTimestamp(u.start)} ${speakerLabel}: ${u.text.trim()}`;
          } else {
            return `${speakerLabel}: ${u.text.trim()}`;
          }
        })
        .join("\n");
    } else if (!options.diarize && Array.isArray(words) && words.length > 0) {
      const sentences = extractSentences(words);
      transcript = sentences
        .map((s) => {
          if (options.showTimestamp) {
            return `${formatTimestamp(s.start)} ${s.text}`;
          } else {
            return s.text;
          }
        })
        .join("\n");
    } else {
      const plain = (scribeResult.text || "").trim();
      transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
    }

    languageCode = (scribeResult as { language_code?: string }).language_code || null;

    if (transcript) {
      // Apply speaker name mapping if provided
      if (options.diarize && options.speakerNames && options.speakerNames.length > 0) {
        try {
          console.log("Identifying speakers with names:", options.speakerNames);
          const speakerMapping = await identifySpeakers(transcript, options.speakerNames);
          transcript = replaceSpeakerLabels(transcript, speakerMapping);
          console.log("Speaker labels replaced successfully");
        } catch (error) {
          console.error("Failed to identify speakers:", error);
          // Continue with original transcript if speaker identification fails
        }
      }

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
      await Deno.remove(audioFilePath).catch(() => {});
      const audioDir = audioFilePath.substring(
        0,
        audioFilePath.lastIndexOf("/"),
      );
      await Deno.remove(audioDir).catch(() => {});
    }

    // Clean up original temp file if no audio conversion was done
    if (tempFilePath && !audioFilePath) {
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
