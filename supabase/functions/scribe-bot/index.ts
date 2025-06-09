import {
  Bot,
  InputFile,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.34.0/mod.ts";
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

async function scribe({
  fileURL,
  fileType,
  duration,
  chatId,
  messageId,
  username,
}: {
  fileURL: string;
  fileType: string;
  duration: number;
  chatId: number;
  messageId: number;
  username: string;
}) {
  let transcript: string | null = null;
  let languageCode: string | null = null;
  let errorMsg: string | null = null;
  try {
    const sourceFileArrayBuffer = await fetch(fileURL).then((res) =>
      res.arrayBuffer()
    );
    const sourceBlob = new Blob([sourceFileArrayBuffer], {
      type: fileType,
    });

    const shouldDiarize = true; // toggle here if you want diarization

    const scribeResult = await elevenlabs.speechToText.convert({
      file: sourceBlob,
      model_id: "scribe_v1", // 'scribe_v1_experimental' is also available for new, experimental features
      tag_audio_events: true,
      diarize: shouldDiarize,
      language_code: "ja",
    }, { timeoutInSeconds: 120 });

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

    // Check if transcript exists before creating file
    if (transcript) {
      // Create a Blob and convert it to InputFile for Telegram API
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("T", "_")
        .slice(0, 15);
      const textBlob = new Blob([transcript], { type: "text/plain" });
      const inputFile = new InputFile(textBlob, `transcript_${timestamp}.txt`);

      // Reply to the user with the transcript as a text file
      await bot.api.sendDocument(chatId, inputFile, {
        reply_parameters: { message_id: messageId },
        caption: "文字起こしが完了しました！📝",
      });
    } else {
      // Fallback to error message if transcript is empty
      await bot.api.sendMessage(
        chatId,
        "Sorry, no transcript was generated. Please try again.",
        {
          reply_parameters: { message_id: messageId },
        },
      );
    }
  } catch (error) {
    errorMsg = error.message;
    console.log(errorMsg);
    await bot.api.sendMessage(
      chatId,
      "Sorry, there was an error. Please try again.",
      {
        reply_parameters: { message_id: messageId },
      },
    );
  }
  // Write log to Supabase.
  const logLine = {
    file_type: fileType,
    duration,
    chat_id: chatId,
    message_id: messageId,
    username,
    language_code: languageCode,
    error: errorMsg,
  };
  console.log({ logLine });
  await supabase.from("transcription_logs").insert({ ...logLine, transcript });
}

const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const bot = new Bot(telegramBotToken || "");
const startMessage =
  `Welcome to the ElevenLabs Scribe Bot\\! I can transcribe speech in 99 languages with super high accuracy\\!
    \nTry it out by sending or forwarding me a voice message, video, or audio file\\!
    \n[Learn more about Scribe](https://elevenlabs.io/speech-to-text) or [build your own bot](https://elevenlabs.io/docs/cookbooks/speech-to-text/telegram-bot)\\!
  `;
bot.command(
  "start",
  (ctx) => ctx.reply(startMessage.trim(), { parse_mode: "MarkdownV2" }),
);

bot.on([":voice", ":audio", ":video"], async (ctx) => {
  try {
    const file = await ctx.getFile();
    const fileURL =
      `https://api.telegram.org/file/bot${telegramBotToken}/${file.file_path}`;
    const fileMeta = ctx.message?.video ?? ctx.message?.voice ??
      ctx.message?.audio;

    if (!fileMeta) {
      return ctx.reply(
        "No video|audio|voice metadata found. Please try again.",
      );
    }

    // Run the transcription in the background.
    EdgeRuntime.waitUntil(
      scribe({
        fileURL,
        fileType: fileMeta.mime_type!,
        duration: fileMeta.duration,
        chatId: ctx.chat.id,
        messageId: ctx.message?.message_id!,
        username: ctx.from?.username || "",
      }),
    );

    // Reply to the user immediately to let them know we received their file.
    return ctx.reply("Received. Scribing...");
  } catch (error) {
    console.error(error);
    return ctx.reply(
      "Sorry, there was an error getting the file. Please try again with a smaller file!",
    );
  }
});

const handleUpdate = webhookCallback(bot, "std/http");

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") !== Deno.env.get("FUNCTION_SECRET")) {
      return new Response("not allowed", { status: 405 });
    }

    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
  }
});
