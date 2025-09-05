/**
 * MIME type utilities
 */

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  // Audio formats
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  
  // Video formats
  "video/mp4": "mp4",
  "video/mpeg": "mpg",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-flv": "flv",
  "video/x-ms-wmv": "wmv",
};

/**
 * Get file extension from MIME type
 */
export const getFileExtensionFromMime = (mimeType: string): string => {
  if (!mimeType) {
    return "bin";
  }
  
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  
  return MIME_TYPE_TO_EXTENSION[normalized] || 
         normalized.split("/")[1] || 
         "bin";
};

/**
 * Check if MIME type is a supported audio format
 */
export const isAudioMimeType = (mimeType: string): boolean => {
  if (!mimeType) {
    return false;
  }
  
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return normalized.startsWith('audio/');
};

/**
 * Check if MIME type is a supported video format
 */
export const isVideoMimeType = (mimeType: string): boolean => {
  if (!mimeType) {
    return false;
  }
  
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return normalized.startsWith('video/');
};

/**
 * Check if MIME type is supported for transcription
 */
export const isSupportedMediaType = (mimeType: string): boolean => {
  if (!mimeType) {
    return false;
  }
  
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return normalized in MIME_TYPE_TO_EXTENSION;
};