import { ElevenLabsClient } from "elevenlabs";
import { dirname } from "@std/path";
import type { TranscriptionOptions, WordItem } from "./types.ts";
import {
  formatTranscriptSegments,
  segmentWords,
} from "../utils/transcript-segments.ts";
import { convertVideoToAudio, isVideoFile } from "../utils/utils.ts";
import {
  identifySpeakers,
  replaceSpeakerLabels,
} from "../clients/gemini-client.ts";
import { config } from "./config.ts";
import { elapsedMs, logPerformance } from "../utils/performance.ts";

let elevenlabsInstance: ElevenLabsClient | null = null;
function getElevenLabsClient(): ElevenLabsClient {
  if (!elevenlabsInstance) {
    elevenlabsInstance = new ElevenLabsClient({
      apiKey: config.elevenLabsApiKey,
    });
  }
  return elevenlabsInstance;
}

export interface TranscriptionResult {
  transcript: string;
  languageCode: string | null;
  words?: WordItem[];
  timings: TranscriptionTimings;
}

export interface TranscriptionTimings {
  conversionMs: number;
  fileReadMs: number;
  sttMs: number;
  speakerIdentificationMs: number;
  coreTotalMs: number;
  totalMs: number;
  inputBytes: number;
  processedBytes: number;
}

