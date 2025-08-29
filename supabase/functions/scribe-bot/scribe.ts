import { ElevenLabsClient } from "npm:elevenlabs@1.59.0";
import { createClient } from "jsr:@supabase/supabase-js@^2";
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
} from "./utils.ts";
import {
  sendSlackMessage,
  uploadTranscriptToSlack,
  downloadSlackFileToPath,
} from "./slack.ts";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!ELEVENLABS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables for Scribe service");
}

const elevenlabs = new ElevenLabsClient({
  apiKey: ELEVENLABS_API_KEY,
});

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

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
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  let errorMsg: string | null = null;
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

    const fileInfo = await Deno.stat(tempFilePath);
    const fileSizeMB = fileInfo.size / (1024 * 1024);
    console.log(`File size: ${fileSizeMB.toFixed(2)}MB`);
    
    if (fileSizeMB > 100) {
      console.warn(`Large file detected: ${fileSizeMB.toFixed(2)}MB - may approach memory limits`);
      await sendSlackMessage(
        channelId,
        `⚠️ Large file detected (${fileSizeMB.toFixed(2)}MB). Processing may take longer...`,
        timestamp,
      );
    }

    console.log("calling elevenlabs with options:", options);

    const file = await Deno.open(tempFilePath, { read: true });
    const fileData = await Deno.readFile(tempFilePath);
    file.close();
    
    const fileBlob = new Blob([fileData], {
      type: fileType,
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

    console.log("ElevenLabs API response received");
    console.log("Scribe result:", JSON.stringify(scribeResult, null, 2));

    const words: WordItem[] | undefined = (scribeResult as { words?: WordItem[] }).words;

    if (options.diarize && Array.isArray(words) && words.length > 0) {
      const grouped = groupBySpeaker(words);
      transcript = grouped
        .map((u) => {
          const speakerLabel = typeof u.speaker === "number"
            ? `speaker_${u.speaker}`
            : `${u.speaker}`;
          if (options.showTimestamp) {
            return `[${formatTimestamp(u.start)}] ${speakerLabel}: ${u.text.trim()}`;
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
            return `[${formatTimestamp(s.start)}] ${s.text}`;
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

    console.log("Generated transcript:", transcript);
    console.log("Language code:", languageCode);

    if (transcript) {
      // Add header with filename if provided
      const finalTranscript = filename 
        ? createTranscriptionHeader(filename) + transcript
        : transcript;
      await uploadTranscriptToSlack(finalTranscript, channelId, timestamp);
    } else {
      console.log("No transcript generated, sending error message");
      await sendSlackMessage(
        channelId,
        "Sorry, no transcript was generated. Please try again.",
        timestamp,
      );
    }
  } catch (error) {
    errorMsg = error instanceof Error ? error.message : String(error);
    
    if (errorMsg.includes('memory') || errorMsg.includes('allocation')) {
      console.error('Memory limit exceeded for file processing');
      await sendSlackMessage(
        channelId,
        "File too large for processing. Please try a smaller file (under 100MB recommended).",
        timestamp,
      );
    } else {
      await sendSlackMessage(
        channelId,
        "Sorry, there was an error. Please try again.",
        timestamp,
      );
    }
  } finally {
    if (tempFilePath && !isGoogleDrive) {
      // Clean up Slack-downloaded files
      try {
        console.log("cleaning up temp file:", tempFilePath);
        await Deno.remove(tempFilePath);
        const tempDir = tempFilePath.substring(
          0,
          tempFilePath.lastIndexOf("/"),
        );
        try {
          await Deno.remove(tempDir);
        } catch {
          // Ignore error if directory is not empty or doesn't exist
        }
      } catch (cleanupError) {
        console.log("Error cleaning up temp file:", cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    } else if (tempFilePath && isGoogleDrive) {
      // Clean up Google Drive downloaded files
      try {
        console.log("cleaning up Google Drive temp file:", tempFilePath);
        await Deno.remove(tempFilePath);
        const tempDir = tempFilePath.substring(
          0,
          tempFilePath.lastIndexOf("/"),
        );
        try {
          await Deno.remove(tempDir);
        } catch {
          // Ignore error if directory is not empty or doesn't exist
        }
      } catch (cleanupError) {
        console.log("Error cleaning up Google Drive temp file:", cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
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
  
  await supabase.from("transcription_logs").insert({ ...logLine, transcript });
}