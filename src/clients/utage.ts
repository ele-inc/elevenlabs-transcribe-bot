import { CloudFileMetadata } from "../services/cloud-service.ts";

const decoder = new TextDecoder();

/**
 * Check if URL is a Utage video URL
 */
export function isUtageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname.includes("utage-system.com") && parsed.pathname.includes("/video/");
  } catch {
    return false;
  }
}

/**
 * Extract video ID from Utage URL
 */
export function extractUtageVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/video\/([^/?]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Fetch HTML and extract m3u8 URL from Utage video page
 */
async function extractM3u8Url(videoUrl: string): Promise<string> {
  try {
    console.log("[Utage] extractM3u8Url: fetching", videoUrl);
    const response = await fetch(videoUrl);
    console.log("[Utage] extractM3u8Url: response status", response.status);
    if (!response.ok) {
      throw new Error(`Failed to fetch Utage page (status ${response.status})`);
    }

    const html = await response.text();
    console.log("[Utage] extractM3u8Url: html length", html.length);

    // Extract m3u8 URL from config object in the HTML
    // Format: const config = {video_id: "...",src: "https://.../video.m3u8", ...};
    const srcMatch = html.match(/src:\s*"([^"]+\.m3u8)"/);

    if (!srcMatch || !srcMatch[1]) {
      throw new Error("Could not find m3u8 URL in Utage video page");
    }

    return srcMatch[1];
  } catch (error) {
    throw new Error(
      `Failed to extract m3u8 URL from Utage: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Extract title from Utage video page
 */
async function extractTitle(videoUrl: string): Promise<string> {
  try {
    console.log("[Utage] extractTitle: fetching", videoUrl);
    const response = await fetch(videoUrl);
    console.log("[Utage] extractTitle: response status", response.status);
    if (!response.ok) {
      return "utage_video";
    }

    const html = await response.text();
    console.log("[Utage] extractTitle: html length", html.length);

    // Try to extract title from video element
    const titleMatch = html.match(/title="([^"]+)"/);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].replace(/\.(mp4|m3u8)$/i, "");
    }

    return "utage_video";
  } catch {
    return "utage_video";
  }
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Get metadata for Utage video
 */
export async function getUtageFileMetadata(videoUrl: string): Promise<CloudFileMetadata> {
  const title = await extractTitle(videoUrl);
  const sanitizedTitle = sanitizeFilename(title);
  const filename = `${sanitizedTitle}.mp3`;

  return {
    id: videoUrl,
    filename,
    mimeType: "audio/mpeg",
  };
}

/**
 * Download Utage video audio
 * Extracts m3u8 URL and uses ffmpeg to download and convert
 */
export async function downloadUtageAudioToPath(
  videoUrl: string,
  outputPath: string,
): Promise<void> {
  console.log("[Utage] downloadUtageAudioToPath: start", videoUrl);
  // Extract m3u8 URL from the page
  const m3u8Url = await extractM3u8Url(videoUrl);
  console.log("[Utage] downloadUtageAudioToPath: m3u8Url", m3u8Url);

  // Check ffmpeg availability
  let ffmpegStatus: "unknown" | "available" | "missing" = "unknown";
  try {
    const command = new Deno.Command("ffmpeg", {
      args: ["-version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success } = await command.output();

    if (!success) {
      throw new Error("ffmpeg is not available");
    }
    ffmpegStatus = "available";
  } catch (error) {
    throw new Error(
      `ffmpeg is not installed or not accessible. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Download and convert using ffmpeg
  console.log("[Utage] downloadUtageAudioToPath: starting ffmpeg with m3u8:", m3u8Url);
  const command = new Deno.Command("ffmpeg", {
    args: [
      "-hide_banner",
      "-nostats",
      "-nostdin",
      "-y",
      "-i",
      m3u8Url,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "192k",
      "-loglevel",
      "info",
      outputPath,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stdout, stderr } = await command.output();
  const stdoutText = decoder.decode(stdout).trim();
  const stderrText = decoder.decode(stderr).trim();
  console.log("[Utage] downloadUtageAudioToPath: ffmpeg completed, success:", success);
  console.log("[Utage] ffmpeg stdout:", stdoutText.slice(0, 500));
  console.log("[Utage] ffmpeg stderr:", stderrText.slice(0, 500));
  if (!success) {
    throw new Error(
      `Failed to download Utage audio: ${stderrText || stdoutText || "Unknown error"}`,
    );
  }

  // Verify output file
  try {
    const stat = await Deno.stat(outputPath);
    if (!stat.isFile || stat.size === 0) {
      throw new Error("Output file is empty after conversion");
    }
  } catch (error) {
    throw new Error(
      `Utage audio output verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
