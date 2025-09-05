import {
  APIInteraction,
  InteractionType,
  APIChatInputApplicationCommandInteraction,
  APIMessageApplicationCommandInteraction,
  APIApplicationCommandInteractionDataStringOption,
  APIApplicationCommandInteractionDataAttachmentOption,
  APIAttachment,
} from "npm:discord-api-types@0.37.100/v10";
import { TranscriptionOptions } from "./types.ts";

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
import { parseTranscriptionOptions, extractGoogleDriveUrls, extractDropboxUrls } from "./utils.ts";
import { downloadGoogleDriveFile } from "./googledrive.ts";
import { downloadDropboxFile } from "./dropbox.ts";

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
      return handleTranscribeCommand(commandInteraction);
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
function handleTranscribeCommand(
  interaction: APIChatInputApplicationCommandInteraction
): Response {
  // Get command options
  const options = interaction.data.options || [];
  const urlOption = options.find(opt => opt.name === "url" && 'value' in opt) as APIApplicationCommandInteractionDataStringOption | undefined;
  const fileOption = options.find(opt => opt.name === "file" && 'value' in opt) as APIApplicationCommandInteractionDataAttachmentOption | undefined;
  const optionsOption = options.find(opt => opt.name === "options" && 'value' in opt) as APIApplicationCommandInteractionDataStringOption | undefined;
  const optionsText = optionsOption?.value || "";

  // Parse transcription options
  const transcriptionOptions = parseTranscriptionOptions(optionsText);

  // If neither URL nor file is provided
  if (!urlOption && !fileOption) {
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

    return replyToInteraction(usageMessage, true);
  }

  // Defer the reply immediately (Discord requires response within 3 seconds)
  // This tells Discord we're processing and prevents timeout
  const deferResponse = deferInteractionReply();

  // Start processing asynchronously without blocking the response
  // Use Promise.resolve to ensure the process starts but doesn't block
  Promise.resolve().then(async () => {
    try {
      await processDiscordTranscription(interaction, {
        url: urlOption?.value as string,
        fileAttachment: fileOption ? interaction.data.resolved?.attachments?.[fileOption.value as string] : null,
        options: transcriptionOptions,
      });
    } catch (error) {
      console.error("Error processing transcription:", error);
      // Try to update the interaction with error message
      await editInteractionReply(
        interaction.token,
        `❌ エラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
      ).catch(console.error);
    }
  });

  return deferResponse;
}

// Handle message context menu command
function handleMessageCommand(
  interaction: APIMessageApplicationCommandInteraction
): Response {
  const message = interaction.data.resolved.messages[interaction.data.target_id];

  if (!message) {
    return replyToInteraction("メッセージが見つかりません。", true);
  }

  // Check for attachments
  const audioVideoAttachments = message.attachments?.filter(attachment => {
    const mimeType = attachment.content_type;
    return mimeType?.startsWith("audio/") || mimeType?.startsWith("video/");
  });

  // Check for Google Drive and Dropbox URLs in message content
  const googleDriveUrls = extractGoogleDriveUrls(message.content || "");
  const dropboxUrls = extractDropboxUrls(message.content || "");

  if ((!audioVideoAttachments || audioVideoAttachments.length === 0) && 
      googleDriveUrls.length === 0 && dropboxUrls.length === 0) {
    return replyToInteraction(
      "このメッセージには音声/動画ファイル、Google Drive、またはDropboxのURLが含まれていません。",
      true,
    );
  }

  // Defer the reply immediately
  const deferResponse = deferInteractionReply();

  // Process each file/URL in background
  Promise.resolve().then(async () => {
    try {
      if (googleDriveUrls.length > 0) {
        for (const url of googleDriveUrls) {
          await processGoogleDriveTranscription(interaction, url, {
            diarize: true,
            showTimestamp: true,
            tagAudioEvents: true
          });
        }
      }

      if (dropboxUrls.length > 0) {
        for (const url of dropboxUrls) {
          await processDropboxTranscription(interaction, url, {
            diarize: true,
            showTimestamp: true,
            tagAudioEvents: true
          });
        }
      }

      if (audioVideoAttachments && audioVideoAttachments.length > 0) {
        for (const attachment of audioVideoAttachments) {
          await processDiscordAttachment(interaction, attachment, {
            diarize: true,
            showTimestamp: true,
            tagAudioEvents: true
          });
        }
      }
    } catch (error) {
      console.error("Error processing message command:", error);
      await editInteractionReply(
        interaction.token,
        `❌ エラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
      ).catch(console.error);
    }
  });

  return deferResponse;
}

// Process Discord transcription request
async function processDiscordTranscription(
  interaction: APIInteraction,
  params: {
    url?: string;
    fileAttachment?: APIAttachment | null;
    options: TranscriptionOptions;
  }
) {
  try {
    // Handle Google Drive or Dropbox URL
    if (params.url) {
      const googleDriveUrls = extractGoogleDriveUrls(params.url);
      const dropboxUrls = extractDropboxUrls(params.url);

      if (googleDriveUrls.length > 0) {
        await processGoogleDriveTranscription(interaction, googleDriveUrls[0], params.options);
      } else if (dropboxUrls.length > 0) {
        await processDropboxTranscription(interaction, dropboxUrls[0], params.options);
      } else {
        await editInteractionReply(
          interaction.token,
          "❌ 有効なGoogle DriveまたはDropboxのURLが見つかりません。"
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
  options: TranscriptionOptions
) {
  const channelId = interaction.channel?.id || "";

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
      await Deno.remove(tempPath).catch(() => {});
      await Deno.remove(tempDir).catch(() => {});
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

// Process Dropbox file for Discord
async function processDropboxTranscription(
  interaction: APIInteraction,
  url: string,
  options: TranscriptionOptions
) {
  const channelId = interaction.channel?.id || "";

  try {
    // Create temporary file path
    const tempDir = await Deno.makeTempDir();
    const tempPath = `${tempDir}/dropbox_${Date.now()}.tmp`;

    // Download and get metadata
    const { filename, mimeType } = await downloadDropboxFile(url, tempPath);

    // Check if it's an audio/video file
    if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
      await editInteractionReply(
        interaction.token,
        `❌ ファイル "${filename}" は音声または動画ファイルではありません。`
      );
      // Clean up
      await Deno.remove(tempPath).catch(() => {});
      await Deno.remove(tempDir).catch(() => {});
      return;
    }

    // Update status
    await editInteractionReply(
      interaction.token,
      `🎵 Dropboxファイル "${filename}" を文字起こし中...`
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
      isGoogleDrive: true, // Reuse flag for external file handling
      tempPath,
      platform: "discord",
    });

    // Final success message
    await editInteractionReply(
      interaction.token,
      `✅ "${filename}" の文字起こしが完了しました！`
    );
  } catch (error) {
    console.error("Dropbox processing error:", error);
    await editInteractionReply(
      interaction.token,
      `❌ Dropboxファイルの処理中にエラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Process Discord attachment
async function processDiscordAttachment(
  interaction: APIInteraction,
  attachment: APIAttachment,
  options: TranscriptionOptions
) {
  const channelId = interaction.channel?.id || "";

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
    await Deno.remove(tempPath).catch(() => {});
    await Deno.remove(tempDir).catch(() => {});

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
