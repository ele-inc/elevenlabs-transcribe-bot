import { Bot, webhookCallback } from 'https://deno.land/x/grammy@v1.34.0/mod.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ElevenLabsClient } from 'npm:elevenlabs@1.50.5';

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

const elevenlabs = new ElevenLabsClient({
  apiKey: Deno.env.get('ELEVENLABS_API_KEY') || '',
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

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
    const sourceFileArrayBuffer = await fetch(fileURL).then((res) => res.arrayBuffer());
    const sourceBlob = new Blob([sourceFileArrayBuffer], {
      type: fileType,
    });

    const scribeResult = await elevenlabs.speechToText.convert({
      file: sourceBlob,
      model_id: 'scribe_v1', // 'scribe_v1_experimental' is also available for new, experimental features
      tag_audio_events: true,
      diarize: true,
    },{ timeoutInSeconds: 120 });

    transcript = scribeResult.text;
    languageCode = scribeResult.language_code;

    // Reply to the user with the transcript
    await bot.api.sendMessage(chatId, transcript, {
      reply_parameters: { message_id: messageId },
    });
  } catch (error) {
    errorMsg = error.message;
    console.log(errorMsg);
    await bot.api.sendMessage(chatId, 'Sorry, there was an error. Please try again.', {
      reply_parameters: { message_id: messageId },
    });
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
  await supabase.from('transcription_logs').insert({ ...logLine, transcript });
}

const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
const bot = new Bot(telegramBotToken || '');
const startMessage = `Welcome to the ElevenLabs Scribe Bot\\! I can transcribe speech in 99 languages with super high accuracy\\!
    \nTry it out by sending or forwarding me a voice message, video, or audio file\\!
    \n[Learn more about Scribe](https://elevenlabs.io/speech-to-text) or [build your own bot](https://elevenlabs.io/docs/cookbooks/speech-to-text/telegram-bot)\\!
  `;
bot.command('start', (ctx) => ctx.reply(startMessage.trim(), { parse_mode: 'MarkdownV2' }));

bot.on([':voice', ':audio', ':video'], async (ctx) => {
  try {
    const file = await ctx.getFile();
    const fileURL = `https://api.telegram.org/file/bot${telegramBotToken}/${file.file_path}`;
    const fileMeta = ctx.message?.video ?? ctx.message?.voice ?? ctx.message?.audio;

    if (!fileMeta) {
      return ctx.reply('No video|audio|voice metadata found. Please try again.');
    }

    // Run the transcription in the background.
    EdgeRuntime.waitUntil(
      scribe({
        fileURL,
        fileType: fileMeta.mime_type!,
        duration: fileMeta.duration,
        chatId: ctx.chat.id,
        messageId: ctx.message?.message_id!,
        username: ctx.from?.username || '',
      })
    );

    // Reply to the user immediately to let them know we received their file.
    return ctx.reply('Received. Scribing...');
  } catch (error) {
    console.error(error);
    return ctx.reply(
      'Sorry, there was an error getting the file. Please try again with a smaller file!'
    );
  }
});

const handleUpdate = webhookCallback(bot, 'std/http');

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('secret') !== Deno.env.get('FUNCTION_SECRET')) {
      return new Response('not allowed', { status: 405 });
    }

    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
  }
});
