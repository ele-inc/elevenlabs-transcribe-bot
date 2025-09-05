import { ElevenLabsClient } from "npm:elevenlabs@1.59.0";
import {
  TranscriptionOptions,
  WordItem,
} from "./types.ts";
import {
  formatTimestamp,
  extractSentences,
  groupBySpeaker,
  isVideoFile,
} from "./utils.ts";
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
 * Transcribe a file from disk using streaming (memory efficient)
 * @param filePath - Path to the audio/video file
 * @param options - Transcription options
 * @returns Transcription result
 */
export async function transcribeFile(
  filePath: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  // Determine MIME type based on file extension
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeType = getMimeType(extension);

  // Check if the file is a video
  if (isVideoFile(mimeType)) {
    console.log("Detected video file, streaming conversion to MP3...");
    
    // Use ffmpeg streaming conversion (no temp files)
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-i", filePath,           // Input file
        "-vn",                    // No video
        "-acodec", "libmp3lame",  // MP3 encoder
        "-ab", "128k",            // Bitrate
        "-ar", "16000",           // Sample rate
        "-ac", "1",               // Mono
        "-f", "mp3",              // Output format
        "pipe:1"                  // Output to stdout
      ],
      stdout: "piped",
      stderr: "piped",
    });
    
    const process = command.spawn();
    
    // Handle ffmpeg errors in background
    (async () => {
      const decoder = new TextDecoder();
      const errorReader = process.stderr.getReader();
      try {
        while (true) {
          const { done, value } = await errorReader.read();
          if (done) break;
          const text = decoder.decode(value);
          if (text.includes("Error") || text.includes("error")) {
            console.error("ffmpeg error:", text);
          }
        }
      } finally {
        errorReader.releaseLock();
      }
    })();
    
    // Convert stream to blob for ElevenLabs API
    const chunks: Uint8Array[] = [];
    const reader = process.stdout.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    
    const audioBlob = new Blob(chunks, { type: "audio/mpeg" });
    console.log(`Audio size: ${(audioBlob.size / 1024 / 1024).toFixed(2)}MB`);
    
    // Call ElevenLabs API
    return await transcribeFromBlob(audioBlob, options);
    
  } else {
    // For audio files, stream directly
    console.log("Streaming audio file...");
    const file = await Deno.open(filePath, { read: true });
    
    try {
      // Read file in chunks and build blob
      const chunks: Uint8Array[] = [];
      const reader = file.readable.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      const audioBlob = new Blob(chunks, { type: mimeType });
      console.log(`Audio size: ${(audioBlob.size / 1024 / 1024).toFixed(2)}MB`);
      
      // Call ElevenLabs API
      return await transcribeFromBlob(audioBlob, options);
    } finally {
      file.close();
    }
  }
}

/**
 * Helper function to transcribe from Blob
 */
async function transcribeFromBlob(
  audioBlob: Blob,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  console.log("Calling ElevenLabs API with audio blob...");
  
  // Call ElevenLabs API
  const scribeResult = await elevenlabs.speechToText.convert({
    file: audioBlob,
    model_id: "scribe_v1",
    tag_audio_events: options.tagAudioEvents,
    diarize: options.diarize,
    language_code: "ja",
    ...(options.diarize && options.numSpeakers ? { num_speakers: options.numSpeakers } : {}),
  }, { timeoutInSeconds: 180 });

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

  // Apply speaker name mapping if provided
  if (options.diarize && options.speakerNames && options.speakerNames.length > 0 && transcript) {
    try {
      console.log("Identifying speakers with names:", options.speakerNames);
      const speakerMapping = await identifySpeakers(transcript, options.speakerNames);
      transcript = replaceSpeakerLabels(transcript, speakerMapping);
      console.log("Speaker labels replaced successfully");
    } catch (error) {
      console.error("Failed to identify speakers:", error);
    }
  }

  const languageCode = (scribeResult as { language_code?: string }).language_code || null;

  return {
    transcript,
    languageCode,
    words,
  };
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
