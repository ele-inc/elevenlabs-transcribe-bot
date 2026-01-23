import { TranscriptionOptions } from "../core/types.ts";
import { formatOptionsText } from "../services/file-processor.ts";
import { sendSlackMessage, uploadTranscriptToSlack, downloadSlackFileToPath } from "../clients/slack.ts";
import { editInteractionReply, sendDiscordMessage, uploadTranscriptToDiscord, downloadDiscordFile } from "../clients/discord.ts";
import { getUsageMessage } from "../utils/messages.ts";
// @ts-ignore: Types are provided in the deployment environment
import { APIInteraction } from "npm:discord-api-types/v10";

export interface PlatformAdapter {
  sendStatusMessage(message: string): Promise<void>;
  sendErrorMessage(error: string): Promise<void>;
  sendSuccessMessage(filename: string): Promise<void>;
  sendUsageMessage(): Promise<void>;
  formatProcessingMessage(filename: string, options: TranscriptionOptions): string;
  uploadTranscript(transcript: string, filename?: string): Promise<void>;
  sendSummary(summary: string): Promise<void>;
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

  async sendErrorMessage(error: string): Promise<void> {
    await sendSlackMessage(
      this.channelId,
      `❌ ${error}`,
      this.threadTimestamp
    );
  }

  async sendSuccessMessage(filename: string): Promise<void> {
    await sendSlackMessage(
      this.channelId,
      `✅ "${filename}" の文字起こしが完了しました！`,
      this.threadTimestamp
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

  async sendSummary(summary: string): Promise<void> {
    const summaryMessage = `📝 要約\n${summary}`;
    await sendSlackMessage(this.channelId, summaryMessage, this.threadTimestamp);
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

  async sendErrorMessage(error: string): Promise<void> {
    await editInteractionReply(
      this.interaction.token,
      `❌ ${error}`
    );
  }

  async sendSuccessMessage(filename: string): Promise<void> {
    await editInteractionReply(
      this.interaction.token,
      `✅ "${filename}" の文字起こしが完了しました！`
    );
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

  async sendSummary(summary: string): Promise<void> {
    const channelId = this.interaction.channel?.id || "";
    const summaryMessage = `📝 要約\n${summary}`;
    await sendDiscordMessage(channelId, summaryMessage);
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
