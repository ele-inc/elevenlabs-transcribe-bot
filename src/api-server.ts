import { config } from "./core/config.ts";
import { handleTranscriptionApi } from "./handlers/transcription-api-handler.ts";
import { jsonResponse } from "./utils/http-utils.ts";

console.log('文字起こし API "scribe-api" を起動しました');

Deno.serve({ port: config.port }, async (req) => {
  const pathname = new URL(req.url).pathname;

  if (pathname === "/" && req.method === "GET") {
    return jsonResponse({ service: "scribe-api", status: "ok" });
  }

  if (
    pathname === "/v1/transcription-jobs" ||
    pathname.startsWith("/v1/transcription-jobs/")
  ) {
    return await handleTranscriptionApi(req);
  }

  return jsonResponse({ error: "見つかりません" }, 404);
});
