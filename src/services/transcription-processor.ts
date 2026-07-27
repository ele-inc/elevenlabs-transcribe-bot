/**
 * Common transcription processing workflow
 * Unifies the transcription logic for both Discord and Slack
 */

import { TranscriptionOptions } from "../core/types.ts";
import { transcribeAudioFile } from "../core/scribe.ts";
import { TempFileManager } from "./temp-file-manager.ts";
import {
  extractMediaInfo,
  isValidAudioVideoFile,
  processCloudFile,
} from "./file-processor.ts";
import { PlatformAdapter } from "../adapters/platform-adapter.ts";
import { resolveMediaMimeType } from "../utils/utils.ts";
import {
  type CloudFileMetadata,
  cloudServiceRegistry,
} from "./cloud-service.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { acquireSlot, activeCount, isAtCapacity, ShuttingDownError } from "./concurrency-limiter.ts";
import { elapsedMs, logPerformance } from "../utils/performance.ts";

export interface FileAttachment {
  url: string;
  filename: string;
  mimeType?: string;
  duration?: number;
}

export interface TranscriptionContext {
  channelId: string;
  timestamp: string;
  userId: string;
}

export class TranscriptionProcessor {
  private tempManager = new TempFileManager();

  constructor(
    private adapter: PlatformAdapter,
    private context: TranscriptionContext,
  ) {}

  /**
   * Process text input for cloud service URLs
   */
  async processTextInput(
    text: string,
    options: TranscriptionOptions,
    downloadOpts?: { password?: string },
  ): Promise<void> {
    const { cloudUrls } = extractMediaInfo(text);

    if (cloudUrls.length === 0) {
      return;
    }

    // Check all URLs to see if any are media files
    const mediaFiles: Array<{
      url: string;
      performanceId: string;
      metadata?: CloudFileMetadata;
    }> = [];
    let hasGoogleDocs = false;

    for (const url of cloudUrls) {
      const performanceId = crypto.randomUUID();
      const service = cloudServiceRegistry.getServiceForUrl(url);
      if (!service) {
        continue;
      }

      const fileId = service.extractFileId(url);
      if (!fileId) {
        continue;
      }

      try {
        const metadataStartedAt = performance.now();
        const metadata = await service.getFileMetadata(fileId, downloadOpts);
        logPerformance("cloud_metadata", {
          performanceId,
          service: service.name,
          metadataMs: elapsedMs(metadataStartedAt),
        });
        if (service.isMediaFile(metadata.mimeType)) {
          mediaFiles.push({ url, performanceId, metadata });
        } else {
          // Check if it's a Google Docs file
          const googleDocsTypes = [
            "application/vnd.google-apps.document",
            "application/vnd.google-apps.spreadsheet",
            "application/vnd.google-apps.presentation",
            "application/vnd.google-apps.drawing",
            "application/vnd.google-apps.form",
            "application/vnd.google-apps.map",
            "application/vnd.google-apps.site",
            "application/vnd.google-apps.script",
            "application/vnd.google-apps.jamboard",
          ];
          if (googleDocsTypes.includes(metadata.mimeType)) {
            hasGoogleDocs = true;
          }
        }
      } catch (error) {
        console.error(`Error getting metadata for ${url}:`, error);
        // If we can't get metadata, try to process it anyway
        mediaFiles.push({ url, performanceId });
      }
    }

    // If no media files and only Google Docs URLs, send error message
    if (mediaFiles.length === 0 && hasGoogleDocs) {
      await this.adapter.sendErrorMessage(
        "音声または動画ファイルを指定してください。GoogleドキュメントのURLは処理できません。"
      );
      return;
    }

    // Process only media file URLs (concurrency-limited)
    for (const { url, performanceId, metadata } of mediaFiles) {
      if (isAtCapacity()) {
        await this.adapter.sendStatusMessage(
          `🕐 現在 ${activeCount()} 件処理中のため順番待ちです...`,
        );
      }
      let release: (() => void) | undefined;
      const queueStartedAt = performance.now();
      try {
        release = await acquireSlot();
        logPerformance("transcription_queue", {
          performanceId,
          source: "cloud",
          queueMs: elapsedMs(queueStartedAt),
        });
      } catch (error) {
        if (error instanceof ShuttingDownError) {
          await this.adapter.sendErrorMessage(
            "サーバが再起動中のため受け付けできませんでした。少し待ってから再度お試しください。",
          );
          return;
        }
        throw error;
      }
      try {
        await this.processCloudUrl(
          url,
          options,
          downloadOpts,
          metadata,
          performanceId,
        );
      } finally {
        release();
      }
    }
  }

