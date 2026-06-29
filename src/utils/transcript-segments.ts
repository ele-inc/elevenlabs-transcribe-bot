import type {
  TranscriptionOptions,
  TranscriptSegment,
  WordItem,
} from "../core/types.ts";

const DEFAULT_TARGET_SEGMENT_DURATION_SECONDS = 10;
const DEFAULT_MAX_SEGMENT_DURATION_SECONDS = 15;
const DEFAULT_MIN_SEGMENT_DURATION_SECONDS = 3;
const DEFAULT_MAX_SEGMENT_CHARS = 80;

interface SegmentWordsOptions {
  targetSegmentDurationSeconds?: number;
  maxSegmentDurationSeconds?: number;
  minSegmentDurationSeconds?: number;
  maxSegmentChars?: number;
  splitOnSpeakerChange?: boolean;
}

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

function isSentenceEndMarker(text: string): boolean {
  return /[。！？.!?]$/.test(text.trim());
}

function isSoftBreakMarker(text: string): boolean {
  return /[、，,;；:：]$/.test(text.trim());
}

function isBreakMarkerOnly(text: string): boolean {
  return /^[。！？.!?、，,;；:：]+$/.test(text.trim());
}

function getWordEnd(word: WordItem): number {
  return typeof word.end === "number" ? word.end : word.start;
}

function getSpeakerLabel(speaker: string | number): string {
  return typeof speaker === "number" ? `speaker_${speaker}` : `${speaker}`;
}

export const segmentWords = (
  words: WordItem[],
  options: SegmentWordsOptions = {},
): TranscriptSegment[] => {
  const targetDuration = options.targetSegmentDurationSeconds ??
    DEFAULT_TARGET_SEGMENT_DURATION_SECONDS;
  const maxDuration = options.maxSegmentDurationSeconds ??
    DEFAULT_MAX_SEGMENT_DURATION_SECONDS;
  const minDuration = options.minSegmentDurationSeconds ??
    DEFAULT_MIN_SEGMENT_DURATION_SECONDS;
  const maxChars = options.maxSegmentChars ?? DEFAULT_MAX_SEGMENT_CHARS;
  const splitOnSpeakerChange = options.splitOnSpeakerChange ?? false;

  const segments: TranscriptSegment[] = [];
  let currentText = "";
  let currentStart: number | null = null;
  let currentEnd: number | undefined;
  let currentSpeaker: string | number | undefined;

  const flush = () => {
    const text = currentText.trim();
    if (text !== "" && currentStart !== null) {
      segments.push({
        text,
        start: currentStart,
        ...(typeof currentEnd === "number" ? { end: currentEnd } : {}),
        ...(currentSpeaker !== undefined ? { speaker: currentSpeaker } : {}),
      });
    }

    currentText = "";
    currentStart = null;
    currentEnd = undefined;
    currentSpeaker = undefined;
  };

  for (const word of words) {
    const wordText = word.text ?? "";
    if (wordText === "" || !Number.isFinite(word.start)) {
      continue;
    }

    const wordSpeaker = word.speaker_id ?? currentSpeaker;
    const speakerChanged = splitOnSpeakerChange &&
      currentText !== "" &&
      word.speaker_id !== undefined &&
      currentSpeaker !== undefined &&
      word.speaker_id !== currentSpeaker;

    if (speakerChanged) {
      flush();
    }

    if (
      currentText !== "" &&
      currentStart !== null &&
      !isBreakMarkerOnly(wordText) &&
      Math.max(0, getWordEnd(word) - currentStart) >= maxDuration
    ) {
      flush();
    }

    if (currentText === "") {
      currentStart = word.start;
      currentSpeaker = wordSpeaker;
    }

    currentText += wordText;
    currentEnd = getWordEnd(word);

    const segmentStart = currentStart ?? word.start;
    const duration = Math.max(0, currentEnd - segmentStart);
    const textLength = currentText.trim().length;
    const sentenceEnd = isSentenceEndMarker(wordText);
    const softBreak = isSoftBreakMarker(wordText);
    const reachedTargetAtNaturalBreak = duration >= targetDuration &&
      (softBreak || sentenceEnd);
    const reachedLengthLimit = duration >= minDuration &&
      textLength >= maxChars;
    const reachedHardDurationLimit = duration >= maxDuration;

    if (
      sentenceEnd ||
      reachedTargetAtNaturalBreak ||
      reachedLengthLimit ||
      reachedHardDurationLimit
    ) {
      flush();
    }
  }

  flush();

  return segments;
};

export const formatTranscriptSegments = (
  segments: TranscriptSegment[],
  options: TranscriptionOptions,
): string => {
  return segments
    .map((segment) => {
      const timestamp = options.showTimestamp
        ? `${formatTimestamp(segment.start)} `
        : "";

      if (options.diarize) {
        const speakerLabel = segment.speaker !== undefined
          ? getSpeakerLabel(segment.speaker)
          : "unknown_speaker";
        return `${timestamp}${speakerLabel}: ${segment.text}`;
      }

      return `${timestamp}${segment.text}`;
    })
    .join("\n");
};
