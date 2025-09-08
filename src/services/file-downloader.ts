/**
 * Unified file downloader for Discord, Slack, and Google Drive
 * Provides a consistent interface for downloading files from different platforms
 */

import { config } from "../config.ts";
import { JWT } from "npm:google-auth-library@9.15.0";
import { google } from "npm:googleapis@144.0.0";

// Download result types
export interface DownloadResult {
  data: Uint8Array;
  metadata: FileMetadata;
}

export interface FileMetadata {
  filename: string;
  mimeType?: string;
  size?: number;
}

// Platform-specific download options
export interface DownloadOptions {
  platform: "discord" | "slack" | "googledrive";
  url?: string;
  fileId?: string;
  token?: string;
}

// Stream download options for large files
export interface StreamDownloadOptions extends DownloadOptions {
  outputPath: string;
}

/**
 * FileDownloader class provides unified interface for downloading files
 * from Discord, Slack, and Google Drive
 */
export class FileDownloader {
  private googleDriveClient?: ReturnType<typeof google.drive>;

  /**
   * Download file to memory (for small files)
   * Returns the file data and metadata
   */
  async downloadToMemory(options: DownloadOptions): Promise<DownloadResult> {
    switch (options.platform) {
      case "discord":
        return this.downloadDiscordFile(options.url!);
      case "slack":
        return this.downloadSlackFile(options.url!, options.token);
      case "googledrive":
        return this.downloadGoogleDriveFile(options.fileId!);
      default:
        throw new Error(`Unsupported platform: ${options.platform}`);
    }
  }

  /**
   * Download file directly to disk (for large files)
   * More efficient for large files as it streams directly to disk
   */
  async downloadToPath(options: StreamDownloadOptions): Promise<FileMetadata> {
    switch (options.platform) {
      case "discord":
        return this.downloadDiscordFileToPath(options.url!, options.outputPath);
      case "slack":
        return this.downloadSlackFileToPath(options.url!, options.outputPath, options.token);
      case "googledrive":
        return this.downloadGoogleDriveFileToPath(options.fileId!, options.outputPath);
      default:
        throw new Error(`Unsupported platform: ${options.platform}`);
    }
  }

  // ============ Discord Download Methods ============

  private async downloadDiscordFile(url: string): Promise<DownloadResult> {
    console.log("Downloading Discord file from:", url);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download Discord file: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Extract filename from URL
    const filename = this.extractDiscordFilename(url);
    const mimeType = response.headers.get("content-type") || undefined;
    const size = parseInt(response.headers.get("content-length") || "0");

    return {
      data,
      metadata: { filename, mimeType, size }
    };
  }

  private async downloadDiscordFileToPath(url: string, outputPath: string): Promise<FileMetadata> {
    console.log("Streaming Discord file to:", outputPath);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download Discord file: ${response.status}`);
    }

    const file = await Deno.open(outputPath, { write: true, create: true });
    try {
      await response.body!.pipeTo(file.writable);
    } finally {
      // File automatically closed when stream completes
    }

    const filename = this.extractDiscordFilename(url);
    const mimeType = response.headers.get("content-type") || undefined;
    const size = parseInt(response.headers.get("content-length") || "0");

    return { filename, mimeType, size };
  }

  private extractDiscordFilename(url: string): string {
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1];
    return filename.split('?')[0] || 'unknown';
  }

  // ============ Slack Download Methods ============

  private async downloadSlackFile(url: string, token?: string): Promise<DownloadResult> {
    console.log("Downloading Slack file from:", url);
    const headers: Record<string, string> = {};
    
    if (token || config.slackBotToken) {
      headers["Authorization"] = `Bearer ${token || config.slackBotToken}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to download Slack file: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Extract filename from URL or headers
    const filename = this.extractSlackFilename(url, response.headers);
    const mimeType = response.headers.get("content-type") || undefined;
    const size = parseInt(response.headers.get("content-length") || "0");

    return {
      data,
      metadata: { filename, mimeType, size }
    };
  }

  private async downloadSlackFileToPath(url: string, outputPath: string, token?: string): Promise<FileMetadata> {
    console.log("Streaming Slack file to:", outputPath);
    const headers: Record<string, string> = {};
    
    if (token || config.slackBotToken) {
      headers["Authorization"] = `Bearer ${token || config.slackBotToken}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to download Slack file: ${response.status}`);
    }

