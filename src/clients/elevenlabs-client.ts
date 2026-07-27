import { ElevenLabsClient } from "elevenlabs";
import { config } from "../core/config.ts";

let elevenlabsInstance: ElevenLabsClient | null = null;

export function getElevenLabsClient(): ElevenLabsClient {
  if (!elevenlabsInstance) {
    elevenlabsInstance = new ElevenLabsClient({
      apiKey: config.elevenLabsApiKey,
    });
  }
  return elevenlabsInstance;
}
