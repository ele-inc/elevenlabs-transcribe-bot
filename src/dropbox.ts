import { config } from "./config.ts";

// Types for Dropbox file metadata
interface DropboxFileMetadata {
  name: string;
  size?: number;
  path_display?: string;
}

// Parse Dropbox URL to extract shareable link
export function parseDropboxUrl(url: string): string | null {
  // Handle various Dropbox URL formats
  // Examples:
  // https://www.dropbox.com/s/xxxxx/filename.mp3?dl=0
  // https://www.dropbox.com/scl/fi/xxxxx/filename.mp3?rlkey=xxxxx&dl=0
  // https://www.dropbox.com/sh/xxxxx/xxxxx
  // https://dl.dropboxusercontent.com/s/xxxxx/filename.mp3
  
  const patterns = [
    /dropbox\.com\/s\/([a-zA-Z0-9]+)/,
    /dropbox\.com\/scl\/fi\/([a-zA-Z0-9]+)/,
    /dropbox\.com\/sh\/([a-zA-Z0-9]+)/,
    /dl\.dropboxusercontent\.com\/s\/([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      // Return the original URL (we'll convert it to direct download later)
      return url;
    }
  }

  return null;
}

// Convert Dropbox sharing URL to direct download URL
export function convertToDirectDownloadUrl(url: string): string {
  let directUrl = url;
  
  // Replace dl=0 with dl=1 to force direct download
  if (directUrl.includes("dl=0")) {
    directUrl = directUrl.replace(/dl=0/g, "dl=1");
  } else if (!directUrl.includes("dl=1")) {
    // If no dl parameter exists, add it
    if (directUrl.includes("?")) {
      directUrl += "&dl=1";
    } else {
      directUrl += "?dl=1";
    }
  }
  
  // Convert www.dropbox.com to dl.dropboxusercontent.com for direct download
  directUrl = directUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com");
  
  return directUrl;
}

// Download Dropbox file to temporary path
export async function downloadDropboxFileToPath(
  url: string,
  tempPath: string,
): Promise<{ filename: string }> {
  try {
    const startTime = performance.now();
    
    // Convert to direct download URL
    const directUrl = convertToDirectDownloadUrl(url);
    
    console.log(`Starting Dropbox download from: ${directUrl}`);
    
    // Download the file
    const response = await fetch(directUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TranscribeBot/1.0)",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}`);
    }
    
    // Extract filename from Content-Disposition header or URL
    let filename = "dropbox_file";
    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition) {
      // First try to extract filename* (RFC 5987 encoded filename for non-ASCII characters)
      const encodedFilenameMatch = contentDisposition.match(/filename\*=([^;]+)/);
      if (encodedFilenameMatch) {
        // Format: UTF-8''encoded-filename
        const encodedPart = encodedFilenameMatch[1];
        const parts = encodedPart.split("''");
        if (parts.length === 2) {
          // Decode the percent-encoded UTF-8 filename
          filename = decodeURIComponent(parts[1]);
        }
      } else {
        // Fallback to regular filename parameter
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch) {
          filename = filenameMatch[1].replace(/['"]/g, "");
          // Try to decode if it appears to be encoded
          try {
            if (filename.includes('%')) {
              filename = decodeURIComponent(filename);
            }
          } catch {
            // Keep original if decoding fails
          }
        }
      }
    } else {
      // Try to extract filename from URL
      const urlPath = new URL(directUrl).pathname;
      const pathSegments = urlPath.split("/");
      const lastSegment = pathSegments[pathSegments.length - 1];
      if (lastSegment && !lastSegment.includes("?")) {
        filename = decodeURIComponent(lastSegment);
      }
    }
    
    // Get content length for progress tracking
    const contentLength = response.headers.get("content-length");
    const totalSize = contentLength ? parseInt(contentLength) : 0;
    const totalSizeMB = totalSize / (1024 * 1024);
    
    console.log(`Downloading: ${filename} (${totalSizeMB.toFixed(2)}MB)`);
    
    // Stream download with chunked writing
    const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
    const writer = file.writable.getWriter();
    
    let downloadedBytes = 0;
    let lastProgressTime = performance.now();
    
    try {
      if (!response.body) {
        throw new Error("Response body is null");
      }
      
      const reader = response.body.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        await writer.write(value);
        downloadedBytes += value.length;
        
        // Log progress every second
        const currentTime = performance.now();
        if (currentTime - lastProgressTime > 1000) {
          const progress = totalSize ? (downloadedBytes / totalSize * 100).toFixed(1) : "?";
          const speed = (downloadedBytes / 1024 / 1024) / ((currentTime - startTime) / 1000);
          console.log(`Download progress: ${progress}% (${speed.toFixed(2)}MB/s)`);
          lastProgressTime = currentTime;
        }
      }
    } finally {
      await writer.close();
    }
    
    const downloadTime = (performance.now() - startTime) / 1000;
    const actualSizeMB = downloadedBytes / (1024 * 1024);
    console.log(`Download complete: ${actualSizeMB.toFixed(2)}MB in ${downloadTime.toFixed(2)}s (${(actualSizeMB / downloadTime).toFixed(2)}MB/s)`);
    
    return { filename };
    
  } catch (error) {
    const err = error as { message?: string };
    throw new Error(`Failed to download Dropbox file: ${err.message}`);
  }
}

// Check if URL is a Dropbox URL
export function isDropboxUrl(url: string): boolean {
  return parseDropboxUrl(url) !== null;
}

// Download Dropbox file and return metadata
export async function downloadDropboxFile(
  url: string,
  tempPath: string,
): Promise<{ filename: string; mimeType: string }> {
  const validUrl = parseDropboxUrl(url);
  
  if (!validUrl) {
    throw new Error("Invalid Dropbox URL");
  }
  
  // Download file
  const { filename } = await downloadDropboxFileToPath(validUrl, tempPath);
  
  // Determine MIME type from file extension
  const ext = filename.split('.').pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    "mp3": "audio/mpeg",
    "mp4": "video/mp4",
    "m4a": "audio/mp4",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "flac": "audio/flac",
    "aac": "audio/aac",
    "wma": "audio/x-ms-wma",
    "wmv": "video/x-ms-wmv",
  };
  
  const mimeType = mimeTypes[ext] || "application/octet-stream";
  
  return {
    filename,
    mimeType,
  };
}