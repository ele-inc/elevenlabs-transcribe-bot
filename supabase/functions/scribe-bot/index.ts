import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@^2";
import { ElevenLabsClient } from "npm:elevenlabs@1.59.0";

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

const elevenlabs = new ElevenLabsClient({
  apiKey: Deno.env.get("ELEVENLABS_API_KEY") || "",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
);

// A single word item returned by Scribe.
interface WordItem {
  text: string;
  start: number;
  end?: number;
  speaker_id?: string | number;
}

// Grouped utterance by a single speaker.
interface SpeakerUtterance {
  speaker: string | number;
  text: string;
  start: number;
}

// Format seconds -> m:ss or h:mm:ss.
const formatTimestamp = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${
      secs.toString().padStart(2, "0")
    }`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * 会話を話者ごとにグループ化する
 * @param words 単語リスト
 * @returns 話者ごとにグループ化された発言リスト
 */
const groupBySpeaker = (words: WordItem[]): SpeakerUtterance[] => {
  const conversation: SpeakerUtterance[] = [];
  let currentSpeaker: string | number | null = null;
  let currentText = "";
  let currentStart = 0;

  for (const word of words) {
    // speaker_idがない場合も処理する
    const speakerId = word.speaker_id ?? "unknown_speaker";

    if (currentSpeaker === null) {
      // 最初の単語
      currentSpeaker = speakerId;
      currentText = word.text;
      currentStart = word.start;
    } else if (currentSpeaker === speakerId) {
      // 同じ話者が続く場合
      currentText += word.text;
    } else {
      // 話者が変わった場合
      conversation.push({
        speaker: currentSpeaker,
        text: currentText,
        start: currentStart,
      });

      currentSpeaker = speakerId;
      currentText = word.text;
      currentStart = word.start;
    }
  }

  // 最後の話者の発言を追加
  if (currentText && currentSpeaker !== null) {
    conversation.push({
      speaker: currentSpeaker,
      text: currentText,
      start: currentStart,
    });
  }

  return conversation;
};

// Send message to Slack
async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });

  return await response.json();
}

async function scribe({
  fileURL,
  fileType,
  duration,
  channelId,
  timestamp,
  userId,
}: {
  fileURL: string;
  fileType: string;
  duration: number;
  channelId: string;
  timestamp: string;
  userId: string;
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  let errorMsg: string | null = null;
  let tempFilePath: string | null = null;

  console.log("fileURL", fileURL, "scribe called");
  console.log("fileType (MIME):", fileType);
  try {
    console.log("fetching file");
    const response = await fetch(fileURL, {
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
      },
    });

    console.log("Response status:", response.status);
    console.log("Response content-type:", response.headers.get("content-type"));

    // Debug: Check if response is HTML error page
    if (response.headers.get("content-type")?.includes("text/html")) {
      const htmlContent = await response.text();
      console.log(
        "HTML Response (first 500 chars):",
        htmlContent.substring(0, 500),
      );
      throw new Error(
        "Received HTML instead of audio file - likely authentication error",
      );
    }

    const sourceFileArrayBuffer = await response.arrayBuffer();
    console.log("File size:", sourceFileArrayBuffer.byteLength, "bytes");

    // Create temporary file with proper extension mapping
    const tempDir = await Deno.makeTempDir();
    const getFileExtension = (mimeType: string): string => {
      const mimeToExt: { [key: string]: string } = {
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "audio/wave": "wav",
        "audio/x-wav": "wav",
        "audio/mp4": "m4a",
        "audio/aac": "aac",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "video/mp4": "mp4",
        "video/mpeg": "mpg",
        "video/quicktime": "mov",
        "video/x-msvideo": "avi",
        "video/webm": "webm",
      };
      return mimeToExt[mimeType] || mimeType.split("/")[1] || "bin";
    };

    const fileExtension = getFileExtension(fileType);
    tempFilePath = `${tempDir}/audio_${Date.now()}.${fileExtension}`;

    console.log("saving to temp file:", tempFilePath);
    await Deno.writeFile(tempFilePath, new Uint8Array(sourceFileArrayBuffer));

    const shouldDiarize = true; // toggle here if you want diarization

    console.log("calling elevenlabs");

    // Create file from temp path for ElevenLabs API
    const fileHandle = await Deno.open(tempFilePath, { read: true });
    const fileBlob = new Blob([await Deno.readFile(tempFilePath)], {
      type: fileType,
    });
    fileHandle.close();

    console.log("Sending to ElevenLabs API...");
    const scribeResult = await elevenlabs.speechToText.convert({
      file: fileBlob,
      model_id: "scribe_v1", // 'scribe_v1_experimental' is also available for new, experimental features
      tag_audio_events: true,
      diarize: shouldDiarize,
      language_code: "ja",
    }, { timeoutInSeconds: 120 });

    console.log("ElevenLabs API response received");
    console.log("Scribe result:", JSON.stringify(scribeResult, null, 2));

    // If diarization data is available, format transcript per speaker; otherwise fallback to plain text.
    const words: WordItem[] | undefined = (scribeResult as any).words;

    if (shouldDiarize && Array.isArray(words) && words.length > 0) {
      const grouped = groupBySpeaker(words);
      transcript = grouped
        .map((u) => {
          const speakerLabel = typeof u.speaker === "number"
            ? `speaker_${u.speaker}`
            : `${u.speaker}`;
          return `[${
            formatTimestamp(u.start)
          }] ${speakerLabel}: ${u.text.trim()}`;
        })
        .join("\n");
    } else {
      // ===== No diarization: plain text with basic sentence breaks, no timestamps =====
      const plain = (scribeResult.text || "").trim();
      // Insert newline after punctuation commonly used as sentence boundaries.
      transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
    }

    languageCode = (scribeResult as any).language_code;

    console.log("Generated transcript:", transcript);
    console.log("Language code:", languageCode);

    // Check if transcript exists before creating file
    if (transcript) {
      console.log("Uploading transcript to Slack...");

      // Create a text file with timestamp
      const fileTimestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("T", "_")
        .slice(0, 15);
      const filename = `transcript_${fileTimestamp}.txt`;

      // Use new Slack Files API v2 with proper form-data
      console.log("Using Slack Files API v2");

      const fileBytes = new TextEncoder().encode(transcript);
      console.log("File size:", fileBytes.length, "bytes");

      // Step 1: Get upload URL with form-data
      const formData1 = new FormData();
      formData1.append("filename", filename);
      formData1.append("length", fileBytes.length.toString());

      const uploadUrlResponse = await fetch(
        "https://slack.com/api/files.getUploadURLExternal",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
          },
          body: formData1,
        },
      );

      const uploadUrlResult = await uploadUrlResponse.json();
      console.log(
        "Upload URL response:",
        JSON.stringify(uploadUrlResult, null, 2),
      );

      if (!uploadUrlResult.ok) {
        throw new Error(`Failed to get upload URL: ${uploadUrlResult.error}`);
      }

      // Step 2: Upload file to the pre-signed URL
      const fileUploadResponse = await fetch(uploadUrlResult.upload_url, {
        method: "POST",
        body: fileBytes,
      });

      if (!fileUploadResponse.ok) {
        throw new Error(
          `Failed to upload file: ${fileUploadResponse.statusText}`,
        );
      }

      // Step 3: Complete the upload with form-data
      const formData2 = new FormData();
      formData2.append(
        "files",
        JSON.stringify([{
          id: uploadUrlResult.file_id,
          title: filename,
        }]),
      );
      formData2.append("channel_id", channelId);
      formData2.append("initial_comment", "文字起こしが完了しました！📝");
      formData2.append("thread_ts", timestamp);

      const completeResponse = await fetch(
        "https://slack.com/api/files.completeUploadExternal",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SLACK_BOT_TOKEN")}`,
          },
          body: formData2,
        },
      );

      const completeResult = await completeResponse.json();
      console.log(
        "Complete upload response:",
        JSON.stringify(completeResult, null, 2),
      );

      if (!completeResult.ok) {
        throw new Error(`Failed to complete upload: ${completeResult.error}`);
      }

      console.log("Transcript successfully uploaded to Slack");
    } else {
      console.log("No transcript generated, sending error message");
      // Fallback to error message if transcript is empty
      await sendSlackMessage(
        channelId,
        "Sorry, no transcript was generated. Please try again.",
        timestamp,
      );
    }
  } catch (error) {
    errorMsg = error.message;
    await sendSlackMessage(
      channelId,
      "Sorry, there was an error. Please try again.",
      timestamp,
    );
  } finally {
    // Clean up temporary file
    if (tempFilePath) {
      try {
        console.log("cleaning up temp file:", tempFilePath);
        await Deno.remove(tempFilePath);
        // Also try to remove the temp directory if it's empty
        const tempDir = tempFilePath.substring(
          0,
          tempFilePath.lastIndexOf("/"),
        );
        try {
          await Deno.remove(tempDir);
        } catch {
          // Ignore error if directory is not empty or doesn't exist
        }
      } catch (cleanupError) {
        console.log("Error cleaning up temp file:", cleanupError.message);
      }
    }
  }

  // Write log to Supabase.
  const logLine = {
    file_type: fileType,
    duration,
    channel_id: channelId,
    message_ts: timestamp,
    user_id: userId,
    language_code: languageCode,
    error: errorMsg,
  };
  await supabase.from("transcription_logs").insert({ ...logLine, transcript });
}

