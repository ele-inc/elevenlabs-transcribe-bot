import { TranscriptionOptions, WordItem, Sentence, SpeakerUtterance } from "./types.ts";

export const parseTranscriptionOptions = (text: string = ""): TranscriptionOptions => {
  return {
    diarize: !text.includes("--no-diarize"),
    showTimestamp: !text.includes("--no-timestamp"),
    tagAudioEvents: !text.includes("--no-audio-events"),
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