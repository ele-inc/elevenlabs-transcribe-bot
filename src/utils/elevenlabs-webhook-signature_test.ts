import { verifyElevenLabsWebhookSignature } from "./elevenlabs-webhook-signature.ts";

async function createSignature(
  body: string,
  secret: string,
  timestamp: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v0=${hex}`;
}

Deno.test("verifyElevenLabsWebhookSignature accepts a valid signature", async () => {
  const body = JSON.stringify({ type: "speech_to_text_transcription" });
  const secret = "test-secret";
  const now = Date.now();
  const timestamp = Math.floor(now / 1000).toString();
  const signature = await createSignature(body, secret, timestamp);

  await verifyElevenLabsWebhookSignature(body, signature, secret, now);
});

Deno.test("verifyElevenLabsWebhookSignature rejects an invalid signature", async () => {
  const now = Date.now();
  const timestamp = Math.floor(now / 1000).toString();

  try {
    await verifyElevenLabsWebhookSignature(
      "{}",
      `t=${timestamp},v0=0000000000000000000000000000000000000000000000000000000000000000`,
      "test-secret",
      now,
    );
  } catch {
    return;
  }
  throw new Error("Expected an invalid signature to be rejected");
});

Deno.test("verifyElevenLabsWebhookSignature rejects an expired timestamp", async () => {
  const body = "{}";
  const secret = "test-secret";
  const now = Date.now();
  const timestamp = Math.floor((now - 31 * 60 * 1000) / 1000).toString();
  const signature = await createSignature(body, secret, timestamp);

  try {
    await verifyElevenLabsWebhookSignature(
      body,
      signature,
      secret,
      now,
    );
  } catch {
    return;
  }
  throw new Error("Expected an expired signature to be rejected");
});
