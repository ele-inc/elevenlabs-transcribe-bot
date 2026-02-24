/**
 * Cloud service manager for handling multiple cloud storage providers
 * Currently supports Google Drive, easily extensible for Dropbox, OneDrive, etc.
 */

import { CloudService, CloudDownloadResult, cloudServiceRegistry } from "./cloud-service.ts";
import { GoogleDriveAdapter } from "../adapters/google-drive-adapter.ts";
import { TempFileManager } from "./temp-file-manager.ts";
import { DropboxAdapter } from "../adapters/dropbox-adapter.ts";
import { YouTubeAdapter } from "../adapters/youtube-adapter.ts";
import { HlsAdapter } from "../adapters/hls-adapter.ts";
import { UtageAdapter } from "../adapters/utage-adapter.ts";
import { VimeoReviewAdapter } from "../adapters/vimeo-review-adapter.ts";
import { getErrorMessage } from "../utils/errors.ts";

export class CloudServiceManager {
  private tempManager = new TempFileManager();

  constructor() {
    this.registerServices();
  }

  /**
   * Register all available cloud services
   * Add new services here as they are implemented
   */
  private registerServices(): void {
    // Register Google Drive
    cloudServiceRegistry.register(new GoogleDriveAdapter());

    // Future services can be registered here:
    cloudServiceRegistry.register(new DropboxAdapter());
    cloudServiceRegistry.register(new VimeoReviewAdapter());
    cloudServiceRegistry.register(new YouTubeAdapter());
    cloudServiceRegistry.register(new UtageAdapter());
    cloudServiceRegistry.register(new HlsAdapter());
    // cloudServiceRegistry.register(new OneDriveService());
    // cloudServiceRegistry.register(new BoxService());
  }

  /**
   * Check if URL is from a supported cloud service
   */
  isSupportedUrl(url: string): boolean {
    return cloudServiceRegistry.getServiceForUrl(url) !== null;
  }

  /**
   * Extract all cloud URLs from text
   */
  extractCloudUrls(text: string): { url: string; service: CloudService }[] {
    const urlPattern = /https?:\/\/[^\s<>]+/gi;
    const urls = text.match(urlPattern) || [];

    const cloudUrls: { url: string; service: CloudService }[] = [];

    for (const url of urls) {
      const service = cloudServiceRegistry.getServiceForUrl(url);
      if (service) {
        cloudUrls.push({ url, service });
      }
    }

    return cloudUrls;
  }

  /**
   * Download file from any supported cloud service
   */
  async downloadFromUrl(url: string): Promise<CloudDownloadResult> {
    const service = cloudServiceRegistry.getServiceForUrl(url);

    if (!service) {
      return {
        success: false,
        error: `Unsupported URL: ${url}`,
      };
    }

    const fileId = service.extractFileId(url);
    if (!fileId) {
      return {
        success: false,
        error: `Could not extract file ID from ${service.name} URL`,
      };
    }

    try {
      // Get metadata first to determine file extension
      const metadata = await service.getFileMetadata(fileId);

      // Determine extension from metadata filename or mimeType
      let extension = "tmp";
      if (metadata.filename) {
        const filenameExt = metadata.filename.split('.').pop()?.toLowerCase();
        if (filenameExt && filenameExt.length <= 5) {
          extension = filenameExt;
        }
      }
      // Fallback to service preferred extension if no valid extension found
      if (extension === "tmp" && typeof service.getPreferredFileExtension === "function") {
        extension = service.getPreferredFileExtension();
      }

      const tempPath = await this.tempManager.createTempFile(
        service.name.toLowerCase().replace(/\s+/g, '_'),
        extension
      );

      // Download file
      const downloaded = await service.downloadFile(fileId, tempPath);

      if (!downloaded) {
        // File was skipped (non-media)
        await this.tempManager.cleanupFileAndDir(tempPath);
        return {
          success: false,
          error: "File is not a media file",
        };
      }

      return {
        success: true,
        metadata,
        tempPath,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanup(): Promise<void> {
    await this.tempManager.cleanupAll();
  }

  /**
   * Get list of supported services
   */
  getSupportedServices(): string[] {
    return cloudServiceRegistry.getAllServices().map(s => s.name);
  }
}

// Singleton instance
export const cloudServiceManager = new CloudServiceManager();
