import { CloudFileMetadata } from "../services/cloud-service.ts";
import { TempFileManager } from "../services/temp-file-manager.ts";

const decoder = new TextDecoder();
let ffmpegStatus: "unknown" | "available" | "missing" = "unknown";
let ffmpegError: string | null = null;
const tempManager = new TempFileManager();

async function ensureFfmpegAvailable(): Promise<void> {
  if (ffmpegStatus === "available") return;
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
      ffmpegError = `ffmpeg check failed. Please ensure ffmpeg is installed and accessible in PATH. ${errorText}`.trim();
      throw new Error(ffmpegError);
    }

    ffmpegStatus = "available";
  } catch (error) {
    ffmpegStatus = "missing";
    ffmpegError = `ffmpeg is not installed or not accessible. ${error instanceof Error ? error.message : String(error)}`;
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

function deriveFilename(streamUrl: string): string {
  try {
    const url = new URL(streamUrl);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const lastSegment = pathSegments.pop() || "hls_stream.m3u8";
    const baseName = lastSegment.toLowerCase().endsWith(".m3u8")
      ? lastSegment.slice(0, -5)
      : lastSegment;
    const sanitized = sanitizeFilename(baseName || "hls_stream");
    return `${sanitized}.mp3`;
  } catch {
    return "hls_stream.mp3";
  }
}

export function isHlsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return false;
    }

    const path = parsed.pathname.toLowerCase();
    return path.endsWith(".m3u8") || path.includes(".m3u8");
  } catch {
    return false;
  }
}

export function extractHlsStreamId(url: string): string | null {
  return isHlsUrl(url) ? url : null;
}

export async function getHlsFileMetadata(streamUrl: string): Promise<CloudFileMetadata> {
  const filename = deriveFilename(streamUrl);
  return {
    id: streamUrl,
    filename,
    mimeType: "application/vnd.apple.mpegurl",
  };
}

export async function downloadHlsAudioToPath(streamUrl: string, tempPath: string): Promise<boolean> {
  await ensureFfmpegAvailable();

  // Some HLS endpoints may reject repeated connections; create a fresh playlist copy first
  const tempPlaylist = await tempManager.createTempFile("hls_playlist", "m3u8");
  try {
    const playlistResponse = await fetch(streamUrl);
    if (!playlistResponse.ok) {
      throw new Error(`Failed to fetch HLS playlist (status ${playlistResponse.status})`);
    }
    const playlistContent = await playlistResponse.text();
    await Deno.writeTextFile(tempPlaylist, playlistContent);

    const command = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
        "-i", tempPlaylist,
        "-vn",
        "-acodec", "libmp3lame",
        "-ab", "192k",
        tempPath,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await command.output();

    if (!success) {
      const errorText = decoder.decode(stderr);
      throw new Error(`ffmpeg failed to download HLS audio: ${errorText}`);
    }

    const stat = await Deno.stat(tempPath);
    if (!stat.isFile || stat.size === 0) {
      throw new Error("Downloaded audio file is empty");
    }

    return true;
  } finally {
    await tempManager.cleanupFileAndDir(tempPlaylist).catch(() => {});
  }
}
