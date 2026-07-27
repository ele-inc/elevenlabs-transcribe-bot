import {
  createTranscriptionWebhookMetadata,
  parseTranscriptionWebhookMetadata,
} from "./transcription-webhook.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected function to throw "${message}"`);
}

Deno.test("transcription webhook metadata round-trips Slack delivery context", () => {
  const metadata = createTranscriptionWebhookMetadata({
    context: {
      platform: "slack",
      channelId: "C123",
      threadTimestamp: "123.456",
    },
    performanceId: "perf-1",
    filename: "meeting.mp4",
    sourceUrl: "https://example.com/meeting",
    fileType: "video/mp4",
    duration: 120,
    options: {
      diarize: true,
      showTimestamp: true,
      tagAudioEvents: false,
      summarize: true,
      numSpeakers: 2,
      speakerNames: ["田中", "佐藤"],
    },
  });

  const parsed = parseTranscriptionWebhookMetadata(metadata);

  assertEquals(parsed.context, {
    platform: "slack",
    channelId: "C123",
    threadTimestamp: "123.456",
  });
  assertEquals(parsed.options, {
    diarize: true,
    showTimestamp: true,
    tagAudioEvents: false,
    summarize: true,
    numSpeakers: 2,
    speakerNames: ["田中", "佐藤"],
  });
});

Deno.test("transcription webhook metadata supports Discord delivery context", () => {
  const metadata = createTranscriptionWebhookMetadata({
    context: { platform: "discord", channelId: "123" },
    performanceId: "perf-2",
    fileType: "audio/mpeg",
    duration: 10,
    options: {
      diarize: false,
      showTimestamp: false,
      tagAudioEvents: true,
      summarize: false,
    },
  });

  assertEquals(
    parseTranscriptionWebhookMetadata(JSON.stringify(metadata)).context,
    { platform: "discord", channelId: "123" },
  );
});

Deno.test("transcription webhook metadata rejects unsafe values", () => {
  const base = {
    version: 1,
    performanceId: "perf",
    platform: "slack",
    channelId: "C123",
    fileType: "audio/mpeg",
    duration: 10,
    diarize: true,
    showTimestamp: true,
    tagAudioEvents: true,
    summarize: true,
  };

  assertThrows(
    () => parseTranscriptionWebhookMetadata(base),
    "requires threadTimestamp",
  );
  assertThrows(
    () =>
      parseTranscriptionWebhookMetadata({
        ...base,
        threadTimestamp: "123.456",
        numSpeakers: 33,
      }),
    "between 1 and 32",
  );
  assertThrows(
    () =>
      createTranscriptionWebhookMetadata({
        context: { platform: "discord", channelId: "123" },
        performanceId: "perf",
        filename: "x".repeat(17_000),
        fileType: "audio/mpeg",
        duration: 10,
        options: {
          diarize: false,
          showTimestamp: false,
          tagAudioEvents: false,
        },
      }),
    "exceeds",
  );
});
