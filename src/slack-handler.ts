/**
 * Slack bot event handler
 * Extracted from index.ts for better separation of concerns
 */

import { SlackEvent } from "./types.ts";
import { parseTranscriptionOptions, extractGoogleDriveUrls } from "./utils.ts";
import { sendSlackMessage } from "./slack.ts";
import { transcribeAudioFile } from "./scribe.ts";
import { downloadGoogleDriveFile } from "./googledrive.ts";
import { textResponse, okResponse, badRequest } from "./http-utils.ts";

// Set to track processed events (with size limit to prevent memory leak)
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

/**
 * Handle Slack app mention events
 */
export async function handleAppMention(event: SlackEvent) {
  // Create unique event ID to prevent duplicates
  const eventId = `${event.channel}_${event.ts}_${event.user}`;

  if (processedEvents.has(eventId)) {
    console.log("Duplicate event detected, skipping:", eventId);
    return;
  }

  // Add event ID and maintain size limit
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_PROCESSED_EVENTS) {
    const firstKey = processedEvents.values().next().value;
    if (firstKey) processedEvents.delete(firstKey);
  }
  console.log("Processing new event:", eventId);

  // Parse transcription options from mention text
  const options = parseTranscriptionOptions(event.text);
  console.log("Parsed options:", options);

  // Check for Google Drive URLs in the message
  const googleDriveUrls = extractGoogleDriveUrls(event.text || "");

  // Check if the mention includes files or Google Drive URLs
  if ((!event.files || event.files.length === 0) && googleDriveUrls.length === 0) {
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

    await sendSlackMessage(
      event.channel,
      usageMessage,
      event.ts,
    );
    return;
  }

  // Process Google Drive URLs first
  for (const driveUrl of googleDriveUrls) {
        // Create temporary file path
        const tempDir = await Deno.makeTempDir();
        const tempPath = `${tempDir}/gdrive_${Date.now()}.tmp`;

        // Reply that we're processing the Google Drive file
        await sendSlackMessage(
          event.channel,
          `Google Driveファイルを処理中...`,
          event.ts,
        );

        // Download and get metadata
        const { filename, mimeType } = await downloadGoogleDriveFile(driveUrl, tempPath);

        // Check if it's an audio/video file
        if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
          await sendSlackMessage(
            event.channel,
            `Google Driveファイル "${filename}" は音声または動画ファイルではありません。`,
            event.ts,
          );
          // Clean up temp file
          await Deno.remove(tempPath);
          continue;
        }

        // Reply with file info including options
        const optionInfo = [];
        if (!options.diarize) optionInfo.push("話者識別OFF");
        if (!options.showTimestamp) optionInfo.push("タイムスタンプOFF");
        if (!options.tagAudioEvents) optionInfo.push("音声イベントOFF");
        if (options.diarize && options.numSpeakers && options.numSpeakers !== 2) {
          optionInfo.push(`話者数: ${options.numSpeakers}`);
        }
        if (options.speakerNames && options.speakerNames.length > 0) {
          optionInfo.push(`話者名: ${options.speakerNames.join(", ")}`);
        }

        const optionText = optionInfo.length > 0
          ? ` (${optionInfo.join(", ")})`
          : "";

        await sendSlackMessage(
          event.channel,
          `Google Driveファイル "${filename}" を受信しました。文字起こし中${optionText}...`,
          event.ts,
        );

        // Create file URL for local temp file
        const fileURL = `file://${tempPath}`;

        // Run transcription in the background
        // Process transcription asynchronously without blocking response
        transcribeAudioFile({
            fileURL,
            fileType: mimeType,
            duration: 0, // Duration not available from Google Drive
            channelId: event.channel,
            timestamp: event.ts,
            userId: event.user,
            options,
            filename,
            isGoogleDrive: true,
            tempPath, // Pass temp path for cleanup
          }).catch(console.error);
  }

    // Process regular Slack files
    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        // Check if file is not audio or video
        if (!file.mimetype || (!file.mimetype.startsWith("audio/") && !file.mimetype.startsWith("video/"))) {
          await sendSlackMessage(
            event.channel,
            `ファイル "${file.name}" は音声または動画ファイルではありません。`,
            event.ts,
          );
          continue;
        }

        // Reply with file info including options
        const optionInfo = [];
        if (!options.diarize) optionInfo.push("話者識別OFF");
        if (!options.showTimestamp) optionInfo.push("タイムスタンプOFF");
        if (!options.tagAudioEvents) optionInfo.push("音声イベントOFF");
        if (options.diarize && options.numSpeakers && options.numSpeakers !== 2) {
          optionInfo.push(`話者数: ${options.numSpeakers}`);
        }
        if (options.speakerNames && options.speakerNames.length > 0) {
          optionInfo.push(`話者名: ${options.speakerNames.join(", ")}`);
        }

        const optionText = optionInfo.length > 0
          ? ` (${optionInfo.join(", ")})`
          : "";

        await sendSlackMessage(
          event.channel,
          `ファイル "${file.name}" を受信しました。文字起こし中${optionText}...`,
          event.ts,
        );

        // Process transcription asynchronously without blocking response
        transcribeAudioFile({
          fileURL: file.url_private || "",
          fileType: file.mimetype || "",
          duration: file.duration || 0,
          channelId: event.channel,
          timestamp: event.ts,
          userId: event.user,
          options,
          filename: file.name,
        }).catch(console.error);
      }
    }
}

/**
 * Handle Slack URL verification challenge
 */
export function handleUrlVerification(challenge: string): Response {
  return textResponse(challenge);
}

/**
 * Main Slack events handler
 */
export async function handleSlackEvents(req: Request): Promise<Response> {
  const bodyText = await req.text();
  const body = JSON.parse(bodyText);

  // Handle URL verification challenge
  if (body.type === "url_verification") {
    return handleUrlVerification(body.challenge);
  }

  // Handle events
  if (body.type === "event_callback") {
    const event = body.event;

    if (event.type !== "app_mention") {
      return okResponse();
    }

    // Process in background to respond quickly to Slack
    handleAppMention(event).catch(console.error);
    return okResponse();
  }

  return badRequest("Unknown event type");
}
