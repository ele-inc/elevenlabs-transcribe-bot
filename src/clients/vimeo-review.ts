import { CloudFileMetadata } from "../services/cloud-service.ts";

const decoder = new TextDecoder();

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

/**
 * Check if URL is a Vimeo Review URL (new format: /reviews/{uuid}/videos/{id})
 */
export function isVimeoReviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname.includes("vimeo.com") &&
      /\/reviews\/[^/]+\/videos\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Extract video ID from Vimeo Review URL
 * Returns the full URL since we need it to scrape the page
 */
export function extractVimeoReviewId(url: string): string | null {
  return isVimeoReviewUrl(url) ? url : null;
}

// Cache player config to avoid fetching twice (metadata + download)
const playerConfigCache = new Map<string, {
  title: string;
  duration?: number;
  hlsUrl: string;
  cachedAt: number;
}>();

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the Vimeo player config JSON from a review page (with caching)
 * 1. Fetch the review page HTML
 * 2. Extract the player config URL from the HTML
 * 3. Fetch the config JSON
 */
async function fetchPlayerConfig(
  reviewUrl: string,
): Promise<{
  title: string;
  duration?: number;
  hlsUrl: string;
}> {
  // Return cached config if available and fresh
  const cached = playerConfigCache.get(reviewUrl);
  if (cached && (Date.now() - cached.cachedAt) < CONFIG_CACHE_TTL_MS) {
    return { title: cached.title, duration: cached.duration, hlsUrl: cached.hlsUrl };
  }
  // Step 1: Fetch the review page HTML
  const pageResponse = await fetch(reviewUrl);
  if (!pageResponse.ok) {
    throw new Error(
      `Failed to fetch Vimeo review page (status ${pageResponse.status})`,
    );
  }
  const html = await pageResponse.text();

  // Step 2: Extract the player config URL
  // The HTML contains URLs like: https://player.vimeo.com/video/{id}/config?...
  // with \u0026 as escaped ampersands
  const configUrlMatch = html.match(
    /https:\/\/player\.vimeo\.com\/video\/\d+\/config\?[^"]+/,
  );
  if (!configUrlMatch) {
    throw new Error(
      "Could not find Vimeo player config URL in review page",
    );
  }

  // Unescape \u0026 -> &
  const configUrl = configUrlMatch[0].replace(/\\u0026/g, "&");

  // Step 3: Fetch the config JSON
  const configResponse = await fetch(configUrl, {
    headers: {
      "Referer": "https://vimeo.com/",
    },
  });
  if (!configResponse.ok) {
    throw new Error(
      `Failed to fetch Vimeo player config (status ${configResponse.status})`,
    );
  }

  const config = await configResponse.json();

  // Extract video info
  const title = config?.video?.title || "vimeo_review_video";
  const duration = config?.video?.duration;

  // Extract HLS URL from config
  const hlsCdns = config?.request?.files?.hls?.cdns;
  if (!hlsCdns) {
    throw new Error("Could not find HLS stream URLs in Vimeo player config");
  }

  // Pick the default CDN or the first available one
  const defaultCdn = config?.request?.files?.hls?.default_cdn;
  const cdnData = hlsCdns[defaultCdn] || Object.values(hlsCdns)[0];
  const hlsUrl = (cdnData as { url?: string })?.url;

  if (!hlsUrl) {
    throw new Error("Could not extract HLS URL from Vimeo player config");
  }

  // Cache the result
  playerConfigCache.set(reviewUrl, { title, duration, hlsUrl, cachedAt: Date.now() });

  return { title, duration, hlsUrl };
}

/**
 * Clear cached config for a URL (called after download completes)
 */
function clearConfigCache(reviewUrl: string): void {
  playerConfigCache.delete(reviewUrl);
}

/**
 * Get metadata for a Vimeo Review video
 */
export async function getVimeoReviewFileMetadata(
  reviewUrl: string,
): Promise<CloudFileMetadata> {
  const { title, duration } = await fetchPlayerConfig(reviewUrl);
  const sanitizedTitle = sanitizeFilename(title);
  const filename = `${sanitizedTitle}.mp3`;

  return {
    id: reviewUrl,
    filename,
    mimeType: "audio/mpeg",
    duration,
  };
}

/**
 * Download audio from a Vimeo Review video using ffmpeg
 */
export async function downloadVimeoReviewAudioToPath(
  reviewUrl: string,
  outputPath: string,
): Promise<void> {
  await ensureFfmpegAvailable();

  const { hlsUrl } = await fetchPlayerConfig(reviewUrl);

  const command = new Deno.Command("ffmpeg", {
    args: [
      "-y",
      "-i",
      hlsUrl,
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

  const { success, stdout, stderr } = await command.output();
  const stderrText = decoder.decode(stderr).trim();
  const stdoutText = decoder.decode(stdout).trim();

  // Clear cache after download attempt
  clearConfigCache(reviewUrl);

  if (!success) {
    console.error("[VimeoReview] ffmpeg failed:", stderrText);
    console.error("[VimeoReview] ffmpeg stdout:", stdoutText);
    throw new Error(
      `Failed to download Vimeo Review audio: ${stderrText || "Unknown error"}`,
    );
  }

  // Verify output file
  try {
    const stat = await Deno.stat(outputPath);
    if (!stat.isFile || stat.size === 0) {
      console.error("[VimeoReview] Output file missing or empty after successful ffmpeg");
      console.error("[VimeoReview] ffmpeg stderr:", stderrText);
      throw new Error("Output file is empty after ffmpeg conversion");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Output file is empty")) {
      throw error;
    }
    console.error("[VimeoReview] stat failed for:", outputPath);
    console.error("[VimeoReview] ffmpeg stderr:", stderrText);
    throw new Error(
      `Vimeo Review audio output verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
