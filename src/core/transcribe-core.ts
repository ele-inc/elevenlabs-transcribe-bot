import { ElevenLabsClient } from "npm:elevenlabs";
import {
  TranscriptionOptions,
  WordItem,
} from "./types.ts";
import {
  formatTimestamp,
  extractSentences,
  groupBySpeaker,
  isVideoFile,
  convertVideoToAudio,
} from "../utils/utils.ts";
import { identifySpeakers, replaceSpeakerLabels } from "../clients/openai-client.ts";
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
  console.log(`File size: ${fileData.length} bytes, MIME type: ${mimeType}`);

  // Create blob from file data with explicit MIME type
  // After video conversion, mimeType should be audio/wav
  const fileBlob = new Blob([fileData], { type: mimeType });

  // Determine filename extension based on MIME type
  const extension = mimeType === "audio/wav" ? "wav" :
                    mimeType === "audio/mpeg" ? "mp3" :
                    mimeType === "audio/mp4" ? "m4a" :
                    mimeType === "audio/ogg" ? "ogg" :
                    mimeType === "audio/flac" ? "flac" : "audio";
  const filename = `audio.${extension}`;

  // Create File object with filename (important for ElevenLabs API)
  const file = new File([fileBlob], filename, { type: mimeType });

  console.log(`Sending to ElevenLabs: filename=${filename}, type=${mimeType}, size=${file.size}`);

  // Call ElevenLabs API
  const scribeResult = await elevenlabs.speechToText.convert({
    file: file,
    model_id: "scribe_v1",
    tag_audio_events: options.tagAudioEvents,
    diarize: options.diarize,
    language_code: "ja",
    ...(options.diarize && options.numSpeakers ? { num_speakers: options.numSpeakers } : {}),
  }, { timeoutInSeconds: 3600 });

  const words: WordItem[] | undefined = (scribeResult as { words?: WordItem[] }).words;
  let transcript = "";

  // Process transcription based on options
  if (options.diarize && Array.isArray(words) && words.length > 0) {
    const grouped = groupBySpeaker(words);
    transcript = grouped
      .map((u) => {
        const speakerLabel = typeof u.speaker === "number"
          ? `speaker_${u.speaker}`
          : `${u.speaker}`;
        // Add line breaks after sentence-ending punctuation for readability
        // Use two trailing spaces before newline for Markdown line break compatibility
        const formattedText = u.text.trim().replace(/([。！？.!?])\s*/g, "$1  \n");
        if (options.showTimestamp) {
          return `${formatTimestamp(u.start)} ${speakerLabel}: ${formattedText}`;
        } else {
          return `${speakerLabel}: ${formattedText}`;
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
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(extension: string): string {
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
  return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}

/**
 * Transcribe a file from disk
 * Handles video-to-audio conversion automatically
 *
 * @param filePath - Path to the audio/video file
 * @param mimeType - MIME type of the file (if known). If not provided, will be inferred from extension.
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribeFile(
  filePath: string,
  options: TranscriptionOptions,
  mimeType?: string
): Promise<TranscriptionResult> {
  let processedFilePath = filePath;
  let audioFilePath: string | null = null;

  try {
    // Determine MIME type: use provided mimeType, or infer from extension
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const effectiveMimeType = mimeType || getMimeTypeFromExtension(extension);

    console.log(`Processing file: ${filePath}`);
    console.log(`MIME type: ${effectiveMimeType} (provided: ${mimeType || 'none, inferred from extension'})`);

    // Check if the file is a video and convert to audio if needed
    if (isVideoFile(effectiveMimeType)) {
      console.log("Detected video file, converting to audio...");
      audioFilePath = await convertVideoToAudio(filePath);
      processedFilePath = audioFilePath;
      console.log("Conversion complete:", audioFilePath);
    }

    // Read the processed file (original audio or converted audio)
    const fileData = await Deno.readFile(processedFilePath);

    // Use audio/wav for converted files (our ffmpeg outputs WAV)
    const finalMimeType = audioFilePath ? "audio/wav" : effectiveMimeType;

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
