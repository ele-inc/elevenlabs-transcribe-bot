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

// Use getters so env vars are validated only when accessed.
// Required for the CLI binary, which doesn't need Slack/Discord tokens
// but still imports modules that reference `config`.
export const config: Config = {
  get port() { return parseInt(Deno.env.get("PORT") || "8080"); },

  get slackBotToken() { return getEnvOrThrow("SLACK_BOT_TOKEN"); },

  get discordPublicKey() { return getEnvOrThrow("DISCORD_PUBLIC_KEY"); },
  get discordBotToken() { return getEnvOrThrow("DISCORD_BOT_TOKEN"); },
  get discordApplicationId() { return getEnvOrThrow("DISCORD_APPLICATION_ID"); },

  get googlePrivateKey() { return getOptionalEnv("GOOGLE_PRIVATE_KEY"); },
  get googleClientEmail() { return getOptionalEnv("GOOGLE_CLIENT_EMAIL"); },
  get googleImpersonateEmail() { return getOptionalEnv("GOOGLE_IMPERSONATE_EMAIL"); },

  get elevenLabsApiKey() { return getEnvOrThrow("ELEVENLABS_API_KEY"); },

  get youtubeCookies() { return getOptionalEnv("YOUTUBE_COOKIES"); },
  get youtubeCookiesBase64() { return getOptionalEnv("YOUTUBE_COOKIES_BASE64"); },
  get youtubeProxy() { return getOptionalEnv("YOUTUBE_PROXY"); },
};

export default config;
