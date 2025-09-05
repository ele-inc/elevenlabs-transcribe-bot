/**
 * Media file related types
 */

export interface MediaFile {
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
  duration?: number;
}

export interface DownloadedFile {
  path: string;
  originalName: string;
  mimeType?: string;
  size?: number;
  isTemporary?: boolean;
}

export interface ConversionResult {
  inputPath: string;
  outputPath: string;
  format: string;
  duration?: number;
}

export type SupportedAudioFormat = 
  | "mp3" 
  | "wav" 
  | "m4a" 
  | "aac" 
  | "ogg" 
  | "webm" 
  | "flac";

export type SupportedVideoFormat = 
  | "mp4" 
  | "mpg" 
  | "mov" 
  | "avi" 
  | "webm" 
  | "mkv" 
  | "flv" 
  | "wmv";

export type SupportedMediaFormat = SupportedAudioFormat | SupportedVideoFormat;