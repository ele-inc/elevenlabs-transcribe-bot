// Removed Supabase Edge Runtime dependency for Cloud Run
import { SlackEvent } from "./types.ts";
import { parseTranscriptionOptions, extractGoogleDriveUrls } from "./utils.ts";
import { sendSlackMessage } from "./slack.ts";
import { transcribeAudioFile } from "./scribe.ts";
import { downloadGoogleDriveFile } from "./googledrive.ts";
import { handleDiscordInteraction } from "./discord-handler.ts";

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
        `• \`--num-speakers <数>\`: 話者数を指定（デフォルト: 2）\n\n` +
        `*使用例:*\n` +
        `@文字起こしKUN --no-timestamp --num-speakers 3\n` +
        `@文字起こしKUN https://drive.google.com/file/d/xxxxx/view`;

      return await sendSlackMessage(
        event.channel,
        usageMessage,
        event.ts,
      );
    }

    // Process Google Drive URLs first
    for (const driveUrl of googleDriveUrls) {
      try {
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
          try {
            await Deno.remove(tempPath);
            await Deno.remove(tempDir);
          } catch {
            // Ignore cleanup errors
          }
          continue;
        }

        // Prepare option info
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
      } catch (error) {
        console.error("Google Drive processing error:", error);
        await sendSlackMessage(
          event.channel,
          `Google Driveファイルの処理中にエラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`,
          event.ts,
        );
      }
    }

    // Filter and process audio/video files from Slack
    const audioVideoFiles = event.files?.filter((file) =>
      file.mimetype?.startsWith("audio/") || file.mimetype?.startsWith("video/")
    ) || [];

    if (audioVideoFiles.length === 0 && googleDriveUrls.length === 0) {
      // This case is already handled above
      return;
    }

    if (audioVideoFiles.length === 0 && googleDriveUrls.length > 0) {
      // Already processed Google Drive URLs above
      return;
    }

    // Check if uploaded files are audio/video
    if (event.files && audioVideoFiles.length === 0 && event.files.length > 0) {
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
      transcribeAudioFile({
          fileURL,
          fileType: file.mimetype || "",
          duration: file.duration || 0,
          channelId: event.channel,
          timestamp: event.ts,
          userId: event.user,
          options,
          filename: file.name,
        }).catch(console.error);
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

const port = parseInt(Deno.env.get("PORT") || "8080");

Deno.serve({ port }, async (req) => {
  try {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // Log incoming request for debugging
    console.log("Incoming request method:", req.method);
    console.log("Incoming request URL:", req.url);
    console.log("Path:", pathname);
    
    // Health check endpoint
    if (pathname === "/" && req.method === "GET") {
      return new Response("ElevenLabs Scribe Bot is running!", { status: 200 });
    }
    
    // Discord endpoint
    if (pathname === "/discord/interactions") {
      console.log("Discord request detected");
      // Handle Discord interactions
      return await handleDiscordInteraction(req);
    }
    
    // Slack endpoint
    if (pathname === "/slack/events" && req.method === "POST") {
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
        handleAppMention(event).catch(console.error);
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error(err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
