// @ts-nocheck
// Types are provided by the runtime in Cloud Run build; keep import path stable
// @ts-ignore: Types are provided in the deployment environment
import {
  APIInteraction,
  InteractionType,
  APIChatInputApplicationCommandInteraction,
  APIMessageApplicationCommandInteraction,
  APIApplicationCommandInteractionDataStringOption,
  APIApplicationCommandInteractionDataAttachmentOption,
  APIAttachment,
} from "npm:discord-api-types/v10";
import { TranscriptionOptions } from "../core/types.ts";

// EdgeRuntime removed for Cloud Run compatibility
import {
  verifyDiscordRequest,
  replyToInteraction,
  deferInteractionReply,
  editInteractionReply,
} from "../clients/discord.ts";
import { parseTranscriptionOptions } from "../utils/utils.ts";
import {
  extractMediaInfo,
  isValidAudioVideoFile
} from "../services/file-processor.ts";
import { createPlatformAdapter } from "../adapters/platform-adapter.ts";
import { TranscriptionProcessor, FileAttachment } from "../services/transcription-processor.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { getUsageMessage, getUnsupportedContentMessage } from "../utils/messages.ts";

/**
 * Execute async function in background without blocking response
 * Used for Discord interactions that need immediate response
 */
function executeInBackground(fn: () => Promise<void>): void {
  Promise.resolve().then(fn).catch(console.error);
}

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
    return replyToInteraction(getUsageMessage(), true);
  }

  // Defer the reply immediately (Discord requires response within 3 seconds)
  // This tells Discord we're processing and prevents timeout
  const deferResponse = deferInteractionReply();

  // Start processing asynchronously without blocking the response
  executeInBackground(async () => {
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
        `❌ ${getErrorMessage(error)}`
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
  const audioVideoAttachments = message.attachments?.filter(attachment =>
    isValidAudioVideoFile(attachment.content_type)
  );

  // Check for cloud URLs in message content
  const { cloudUrls } = extractMediaInfo(message.content || "");

  if ((!audioVideoAttachments || audioVideoAttachments.length === 0) && cloudUrls.length === 0) {
    return replyToInteraction(getUnsupportedContentMessage(), true);
  }

  // Defer the reply immediately
  const deferResponse = deferInteractionReply();

  // Process each file/URL in background
  executeInBackground(async () => {
    const { adapter, processor } = createDiscordProcessor(interaction);
    try {
      const defaultOptions: TranscriptionOptions = {
        diarize: true,
        showTimestamp: true,
        tagAudioEvents: true
      };

      // Process cloud URLs
      if (cloudUrls.length > 0) {
        for (const url of cloudUrls) {
          await processor.processCloudUrl(url, defaultOptions);
        }
      }

      // Process file attachments
      if (audioVideoAttachments && audioVideoAttachments.length > 0) {
        for (const attachment of audioVideoAttachments) {
          await processDiscordAttachment(interaction, attachment, defaultOptions);
        }
      }
    } catch (error) {
      console.error("Error processing message command:", error);
      await adapter.sendErrorMessage(getErrorMessage(error));
    } finally {
      await processor.cleanup();
    }
  });

  return deferResponse;
}

/**
 * Create adapter and processor for Discord interactions
 * Centralized helper to reduce duplication
 */
function createDiscordProcessor(interaction: APIInteraction): {
  adapter: ReturnType<typeof createPlatformAdapter>;
  processor: TranscriptionProcessor;
} {
  const channelId = interaction.channel?.id || "";
  const adapter = createPlatformAdapter("discord", {
    channelId,
    interaction,
  });

  const processor = new TranscriptionProcessor(adapter, {
    channelId,
    timestamp: interaction.id,
    userId: interaction.member?.user?.id || interaction.user?.id || "",
  });

  return { adapter, processor };
}

/**
 * Process Discord transcription request (unified handler)
 * Handles both cloud URLs and file attachments
 */
async function processDiscordTranscription(
  interaction: APIInteraction,
  params: {
    url?: string;
    fileAttachment?: APIAttachment | null;
    options: TranscriptionOptions;
  }
) {
  const { adapter, processor } = createDiscordProcessor(interaction);

  try {
    // Handle cloud URL
    if (params.url) {
      const { cloudUrls } = extractMediaInfo(params.url);

      if (cloudUrls.length > 0) {
        await processor.processCloudUrl(cloudUrls[0], params.options);
      } else {
        await adapter.sendErrorMessage("有効なクラウドのURLが見つかりません。");
      }
      return;
    }

    // Handle file attachment
    if (params.fileAttachment) {
      await processDiscordAttachment(interaction, params.fileAttachment, params.options);
    }
  } catch (error) {
    console.error("Discord transcription error:", error);
    await adapter.sendErrorMessage(getErrorMessage(error));
  } finally {
    await processor.cleanup();
  }
}


/**
 * Process Discord attachment
 * Uses TranscriptionProcessor for unified processing
 */
async function processDiscordAttachment(
  interaction: APIInteraction,
  attachment: APIAttachment,
  options: TranscriptionOptions
) {
  const { adapter, processor } = createDiscordProcessor(interaction);

  try {
    // Convert Discord attachment to FileAttachment format
    const fileAttachment: FileAttachment = {
      url: attachment.url,
      filename: attachment.filename,
      mimeType: attachment.content_type,
      duration: 0,
    };

    // Use TranscriptionProcessor for unified processing
    await processor.processAttachments([fileAttachment], options);
  } catch (error) {
    console.error("Discord attachment processing error:", error);
    await adapter.sendErrorMessage(
      getErrorMessage(error)
    );
  } finally {
    await processor.cleanup();
  }
}
