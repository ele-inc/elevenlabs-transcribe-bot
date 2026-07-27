import { createWebhookPlatformAdapter } from "../adapters/platform-adapter.ts";
import { getElevenLabsWebhookConfig } from "../core/config.ts";
import { formatTranscriptionPayload } from "../core/transcribe-core.ts";
import { parseTranscriptionWebhookMetadata } from "../core/transcription-webhook.ts";
import { deliverTranscriptionResult } from "../services/transcription-result-delivery.ts";
import {
  badRequest,
  jsonResponse,
  serviceUnavailable,
  unauthorized,
} from "../utils/http-utils.ts";
import { elapsedMs, logPerformance } from "../utils/performance.ts";
import { verifyElevenLabsWebhookSignature } from "../utils/elevenlabs-webhook-signature.ts";

const processedRequests = new Set<string>();
const MAX_PROCESSED_REQUESTS = 1000;
const SUPPORTED_EVENT_TYPES = new Set([
  "speech_to_text_transcription",
  "speech_to_text.completed",
]);

type WebhookEvent = {
  type?: unknown;
  data?: unknown;
};

export async function handleElevenLabsWebhook(
  req: Request,
): Promise<Response> {
  const startedAt = performance.now();
  let webhookConfig;
  try {
    webhookConfig = getElevenLabsWebhookConfig();
  } catch (error) {
    console.error("Invalid ElevenLabs webhook configuration:", error);
    return serviceUnavailable("ElevenLabs webhook is not configured correctly");
  }
  if (!webhookConfig) {
    return serviceUnavailable("ElevenLabs webhook is not configured");
  }

  const signature = req.headers.get("ElevenLabs-Signature");
  if (!signature) {
    return unauthorized("Missing ElevenLabs webhook signature");
  }
  const rawBody = await req.text();

  let event: WebhookEvent;
  try {
    await verifyElevenLabsWebhookSignature(
      rawBody,
      signature,
      webhookConfig.webhookSecret,
    );
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch (error) {
    console.warn("ElevenLabs webhook signature verification failed:", error);
    return unauthorized("Invalid ElevenLabs webhook signature");
  }

  if (
    typeof event.type !== "string" ||
    !SUPPORTED_EVENT_TYPES.has(event.type)
  ) {
    return new Response(null, { status: 204 });
  }
  if (!isRecord(event.data)) {
    return badRequest("Webhook data must be an object");
  }

  const requestId = readString(event.data, "request_id", "requestId");
  if (!requestId) {
    return badRequest("Webhook data is missing request_id");
  }
  if (processedRequests.has(requestId)) {
    return jsonResponse({ ok: true, duplicate: true });
  }

  let parsedMetadata;
  try {
    parsedMetadata = parseTranscriptionWebhookMetadata(
      event.data.webhook_metadata ?? event.data.webhookMetadata,
    );
  } catch (error) {
    console.error("Invalid transcription webhook metadata:", error);
    return badRequest("Invalid transcription webhook metadata");
  }

  const adapter = createWebhookPlatformAdapter(parsedMetadata.context);
  const transcription = event.data.transcription;

  try {
    if (!isRecord(transcription)) {
      const failureMessage = readString(event.data, "error") ??
        "ElevenLabs から文字起こし結果が返りませんでした。もう一度お試しください。";
      await adapter.sendErrorMessage(failureMessage);
    } else {
      const formatted = await formatTranscriptionPayload(
        transcription,
        parsedMetadata.options,
      );
      await deliverTranscriptionResult({
        transcript: formatted.transcript,
        filename: parsedMetadata.metadata.filename,
        sourceUrl: parsedMetadata.metadata.sourceUrl,
        options: parsedMetadata.options,
        adapter,
      });
    }
  } catch (error) {
    console.error("Failed to deliver ElevenLabs webhook result:", error);
    logPerformance("transcription_webhook_delivery", {
      performanceId: parsedMetadata.metadata.performanceId,
      requestId,
      totalMs: elapsedMs(startedAt),
      success: false,
    });
    return jsonResponse({ error: "Webhook delivery failed" }, 500);
  }

  rememberProcessedRequest(requestId);
  logPerformance("transcription_webhook_delivery", {
    performanceId: parsedMetadata.metadata.performanceId,
    requestId,
    totalMs: elapsedMs(startedAt),
    success: true,
  });
  return jsonResponse({ ok: true });
}

function rememberProcessedRequest(requestId: string): void {
  processedRequests.add(requestId);
  if (processedRequests.size > MAX_PROCESSED_REQUESTS) {
    const first = processedRequests.values().next().value;
    if (typeof first === "string") processedRequests.delete(first);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}
