import type { TranscriptionOptions, WordItem } from "./types.ts";
import {
  formatTranscriptSegments,
  segmentWords,
} from "../utils/transcript-segments.ts";

export type TranscriptionPayload = {
  text?: unknown;
  languageCode?: unknown;
  language_code?: unknown;
  words?: unknown;
};

export function normalizeAndFormatTranscriptionPayload(
  payload: TranscriptionPayload,
  options: TranscriptionOptions,
): {
  transcript: string;
  languageCode: string | null;
  words?: WordItem[];
} {
  const words = normalizeWords(payload.words);
  let transcript = "";

  if (words?.length) {
    const segments = segmentWords(words, {
      splitOnSpeakerChange: options.diarize,
    });
    transcript = formatTranscriptSegments(segments, options);
  } else {
    const plain = typeof payload.text === "string" ? payload.text.trim() : "";
    transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
  }

  return {
    transcript,
    languageCode: typeof payload.languageCode === "string"
      ? payload.languageCode
      : typeof payload.language_code === "string"
      ? payload.language_code
      : null,
    words,
  };
}

function normalizeWords(value: unknown): WordItem[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const words: WordItem[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.text !== "string" || typeof raw.start !== "number" ||
      !Number.isFinite(raw.start)
    ) {
      continue;
    }
    const speaker = raw.speakerId ?? raw.speaker_id;
    words.push({
      text: raw.text,
      start: raw.start,
      ...(typeof raw.end === "number" && Number.isFinite(raw.end)
        ? { end: raw.end }
        : {}),
      ...(typeof speaker === "string" || typeof speaker === "number"
        ? { speaker_id: speaker }
        : {}),
    });
  }
  return words.length > 0 ? words : undefined;
}
