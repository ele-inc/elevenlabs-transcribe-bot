import { 
  InteractionType, 
  InteractionResponseType,
  APIInteraction,
  APIApplicationCommandInteraction,
  APIMessageComponentInteraction,
  APIChatInputApplicationCommandInteraction,
  APIEmbed,
} from "npm:discord-api-types@0.37.100/v10";
import nacl from "npm:tweetnacl@1.0.3";

const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") || "";
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") || "";
const DISCORD_APPLICATION_ID = Deno.env.get("DISCORD_APPLICATION_ID") || "";

// Helper function to convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) throw new Error("Invalid hex string");
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

// Verify Discord request signature using TweetNaCl
export async function verifyDiscordRequest(
  request: Request,
  publicKey: string = DISCORD_PUBLIC_KEY
): Promise<boolean> {
  // Discord sends headers in lowercase
  const signature = request.headers.get("x-signature-ed25519") || request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("x-signature-timestamp") || request.headers.get("X-Signature-Timestamp");
  
  console.log("Discord verification - headers:", {
    signature: signature ? "present" : "missing",
    timestamp: timestamp ? "present" : "missing",
    publicKey: publicKey ? "present" : "missing"
  });
  
  if (!signature || !timestamp || !publicKey) {
    console.error("Missing required data for Discord verification");
    return false;
  }

  const body = await request.clone().text();
  console.log("Discord verification - body type:", body.includes('"type":0') ? "PING" : "Other");
  
  try {
    // Concatenate timestamp and body
    const message = timestamp + body;
    const messageData = new TextEncoder().encode(message);
    
    // Convert hex strings to Uint8Array
    const signatureData = hexToUint8Array(signature);
    const publicKeyData = hexToUint8Array(publicKey);
    
    // Verify the signature using Ed25519
    const isValid = nacl.sign.detached.verify(
      messageData,
      signatureData,
      publicKeyData
    );
    
    console.log("Discord verification result:", isValid);
    return isValid;
  } catch (error) {
    console.error("Discord verification error:", error);
    return false;
  }
}

// Send a message to Discord channel
export async function sendDiscordMessage(
  channelId: string,
  content: string,
  embeds?: APIEmbed[],
  files?: { name: string; content: Uint8Array }[]
): Promise<void> {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  
  const formData = new FormData();
  
  const payload: any = {};
  if (content) payload.content = content;
  if (embeds) payload.embeds = embeds;
  
  formData.append("payload_json", JSON.stringify(payload));
  
  // Add files if present
  if (files) {
    files.forEach((file, index) => {
      formData.append(
        `files[${index}]`,
        new Blob([file.content]),
        file.name
      );
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to send Discord message:", error);
    throw new Error(`Discord API error: ${response.status}`);
  }
}

// Upload transcript file to Discord
export async function uploadTranscriptToDiscord(
  transcript: string,
  channelId: string,
  filename?: string
): Promise<void> {
  const encoder = new TextEncoder();
  const transcriptBytes = encoder.encode(transcript);
  
  // Use timestamp-based naming like Slack bot
  const fileTimestamp = Date.now();
  const transcriptFilename = `transcript_${fileTimestamp}.txt`;

  await sendDiscordMessage(
    channelId,
    "✅ 文字起こしが完了しました！",
    undefined,
    [{
      name: transcriptFilename,
      content: transcriptBytes,
    }]
  );
}

// Reply to Discord interaction
export async function replyToInteraction(
  interaction: APIInteraction,
  content: string,
  ephemeral: boolean = false
): Promise<Response> {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content,
        flags: ephemeral ? 64 : 0, // 64 = ephemeral message flag
      },
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Defer interaction reply (for long-running operations)
export async function deferInteractionReply(
  interaction: APIInteraction
): Promise<Response> {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Edit interaction reply
export async function editInteractionReply(
  interactionToken: string,
  content: string,
  embeds?: APIEmbed[]
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`;
  
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      content,
      embeds,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to edit interaction reply:", error);
  }
}

// Download file from Discord CDN
export async function downloadDiscordFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download Discord file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Get file info from Discord attachment URL
export function getDiscordFileInfo(url: string): { name: string; extension: string } {
  const urlParts = url.split("/");
  const filename = urlParts[urlParts.length - 1].split("?")[0];
  const extension = filename.split(".").pop() || "";
  
  return {
    name: filename,
    extension,
  };
}

// Format Discord message with options
export function formatDiscordMessage(
  transcript: string,
  options: {
    showTimestamp?: boolean;
    diarize?: boolean;
  }
): string {
  // Discord has a 2000 character limit for messages
  const MAX_LENGTH = 1900; // Leave some buffer
  
  if (transcript.length <= MAX_LENGTH) {
    return transcript;
  }
  
  // Truncate and add indicator
  return transcript.substring(0, MAX_LENGTH) + "\n\n... (完全な文字起こしはファイルを参照してください)";
}