import { TranscriptionOptions } from "../core/types.ts";
import { formatOptionsText } from "../services/file-processor.ts";
import { sendSlackMessage } from "../clients/slack.ts";
import { editInteractionReply } from "../clients/discord.ts";
import { APIInteraction } from "npm:discord-api-types@0.37.100/v10";

export interface PlatformAdapter {
  sendStatusMessage(message: string): Promise<void>;
  sendErrorMessage(error: string): Promise<void>;
  sendSuccessMessage(filename: string): Promise<void>;
  sendUsageMessage(): Promise<void>;
  formatProcessingMessage(filename: string, options: TranscriptionOptions): string;
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
      `❌ エラーが発生しました: ${error}`,
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
    const usageMessage = `📝 *使い方*\n\n` +
      `音声または動画ファイルをアップロードしてメンションするか、\n` +
      `Google Driveのリンクを含めてメンションしてください。\n\n` +
      `*オプション:*\n` +
      `• \`--no-diarize\`: 話者識別を無効化\n` +
      `• \`--no-timestamp\`: タイムスタンプを非表示\n` +
      `• \`--no-audio-events\`: 音声イベント（拍手、音楽など）のタグを無効化\n` +
      `• \`--num-speakers <数>\`: 話者数を指定（デフォルト: 2）\n` +
      `• \`--speaker-names "<名前1>,<名前2>"\`: 話者名を指定（AIが自動判定）\n\n` +
      `*使用例:*\n` +
      `@文字起こしKUN --no-timestamp --num-speakers 3\n` +
      `@文字起こしKUN --speaker-names "田中,山田"\n` +
      `@文字起こしKUN https://drive.google.com/file/d/xxxxx/view`;

    await this.sendStatusMessage(usageMessage);
  }

  formatProcessingMessage(filename: string, options: TranscriptionOptions): string {
    return formatProcessingMessageCommon(filename, options);
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
      `❌ エラーが発生しました: ${error}`
    );
  }

  async sendSuccessMessage(filename: string): Promise<void> {
    await editInteractionReply(
      this.interaction.token,
      `✅ "${filename}" の文字起こしが完了しました！`
    );
  }

  async sendUsageMessage(): Promise<void> {
    const usageMessage = `**🎙️概要**
音声・動画ファイルやGoogle DriveのURLから文字起こしを行います。
チャット欄に/transcribeと入力で使用開始。

**⚙️オプション**
• \`--no-diarize\`: 話者識別をオフ ※話者が一人の場合には使用推奨
• \`--num-speakers <数>\`: 話者数を指定（デフォルト:2）※指定することで話者識別の精度が向上します
• \`--speaker-names 名前1,名前2\`: 話者名を設定（順不同、人数分必要）
• \`--no-timestamp\`: タイムスタンプを非表示
• \`--no-audio-events\`: 音声イベントを非表示

**⚠️注意点**
•「アプリケーションが応答しませんでした」と表示されても、Discordの仕様によるもので処理は実行されています。
•Google DriveのURLからの文字起こしは、最大20GBのファイルに対応しています。`;

    await this.sendStatusMessage(usageMessage);
  }

  formatProcessingMessage(filename: string, options: TranscriptionOptions): string {
    return formatProcessingMessageCommon(filename, options);
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