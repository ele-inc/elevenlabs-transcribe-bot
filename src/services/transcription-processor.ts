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
import { getFileExtensionFromMime } from "../utils/utils.ts";
import { cloudServiceManager } from "./cloud-service-manager.ts";
import { cloudServiceRegistry } from "./cloud-service.ts";
import { getErrorMessage } from "../utils/errors.ts";

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
    const mediaUrls: string[] = [];
    const nonMediaUrls: string[] = [];
    let hasGoogleDocs = false;

    for (const url of cloudUrls) {
      const service = cloudServiceRegistry.getServiceForUrl(url);
      if (!service) {
        continue;
      }

      const fileId = service.extractFileId(url);
      if (!fileId) {
        continue;
      }

      try {
        const metadata = await service.getFileMetadata(fileId, downloadOpts);
        if (service.isMediaFile(metadata.mimeType)) {
          mediaUrls.push(url);
        } else {
          nonMediaUrls.push(url);
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
        mediaUrls.push(url);
      }
    }

    // If no media files and only Google Docs URLs, send error message
    if (mediaUrls.length === 0 && hasGoogleDocs) {
      await this.adapter.sendErrorMessage(
        "音声または動画ファイルを指定してください。GoogleドキュメントのURLは処理できません。"
      );
      return;
    }

    // Process only media file URLs
    for (const url of mediaUrls) {
      await this.processCloudUrl(url, options, downloadOpts);
    }
  }

  /**
   * Process a cloud service URL (Google Drive, Dropbox, etc.)
   */
  async processCloudUrl(
    url: string,
    options: TranscriptionOptions,
    downloadOpts?: { password?: string },
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
      const metadata = await service.getFileMetadata(fileId, downloadOpts);

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
      if (!isValidAudioVideoFile(attachment.mimeType)) {
        await this.adapter.sendStatusMessage(
          `ファイル "${attachment.filename}" は音声または動画ファイルではありません。`,
        );
        continue;
      }

      await this.processAttachment(attachment, options);
    }
  }

  /**
   * Process a single attachment
   */
  private async processAttachment(
    attachment: FileAttachment,
    options: TranscriptionOptions,
  ): Promise<void> {
    let tempPath: string | undefined;

    try {
      // Update status
      await this.adapter.sendStatusMessage(
        this.adapter.formatProcessingMessage(attachment.filename, options),
      );

      // Download file using platform adapter
      const extension = getFileExtensionFromMime(attachment.mimeType || "");
      tempPath = await this.tempManager.createTempFile("audio", extension);
      await this.adapter.downloadFile(attachment.url, tempPath);

      // Transcribe
      const fileURL = `file://${tempPath}`;
      await transcribeAudioFile({
        fileURL,
        fileType: attachment.mimeType || "",
        duration: attachment.duration || 0,
        channelId: this.context.channelId,
        timestamp: this.context.timestamp,
        userId: this.context.userId,
        options,
        filename: attachment.filename,
        tempPath,
        adapter: this.adapter,
      });

      // Success message is sent from scribe.ts after upload
    } catch (error) {
      console.error("Attachment processing error:", error);
      await this.adapter.sendErrorMessage(
        getErrorMessage(error),
      );
    } finally {
      // Cleanup is handled by scribe.ts
    }
  }

  /**
   * Clean up all temporary files
   */
  async cleanup(): Promise<void> {
    await this.tempManager.cleanupAll();
  }
}
