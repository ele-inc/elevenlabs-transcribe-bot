import {
  formatTranscriptSegments,
  segmentWords,
} from "./transcript-segments.ts";
import type { TranscriptionOptions, WordItem } from "../core/types.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const baseOptions: TranscriptionOptions = {
  diarize: false,
  showTimestamp: true,
  tagAudioEvents: true,
};

Deno.test("segmentWords splits a long sentence without speaker metadata", () => {
  const words: WordItem[] = [
    { text: "alpha ", start: 0, end: 1 },
    { text: "bravo ", start: 2, end: 3 },
    { text: "charlie ", start: 4, end: 5 },
    { text: "delta ", start: 6, end: 7 },
    { text: "echo ", start: 8, end: 9 },
    { text: "foxtrot", start: 10, end: 11 },
  ];

  const segments = segmentWords(words, {
    targetSegmentDurationSeconds: 4,
    maxSegmentDurationSeconds: 6,
    maxSegmentChars: 999,
  });

  assertEquals(
    segments.map((segment) => segment.start),
    [0, 6],
  );
  assertEquals(segments.length, 2);
});

Deno.test("formatTranscriptSegments renders timestamps without speaker labels", () => {
  const transcript = formatTranscriptSegments(
    [
      { text: "alpha bravo", start: 0 },
      { text: "charlie delta", start: 12 },
    ],
    baseOptions,
  );

  assertEquals(transcript, "0:00 alpha bravo\n0:12 charlie delta");
});

Deno.test("formatTranscriptSegments adds speaker labels only when diarization is enabled", () => {
  const transcript = formatTranscriptSegments(
    [
      { text: "alpha bravo", start: 0, speaker: "speaker_0" },
      { text: "charlie delta", start: 12, speaker: "speaker_1" },
    ],
    { ...baseOptions, diarize: true },
  );

  assertEquals(
    transcript,
    "0:00 speaker_0: alpha bravo\n0:12 speaker_1: charlie delta",
  );
});

Deno.test("segmentWords can split on speaker changes as an extra boundary", () => {
  const words: WordItem[] = [
    { text: "alpha ", start: 0, end: 1, speaker_id: "speaker_0" },
    { text: "bravo", start: 2, end: 3, speaker_id: "speaker_1" },
  ];

  const segments = segmentWords(words, { splitOnSpeakerChange: true });

  assertEquals(
    segments.map((segment) => ({
      text: segment.text,
      start: segment.start,
      speaker: segment.speaker,
    })),
    [
      { text: "alpha", start: 0, speaker: "speaker_0" },
      { text: "bravo", start: 2, speaker: "speaker_1" },
    ],
  );
});
