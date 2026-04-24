import { TranscriptionOptions } from "../core/types.ts";
import { formatOptionsText } from "../services/file-processor.ts";
import { sendSlackMessage, uploadTranscriptToSlack, downloadSlackFileToPath } from "../clients/slack.ts";
import { editInteractionReply, sendDiscordMessage, uploadTranscriptToDiscord, downloadDiscordFile } from "../clients/discord.ts";
import { getUsageMessage } from "../utils/messages.ts";
import {
  buildSummaryBlocks,
  buildErrorBlocks,
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
  formatProcessingMessage(filename: string, options: TranscriptionOptions): string;
  uploadTranscript(transcript: string, filename?: string): Promise<void>;
  sendSummary(summary: string, context?: SummaryContext): Promise<void>;
  downloadFile(fileURL: string, filePath: string): Promise<void>;
}

/**
 * Common implementation for formatting processing message
 */
function formatProcessingMessageCommon(filename: string, options: TranscriptionOptions): string {
  const optionsText = formatOptionsText(options);
  return `ファイル "${filename}" を受信しました。文字起こし中${optionsText}...`;
}

export class SlackAdapter implements PlatformAdapter {
  constructor(
    private channelId: string,
    private threadTimestamp: string
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

  formatProcessingMessage(filename: string, options: TranscriptionOptions): string {
    return formatProcessingMessageCommon(filename, options);
  }

  async uploadTranscript(transcript: string, _filename?: string): Promise<void> {
    await uploadTranscriptToSlack(transcript, this.channelId, this.threadTimestamp);
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
}

export class DiscordAdapter implements PlatformAdapter {
  constructor(
    private interaction: APIInteraction
  ) {}

  async sendStatusMessage(message: string): Promise<void> {
    await editInteractionReply(this.interaction.token, message);
  }

  async sendErrorMessage(error: string, hint?: string): Promise<void> {
    const message = hint ? `⚠️ ${error}\n${hint}` : `⚠️ ${error}`;
    await editInteractionReply(this.interaction.token, message);
  }

  async sendUsageMessage(): Promise<void> {
    await this.sendStatusMessage(getUsageMessage());
  }

  formatProcessingMessage(filename: string, options: TranscriptionOptions): string {
    return formatProcessingMessageCommon(filename, options);
  }

  async uploadTranscript(transcript: string, _filename?: string): Promise<void> {
    const channelId = this.interaction.channel?.id || "";
    await uploadTranscriptToDiscord(transcript, channelId);
  }

  async sendSummary(summary: string, context?: SummaryContext): Promise<void> {
    const channelId = this.interaction.channel?.id || "";
    const header = context?.filename
      ? `📝 **"${context.filename}" の要約**`
      : "📝 **文字起こし要約**";
    await sendDiscordMessage(channelId, `${header}\n\n${summary}`);
  }

  async downloadFile(fileURL: string, filePath: string): Promise<void> {
    // Discord returns Uint8Array, so we need to write it to file
    const fileData = await downloadDiscordFile(fileURL);
    await Deno.writeFile(filePath, fileData);
  }
}

export function createPlatformAdapter(
  platform: "discord" | "slack",
  context: {
    channelId: string;
    interaction?: APIInteraction;
    threadTimestamp?: string;
  }
): PlatformAdapter {
  if (platform === "discord") {
    if (!context.interaction) {
      throw new Error("Discord adapter requires interaction");
    }
    return new DiscordAdapter(context.interaction);
  } else {
    if (!context.threadTimestamp) {
      throw new Error("Slack adapter requires threadTimestamp");
    }
    return new SlackAdapter(context.channelId, context.threadTimestamp);
  }
}
