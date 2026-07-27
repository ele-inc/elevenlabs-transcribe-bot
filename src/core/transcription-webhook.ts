import type { Platform, TranscriptionOptions } from "./types.ts";

const WEBHOOK_METADATA_VERSION = 1;
const MAX_WEBHOOK_METADATA_BYTES = 16 * 1024;

export interface WebhookDeliveryContext {
  platform: Platform;
  channelId: string;
  threadTimestamp?: string;
}

export interface TranscriptionWebhookMetadata {
  version: number;
  performanceId: string;
  platform: Platform;
  channelId: string;
  threadTimestamp?: string;
  filename?: string;
  sourceUrl?: string;
  fileType: string;
  duration: number;
  diarize: boolean;
  showTimestamp: boolean;
  tagAudioEvents: boolean;
  summarize: boolean;
  numSpeakers?: number;
  speakerNamesJson?: string;
}

export function createTranscriptionWebhookMetadata({
  context,
  performanceId,
  filename,
  sourceUrl,
  fileType,
  duration,
  options,
}: {
  context: WebhookDeliveryContext;
  performanceId: string;
  filename?: string;
  sourceUrl?: string;
  fileType: string;
  duration: number;
  options: TranscriptionOptions;
}): TranscriptionWebhookMetadata {
  const metadata: TranscriptionWebhookMetadata = {
    version: WEBHOOK_METADATA_VERSION,
    performanceId,
    platform: context.platform,
    channelId: context.channelId,
    threadTimestamp: context.threadTimestamp,
    filename,
    sourceUrl,
    fileType,
    duration,
    diarize: options.diarize,
    showTimestamp: options.showTimestamp,
    tagAudioEvents: options.tagAudioEvents,
    summarize: options.summarize !== false,
    numSpeakers: options.numSpeakers,
    speakerNamesJson: options.speakerNames
      ? JSON.stringify(options.speakerNames)
      : undefined,
  };

  const byteLength = new TextEncoder().encode(JSON.stringify(metadata)).length;
  if (byteLength > MAX_WEBHOOK_METADATA_BYTES) {
    throw new Error(
      `Webhook metadata exceeds ${MAX_WEBHOOK_METADATA_BYTES} bytes`,
    );
  }

  return metadata;
}

export function parseTranscriptionWebhookMetadata(
  input: unknown,
): {
  metadata: TranscriptionWebhookMetadata;
  options: TranscriptionOptions;
  context: WebhookDeliveryContext;
} {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!isRecord(parsed)) {
    throw new Error("Webhook metadata must be an object");
  }
  const byteLength = new TextEncoder().encode(JSON.stringify(parsed)).length;
  if (byteLength > MAX_WEBHOOK_METADATA_BYTES) {
    throw new Error(
      `Webhook metadata exceeds ${MAX_WEBHOOK_METADATA_BYTES} bytes`,
    );
  }

  const version = requireNumber(parsed, "version");
  if (version !== WEBHOOK_METADATA_VERSION) {
    throw new Error(`Unsupported webhook metadata version: ${version}`);
  }

  const platform = requireString(parsed, "platform");
  if (platform !== "slack" && platform !== "discord") {
    throw new Error(`Unsupported webhook platform: ${platform}`);
  }

  const speakerNames = parseSpeakerNames(parsed.speakerNamesJson);
  const metadata: TranscriptionWebhookMetadata = {
    version,
    performanceId: requireString(parsed, "performanceId"),
    platform,
    channelId: requireString(parsed, "channelId"),
    threadTimestamp: optionalString(parsed, "threadTimestamp"),
    filename: optionalString(parsed, "filename"),
    sourceUrl: optionalString(parsed, "sourceUrl"),
    fileType: requireString(parsed, "fileType"),
    duration: requireNumber(parsed, "duration"),
    diarize: requireBoolean(parsed, "diarize"),
    showTimestamp: requireBoolean(parsed, "showTimestamp"),
    tagAudioEvents: requireBoolean(parsed, "tagAudioEvents"),
    summarize: requireBoolean(parsed, "summarize"),
    numSpeakers: optionalNumber(parsed, "numSpeakers"),
    speakerNamesJson: optionalString(parsed, "speakerNamesJson"),
  };

  if (platform === "slack" && !metadata.threadTimestamp) {
    throw new Error("Slack webhook metadata requires threadTimestamp");
  }
  if (metadata.duration < 0) {
    throw new Error("duration must be non-negative");
  }
  if (
    metadata.numSpeakers !== undefined &&
    (!Number.isInteger(metadata.numSpeakers) ||
      metadata.numSpeakers < 1 || metadata.numSpeakers > 32)
  ) {
    throw new Error("numSpeakers must be an integer between 1 and 32");
  }

  return {
    metadata,
    options: {
      diarize: metadata.diarize,
      showTimestamp: metadata.showTimestamp,
      tagAudioEvents: metadata.tagAudioEvents,
      summarize: metadata.summarize,
      ...(metadata.numSpeakers ? { numSpeakers: metadata.numSpeakers } : {}),
      ...(speakerNames ? { speakerNames } : {}),
    },
    context: {
      platform,
      channelId: metadata.channelId,
      threadTimestamp: metadata.threadTimestamp,
    },
  };
}

function parseSpeakerNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("speakerNamesJson must be a string");
  }

  const parsed = JSON.parse(value);
  if (
    !Array.isArray(parsed) || parsed.length > 32 ||
    !parsed.every((name) => typeof name === "string" && name.length > 0)
  ) {
    throw new Error("speakerNamesJson must contain an array of speaker names");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return field;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  if (field === undefined || field === null) return undefined;
  if (typeof field !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return field;
}

function requireNumber(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`${key} must be a finite number`);
  }
  return field;
}

function optionalNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = value[key];
  if (field === undefined || field === null) return undefined;
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`${key} must be a finite number`);
  }
  return field;
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const field = value[key];
  if (typeof field !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return field;
}
