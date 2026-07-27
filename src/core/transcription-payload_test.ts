import { normalizeAndFormatTranscriptionPayload } from "./transcription-payload.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const options = {
  diarize: true,
  showTimestamp: true,
  tagAudioEvents: false,
};

Deno.test("normalizes SDK camelCase transcription fields", () => {
  const result = normalizeAndFormatTranscriptionPayload({
    languageCode: "ja",
    text: "fallback",
    words: [
      {
        text: "こんにちは。",
        start: 0,
        end: 1,
        speakerId: "speaker_0",
      },
    ],
  }, options);

  assertEquals(result.languageCode, "ja");
  assertEquals(result.transcript, "speaker_0:\n0:00 こんにちは。");
  assertEquals(result.words?.[0].speaker_id, "speaker_0");
});

Deno.test("normalizes webhook snake_case transcription fields", () => {
  const result = normalizeAndFormatTranscriptionPayload({
    language_code: "en",
    words: [
      {
        text: "Hello.",
        start: 2,
        end: 3,
        speaker_id: "speaker_1",
      },
    ],
  }, options);

  assertEquals(result.languageCode, "en");
  assertEquals(result.transcript, "speaker_1:\n0:02 Hello.");
});
