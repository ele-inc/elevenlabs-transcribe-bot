import { formatVersion, VERSION } from "./version.ts";
import { assertEquals } from "@std/assert";

Deno.test("formatVersion includes the scribe CLI version", () => {
  assertEquals(formatVersion(), `scribe ${VERSION}`);
});
