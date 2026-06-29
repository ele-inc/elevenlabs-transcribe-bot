import { formatVersion, VERSION } from "./version.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

Deno.test("formatVersion includes the scribe CLI version", () => {
  assertEquals(formatVersion(), `scribe ${VERSION}`);
});
