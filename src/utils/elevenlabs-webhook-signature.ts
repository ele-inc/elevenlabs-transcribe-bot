const SIGNATURE_TOLERANCE_MS = 30 * 60 * 1000;

export async function verifyElevenLabsWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  now: number = Date.now(),
): Promise<void> {
  const fields = signatureHeader.split(",");
  const timestamp = fields.find((field) => field.startsWith("t="))?.slice(2);
  const signature = fields.find((field) => field.startsWith("v0="))?.slice(3);
  if (!timestamp || !signature) {
    throw new Error("Invalid ElevenLabs signature format");
  }

  const timestampMs = Number(timestamp) * 1000;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(now - timestampMs) > SIGNATURE_TOLERANCE_MS
  ) {
    throw new Error("ElevenLabs signature timestamp is outside tolerance");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    ),
  );
  const expected = hexToBytes(signature);
  if (!expected || !timingSafeEqual(actual, expected)) {
    throw new Error("ElevenLabs signature does not match");
  }
}

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
