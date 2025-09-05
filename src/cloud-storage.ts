/**
 * Common interface and utilities for cloud storage providers
 */

import { downloadGoogleDriveFile, isGoogleDriveUrl, parseGoogleDriveUrl } from "./googledrive.ts";
import { downloadDropboxFile, isDropboxUrl, parseDropboxUrl } from "./dropbox.ts";

// Cloud storage provider types
export type CloudStorageProvider = "google-drive" | "dropbox" | "unknown";

// Common file metadata interface
export interface CloudFileMetadata {
  filename: string;
  mimeType: string;
  provider: CloudStorageProvider;
}

// Cloud storage URL info
export interface CloudStorageUrl {
  originalUrl: string;
  provider: CloudStorageProvider;
  isValid: boolean;
}

/**
 * Detect cloud storage provider from URL
 */
export function detectCloudStorageProvider(url: string): CloudStorageProvider {
  if (isGoogleDriveUrl(url)) {
    return "google-drive";
  }
  if (isDropboxUrl(url)) {
    return "dropbox";
  }
  return "unknown";
}

/**
 * Parse cloud storage URL and return info
 */
export function parseCloudStorageUrl(url: string): CloudStorageUrl {
  const provider = detectCloudStorageProvider(url);
  
  if (provider === "google-drive") {
    return {
      originalUrl: url,
      provider,
      isValid: parseGoogleDriveUrl(url) !== null,
    };
  }
  
  if (provider === "dropbox") {
    return {
      originalUrl: url,
      provider,
      isValid: parseDropboxUrl(url) !== null,
    };
  }
  
  return {
    originalUrl: url,
    provider: "unknown",
    isValid: false,
  };
}

/**
 * Download file from cloud storage URL
 */
export async function downloadCloudFile(
  url: string,
  tempPath: string
): Promise<CloudFileMetadata> {
  const urlInfo = parseCloudStorageUrl(url);
  
  if (!urlInfo.isValid) {
    throw new Error(`Invalid or unsupported cloud storage URL: ${url}`);
  }
  
  switch (urlInfo.provider) {
    case "google-drive": {
      const result = await downloadGoogleDriveFile(url, tempPath);
      return {
        ...result,
        provider: "google-drive",
      };
    }
    
    case "dropbox": {
      const result = await downloadDropboxFile(url, tempPath);
      return {
        ...result,
        provider: "dropbox",
      };
    }
    
    default:
      throw new Error(`Unsupported cloud storage provider: ${urlInfo.provider}`);
  }
}

/**
 * Extract all cloud storage URLs from text
 */
export function extractCloudStorageUrls(text: string): CloudStorageUrl[] {
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  const urls = text.match(urlPattern) || [];
  
  return urls
    .map(url => parseCloudStorageUrl(url))
    .filter(urlInfo => urlInfo.isValid);
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: CloudStorageProvider): string {
  switch (provider) {
    case "google-drive":
      return "Google Drive";
    case "dropbox":
      return "Dropbox";
    default:
      return "Unknown";
  }
}

/**
 * Check if URL is a supported cloud storage URL
 */
export function isCloudStorageUrl(url: string): boolean {
  return detectCloudStorageProvider(url) !== "unknown";
}