/**
 * Cloud service manager for handling multiple cloud storage providers
 * Currently supports Google Drive, easily extensible for Dropbox, OneDrive, etc.
 */

import {
  CloudDownloadOptions,
  CloudDownloadResult,
  CloudService,
  cloudServiceRegistry,
  resolveCloudFileMetadata,
} from "./cloud-service.ts";
import { GoogleDriveAdapter } from "../adapters/google-drive-adapter.ts";
import { TempFileManager } from "./temp-file-manager.ts";
import { DropboxAdapter } from "../adapters/dropbox-adapter.ts";
import { YouTubeAdapter } from "../adapters/youtube-adapter.ts";
import { HLS_SERVICE_NAME, HlsAdapter } from "../adapters/hls-adapter.ts";
import { UtageAdapter } from "../adapters/utage-adapter.ts";
import { VimeoReviewAdapter } from "../adapters/vimeo-review-adapter.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { elapsedMs, logPerformance } from "../utils/performance.ts";
import { config } from "../core/config.ts";
import { isAllowedHlsApiUrl } from "../utils/hls-url-policy.ts";

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

  /** Web API から安全に受け付けられる入力 URL かを判定する。 */
  isApiSourceUrlSupported(url: string): boolean {
    const service = cloudServiceRegistry.getServiceForUrl(url);
    if (!service) return false;
    if (service.name !== HLS_SERVICE_NAME) return true;

    return isAllowedHlsApiUrl(url, config.transcriptionHlsAllowedHosts);
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
  async downloadFromUrl(
    url: string,
    opts?: CloudDownloadOptions,
  ): Promise<CloudDownloadResult> {
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
      const metadataStartedAt = performance.now();
      const metadata = await resolveCloudFileMetadata(service, fileId, opts);
      const metadataMs = elapsedMs(metadataStartedAt);

      // Determine extension from metadata filename or mimeType
      let extension = "tmp";
      if (metadata.filename) {
        const filenameExt = metadata.filename.split(".").pop()?.toLowerCase();
        if (filenameExt && filenameExt.length <= 5) {
          extension = filenameExt;
        }
      }
      // Fallback to service preferred extension if no valid extension found
      if (
        extension === "tmp" &&
        typeof service.getPreferredFileExtension === "function"
      ) {
        extension = service.getPreferredFileExtension();
      }

      const tempPrefix = service.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "cloud";
      const tempPath = await this.tempManager.createTempFile(
        tempPrefix,
        extension,
      );

      // Download file
      const downloadStartedAt = performance.now();
      const downloaded = await service.downloadFile(fileId, tempPath, {
        ...opts,
        metadata,
      });
      const downloadMs = elapsedMs(downloadStartedAt);

      logPerformance("cloud_download", {
        performanceId: opts?.performanceId,
        service: service.name,
        metadataCacheHit: opts?.metadata !== undefined,
        metadataMs,
        downloadMs,
        sourceBytes: metadata.size,
      });

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
   * Clean up one completed download without touching concurrent requests.
   */
  async cleanupDownloadedFile(tempPath: string): Promise<void> {
    await this.tempManager.cleanupFileAndDir(tempPath);
  }

  /**
   * Get list of supported services
   */
  getSupportedServices(): string[] {
    return cloudServiceRegistry.getAllServices().map((s) => s.name);
  }
}

// シングルトン
export const cloudServiceManager = new CloudServiceManager();
