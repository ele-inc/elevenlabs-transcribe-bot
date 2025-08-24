export interface WordItem {
  text: string;
  start: number;
  end?: number;
  speaker_id?: string | number;
}

export interface SpeakerUtterance {
  speaker: string | number;
  text: string;
  start: number;
}

export interface Sentence {
  text: string;
  start: number;
}

export interface SlackFile {
  name: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
  duration?: number;
}

export interface SlackEvent {
  type: string;
  channel: string;
  user: string;
  text?: string;
  ts: string;
  files?: SlackFile[];
}

export interface TranscriptionOptions {
  diarize: boolean;
  showTimestamp: boolean;
  tagAudioEvents: boolean;
  numSpeakers?: number;
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