/**
 * Centralized message constants for bot responses
 * Used across Discord and Slack handlers
 */

/**
 * List of supported services for usage messages
 */
export const SUPPORTED_SERVICES = [
  "Google Drive",
  "Dropbox",
  "YouTube",
  "Vimeo",
  "Loom",
  "Zoom",
  "Utage",
  "HLS(.m3u8)",
];

/**
 * Get formatted list of supported services
 */
function getSupportedServicesList(): string {
  return SUPPORTED_SERVICES.join("、");
}

/**
 * Usage message for Slack
 */
export function getUsageMessage(): string {
  return `🎙️ 音声・動画ファイルまたは${getSupportedServicesList()}のURLから文字起こしができます。

**オプション**
• \`--no-diarize\`: 話者識別OFF（一人の場合に推奨）
• \`--num-speakers <数>\`: 話者数を指定（デフォルト:2）
• \`--speaker-names <名前1,名前2>\`: 話者名を指定
• \`--no-timestamp\`: タイムスタンプ非表示
• \`--no-audio-events\`: 音声イベント非表示
• \`--no-summarize\`: 要約スキップ

**使用例**
• [ファイル添付]
• [ファイル添付] \`--num-speakers 3\`
• [URL] \`https://www.youtube.com/watch?v=xxxxx\`
• [URL + オプション] \`https://utage-system.com/video/xxxxx --speaker-names 田中,山田\``;
}

/**
 * Usage message for Discord
 */
export function getDiscordUsageMessage(): string {
  return `🎙️ **文字起こしBot**

**スラッシュコマンドの使い方**
メッセージ入力欄に \`/\` を入力すると、利用可能なコマンド一覧が表示されます。
\`/transcribe\` を選択して使用してください。

**\`/transcribe\` コマンド**
• \`/transcribe file:\` → ファイルを選択して文字起こし
• \`/transcribe url:\` → URLから文字起こし
• \`/transcribe file: options:--num-speakers 3\` → オプション付き

**右クリックメニュー**
音声/動画が添付されたメッセージを右クリック → アプリ → 「Transcribe Audio/Video」

**対応URL**
${getSupportedServicesList()}

**オプション一覧**
• \`--no-diarize\`: 話者識別OFF
• \`--num-speakers <数>\`: 話者数を指定
• \`--speaker-names <名前1,名前2>\`: 話者名を指定
• \`--no-timestamp\`: タイムスタンプ非表示
• \`--no-audio-events\`: 音声イベント非表示
• \`--no-summarize\`: 要約スキップ

⚠️ ファイルは10MBまで。大きいファイルはGoogle Drive経由で。`;
}

/**
 * Error message for unsupported content
 */
export function getUnsupportedContentMessage(): string {
  return `音声/動画ファイルまたは対応URL(${getSupportedServicesList()})を送信してください。`;
}