  /**
   * Process a cloud service URL (Google Drive, Dropbox, etc.)
   */
  async processCloudUrl(
    url: string,
    options: TranscriptionOptions,
    downloadOpts?: { password?: string },
    resolvedMetadata?: CloudFileMetadata,
    performanceId: string = crypto.randomUUID(),
  ): Promise<void> {
    try {
      // Get metadata first to send status message with filename
      const service = cloudServiceRegistry.getServiceForUrl(url);

      if (!service) {
        await this.adapter.sendErrorMessage("サポートされていないURLです。");
        return;
      }

      const fileId = service.extractFileId(url);
      if (!fileId) {
        await this.adapter.sendErrorMessage(
          "ファイルIDを抽出できませんでした。",
        );
        return;
      }

      // Get metadata first to check if it's a media file
      let metadata = resolvedMetadata;
      if (!metadata) {
        const metadataStartedAt = performance.now();
        metadata = await service.getFileMetadata(fileId, downloadOpts);
        logPerformance("cloud_metadata", {
          performanceId,
          service: service.name,
          metadataMs: elapsedMs(metadataStartedAt),
        });
      }

      // Check if file is a media file before sending status message
      if (!service.isMediaFile(metadata.mimeType)) {
        // Silently skip non-media files (like Google Docs) without sending a message
        return;
      }

      // Send status message only for media files
      await this.adapter.sendStatusMessage(
        this.adapter.formatProcessingMessage(metadata.filename, options),
      );

      // Now process the file (download and transcribe)
      const result = await processCloudFile(url, {
        channelId: this.context.channelId,
        timestamp: this.context.timestamp,
        userId: this.context.userId,
        transcriptionOptions: options,
        adapter: this.adapter,
        password: downloadOpts?.password,
        metadata,
        performanceId,
      });

      if (!result.success) {
        if (result.error === "File is not a media file") {
          return; // Silently skip non-media files
        }
        await this.adapter.sendErrorMessage(result.error || "Unknown error");
        return;
      }

      // Status message already sent above, transcription is handled inside processCloudFile
    } catch (error) {
      console.error("Cloud file processing error:", error);
      await this.adapter.sendErrorMessage(
        getErrorMessage(error),
      );
    }
  }

  // Keep backward compatibility
  async processGoogleDriveUrl(
    url: string,
    options: TranscriptionOptions,
  ): Promise<void> {
    return await this.processCloudUrl(url, options);
  }

  /**
   * Process file attachments
   */
  async processAttachments(
    attachments: FileAttachment[],
    options: TranscriptionOptions,
  ): Promise<void> {
    for (const attachment of attachments) {
      const performanceId = crypto.randomUUID();
      if (!isValidAudioVideoFile(attachment.mimeType, attachment.filename)) {
        await this.adapter.sendStatusMessage(
          `ファイル "${attachment.filename}" は音声または動画ファイルではありません。`,
        );
        continue;
      }

      if (isAtCapacity()) {
        await this.adapter.sendStatusMessage(
          `🕐 現在 ${activeCount()} 件処理中のため順番待ちです...`,
        );
      }
      let release: (() => void) | undefined;
      const queueStartedAt = performance.now();
      try {
        release = await acquireSlot();
        logPerformance("transcription_queue", {
          performanceId,
          source: "attachment",
          queueMs: elapsedMs(queueStartedAt),
        });
      } catch (error) {
        if (error instanceof ShuttingDownError) {
          await this.adapter.sendErrorMessage(
            "サーバが再起動中のため受け付けできませんでした。少し待ってから再度お試しください。",
          );
          return;
        }
        throw error;
      }
      try {
        await this.processAttachment(attachment, options, performanceId);
      } finally {
        release();
      }
    }
  }

  /**
   * Process a single attachment
   */
  private async processAttachment(
    attachment: FileAttachment,
    options: TranscriptionOptions,
    performanceId: string,
  ): Promise<void> {
    try {
      // Update status
      await this.adapter.sendStatusMessage(
        this.adapter.formatProcessingMessage(attachment.filename, options),
      );

      // Resolve the MIME type before the single download in transcribeAudioFile.
      const fileType = resolveMediaMimeType(
        attachment.mimeType,
        attachment.filename,
      ) || "";

      // Transcribe
      await transcribeAudioFile({
        fileURL: attachment.url,
        fileType,
        duration: attachment.duration || 0,
        channelId: this.context.channelId,
        timestamp: this.context.timestamp,
        userId: this.context.userId,
        options,
        filename: attachment.filename,
        performanceId,
        adapter: this.adapter,
      });

      // Success message is sent from scribe.ts after upload
    } catch (error) {
      console.error("Attachment processing error:", error);
      await this.adapter.sendErrorMessage(
        getErrorMessage(error),
      );
    }
  }

  /**
   * Clean up all temporary files
   */
  async cleanup(): Promise<void> {
    await this.tempManager.cleanupAll();
  }
}
