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
};

export default config;