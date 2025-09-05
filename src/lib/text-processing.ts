/**
 * Text processing utilities
 */

import type { WordItem, Sentence, SpeakerUtterance } from "../types.ts";

/**
 * Check if a word ends a sentence
 */
export const isSentenceEndMarker = (text: string): boolean => {
  return /[.!?。！？]$/.test(text.trim());
};

/**
 * Extract sentences from word items
 */
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

  // Add any remaining text as a sentence
  if (currentSentence.trim() !== "" && currentStart !== null) {
    sentences.push({ 
      text: currentSentence.trim(), 
      start: currentStart 
    });
  }

  return sentences;
};

/**
 * Group words by speaker
 */
export const groupBySpeaker = (words: WordItem[]): SpeakerUtterance[] => {
  const utterances: SpeakerUtterance[] = [];
  let currentSpeaker: string | number | undefined;
  let currentText = "";
  let currentStart: number | null = null;

  for (const word of words) {
    const speaker = word.speaker_id ?? "unknown";
    
    if (speaker !== currentSpeaker) {
      // Save previous utterance
      if (currentText && currentStart !== null) {
        utterances.push({
          speaker: currentSpeaker ?? "unknown",
          text: currentText.trim(),
          start: currentStart,
        });
      }
      
      // Start new utterance
      currentSpeaker = speaker;
      currentText = word.text;
      currentStart = word.start;
    } else {
      currentText += word.text;
    }
  }

  // Add final utterance
  if (currentText && currentStart !== null) {
    utterances.push({
      speaker: currentSpeaker ?? "unknown",
      text: currentText.trim(),
      start: currentStart,
    });
  }

  return utterances;
};

/**
 * Clean and normalize text
 */
export const normalizeText = (text: string): string => {
  return text
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')  // Limit consecutive newlines
    .trim();
};

/**
 * Truncate text to a maximum length with ellipsis
 */
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.slice(0, maxLength - 3) + "...";
};