    const file = await Deno.open(outputPath, { write: true, create: true });
    try {
      await response.body!.pipeTo(file.writable);
    } finally {
      // File automatically closed when stream completes
    }

    const filename = this.extractSlackFilename(url, response.headers);
    const mimeType = response.headers.get("content-type") || undefined;
    const size = parseInt(response.headers.get("content-length") || "0");

    return { filename, mimeType, size };
  }

  private extractSlackFilename(url: string, headers: Headers): string {
    // Try to get filename from Content-Disposition header
    const contentDisposition = headers.get("content-disposition");
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) return match[1];
    }

    // Fallback to URL parsing
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1];
    return filename.split('?')[0] || 'unknown';
  }

  // ============ Google Drive Download Methods ============

  private initializeGoogleDriveClient() {
    if (!this.googleDriveClient) {
      if (!config.googlePrivateKey) {
        throw new Error("GOOGLE_PRIVATE_KEY environment variable is not set");
      }

      const formattedPrivateKey = config.googlePrivateKey.replace(/\\n/g, '\n');

      const auth = new JWT({
        email: config.googleClientEmail,
        key: formattedPrivateKey,
        scopes: ["https://www.googleapis.com/auth/drive"],
        subject: config.googleImpersonateEmail,
      });

      this.googleDriveClient = google.drive({ version: "v3", auth });
    }
    return this.googleDriveClient;
  }

  private async downloadGoogleDriveFile(fileId: string): Promise<DownloadResult> {
    const drive = this.initializeGoogleDriveClient();

    // Get file metadata first
    const metadataResponse = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
      supportsAllDrives: true,
    });

    const metadata = metadataResponse.data;
    
    // Check if it's a Google Docs file (can't be downloaded directly)
    if (this.isGoogleDocsFile(metadata.mimeType || "")) {
      throw new Error(`Cannot download Google Docs file directly: ${metadata.name}`);
    }

    // Download file content
    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );

    const data = new Uint8Array(response.data as ArrayBuffer);

    return {
      data,
      metadata: {
        filename: metadata.name || "unknown",
        mimeType: metadata.mimeType || undefined,
        size: metadata.size ? parseInt(metadata.size) : undefined,
      }
    };
  }

  private async downloadGoogleDriveFileToPath(fileId: string, outputPath: string): Promise<FileMetadata> {
    const drive = this.initializeGoogleDriveClient();

    // Get file metadata first
    const metadataResponse = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
      supportsAllDrives: true,
    });

    const metadata = metadataResponse.data;
    
    // Check if it's a Google Docs file
    if (this.isGoogleDocsFile(metadata.mimeType || "")) {
      throw new Error(`Cannot download Google Docs file directly: ${metadata.name}`);
    }

    console.log(`Downloading: ${metadata.name} (${(parseInt(metadata.size || "0") / 1024 / 1024).toFixed(2)}MB)`);

    // Stream download to file
    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );

    const file = await Deno.open(outputPath, { write: true, create: true });
    const writer = file.writable.getWriter();

    try {
      // @ts-ignore - response.data is a Node.js stream
      for await (const chunk of response.data) {
        await writer.write(chunk);
      }
    } finally {
      await writer.close();
    }

    return {
      filename: metadata.name || "unknown",
      mimeType: metadata.mimeType || undefined,
      size: metadata.size ? parseInt(metadata.size) : undefined,
    };
  }

  private isGoogleDocsFile(mimeType: string): boolean {
    const googleDocsTypes = [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
      "application/vnd.google-apps.drawing",
      "application/vnd.google-apps.form",
      "application/vnd.google-apps.map",
      "application/vnd.google-apps.site",
    ];
    return googleDocsTypes.includes(mimeType);
  }

  // ============ Utility Methods ============

  /**
   * Parse Google Drive URL to extract file ID
   */
  static parseGoogleDriveUrl(url: string): string | null {
    const patterns = [
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9-_]+)/,
      /docs\.google\.com\/[a-z]+\/d\/([a-zA-Z0-9-_]+)/,
      /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9-_]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Check if URL is a Google Drive URL
   */
  static isGoogleDriveUrl(url: string): boolean {
    return FileDownloader.parseGoogleDriveUrl(url) !== null;
  }
}