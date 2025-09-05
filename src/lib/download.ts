/**
 * Unified file download utilities
 */

import type { DownloadedFile, MediaFile } from "../types/media.ts";
import { retryWithBackoff, ExternalServiceError } from "../errors.ts";
import { getFileExtensionFromMime } from "./mime-types.ts";

/**
 * Download options
 */
export interface DownloadOptions {
  headers?: Record<string, string>;
  maxRetries?: number;
  timeoutMs?: number;
  progressCallback?: (bytesDownloaded: number, totalBytes?: number) => void;
}

/**
 * Download a file from a URL to a temporary location
 */
export async function downloadFile(
  url: string,
  filename?: string,
  options: DownloadOptions = {}
): Promise<DownloadedFile> {
  const { 
    headers = {}, 
    maxRetries = 3, 
    timeoutMs = 300000,
    progressCallback 
  } = options;

  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'ElevenLabs-Transcribe-Bot/1.0',
            ...headers,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new ExternalServiceError(
            'Download',
            `Failed to download: ${response.status} ${response.statusText}`,
            { url, status: response.status }
          );
        }

        // Get content info
        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

        // Determine filename
        const finalFilename = filename || getFilenameFromResponse(response, url);
        const extension = contentType 
          ? getFileExtensionFromMime(contentType)
          : getExtensionFromFilename(finalFilename);

        // Create temp directory and file
        const tempDir = await Deno.makeTempDir();
        const tempPath = `${tempDir}/${finalFilename}${extension ? `.${extension}` : ''}`;

        // Stream download with progress
        const file = await Deno.open(tempPath, { write: true, create: true });
        
        try {
          let bytesDownloaded = 0;
          const reader = response.body?.getReader();
          
          if (!reader) {
            throw new Error('Response body is not readable');
          }

          while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            await file.write(value);
            bytesDownloaded += value.byteLength;
            
            if (progressCallback) {
              progressCallback(bytesDownloaded, totalBytes);
            }
          }
        } finally {
          file.close();
        }

        // Get file size
        const stat = await Deno.stat(tempPath);

        return {
          path: tempPath,
          originalName: finalFilename,
          mimeType: contentType || undefined,
          size: stat.size,
          isTemporary: true,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    maxRetries
  );
}

/**
 * Download with authentication
 */
export async function downloadWithAuth(
  url: string,
  token: string,
  tokenType: 'Bearer' | 'Basic' = 'Bearer',
  filename?: string,
  options: DownloadOptions = {}
): Promise<DownloadedFile> {
  return downloadFile(url, filename, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `${tokenType} ${token}`,
    },
  });
}

/**
 * Extract filename from response headers or URL
 */
function getFilenameFromResponse(response: Response, url: string): string {
  // Try Content-Disposition header
  const disposition = response.headers.get('content-disposition');
  if (disposition) {
    const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch) {
      let filename = filenameMatch[1];
      if (filename.startsWith('"') && filename.endsWith('"')) {
        filename = filename.slice(1, -1);
      }
      return decodeURIComponent(filename.replace(/['"]/g, ''));
    }
  }

  // Fall back to URL path
  const urlPath = new URL(url).pathname;
  const segments = urlPath.split('/');
  const lastSegment = segments[segments.length - 1];
  
  if (lastSegment && lastSegment !== '') {
    return decodeURIComponent(lastSegment.split('?')[0]);
  }

  // Default filename
  return `download_${Date.now()}`;
}

/**
 * Get file extension from filename
 */
function getExtensionFromFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Clean up temporary file
 */
export async function cleanupTempFile(path: string): Promise<void> {
  try {
    await Deno.remove(path);
    // Try to remove parent directory if empty
    const dir = path.substring(0, path.lastIndexOf('/'));
    await Deno.remove(dir).catch(() => {});
  } catch (error) {
    console.warn(`Failed to cleanup temp file: ${path}`, error);
  }
}

/**
 * Download multiple files in parallel
 */
export async function downloadMultiple(
  files: MediaFile[],
  options: DownloadOptions = {}
): Promise<DownloadedFile[]> {
  const downloads = files.map(file => 
    downloadFile(file.url, file.name, options)
  );
  
  return Promise.all(downloads);
}

/**
 * Validate downloaded file
 */
export async function validateDownload(
  file: DownloadedFile,
  expectedMimeType?: string,
  maxSizeBytes?: number
): Promise<boolean> {
  try {
    const stat = await Deno.stat(file.path);
    
    // Check file exists and is not empty
    if (!stat.isFile || stat.size === 0) {
      return false;
    }
    
    // Check size limit
    if (maxSizeBytes && stat.size > maxSizeBytes) {
      return false;
    }
    
    // Check MIME type if specified
    if (expectedMimeType && file.mimeType) {
      const expected = expectedMimeType.toLowerCase().split(';')[0].trim();
      const actual = file.mimeType.toLowerCase().split(';')[0].trim();
      
      if (expected !== actual && !actual.startsWith(expected.split('/')[0])) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}