/**
 * Core transcription function that is platform-independent
 * @param fileData - The audio/video file data as Uint8Array
 * @param mimeType - MIME type of the file
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribeCore(
  fileData: Uint8Array<ArrayBuffer>,
  mimeType: string,
  options: TranscriptionOptions,
  performanceId: string = crypto.randomUUID(),
): Promise<TranscriptionResult> {
  const coreStartedAt = performance.now();
  console.log("Calling ElevenLabs API with options:", options);
  console.log(`File size: ${fileData.length} bytes, MIME type: ${mimeType}`);

  // Create blob from file data with explicit MIME type
  // After video conversion, mimeType should be audio/mp4 (m4a)
  // NOTE: fileDataを直接渡す（コピーするとピークメモリがファイルサイズ分増える）
  const fileBlob = new Blob([fileData], { type: mimeType });

  // Determine filename extension based on MIME type
  const extension = mimeType === "audio/wav"
    ? "wav"
    : mimeType === "audio/mpeg"
    ? "mp3"
    : mimeType === "audio/mp4"
    ? "m4a"
    : mimeType === "audio/ogg"
    ? "ogg"
    : mimeType === "audio/flac"
    ? "flac"
    : "audio";
  const filename = `audio.${extension}`;

  // Create File object with filename (important for ElevenLabs API)
  const file = new File([fileBlob], filename, { type: mimeType });

  console.log(
    `Sending to ElevenLabs: filename=${filename}, type=${mimeType}, size=${file.size}`,
  );

  // Call ElevenLabs API
  const sttStartedAt = performance.now();
  const scribeResult = await getElevenLabsClient().speechToText.convert({
    file: file,
    model_id: "scribe_v2",
    tag_audio_events: options.tagAudioEvents,
    diarize: options.diarize,
    ...(options.diarize && options.numSpeakers
      ? { num_speakers: options.numSpeakers }
      : {}),
  }, { timeoutInSeconds: 3600 });
  const sttMs = elapsedMs(sttStartedAt);

  const words: WordItem[] | undefined =
    (scribeResult as { words?: WordItem[] }).words;
  let transcript = "";

  // Process transcription from word-level timestamps. Speaker labels are optional
  // metadata on top of the same segmentation rules.
  if (Array.isArray(words) && words.length > 0) {
    const segments = segmentWords(words, {
      splitOnSpeakerChange: options.diarize,
    });
    transcript = formatTranscriptSegments(segments, options);
  } else {
    const plain = (scribeResult.text || "").trim();
    transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
  }

  // Apply speaker name mapping if provided
  let speakerIdentificationMs = 0;
  if (
    options.diarize && options.speakerNames &&
    options.speakerNames.length > 0 && transcript
  ) {
    const speakerIdentificationStartedAt = performance.now();
    try {
      console.log("Identifying speakers with names:", options.speakerNames);
      const speakerMapping = await identifySpeakers(
        transcript,
        options.speakerNames,
      );
      transcript = replaceSpeakerLabels(transcript, speakerMapping);
      console.log("Speaker labels replaced successfully");
    } catch (error) {
      console.error("Failed to identify speakers:", error);
      // Continue with original transcript if speaker identification fails
    } finally {
      speakerIdentificationMs = elapsedMs(speakerIdentificationStartedAt);
    }
  }

  const languageCode =
    (scribeResult as { language_code?: string }).language_code || null;
  const coreTotalMs = elapsedMs(coreStartedAt);

  logPerformance("transcription_core", {
    performanceId,
    mimeType,
    processedBytes: fileData.length,
    sttMs,
    speakerIdentificationMs,
    coreTotalMs,
  });

  return {
    transcript,
    languageCode,
    words,
    timings: {
      conversionMs: 0,
      fileReadMs: 0,
      sttMs,
      speakerIdentificationMs,
      coreTotalMs,
      totalMs: coreTotalMs,
      inputBytes: fileData.length,
      processedBytes: fileData.length,
    },
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
  mimeType?: string,
  performanceId: string = crypto.randomUUID(),
): Promise<TranscriptionResult> {
  const startedAt = performance.now();
  let processedFilePath = filePath;
  let audioFilePath: string | null = null;
  let convertedMimeType: string | null = null;
  let conversionMs = 0;
  let fileReadMs = 0;

  try {
    // Determine MIME type: use provided mimeType, or infer from extension
    const extension = filePath.split(".").pop()?.toLowerCase() || "";
    const effectiveMimeType = mimeType || getMimeTypeFromExtension(extension);

    console.log(`Processing file: ${filePath}`);
    console.log(
      `MIME type: ${effectiveMimeType} (provided: ${
        mimeType || "none, inferred from extension"
      })`,
    );

    // Check if the file is a video and convert to audio if needed
    if (isVideoFile(effectiveMimeType)) {
      console.log("Detected video file, converting to audio...");
      // 話者識別を行う場合は可逆圧縮(FLAC)で音質を維持し、
      // 行わない場合はAACでサイズを最小化する
      const conversionStartedAt = performance.now();
      const converted = await convertVideoToAudio(
        filePath,
        options.diarize !== false,
      );
      conversionMs = elapsedMs(conversionStartedAt);
      audioFilePath = converted.path;
      convertedMimeType = converted.mimeType;
      processedFilePath = audioFilePath;
      console.log("Conversion complete:", audioFilePath);
    }

    // Read the processed file (original audio or converted audio)
    const fileReadStartedAt = performance.now();
    const fileData = await Deno.readFile(processedFilePath);
    fileReadMs = elapsedMs(fileReadStartedAt);

    const finalMimeType = convertedMimeType ?? effectiveMimeType;

    // Call the core transcription function
    const result = await transcribeCore(
      fileData,
      finalMimeType,
      options,
      performanceId,
    );
    const totalMs = elapsedMs(startedAt);
    const inputBytes = (await Deno.stat(filePath)).size;
    result.timings = {
      ...result.timings,
      conversionMs,
      fileReadMs,
      totalMs,
      inputBytes,
      processedBytes: fileData.length,
    };

    logPerformance("transcription_file", {
      performanceId,
      inputMimeType: effectiveMimeType,
      processedMimeType: finalMimeType,
      inputBytes,
      processedBytes: fileData.length,
      conversionMs,
      fileReadMs,
      sttMs: result.timings.sttMs,
      speakerIdentificationMs: result.timings.speakerIdentificationMs,
      totalMs,
    });

    return result;
  } finally {
    // Clean up converted audio file if it was created
    if (audioFilePath) {
      console.log("Cleaning up converted audio file:", audioFilePath);
      await Deno.remove(audioFilePath).catch(() => {});
      const audioDir = dirname(audioFilePath);
      await Deno.remove(audioDir).catch(() => {});
    }
  }
}
