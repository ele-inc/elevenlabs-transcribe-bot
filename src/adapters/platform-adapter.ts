import { TranscriptionOptions } from "../core/types.ts";
import type { WebhookDeliveryContext } from "../core/transcription-webhook.ts";
import { formatOptionsText } from "../services/file-processor.ts";
import {
  downloadSlackFileToPath,
  sendSlackMessage,
  uploadTranscriptToSlack,
} from "../clients/slack.ts";
import {
  downloadDiscordFileToPath,
  editInteractionReply,
  isUnknownWebhookError,
  sendDiscordMessage,
  uploadTranscriptToDiscord,
} from "../clients/discord.ts";
import { getUsageMessage } from "../utils/messages.ts";
import {
  buildErrorBlocks,
  buildSummaryBlocks,
  summaryFallbackText,
} from "../utils/slack-blocks.ts";
// @ts-ignore: Types are provided in the deployment environment
import { APIInteraction } from "discord-api-types/v10";

export interface SummaryContext {
  filename?: string;
  options?: TranscriptionOptions;
}

export interface PlatformAdapter {
  sendStatusMessage(message: string): Promise<void>;
  sendErrorMessage(error: string, hint?: string): Promise<void>;
  sendUsageMessage(): Promise<void>;
  formatProcessingMessage(
    filename: string,
    options: TranscriptionOptions,
  ): string;
  uploadTranscript(transcript: string, filename?: string): Promise<void>;
  sendSummary(summary: string, context?: SummaryContext): Promise<void>;
  downloadFile(fileURL: string, filePath: string): Promise<void>;
  getWebhookDeliveryContext(): WebhookDeliveryContext;
}

/**
 * Common implementation for formatting processing message
 */
function formatProcessingMessageCommon(
  filename: string,
  options: TranscriptionOptions,
): string {
  const optionsText = formatOptionsText(options);
  return `ファイル "${filename}" を受信しました。文字起こし中${optionsText}...`;
}

export class SlackAdapter implements PlatformAdapter {
  constructor(
    private channelId: string,
    private threadTimestamp: string,
  ) {}

  async sendStatusMessage(message: string): Promise<void> {
    await sendSlackMessage(this.channelId, message, this.threadTimestamp);
  }

  async sendErrorMessage(error: string, hint?: string): Promise<void> {
    const blocks = buildErrorBlocks(error, hint);
    await sendSlackMessage(
      this.channelId,
      `⚠️ ${error}`,
      this.threadTimestamp,
      blocks,
    );
  }

  async sendUsageMessage(): Promise<void> {
    await this.sendStatusMessage(getUsageMessage());
  }

  formatProcessingMessage(
    filename: string,
    options: TranscriptionOptions,
  ): string {
    return formatProcessingMessageCommon(filename, options);
  }

  async uploadTranscript(
    transcript: string,
    _filename?: string,
  ): Promise<void> {
    await uploadTranscriptToSlack(
      transcript,
      this.channelId,
      this.threadTimestamp,
    );
  }

  async sendSummary(summary: string, context?: SummaryContext): Promise<void> {
    const blocks = buildSummaryBlocks({
      summary,
      filename: context?.filename,
      options: context?.options,
    });
    await sendSlackMessage(
      this.channelId,
      summaryFallbackText(context?.filename),
      this.threadTimestamp,
      blocks,
    );
  }

  async downloadFile(fileURL: string, filePath: string): Promise<void> {
    await downloadSlackFileToPath(fileURL, filePath);
  }

  getWebhookDeliveryContext(): WebhookDeliveryContext {
    return {
      platform: "slack",
      channelId: this.channelId,
      threadTimestamp: this.threadTimestamp,
    };
  }
}

export class DiscordAdapter implements PlatformAdapter {
  constructor(
    private interaction: APIInteraction | undefined,
    private channelId: string,
  ) {}

  async sendStatusMessage(message: string): Promise<void> {
    await this.editInteractionReplyOrSendToChannel(message);
  }

  async sendErrorMessage(error: string, hint?: string): Promise<void> {
    const message = hint ? `⚠️ ${error}\n${hint}` : `⚠️ ${error}`;
    await this.editInteractionReplyOrSendToChannel(message);
  }

  async sendUsageMessage(): Promise<void> {
    await this.sendStatusMessage(getUsageMessage());
  }

  formatProcessingMessage(
    filename: string,
    options: TranscriptionOptions,
  ): string {
    return formatProcessingMessageCommon(filename, options);
  }

  async uploadTranscript(
    transcript: string,
    _filename?: string,
  ): Promise<void> {
    await uploadTranscriptToDiscord(transcript, this.channelId);
  }

  async sendSummary(summary: string, context?: SummaryContext): Promise<void> {
    const header = context?.filename
      ? `📝 **"${context.filename}" の要約**`
      : "📝 **文字起こし要約**";
    await sendDiscordMessage(this.channelId, `${header}\n\n${summary}`);
  }

  async downloadFile(fileURL: string, filePath: string): Promise<void> {
    await downloadDiscordFileToPath(fileURL, filePath);
  }

  getWebhookDeliveryContext(): WebhookDeliveryContext {
    return { platform: "discord", channelId: this.channelId };
  }

  private async editInteractionReplyOrSendToChannel(
    message: string,
  ): Promise<void> {
    if (!this.interaction) {
      await sendDiscordMessage(this.channelId, message);
      return;
    }

    try {
      await editInteractionReply(
        this.interaction.application_id,
        this.interaction.token,
        message,
      );
    } catch (error) {
      if (!isUnknownWebhookError(error)) {
        throw error;
      }

      if (!this.channelId) {
        throw error;
      }

      console.warn(
        "Discord interaction webhook expired; sending message to channel instead.",
      );
      await sendDiscordMessage(this.channelId, message);
    }
  }
}

export function createWebhookPlatformAdapter(
  context: WebhookDeliveryContext,
): PlatformAdapter {
  if (context.platform === "discord") {
    return new DiscordAdapter(undefined, context.channelId);
  }
  if (!context.threadTimestamp) {
    throw new Error("Slack webhook adapter requires threadTimestamp");
  }
  return new SlackAdapter(context.channelId, context.threadTimestamp);
}

export function createPlatformAdapter(
  platform: "discord" | "slack",
  context: {
    channelId: string;
    interaction?: APIInteraction;
    threadTimestamp?: string;
  },
): PlatformAdapter {
  if (platform === "discord") {
    if (!context.interaction) {
      throw new Error("Discord adapter requires interaction");
    }
    return new DiscordAdapter(context.interaction, context.channelId);
  } else {
    if (!context.threadTimestamp) {
      throw new Error("Slack adapter requires threadTimestamp");
    }
    return new SlackAdapter(context.channelId, context.threadTimestamp);
  }
}