// Handle hello message
async function handleMessage(event: any) {
  if (event.text?.toLowerCase().includes("hello")) {
    const startMessage =
      `Welcome to the ElevenLabs Scribe Bot! I can transcribe speech in 99 languages with super high accuracy!
Try it out by uploading a voice message, video, or audio file!
[Learn more about Scribe](https://elevenlabs.io/speech-to-text)!`;

    await sendSlackMessage(event.channel, startMessage);
  }
}

// Set to track processed events
const processedEvents = new Set<string>();

// Handle app mention with files
async function handleAppMention(event: any) {
  // Create unique event ID to prevent duplicates
  const eventId = `${event.channel}_${event.ts}_${event.user}`;

  if (processedEvents.has(eventId)) {
    console.log("Duplicate event detected, skipping:", eventId);
    return;
  }

  processedEvents.add(eventId);
  console.log("Processing new event:", eventId);

  try {
    // Check if the mention includes files
    if (!event.files || event.files.length === 0) {
      return await sendSlackMessage(
        event.channel,
        "Please upload an audio or video file with your mention for transcription.",
        event.ts,
      );
    }

    // Process each file
    for (const file of event.files) {
      // Check if file is audio/video
      if (
        !file.mimetype?.startsWith("audio/") &&
        !file.mimetype?.startsWith("video/")
      ) {
        await sendSlackMessage(
          event.channel,
          `File "${file.name}" is not an audio or video file. Please upload an audio or video file for transcription.`,
          event.ts,
        );
        continue;
      }

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

      // Run the transcription in the background
      EdgeRuntime.waitUntil(
        scribe({
          fileURL,
          fileType: file.mimetype,
          duration: file.duration || 0,
          channelId: event.channel,
          timestamp: event.ts,
          userId: event.user,
        }),
      );

      // Reply to the user immediately
      await sendSlackMessage(
        event.channel,
        `Received "${file.name}". Scribing...`,
        event.ts,
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
        await EdgeRuntime.waitUntil(handleAppMention(event));
        return new Response("OK", { status: 200 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error(err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
