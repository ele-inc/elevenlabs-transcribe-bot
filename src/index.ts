import { handleDiscordInteraction } from "./handlers/discord-handler.ts";
import { handleSlackEvents } from "./handlers/slack-handler.ts";
import { handleSlackInteractions } from "./handlers/slack-interaction-handler.ts";
import { config } from "./core/config.ts";
import { methodNotAllowed, textResponse } from "./utils/http-utils.ts";
import { installGracefulShutdown } from "./services/concurrency-limiter.ts";
import { handleElevenLabsWebhook } from "./handlers/elevenlabs-webhook-handler.ts";

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

installGracefulShutdown();

const port = config.port;

Deno.serve({ port }, async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Log incoming request for debugging
  console.log("Incoming request method:", req.method);
  console.log("Path:", pathname);

  // Health check endpoint
  if (pathname === "/" && req.method === "GET") {
    return textResponse("ElevenLabs Scribe Bot is running!");
  }

  // Discord endpoint
  if (pathname === "/discord/interactions") {
    console.log("Discord request detected");
    return await handleDiscordInteraction(req);
  }

  // Slack events endpoint
  if (pathname === "/slack/events" && req.method === "POST") {
    return await handleSlackEvents(req);
  }

  // Slack interactions endpoint (buttons, modals)
  if (pathname === "/slack/interactions" && req.method === "POST") {
    return await handleSlackInteractions(req);
  }

  if (
    pathname === "/webhooks/elevenlabs/speech-to-text" &&
    req.method === "POST"
  ) {
    return await handleElevenLabsWebhook(req);
  }

  return methodNotAllowed(["GET", "POST"]);
});
