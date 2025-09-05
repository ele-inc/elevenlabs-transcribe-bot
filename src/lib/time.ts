/**
 * Time-related utility functions
 */

/**
 * Format seconds into a human-readable timestamp (HH:MM:SS or MM:SS)
 */
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

/**
 * Convert milliseconds to seconds
 */
export const msToSeconds = (ms: number): number => {
  return ms / 1000;
};

/**
 * Convert seconds to milliseconds
 */
export const secondsToMs = (seconds: number): number => {
  return seconds * 1000;
};

/**
 * Format duration in seconds to a human-readable string
 */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  
  const parts: string[] = [];
  
  if (hrs > 0) {
    parts.push(`${hrs}h`);
  }
  if (mins > 0) {
    parts.push(`${mins}m`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}s`);
  }
  
  return parts.join(' ');
};