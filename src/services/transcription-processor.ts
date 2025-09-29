/**
 * Common transcription processing workflow
 * Unifies the transcription logic for both Discord and Slack
 */

import { TranscriptionOptions } from "../core/types.ts";
import { transcribeAudioFile } from "../core/scribe.ts";
import { TempFileManager } from "./temp-file-manager.ts";
import { processCloudFile, isValidAudioVideoFile, extractMediaInfo } from "./file-processor.ts";
import { PlatformAdapter } from "../adapters/platform-adapter.ts";
import { downloadSlackFileToPath } from "../clients/slack.ts";
import { getFileExtensionFromMime } from "../utils/utils.ts";

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
  platform: "discord" | "slack";
}

export class TranscriptionProcessor {
  private tempManager = new TempFileManager();

  constructor(
    private adapter: PlatformAdapter,
    private context: TranscriptionContext
  ) {}

  /**
   * Process text input for cloud service URLs
   */
  async processTextInput(text: string, options: TranscriptionOptions): Promise<void> {
    const { cloudUrls } = extractMediaInfo(text);

    if (cloudUrls.length === 0) {
      return;
    }

    for (const url of cloudUrls) {
      await this.processCloudUrl(url, options);
    }
  }

  /**
   * Process a cloud service URL (Google Drive, Dropbox, etc.)
   */
  async processCloudUrl(url: string, options: TranscriptionOptions): Promise<void> {
    try {
      // Send "received" message immediately before processing
      // We'll update with filename once we get metadata
      await this.adapter.sendStatusMessage(
        "ファイルを取得中..."
      );

      const result = await processCloudFile(url, {
        channelId: this.context.channelId,
        timestamp: this.context.timestamp,
        userId: this.context.userId,
        transcriptionOptions: options,
        platform: this.context.platform,
      });

      if (!result.success) {
        if (result.error === "File is not a media file") {
          return; // Silently skip non-media files
        }
        await this.adapter.sendErrorMessage(result.error || "Unknown error");
        return;
      }

      if (result.filename) {
        // Update with actual filename
        await this.adapter.sendStatusMessage(
          this.adapter.formatProcessingMessage(result.filename, options)
        );
        // Success message is sent from scribe.ts after upload
      }
    } catch (error) {
      console.error("Cloud file processing error:", error);
      await this.adapter.sendErrorMessage(
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  // Keep backward compatibility
  async processGoogleDriveUrl(url: string, options: TranscriptionOptions): Promise<void> {
    return await this.processCloudUrl(url, options);
  }

  /**
   * Process file attachments
   */
  async processAttachments(
    attachments: FileAttachment[],
    options: TranscriptionOptions
  ): Promise<void> {
    for (const attachment of attachments) {
      if (!isValidAudioVideoFile(attachment.mimeType)) {
        await this.adapter.sendStatusMessage(
          `ファイル "${attachment.filename}" は音声または動画ファイルではありません。`
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
    options: TranscriptionOptions
  ): Promise<void> {
    let tempPath: string | undefined;

    try {
      // Update status
      await this.adapter.sendStatusMessage(
        this.adapter.formatProcessingMessage(attachment.filename, options)
      );

      // For Slack files, download directly to temp
      const extension = getFileExtensionFromMime(attachment.mimeType || "");
      tempPath = await this.tempManager.createTempFile("audio", extension);
      await downloadSlackFileToPath(attachment.url, tempPath);

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
        platform: this.context.platform,
      });

      // Success message is sent from scribe.ts after upload
    } catch (error) {
      console.error(`${this.context.platform} attachment processing error:`, error);
      await this.adapter.sendErrorMessage(
        error instanceof Error ? error.message : "Unknown error"
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