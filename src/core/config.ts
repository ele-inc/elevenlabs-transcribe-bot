/**
 * Centralized configuration management
 * All environment variables are accessed through this module
 */

interface Config {
  // Server
  port: number;

  // Slack
  slackBotToken: string;

  // Discord
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId: string;

  // Google Drive
  googlePrivateKey?: string;
  googleClientEmail?: string;
  googleImpersonateEmail?: string;

  // ElevenLabs
  elevenLabsApiKey: string;

  // YouTube (optional)
  youtubeCookies?: string; // Path to cookies file (for local/container usage)
  youtubeCookiesBase64?: string; // Base64-encoded cookies file content (for Cloud Run)
  youtubeProxy?: string; // Proxy URL for yt-dlp (e.g. http://user:pass@host:port)
}

function getEnvOrThrow(key: string, defaultValue?: string): string {
  const value = Deno.env.get(key) || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getOptionalEnv(key: string): string | undefined {
  return Deno.env.get(key);
}

export const config: Config = {
  // Server
  port: parseInt(Deno.env.get("PORT") || "8080"),

  // Slack
  slackBotToken: getEnvOrThrow("SLACK_BOT_TOKEN"),

  // Discord
  discordPublicKey: getEnvOrThrow("DISCORD_PUBLIC_KEY"),
  discordBotToken: getEnvOrThrow("DISCORD_BOT_TOKEN"),
  discordApplicationId: getEnvOrThrow("DISCORD_APPLICATION_ID"),

  // Google Drive (optional)
  googlePrivateKey: getOptionalEnv("GOOGLE_PRIVATE_KEY"),
  googleClientEmail: getOptionalEnv("GOOGLE_CLIENT_EMAIL"),
  googleImpersonateEmail: getOptionalEnv("GOOGLE_IMPERSONATE_EMAIL"),

  // ElevenLabs
  elevenLabsApiKey: getEnvOrThrow("ELEVENLABS_API_KEY"),

  // YouTube (optional)
  youtubeCookies: getOptionalEnv("YOUTUBE_COOKIES"),
  youtubeCookiesBase64: getOptionalEnv("YOUTUBE_COOKIES_BASE64"),
  youtubeProxy: getOptionalEnv("YOUTUBE_PROXY"),
};

export default config;
