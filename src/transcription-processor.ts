/**
 * Common transcription processing workflow
 * Unifies the transcription logic for both Discord and Slack
 */

import { TranscriptionOptions } from "./types.ts";
import { transcribeAudioFile } from "./scribe.ts";
import { TempFileManager } from "./temp-file-manager.ts";
import { processGoogleDriveFile, isValidAudioVideoFile, extractMediaInfo } from "./file-processor.ts";
import { PlatformAdapter } from "./platform-adapter.ts";
import { downloadSlackFileToPath } from "./slack.ts";
import { getFileExtensionFromMime } from "./utils.ts";

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
   * Process text input for Google Drive URLs
   */
  async processTextInput(text: string, options: TranscriptionOptions): Promise<void> {
    const { googleDriveUrls } = extractMediaInfo(text);

    if (googleDriveUrls.length === 0) {
      return;
    }

    for (const url of googleDriveUrls) {
      await this.processGoogleDriveUrl(url, options);
    }
  }

  /**
   * Process a Google Drive URL
   */
  async processGoogleDriveUrl(url: string, options: TranscriptionOptions): Promise<void> {
    try {
      const result = await processGoogleDriveFile(url, {
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
        await this.adapter.sendStatusMessage(
          this.adapter.formatProcessingMessage(result.filename, options)
        );
        await this.adapter.sendSuccessMessage(result.filename);
      }
    } catch (error) {
      console.error("Google Drive processing error:", error);
      await this.adapter.sendErrorMessage(
        error instanceof Error ? error.message : "Unknown error"
      );
    }
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

      // Success message
      await this.adapter.sendSuccessMessage(attachment.filename);
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