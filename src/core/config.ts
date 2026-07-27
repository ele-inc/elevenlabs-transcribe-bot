/**
 * Centralized configuration management
 * All environment variables are accessed through this module
 */

interface Config {
  // Server
  port: number;
  maxConcurrentTranscriptions: number;

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
  elevenLabsWebhookId?: string;
  elevenLabsWebhookSecret?: string;

  // YouTube (optional)
  youtubeCookies?: string; // Path to cookies file (for local/container usage)
  youtubeCookiesBase64?: string; // Base64-encoded cookies file content (for Cloud Run)
  youtubeCookiesFromBrowser?: string; // Browser name/profile for yt-dlp --cookies-from-browser
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

function getIntegerEnv(key: string, defaultValue: number): number {
  const value = Deno.env.get(key);
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// Use getters so env vars are validated only when accessed.
// Required for the CLI binary, which doesn't need Slack/Discord tokens
// but still imports modules that reference `config`.
export const config: Config = {
  get port() {
    return parseInt(Deno.env.get("PORT") || "8080");
  },
  get maxConcurrentTranscriptions() {
    return getIntegerEnv("MAX_CONCURRENT_TRANSCRIPTIONS", 3);
  },

  get slackBotToken() {
    return getEnvOrThrow("SLACK_BOT_TOKEN");
  },

  get discordPublicKey() {
    return getEnvOrThrow("DISCORD_PUBLIC_KEY");
  },
  get discordBotToken() {
    return getEnvOrThrow("DISCORD_BOT_TOKEN");
  },
  get discordApplicationId() {
    return getEnvOrThrow("DISCORD_APPLICATION_ID");
  },

  get googlePrivateKey() {
    return getOptionalEnv("GOOGLE_PRIVATE_KEY");
  },
  get googleClientEmail() {
    return getOptionalEnv("GOOGLE_CLIENT_EMAIL");
  },
  get googleImpersonateEmail() {
    return getOptionalEnv("GOOGLE_IMPERSONATE_EMAIL");
  },

  get elevenLabsApiKey() {
    return getEnvOrThrow("ELEVENLABS_API_KEY");
  },
  get elevenLabsWebhookId() {
    return getOptionalEnv("ELEVENLABS_WEBHOOK_ID");
  },
  get elevenLabsWebhookSecret() {
    return getOptionalEnv("ELEVENLABS_WEBHOOK_SECRET");
  },

  get youtubeCookies() {
    return getOptionalEnv("YOUTUBE_COOKIES");
  },
  get youtubeCookiesBase64() {
    return getOptionalEnv("YOUTUBE_COOKIES_BASE64");
  },
  get youtubeCookiesFromBrowser() {
    return getOptionalEnv("YOUTUBE_COOKIES_FROM_BROWSER");
  },
  get youtubeProxy() {
    return getOptionalEnv("YOUTUBE_PROXY");
  },
};

export function getElevenLabsWebhookConfig():
  | { webhookId: string; webhookSecret: string }
  | null {
  const webhookId = config.elevenLabsWebhookId;
  const webhookSecret = config.elevenLabsWebhookSecret;

  if (!webhookId && !webhookSecret) return null;
  if (!webhookId || !webhookSecret) {
    throw new Error(
      "ELEVENLABS_WEBHOOK_ID and ELEVENLABS_WEBHOOK_SECRET must be configured together",
    );
  }
  return { webhookId, webhookSecret };
}

export default config;
