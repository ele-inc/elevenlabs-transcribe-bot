import { ElevenLabsClient } from "npm:elevenlabs@1.59.0";
import {
  TranscriptionOptions,
  WordItem,
} from "./types.ts";
import {
  isVideoFile,
  convertVideoToAudio,
} from "./utils.ts";
import { formatTranscription } from "./lib/transcription-formatter.ts";
import { identifySpeakers, replaceSpeakerLabels } from "./openai-client.ts";
import { config } from "./config.ts";

const elevenlabs = new ElevenLabsClient({
  apiKey: config.elevenLabsApiKey,
});

export interface TranscriptionResult {
  transcript: string;
  languageCode: string | null;
  words?: WordItem[];
}


/**
 * Core transcription function that is platform-independent
 * @param fileData - The audio/video file data as Uint8Array
 * @param mimeType - MIME type of the file
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribeCore(
  fileData: Uint8Array,
  mimeType: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  console.log("Calling ElevenLabs API with options:", options);

  // Create blob from file data
  // Always use audio/mpeg for converted video files
  const blobType = isVideoFile(mimeType) ? "audio/mpeg" : mimeType;
  const fileBlob = new Blob([fileData], { type: blobType });

  // Call ElevenLabs API
  const scribeResult = await elevenlabs.speechToText.convert({
    file: fileBlob,
    model_id: "scribe_v1",
    tag_audio_events: options.tagAudioEvents,
    diarize: options.diarize,
    language_code: "ja",
    ...(options.diarize && options.numSpeakers ? { num_speakers: options.numSpeakers } : {}),
  }, { timeoutInSeconds: 180 });

  const words: WordItem[] | undefined = (scribeResult as { words?: WordItem[] }).words;
  
  // Format transcription using the formatter (before speaker name mapping)
  let transcript = formatTranscription(words, options, undefined);
  
  // Fallback to plain text if no words
  if (!transcript && !words) {
    const plain = (scribeResult.text || "").trim();
    transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
  }

  // Apply speaker name mapping if provided
  if (options.diarize && options.speakerNames && options.speakerNames.length > 0 && transcript) {
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

  const languageCode = (scribeResult as { language_code?: string }).language_code || null;

  return {
    transcript,
    languageCode,
    words,
  };
}

/**
 * Transcribe a file from disk
 * @param filePath - Path to the audio/video file
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribeFile(
  filePath: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  let processedFilePath = filePath;
  let audioFilePath: string | null = null;

  try {
    // Determine MIME type based on file extension
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const mimeType = getMimeType(extension);

    // Check if the file is a video and convert to MP3 if needed
    if (isVideoFile(mimeType)) {
      console.log("Detected video file, converting to MP3...");
      audioFilePath = await convertVideoToAudio(filePath);
      processedFilePath = audioFilePath;
      console.log("Conversion complete:", audioFilePath);
    }

    // Read the processed file (original audio or converted MP3)
    const fileData = await Deno.readFile(processedFilePath);

    // Use the appropriate MIME type
    const finalMimeType = audioFilePath ? "audio/mpeg" : mimeType;

    // Call the core transcription function
    const result = await transcribeCore(fileData, finalMimeType, options);

    return result;
  } finally {
    // Clean up converted audio file if it was created
    if (audioFilePath) {
      console.log("Cleaning up converted audio file:", audioFilePath);
      await Deno.remove(audioFilePath).catch(() => {});
      const audioDir = audioFilePath.substring(0, audioFilePath.lastIndexOf("/"));
      await Deno.remove(audioDir).catch(() => {});
    }
  }
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    flac: "audio/flac",
  };
  return mimeTypes[extension] || "application/octet-stream";
}
