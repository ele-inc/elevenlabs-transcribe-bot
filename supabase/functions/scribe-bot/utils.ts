import { TranscriptionOptions, WordItem, Sentence, SpeakerUtterance } from "./types.ts";
import { isGoogleDriveUrl } from "./googledrive.ts";

export const parseTranscriptionOptions = (text: string = ""): TranscriptionOptions => {
  const diarize = !text.includes("--no-diarize");

  // Parse num-speakers from command, or use default of 2 when diarize is enabled
  let numSpeakers: number | undefined;
  if (diarize) {
    const numSpeakersMatch = text.match(/--num-speakers\s+(\d+)/);
    if (numSpeakersMatch) {
      const parsed = parseInt(numSpeakersMatch[1], 10);
      numSpeakers = (parsed >= 1 && parsed <= 32) ? parsed : 2;
    } else {
      numSpeakers = 2; // Default to 2 speakers when diarize is true
    }
  }

  return {
    diarize,
    showTimestamp: !text.includes("--no-timestamp"),
    tagAudioEvents: !text.includes("--no-audio-events"),
    ...(numSpeakers ? { numSpeakers } : {}),
  };
};

export const getFileExtensionFromMime = (mimeType: string): string => {
  const mimeToExt: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/mpeg": "mpg",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/webm": "webm",
  };
  return mimeToExt[mimeType] || mimeType.split("/")[1] || "bin";
};

export const formatTimestamp = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${
      secs.toString().padStart(2, "0")
    }`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const extractSentences = (words: WordItem[]): Sentence[] => {
  const sentences: Sentence[] = [];
  let currentSentence = "";
  let currentStart: number | null = null;

  for (const word of words) {
    if (currentSentence === "") {
      currentStart = word.start;
    }

    currentSentence += word.text;

    if (isSentenceEndMarker(word.text)) {
      if (currentSentence.trim() !== "" && currentStart !== null) {
        sentences.push({
          text: currentSentence.trim(),
          start: currentStart,
        });
      }
      currentSentence = "";
      currentStart = null;
    }
  }

  if (currentSentence.trim() !== "" && currentStart !== null) {
    sentences.push({ text: currentSentence.trim(), start: currentStart });
  }

  return sentences;
};

function isSentenceEndMarker(text: string): boolean {
  return /^[。！？.!?]$/.test(text);
}

export const createTranscriptionHeader = (filename: string): string => {
  return `Original filename: ${filename}\n\n# Transcription Result\n\n`;
}

export const groupBySpeaker = (words: WordItem[]): SpeakerUtterance[] => {
  const conversation: SpeakerUtterance[] = [];
  let currentSpeaker: string | number | null = null;
  let currentText = "";
  let currentStart = 0;

  for (const word of words) {
    const speakerId = word.speaker_id ?? "unknown_speaker";

    if (currentSpeaker === null) {
      currentSpeaker = speakerId;
      currentText = word.text;
      currentStart = word.start;
    } else if (currentSpeaker === speakerId) {
      currentText += word.text;
    } else {
      conversation.push({
        speaker: currentSpeaker,
        text: currentText,
        start: currentStart,
      });

      currentSpeaker = speakerId;
      currentText = word.text;
      currentStart = word.start;
    }
  }

  if (currentText && currentSpeaker !== null) {
    conversation.push({
      speaker: currentSpeaker,
      text: currentText,
      start: currentStart,
    });
  }

  return conversation;
};

export const extractGoogleDriveUrls = (text: string): string[] => {
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  const urls = text.match(urlPattern) || [];
  return urls.filter(url => isGoogleDriveUrl(url));
};

/**
 * 動画ファイルから音声(MP3)を抽出する
 * @param inputPath 入力動画ファイルのパス
 * @returns 変換された音声ファイルのパス
 */
export const convertVideoToAudio = async (
  inputPath: string
): Promise<string> => {
  const outputDir = await Deno.makeTempDir();
  try {
    // 元のファイル名を保持してmp3拡張子に変更
    const originalBaseName = inputPath.substring(inputPath.lastIndexOf('/') + 1, inputPath.lastIndexOf('.'));
    const outputPath = `${outputDir}/${originalBaseName}.mp3`;

    console.log(`Converting video to audio: ${inputPath} -> ${outputPath}`);

    // ffmpegコマンドで動画から音声を抽出
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-i", inputPath,
        "-vn",
        "-acodec", "mp3",
        "-ab", "192k",
        "-ar", "44100",
        "-y",
        outputPath
      ],
      stdout: "piped",
      stderr: "piped",
    });
    
    const { success, stderr } = await command.output();
    
    if (!success) {
      const errorText = new TextDecoder().decode(stderr);
      throw new Error(`ffmpeg failed: ${errorText}`);
    }

    console.log(`Audio extraction completed: ${outputPath}`);
    return outputPath;
  } catch (error) {
    // Clean up temp directory on error
    try {
      await Deno.remove(outputDir, { recursive: true });
    } catch {}
    throw new Error(`Failed to convert video to audio: ${error}`);
  }
};

/**
 * Check if a file is a video based on MIME type
 */
export const isVideoFile = (mimeType: string): boolean => {
  return mimeType.startsWith('video/');
};
