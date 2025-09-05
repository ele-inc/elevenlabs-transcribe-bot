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
import {
  extractCloudStorageUrls,
  downloadCloudFile,
  getProviderDisplayName,
  CloudStorageUrl,
} from "./cloud-storage.ts";

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
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle application commands
    if (interaction.type === InteractionType.ApplicationCommand) {
      const commandInteraction = interaction as APIChatInputApplicationCommandInteraction;
      
      if (commandInteraction.data.name === "transcribe") {
        return handleTranscribeCommand(commandInteraction);
      }
    }

    // Handle message commands (right-click on message)
    if (interaction.type === InteractionType.ApplicationCommand) {
      const messageCommand = interaction as APIMessageApplicationCommandInteraction;
      
      if (messageCommand.data.name === "Transcribe Message") {
        return handleTranscribeMessageCommand(messageCommand);
      }
    }

    return new Response("Unknown interaction", { status: 400 });
  } catch (error) {
    console.error("Discord interaction error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

// Handle the /transcribe slash command
function handleTranscribeCommand(interaction: APIChatInputApplicationCommandInteraction): Response {
  // Parse options from the command
  const options = interaction.data.options || [];
  
  // Get file attachment if provided
  const fileOption = options.find((opt): opt is APIApplicationCommandInteractionDataAttachmentOption => 
    opt.name === 'file' && opt.type === 11
  );
  
  // Get URL if provided  
  const urlOption = options.find((opt): opt is APIApplicationCommandInteractionDataStringOption =>
    opt.name === 'url' && opt.type === 3
  );
  
  // Get transcription options
  const diarizeOption = options.find((opt): opt is APIApplicationCommandInteractionDataStringOption =>
    opt.name === 'diarize' && opt.type === 3
  )?.value !== 'false';
  
  const timestampOption = options.find((opt): opt is APIApplicationCommandInteractionDataStringOption =>
    opt.name === 'timestamp' && opt.type === 3
  )?.value !== 'false';

  const audioEventsOption = options.find((opt): opt is APIApplicationCommandInteractionDataStringOption =>
    opt.name === 'audio_events' && opt.type === 3
  )?.value !== 'false';

  const transcriptionOptions: TranscriptionOptions = {
    diarize: diarizeOption ?? true,
    showTimestamp: timestampOption ?? true,
    tagAudioEvents: audioEventsOption ?? true,
  };

  // Handle file or URL
  if (fileOption) {
    const attachmentId = fileOption.value;
    const resolved = interaction.data.resolved;
    const attachment = resolved?.attachments?.[attachmentId];
    
    if (!attachment) {
      return replyToInteraction("ファイルが見つかりません。", true);
    }
    
    // Check if it's audio/video
    const mimeType = attachment.content_type;
    if (!mimeType?.startsWith("audio/") && !mimeType?.startsWith("video/")) {
      return replyToInteraction("音声または動画ファイルをアップロードしてください。", true);
    }
    
    // Defer the reply and process in background
    const deferResponse = deferInteractionReply();
    
    processTranscription(interaction, {
      fileAttachment: attachment,
      options: transcriptionOptions,
    });
    
    return deferResponse;
  }
  
  if (urlOption) {
    // Defer the reply and process in background
    const deferResponse = deferInteractionReply();
    
    processTranscription(interaction, {
      url: urlOption.value,
      options: transcriptionOptions,
    });
    
    return deferResponse;
  }
  
  return replyToInteraction("ファイルまたはURLを指定してください。", true);
}

// Handle the "Transcribe Message" context menu command
function handleTranscribeMessageCommand(interaction: APIMessageApplicationCommandInteraction): Response {
  const message = interaction.data.resolved.messages[interaction.data.target_id];
  
  if (!message) {
    return replyToInteraction("メッセージが見つかりません。", true);
  }

  // Check for attachments
  const audioVideoAttachments = message.attachments?.filter(attachment => {
    const mimeType = attachment.content_type;
    return mimeType?.startsWith("audio/") || mimeType?.startsWith("video/");
  });

  // Check for cloud storage URLs in message content
  const cloudUrls = extractCloudStorageUrls(message.content || "");

  if ((!audioVideoAttachments || audioVideoAttachments.length === 0) && cloudUrls.length === 0) {
    return replyToInteraction(
      "このメッセージには音声/動画ファイルまたはクラウドストレージのURLが含まれていません。",
      true,
    );
  }

  // Defer the reply immediately
  const deferResponse = deferInteractionReply();

  // Process each file/URL in background
  Promise.resolve().then(async () => {
    try {
      if (cloudUrls.length > 0) {
        for (const cloudUrl of cloudUrls) {
          await processCloudStorageTranscription(interaction, cloudUrl, {
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

// Process transcription request
async function processTranscription(
  interaction: APIInteraction,
  params: {
    url?: string;
    fileAttachment?: APIAttachment | null;
    options: TranscriptionOptions;
  }
) {
  try {
    // Handle cloud storage URL
    if (params.url) {
      const cloudUrls = extractCloudStorageUrls(params.url);

      if (cloudUrls.length > 0) {
        await processCloudStorageTranscription(interaction, cloudUrls[0], params.options);
      } else {
        await editInteractionReply(
          interaction.token,
          "❌ 有効なクラウドストレージのURLが見つかりません。"
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

// Process cloud storage file for Discord
async function processCloudStorageTranscription(
  interaction: APIInteraction,
  cloudUrl: CloudStorageUrl,
  options: TranscriptionOptions
) {
  const channelId = interaction.channel?.id || "";

  try {
    // Create temporary file path
    const tempDir = await Deno.makeTempDir();
    const tempPath = `${tempDir}/cloud_${Date.now()}.tmp`;

    // Download and get metadata
    const { filename, mimeType, provider } = await downloadCloudFile(cloudUrl.originalUrl, tempPath);
    const providerName = getProviderDisplayName(provider);

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
      `🎵 ${providerName}ファイル "${filename}" を文字起こし中...`
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
    console.error("Cloud storage processing error:", error);
    await editInteractionReply(
      interaction.token,
      `❌ ${cloudUrl.provider === "google-drive" ? "Google Drive" : "Dropbox"}ファイルの処理中にエラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
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

    // Update interaction
    await editInteractionReply(
      interaction.token,
      `🎵 "${attachment.filename}" を文字起こし中...`
    );

    // Transcribe
    await transcribeAudioFile({
      fileURL: `file://${tempPath}`,
      fileType: attachment.content_type || "",
      duration: 0,
      channelId,
      timestamp: interaction.id,
      userId: interaction.member?.user?.id || interaction.user?.id || "",
      options,
      filename: attachment.filename,
      isGoogleDrive: false,
      tempPath,
      platform: "discord",
    });

    // Final success message
    await editInteractionReply(
      interaction.token,
      `✅ "${attachment.filename}" の文字起こしが完了しました！`
    );

    // Clean up
    await Deno.remove(tempPath).catch(() => {});
    await Deno.remove(tempDir).catch(() => {});
  } catch (error) {
    console.error("Discord attachment processing error:", error);
    await editInteractionReply(
      interaction.token,
      `❌ ファイルの処理中にエラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}