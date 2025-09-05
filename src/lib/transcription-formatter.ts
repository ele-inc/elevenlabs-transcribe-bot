/**
 * Transcription formatting utilities
 */

import type { 
  WordItem, 
  SpeakerUtterance, 
  Sentence,
  TranscriptionOptions 
} from "../types/transcription.ts";
import { formatTimestamp } from "./time.ts";
import { extractSentences, groupBySpeaker } from "./text-processing.ts";

/**
 * Format transcription result based on options
 */
export function formatTranscription(
  words: WordItem[] | undefined,
  options: TranscriptionOptions,
  speakerNames?: string[]
): string {
  if (!words || words.length === 0) {
    return "";
  }

  if (options.diarize) {
    return formatDiarizedTranscription(words, options, speakerNames);
  } else {
    return formatSentenceTranscription(words, options);
  }
}

/**
 * Format diarized transcription with speaker labels
 */
function formatDiarizedTranscription(
  words: WordItem[],
  options: TranscriptionOptions,
  speakerNames?: string[]
): string {
  const grouped = groupBySpeaker(words);
  
  return grouped
    .map((utterance) => {
      const speakerLabel = formatSpeakerLabel(utterance.speaker, speakerNames);
      const timestamp = options.showTimestamp 
        ? `${formatTimestamp(utterance.start)} ` 
        : '';
      
      return `${timestamp}${speakerLabel}: ${utterance.text.trim()}`;
    })
    .join("\n");
}

/**
 * Format sentence-based transcription
 */
function formatSentenceTranscription(
  words: WordItem[],
  options: TranscriptionOptions
): string {
  const sentences = extractSentences(words);
  
  return sentences
    .map((sentence) => {
      const timestamp = options.showTimestamp 
        ? `${formatTimestamp(sentence.start)} ` 
        : '';
      
      return `${timestamp}${sentence.text}`;
    })
    .join("\n");
}

/**
 * Format speaker label with optional custom names
 */
export function formatSpeakerLabel(
  speaker: string | number,
  speakerNames?: string[]
): string {
  // If custom speaker names are provided
  if (speakerNames && typeof speaker === 'number') {
    const speakerIndex = speaker;
    if (speakerIndex >= 0 && speakerIndex < speakerNames.length) {
      return speakerNames[speakerIndex];
    }
  }
  
  // Default formatting
  return typeof speaker === "number"
    ? `speaker_${speaker}`
    : `${speaker}`;
}

/**
 * Create transcription header with metadata
 */
export function createTranscriptionHeader(
  filename: string,
  duration?: number,
  language?: string
): string {
  const lines = [
    `# Transcription Result`,
    ``,
    `**File:** ${filename}`,
  ];
  
  if (duration) {
    lines.push(`**Duration:** ${formatTimestamp(duration)}`);
  }
  
  if (language) {
    lines.push(`**Language:** ${language}`);
  }
  
  lines.push('', '---', '');
  
  return lines.join('\n');
}

/**
 * Format transcription with metadata
 */
export function formatFullTranscription(
  transcript: string,
  filename: string,
  duration?: number,
  language?: string
): string {
  const header = createTranscriptionHeader(filename, duration, language);
  return `${header}${transcript}`;
}

/**
 * Create summary of transcription
 */
export function createTranscriptionSummary(
  words: WordItem[],
  options: TranscriptionOptions
): { 
  wordCount: number;
  speakerCount?: number;
  duration?: number;
} {
  const wordCount = words.length;
  
  // Calculate duration from last word timestamp
  const lastWord = words[words.length - 1];
  const duration = lastWord?.end || lastWord?.start;
  
  // Count unique speakers if diarized
  let speakerCount: number | undefined;
  if (options.diarize) {
    const uniqueSpeakers = new Set(
      words.map(w => w.speaker_id).filter(s => s !== undefined)
    );
    speakerCount = uniqueSpeakers.size;
  }
  
  return {
    wordCount,
    speakerCount,
    duration,
  };
}