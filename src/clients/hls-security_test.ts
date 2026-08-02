import { assertEquals, assertRejects } from "@std/assert";
import { rewriteHlsManifest } from "./hls.ts";
import { assertAllowedHlsFetchUrl } from "../utils/hls-url-policy.ts";

Deno.test("HLSマニフェスト内の全外部参照をローカル参照へ置き換える", async () => {
  const fetched: string[] = [];
  const manifest = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/playlist.m3u8"',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
    "video/playlist.m3u8",
    "segment-1.ts",
  ].join("\n");

  const rewritten = await rewriteHlsManifest(
    manifest,
    "https://media.example.com/root/master.m3u8",
    (url) => {
      fetched.push(url);
      return Promise.resolve(`local-${fetched.length}`);
    },
  );

  assertEquals(fetched, [
    "https://media.example.com/root/audio/playlist.m3u8",
    "https://media.example.com/root/keys/key.bin",
    "https://media.example.com/root/init.mp4",
    "https://media.example.com/root/video/playlist.m3u8",
    "https://media.example.com/root/segment-1.ts",
  ]);
  assertEquals(rewritten.includes("https://"), false);
  assertEquals(rewritten.includes('URI="local-1"'), true);
  assertEquals(rewritten.endsWith("local-5"), true);
});

Deno.test("HLSマニフェスト内のHTTPS以外の参照を拒否する", async () => {
  await assertRejects(
    () =>
      rewriteHlsManifest(
        "#EXTM3U\nhttp://internal.example/segment.ts",
        "https://media.example.com/root.m3u8",
        () => Promise.resolve("unused"),
      ),
    Error,
    "HTTPS以外",
  );
});

Deno.test("HLSマニフェスト内のdata URIはそのまま維持する", async () => {
  const dataUri = "data:text/plain;base64,c2VjcmV0";
  const rewritten = await rewriteHlsManifest(
    `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${dataUri}"`,
    "https://media.example.com/root.m3u8",
    () => Promise.reject(new Error("data URIを取得しようとしました")),
  );
  assertEquals(rewritten.includes(dataUri), true);
});

Deno.test("許可ホストでもDNS解決先がプライベートIPなら拒否する", async () => {
  await assertRejects(
    () =>
      assertAllowedHlsFetchUrl(
        "https://media.example.com/segment.ts",
        ["media.example.com"],
        (_hostname, recordType) =>
          Promise.resolve(recordType === "A" ? ["10.0.0.1"] : []),
      ),
    Error,
    "プライベートIP",
  );
});

Deno.test("許可ホストの公開IPは取得先として受け付ける", async () => {
  await assertAllowedHlsFetchUrl(
    "https://media.example.com/segment.ts",
    ["media.example.com"],
    (_hostname, recordType) =>
      Promise.resolve(recordType === "A" ? ["8.8.8.8"] : []),
  );
});

Deno.test("DNS解決結果が空なら取得先を拒否する", async () => {
  await assertRejects(
    () =>
      assertAllowedHlsFetchUrl(
        "https://media.example.com/segment.ts",
        ["media.example.com"],
        () => Promise.resolve([]),
      ),
    Error,
    "DNS解決結果を確認できません",
  );
});
