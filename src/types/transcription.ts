/**
 * Transcription-related types
 */

export interface TranscriptionOptions {
  diarize: boolean;
  showTimestamp: boolean;
  tagAudioEvents: boolean;
  numSpeakers?: number;
  speakerNames?: string[];
}

export interface WordItem {
  text: string;
  start: number;
  end?: number;
  speaker_id?: string | number;
}

export interface Sentence {
  text: string;
  start: number;
}

export interface SpeakerUtterance {
  speaker: string | number;
  text: string;
  start: number;
}

export interface TranscriptionResult {
  words: WordItem[];
  sentences?: Sentence[];
  utterances?: SpeakerUtterance[];
  duration?: number;
  language?: string;
}

export interface TranscriptionLog {
  file_type: string;
  duration: number;
  channel_id: string;
  message_ts: string;
  user_id: string;
  language_code: string | null;
  error: string | null;
  transcript?: string;
}