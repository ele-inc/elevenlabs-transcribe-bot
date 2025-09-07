import { handleDiscordInteraction } from "./discord-handler.ts";
import { handleSlackEvents } from "./slack-handler.ts";
import { handleDriveEvents } from "./drive-events-handler.ts";
import { config } from "./config.ts";
import { textResponse, methodNotAllowed } from "./http-utils.ts";

console.log(`Function "elevenlabs-scribe-bot" up and running!`);

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

  // Slack endpoint
  if (pathname === "/slack/events" && req.method === "POST") {
    return await handleSlackEvents(req);
  }

  // Drive Events endpoint (from Eventarc)
  if (pathname === "/events" && req.method === "POST") {
    console.log("Drive Events request detected");
    return await handleDriveEvents(req);
  }

  return methodNotAllowed(['GET', 'POST']);
});
