import { CloudFileMetadata } from "../services/cloud-service.ts";
import { assertAllowedHlsFetchUrl } from "../utils/hls-url-policy.ts";

const decoder = new TextDecoder();
const MAX_HLS_RESOURCES = 20_000;
const MAX_HLS_REDIRECTS = 5;
const HLS_FETCH_TIMEOUT_MS = 30_000;

let ffmpegStatus: "unknown" | "available" | "missing" = "unknown";
let ffmpegError: string | null = null;

async function ensureFfmpegAvailable(): Promise<void> {
  if (ffmpegStatus === "available") {
    return;
  }

  if (ffmpegStatus === "missing") {
    throw new Error(ffmpegError ?? "ffmpeg is not available");
  }

  try {
    const command = new Deno.Command("ffmpeg", {
      args: ["-version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stderr } = await command.output();

    if (!success) {
      const errorText = decoder.decode(stderr).trim();
      ffmpegStatus = "missing";
      ffmpegError =
        `ffmpeg check failed. Please ensure ffmpeg is installed and accessible in PATH. ${errorText}`
          .trim();
      throw new Error(ffmpegError);
    }

    ffmpegStatus = "available";
  } catch (error) {
    ffmpegStatus = "missing";
    ffmpegError = `ffmpeg is not installed or not accessible. ${
      error instanceof Error ? error.message : String(error)
    }`;
    throw new Error(ffmpegError);
  }
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function isHlsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();

    if (pathname.includes(".m3u8")) {
      return true;
    }

    // Some HLS URLs include the playlist in query parameters
    return search.includes(".m3u8") || search.includes("hls");
  } catch {
    return false;
  }
}

export function extractHlsStreamId(url: string): string | null {
  return isHlsUrl(url) ? url : null;
}

function deriveFilename(streamUrl: string): string {
  try {
    const parsed = new URL(streamUrl);
    const pathname = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = pathname[pathname.length - 1] || "hls_audio";
    const baseName = lastSegment.replace(/\.m3u8$/i, "") || "hls_audio";
    return `${sanitizeFilename(baseName)}.mp3`;
  } catch {
    return "hls_audio.mp3";
  }
}

function deriveVideoFilename(streamUrl: string): string {
  try {
    const parsed = new URL(streamUrl);
    const pathname = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = pathname[pathname.length - 1] || "hls_video";
    const baseName = lastSegment.replace(/\.m3u8$/i, "") || "hls_video";
    return `${sanitizeFilename(baseName)}.mp4`;
  } catch {
    return "hls_video.mp4";
  }
}

async function probeDuration(streamUrl: string): Promise<number | undefined> {
  try {
    const command = new Deno.Command("ffprobe", {
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        streamUrl,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stdout } = await command.output();
    if (!success) return undefined;

    const output = decoder.decode(stdout).trim();
    if (!output) return undefined;

    const duration = parseFloat(output);
    return Number.isFinite(duration) ? duration : undefined;
  } catch {
    return undefined;
  }
}

async function verifyOutputFile(
  outputPath: string,
  label: string,
): Promise<void> {
  try {
    const stat = await Deno.stat(outputPath);
    if (!stat.isFile || stat.size === 0) {
      throw new Error("Output file is empty");
    }
  } catch (error) {
    throw new Error(
      `${label} output verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function getHlsFileMetadata(
  streamUrl: string,
  allowedHosts?: string[],
): Promise<CloudFileMetadata> {
  await ensureFfmpegAvailable();
  const filename = deriveFilename(streamUrl);
  // Workerでは実取得時に全参照先を検査する。ここでリモートURLをffprobeへ
  // 渡すと検査を迂回するため、許可リスト指定時はdurationを省略する。
  const duration = allowedHosts === undefined
    ? await probeDuration(streamUrl)
    : undefined;

  return {
    id: streamUrl,
    filename,
    mimeType: "audio/mpeg",
    duration,
  };
}

export async function getHlsVideoMetadata(
  streamUrl: string,
): Promise<CloudFileMetadata> {
  await ensureFfmpegAvailable();
  const filename = deriveVideoFilename(streamUrl);
  const duration = await probeDuration(streamUrl);

  return {
    id: streamUrl,
    filename,
    mimeType: "video/mp4",
    duration,
  };
}

export async function downloadHlsAudioToPath(
  streamUrl: string,
  outputPath: string,
  allowedHosts?: string[],
): Promise<void> {
  await ensureFfmpegAvailable();

  let bundleDirectory: string | undefined;
  let inputUrl = streamUrl;
  const inputArgs: string[] = [];
  if (allowedHosts !== undefined) {
    const bundle = await createValidatedHlsBundle(streamUrl, allowedHosts);
    bundleDirectory = bundle.directory;
    inputUrl = bundle.manifestPath;
    inputArgs.push(
      "-protocol_whitelist",
      "file,crypto,data",
      "-allowed_extensions",
      "ALL",
    );
  }

  try {
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-hide_banner",
        "-nostdin",
        "-y",
        ...inputArgs,
        "-i",
        inputUrl,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-b:a",
        "192k",
        "-loglevel",
        "error",
        outputPath,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await command.output();
    if (!success) {
      const errorText = decoder.decode(stderr).trim();
      throw new Error(
        `Failed to download or convert HLS audio: ${
          errorText || "Unknown error"
        }`,
      );
    }

    await verifyOutputFile(outputPath, "HLS audio");
  } finally {
    if (bundleDirectory) {
      await Deno.remove(bundleDirectory, { recursive: true }).catch(() => {});
    }
  }
}

interface HlsBundle {
  directory: string;
  manifestPath: string;
}

/**
 * HLSの参照ツリーを検証しながらローカルへ固定化する。
 * ffmpegにはローカルファイルだけを渡すため、未検証のリダイレクトや
 * マニフェスト内URLへffmpeg自身が接続することはない。
 */
async function createValidatedHlsBundle(
  streamUrl: string,
  allowedHosts: string[],
): Promise<HlsBundle> {
  const directory = await Deno.makeTempDir({ prefix: "scribe-hls-" });
  const resources = new Map<string, Promise<string>>();
  const inProgress = new Set<string>();
  let resourceCount = 0;

  const saveResource = (
    url: string,
    forceManifest = false,
  ): Promise<string> => {
    const existing = resources.get(url);
    if (existing) {
      if (inProgress.has(url)) {
        return Promise.reject(
          new Error(`HLSマニフェストが循環参照しています: ${url}`),
        );
      }
      return existing;
    }
    if (++resourceCount > MAX_HLS_RESOURCES) {
      return Promise.reject(
        new Error(
          `HLSの参照リソース数が上限 ${MAX_HLS_RESOURCES} を超えました`,
        ),
      );
    }
    const resourceId = resourceCount;
    inProgress.add(url);

    const promise = (async () => {
      const { response, finalUrl } = await fetchValidatedHlsResource(
        url,
        allowedHosts,
      );
      const contentType = response.headers.get("content-type")?.toLowerCase() ||
        "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const looksLikeManifest = forceManifest ||
        contentType.includes("mpegurl") ||
        decoder.decode(bytes.slice(0, 16)).trimStart().startsWith("#EXTM3U");
      const extension = looksLikeManifest
        ? ".m3u8"
        : resourceExtension(finalUrl);
      const filename = `resource-${resourceId}${extension}`;
      const path = `${directory}/${filename}`;

      if (!looksLikeManifest) {
        await Deno.writeFile(path, bytes);
        return filename;
      }

      const manifest = decoder.decode(bytes);
      const rewritten = await rewriteHlsManifest(
        manifest,
        finalUrl,
        saveResource,
      );
      await Deno.writeTextFile(path, rewritten);
      return filename;
    })().finally(() => inProgress.delete(url));
    resources.set(url, promise);
    return promise;
  };

  try {
    const manifestName = await saveResource(streamUrl, true);
    return { directory, manifestPath: `${directory}/${manifestName}` };
  } catch (error) {
    await Deno.remove(directory, { recursive: true }).catch(() => {});
    throw error;
  }
}

async function fetchValidatedHlsResource(
  initialUrl: string,
  allowedHosts: string[],
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_HLS_REDIRECTS;
    redirectCount++
  ) {
    await assertAllowedHlsFetchUrl(currentUrl, allowedHosts);
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(HLS_FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new Error("HLS取得先のリダイレクトにLocationがありません");
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `HLSリソースの取得に失敗しました: HTTP ${response.status}`,
      );
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error(
    `HLSリダイレクト回数が上限 ${MAX_HLS_REDIRECTS} を超えました`,
  );
}

export async function rewriteHlsManifest(
  manifest: string,
  manifestUrl: string,
  saveResource: (url: string) => Promise<string>,
): Promise<string> {
  const lines = manifest.split(/\r?\n/);
  const rewritten: string[] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) {
      rewritten.push(
        await rewriteUriAttributes(line, manifestUrl, saveResource),
      );
      continue;
    }
    rewritten.push(
      await localizeHlsUri(line.trim(), manifestUrl, saveResource),
    );
  }
  return rewritten.join("\n");
}

async function rewriteUriAttributes(
  line: string,
  manifestUrl: string,
  saveResource: (url: string) => Promise<string>,
): Promise<string> {
  const pattern = /URI="([^"]+)"/g;
  let result = "";
  let lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    result += line.slice(lastIndex, match.index);
    const localized = await localizeHlsUri(
      match[1],
      manifestUrl,
      saveResource,
    );
    result += `URI="${localized}"`;
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  return result + line.slice(lastIndex);
}

async function localizeHlsUri(
  uri: string,
  manifestUrl: string,
  saveResource: (url: string) => Promise<string>,
): Promise<string> {
  if (uri.startsWith("data:")) return uri;
  const resolved = new URL(uri, manifestUrl);
  if (resolved.protocol !== "https:") {
    throw new Error(`HLS内にHTTPS以外の参照があります: ${resolved.href}`);
  }
  return await saveResource(resolved.href);
}

function resourceExtension(url: string): string {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.[a-z0-9]{1,8}$/i);
  return match?.[0] || ".bin";
}

export async function downloadHlsVideoToPath(
  streamUrl: string,
  outputPath: string,
): Promise<void> {
  await ensureFfmpegAvailable();

  const attempts: Array<{ label: string; args: string[] }> = [
    {
      label: "stream copy with AAC bitstream filter",
      args: [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        streamUrl,
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        "-loglevel",
        "error",
        outputPath,
      ],
    },
    {
      label: "stream copy",
      args: [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        streamUrl,
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-loglevel",
        "error",
        outputPath,
      ],
    },
    {
      label: "h264/aac transcode",
      args: [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        streamUrl,
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-loglevel",
        "error",
        outputPath,
      ],
    },
  ];

  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      await Deno.remove(outputPath).catch(() => {});

      const command = new Deno.Command("ffmpeg", {
        args: attempt.args,
        stdout: "piped",
        stderr: "piped",
      });

      const { success, stderr } = await command.output();
      const errorText = decoder.decode(stderr).trim();

      if (!success) {
        errors.push(`${attempt.label}: ${errorText || "Unknown error"}`);
        continue;
      }

      await verifyOutputFile(outputPath, "HLS video");
      return;
    } catch (error) {
      errors.push(
        `${attempt.label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  throw new Error(`Failed to download HLS video: ${errors.join(" | ")}`);
}
