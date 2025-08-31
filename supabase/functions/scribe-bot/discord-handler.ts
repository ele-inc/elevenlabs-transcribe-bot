import {
  APIInteraction,
  InteractionType,
  APIChatInputApplicationCommandInteraction,
  APIMessageApplicationCommandInteraction,
} from "npm:discord-api-types@0.37.100/v10";

// EdgeRuntime removed for Cloud Run compatibility
import {
  verifyDiscordRequest,
  replyToInteraction,
  deferInteractionReply,
  editInteractionReply,
  downloadDiscordFile,
  getDiscordFileInfo,
} from "./discord.ts";
import { transcribeAudioFile } from "./scribe.ts";
import { parseTranscriptionOptions, extractGoogleDriveUrls } from "./utils.ts";
import { downloadGoogleDriveFile } from "./googledrive.ts";

// Handle Discord interactions
export async function handleDiscordInteraction(request: Request): Promise<Response> {
  try {
    // First, verify the signature for all requests including PING
    const bodyText = await request.text();

    // Create a new request with the body for verification
    const clonedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    });

    const isValid = await verifyDiscordRequest(clonedRequest);

    if (!isValid) {
      console.error("Invalid Discord request signature");
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse the interaction after verification
    const interaction: APIInteraction = JSON.parse(bodyText);

    // Handle PING (for endpoint verification)
    if (interaction.type === InteractionType.Ping) {
      console.log("Discord PING received and verified for endpoint verification");
      // Must return exactly { "type": 1 } for Discord verification
      return new Response(
        JSON.stringify({ type: 1 }), // InteractionResponseType.Pong = 1
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          }
        }
      );
    }

  // Handle slash commands
  if (interaction.type === InteractionType.ApplicationCommand) {
    const commandInteraction = interaction as APIChatInputApplicationCommandInteraction;

    if (commandInteraction.data.name === "transcribe") {
      return await handleTranscribeCommand(commandInteraction);
    }
  }

  // Handle message commands (right-click on message -> Apps -> Transcribe)
  if (interaction.type === InteractionType.ApplicationCommand) {
    const messageCommand = interaction as APIMessageApplicationCommandInteraction;

    if (messageCommand.data.name === "Transcribe Audio/Video") {
      return handleMessageCommand(messageCommand);
    }
  }

  return new Response("Unknown interaction type", { status: 400 });
  } catch (error) {
    console.error("Discord handler error:", error);
    // Return PONG for any parsing errors during verification
    if (error instanceof SyntaxError) {
      return new Response(
        JSON.stringify({ type: 1 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Internal server error", { status: 500 });
  }
}

// Handle /transcribe slash command
async function handleTranscribeCommand(
  interaction: APIChatInputApplicationCommandInteraction
): Promise<Response> {
  // Get command options
  const options = interaction.data.options || [];
  const urlOption = options.find(opt => opt.name === "url");
  const fileOption = options.find(opt => opt.name === "file");
  const optionsText = options.find(opt => opt.name === "options")?.value as string || "";

  // Parse transcription options
  const transcriptionOptions = parseTranscriptionOptions(optionsText);

  // If neither URL nor file is provided
  if (!urlOption && !fileOption) {
    const usageMessage = `📝 **使い方**\n\n` +
      `音声または動画ファイルをアップロードするか、Google DriveのURLを指定してください。\n\n` +
      `**オプション:**\n` +
      `• \`--no-diarize\`: 話者識別を無効化\n` +
      `• \`--no-timestamp\`: タイムスタンプを非表示\n` +
      `• \`--no-audio-events\`: 音声イベントのタグを無効化\n` +
      `• \`--num-speakers <数>\`: 話者数を指定（デフォルト: 2）\n\n` +
      `**使用例:**\n` +
      `/transcribe url:https://drive.google.com/file/d/xxxxx/view options:--num-speakers 3`;

    return replyToInteraction(usageMessage, true);
  }

  // Defer the reply immediately (Discord requires response within 3 seconds)
  const deferResponse = await deferInteractionReply();

  // Process in background
  processDiscordTranscription(interaction, {
    url: urlOption?.value as string,
    fileAttachment: fileOption ? interaction.data.resolved?.attachments?.[fileOption.value as string] : null,
    options: transcriptionOptions,
  }).catch(console.error);

  return deferResponse;
}

// Handle message context menu command
function handleMessageCommand(
  interaction: APIMessageApplicationCommandInteraction
): Promise<Response> {
  const message = interaction.data.resolved.messages[interaction.data.target_id];

  if (!message) {
    return replyToInteraction("メッセージが見つかりません。", true);
  }

  // Check for attachments
  const audioVideoAttachments = message.attachments?.filter(attachment => {
    const mimeType = attachment.content_type;
    return mimeType?.startsWith("audio/") || mimeType?.startsWith("video/");
  });

  // Check for Google Drive URLs in message content
  const googleDriveUrls = extractGoogleDriveUrls(message.content || "");

  if ((!audioVideoAttachments || audioVideoAttachments.length === 0) && googleDriveUrls.length === 0) {
    return replyToInteraction(
      "このメッセージには音声/動画ファイルまたはGoogle DriveのURLが含まれていません。",
      true,
    );
  }

  // Defer the reply immediately
  const deferResponse = deferInteractionReply();

  // Process each file/URL in background
  if (googleDriveUrls.length > 0) {
    for (const url of googleDriveUrls) {
      globalThis.EdgeRuntime.waitUntil(
        processGoogleDriveTranscription(interaction, url, {})
      );
    }
  }

  if (audioVideoAttachments && audioVideoAttachments.length > 0) {
    for (const attachment of audioVideoAttachments) {
      // Process attachment asynchronously
      processDiscordAttachment(interaction, attachment, {}).catch(console.error);
    }
  }

  return deferResponse;
}

// Process Discord transcription request
async function processDiscordTranscription(
  interaction: APIInteraction,
  params: {
    url?: string;
    fileAttachment?: any;
    options: any;
  }
) {
  try {
    // Handle Google Drive URL
    if (params.url) {
      const googleDriveUrls = extractGoogleDriveUrls(params.url);

      if (googleDriveUrls.length > 0) {
        await processGoogleDriveTranscription(interaction, googleDriveUrls[0], params.options);
      } else {
        await editInteractionReply(
          interaction.token,
          "❌ 有効なGoogle DriveのURLが見つかりません。"
        );
      }
      return;
    }

    // Handle file attachment
    if (params.fileAttachment) {
      await processDiscordAttachment(interaction, params.fileAttachment, params.options);
    }
  } catch (error) {
    console.error("Discord transcription error:", error);
    await editInteractionReply(
      interaction.token,
      `❌ エラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Process Google Drive file for Discord
async function processGoogleDriveTranscription(
  interaction: APIInteraction,
  url: string,
  options: any
) {
  const channelId = interaction.channel?.id || interaction.channel_id || "";

  try {
    // Create temporary file path
    const tempDir = await Deno.makeTempDir();
    const tempPath = `${tempDir}/gdrive_${Date.now()}.tmp`;

    // Download and get metadata
    const { filename, mimeType } = await downloadGoogleDriveFile(url, tempPath);

    // Check if it's an audio/video file
    if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
      await editInteractionReply(
        interaction.token,
        `❌ ファイル "${filename}" は音声または動画ファイルではありません。`
      );
      // Clean up
      try {
        await Deno.remove(tempPath);
        await Deno.remove(tempDir);
      } catch {}
      return;
    }

    // Update status
    await editInteractionReply(
      interaction.token,
      `🎵 Google Driveファイル "${filename}" を文字起こし中...`
    );

    // Transcribe
    const fileURL = `file://${tempPath}`;

    await transcribeAudioFile({
      fileURL,
      fileType: mimeType,
      duration: 0,
      channelId,
      timestamp: interaction.id,
      userId: interaction.member?.user?.id || interaction.user?.id || "",
      options,
      filename,
      isGoogleDrive: true,
      tempPath,
      platform: "discord",
    });

    // Final success message
    await editInteractionReply(
      interaction.token,
      `✅ "${filename}" の文字起こしが完了しました！`
    );
  } catch (error) {
    console.error("Google Drive processing error:", error);
    await editInteractionReply(
      interaction.token,
      `❌ Google Driveファイルの処理中にエラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Process Discord attachment
async function processDiscordAttachment(
  interaction: APIInteraction,
  attachment: any,
  options: any
) {
  const channelId = interaction.channel?.id || interaction.channel_id || "";

  try {
    // Download the file
    const fileData = await downloadDiscordFile(attachment.url);

    // Create temporary file
    const tempDir = await Deno.makeTempDir();
    const fileInfo = getDiscordFileInfo(attachment.url);
    const tempPath = `${tempDir}/${fileInfo.name}`;

    // Write to temp file
    await Deno.writeFile(tempPath, fileData);

    // Update status
    await editInteractionReply(
      interaction.token,
      `🎵 "${attachment.filename}" を文字起こし中...`
    );

    // Transcribe
    const fileURL = `file://${tempPath}`;

    await transcribeAudioFile({
      fileURL,
      fileType: attachment.content_type || "",
      duration: 0,
      channelId,
      timestamp: interaction.id,
      userId: interaction.member?.user?.id || interaction.user?.id || "",
      options,
      filename: attachment.filename,
      tempPath,
      platform: "discord",
    });

    // Clean up
    try {
      await Deno.remove(tempPath);
      await Deno.remove(tempDir);
    } catch {}

    // Final success message
    await editInteractionReply(
      interaction.token,
      `✅ "${attachment.filename}" の文字起こしが完了しました！`
    );
  } catch (error) {
    console.error("Discord attachment processing error:", error);
    await editInteractionReply(
      interaction.token,
      `❌ ファイル処理中にエラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
