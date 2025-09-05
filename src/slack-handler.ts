/**
 * Slack bot event handler
 * Extracted from index.ts for better separation of concerns
 */

import { SlackEvent } from "./types.ts";
import { parseTranscriptionOptions, extractGoogleDriveUrls } from "./utils.ts";
import { sendSlackMessage } from "./slack.ts";
import { transcribeAudioFile, transcribeAudioFromStream } from "./scribe.ts";
import { GoogleDriveStreamer, parseGoogleDriveUrl } from "./googledrive-stream.ts";
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

  // Process Google Drive URLs with streaming
  for (const driveUrl of googleDriveUrls) {
        try {
          // Parse Google Drive URL
          const fileId = parseGoogleDriveUrl(driveUrl);
          if (!fileId) {
            await sendSlackMessage(
              event.channel,
              `無効なGoogle Drive URLです。`,
              event.ts,
            );
            continue;
          }

          // Initialize streamer
          const streamer = new GoogleDriveStreamer();
          
          // Get file metadata
          const metadata = await streamer.getFileMetadata(fileId);
          const { name: filename, mimeType } = metadata;

          // Check if it's an audio/video file
          if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
            await sendSlackMessage(
              event.channel,
              `Google Driveファイル "${filename}" は音声または動画ファイルではありません。`,
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
            `Google Driveファイル "${filename}" をストリーミングで文字起こし中${optionText}...`,
            event.ts,
          );

          // Get audio stream (converts video if needed)
          let audioStream: ReadableStream<Uint8Array>;
          let processingDone: Promise<void>;
          
          if (mimeType.startsWith("video/")) {
            console.log("Streaming video to audio conversion...");
            const result = await streamer.streamVideoToAudio(fileId);
            audioStream = result.stream;
            processingDone = result.done;
          } else {
            console.log("Streaming audio directly...");
            const result = await streamer.streamAudio(fileId);
            audioStream = result.stream;
            processingDone = result.done;
          }

          // Run streaming transcription and wait for both to complete
          const transcribePromise = transcribeAudioFromStream({
              audioStream,
              fileType: "audio/mpeg", // Always MP3 after conversion
              channelId: event.channel,
              timestamp: event.ts,
              userId: event.user,
              options,
              filename,
              platform: "slack",
          });
          
          // Wait for both transcription and processing to complete
          Promise.all([transcribePromise, processingDone]).catch((error) => {
              console.error("Error processing Google Drive stream:", error);
              sendSlackMessage(
                event.channel,
                `Google Driveファイルのストリーミング処理中にエラーが発生しました: ${error.message}`,
                event.ts,
              );
          });
        } catch (error) {
          console.error("Error accessing Google Drive:", error);
          await sendSlackMessage(
            event.channel,
            `Google Driveアクセスエラー: ${error instanceof Error ? error.message : "Unknown error"}`,
            event.ts,
          );
        }
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
