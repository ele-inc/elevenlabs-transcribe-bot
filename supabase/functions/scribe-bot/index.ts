import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SlackEvent } from "./types.ts";
import { parseTranscriptionOptions } from "./utils.ts";
import { sendSlackMessage } from "./slack.ts";
import { transcribeAudioFile } from "./scribe.ts";

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

// Set to track processed events (with size limit to prevent memory leak)
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

// Handle app mention with files
async function handleAppMention(event: SlackEvent) {
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

  try {
    // Check if the mention includes files
    if (!event.files || event.files.length === 0) {
      const usageMessage = `📝 *使い方*\n\n` +
        `音声または動画ファイルをアップロードしてメンションしてください。\n\n` +
        `*オプション:*\n` +
        `• \`--no-diarize\`: 話者識別を無効化\n` +
        `• \`--no-timestamp\`: タイムスタンプを非表示\n` +
        `• \`--no-audio-events\`: 音声イベント（拍手、音楽など）のタグを無効化\n` +
        `• \`--num-speakers <数>\`: 話者数を指定（デフォルト: 2）\n\n` +
        `*使用例:*\n` +
        `@文字起こしKUN --no-timestamp --num-speakers 3`;

      return await sendSlackMessage(
        event.channel,
        usageMessage,
        event.ts,
      );
    }

    // Filter and process audio/video files
    const audioVideoFiles = event.files.filter((file) =>
      file.mimetype?.startsWith("audio/") || file.mimetype?.startsWith("video/")
    );

    if (audioVideoFiles.length === 0) {
      for (const file of event.files) {
        await sendSlackMessage(
          event.channel,
          `File "${file.name}" is not an audio or video file. Please upload an audio or video file for transcription.`,
          event.ts,
        );
      }
      return;
    }

    for (const file of audioVideoFiles) {
      // Get file download URL
      const fileURL = file.url_private_download || file.url_private;

      if (!fileURL) {
        await sendSlackMessage(
          event.channel,
          `Could not access file "${file.name}". Please try uploading again.`,
          event.ts,
        );
        continue;
      }

      // Reply to the user immediately with option info
      const optionInfo = [];
      if (!options.diarize) optionInfo.push("話者識別OFF");
      if (!options.showTimestamp) optionInfo.push("タイムスタンプOFF");
      if (!options.tagAudioEvents) optionInfo.push("音声イベントOFF");
      if (options.diarize && options.numSpeakers && options.numSpeakers !== 2) {
        optionInfo.push(`話者数: ${options.numSpeakers}`);
      }

      const optionText = optionInfo.length > 0
        ? ` (${optionInfo.join(", ")})`
        : "";

      await sendSlackMessage(
        event.channel,
        `Received "${file.name}". Scribing${optionText}...`,
        event.ts,
      );

      // Run the transcription in the background
      EdgeRuntime.waitUntil(
        transcribeAudioFile({
          fileURL,
          fileType: file.mimetype || "",
          duration: file.duration || 0,
          channelId: event.channel,
          timestamp: event.ts,
          userId: event.user,
          options,
          filename: file.name,
        }),
      );
    }
  } catch (error) {
    console.error(error);
    return await sendSlackMessage(
      event.channel,
      "Sorry, there was an error processing your files. Please try again!",
      event.ts,
    );
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === "POST") {
      const bodyText = await req.text();
      const body = JSON.parse(bodyText);

      // Handle Slack URL verification challenge
      if (body.type === "url_verification") {
        return new Response(body.challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // Handle Slack events
      if (body.type === "event_callback") {
        const event = body.event;

        if (event.type !== "app_mention") {
          return new Response("OK", { status: 200 });
        }
        // Process in background to respond quickly to Slack
        EdgeRuntime.waitUntil(handleAppMention(event));
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error(err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
