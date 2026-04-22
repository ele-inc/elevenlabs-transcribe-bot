import { CloudFileMetadata } from "../services/cloud-service.ts";
import { config } from "../core/config.ts";
import { TempFileManager } from "../services/temp-file-manager.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const tempManager = new TempFileManager();

let ytDlpStatus: "unknown" | "available" | "missing" = "unknown";
let ytDlpError: string | null = null;

async function ensureYtDlpAvailable(): Promise<void> {
  if (ytDlpStatus === "available") {
    return;
  }

  if (ytDlpStatus === "missing") {
    throw new Error(ytDlpError ?? "yt-dlp is not available");
  }

  try {
    const command = new Deno.Command("yt-dlp", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stderr } = await command.output();

    if (!success) {
      const errorText = decoder.decode(stderr).trim();
      ytDlpStatus = "missing";
      ytDlpError =
        `yt-dlp check failed. Please ensure yt-dlp is installed and accessible in PATH. ${errorText}`
          .trim();
      throw new Error(ytDlpError);
    }

    ytDlpStatus = "available";
  } catch (error) {
    ytDlpStatus = "missing";
    ytDlpError = `yt-dlp is not installed or not accessible. ${
      error instanceof Error ? error.message : String(error)
    }`;
    throw new Error(ytDlpError);
  }
}

function createYouTubeWatchUrl(videoId: string): string {
  // If videoId is a full URL (for Loom and other sites), return as-is
  if (videoId.startsWith("http://") || videoId.startsWith("https://")) {
    return videoId;
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Creates a temporary cookies file from Base64-encoded content
 * Returns an object with the path and whether it's a temporary file that needs cleanup
 */
async function createCookiesFileIfNeeded(): Promise<
  { path: string | null; isTemporary: boolean }
> {
  // If cookies file path is provided, use it directly (for local/container usage)
  if (config.youtubeCookies) {
    // Check if file exists
    try {
      await Deno.stat(config.youtubeCookies);
      return { path: config.youtubeCookies, isTemporary: false };
    } catch {
      // File doesn't exist, but we'll let yt-dlp handle the error
      return { path: config.youtubeCookies, isTemporary: false };
    }
  }

  // If Base64-encoded cookies are provided, decode and create temporary file
  if (config.youtubeCookiesBase64) {
    try {
      // Clean the Base64 string: remove whitespace, newlines, quotes, etc.
      let cleanedBase64 = config.youtubeCookiesBase64.trim();

      // Remove surrounding quotes if present (single or double)
      if (
        (cleanedBase64.startsWith('"') && cleanedBase64.endsWith('"')) ||
        (cleanedBase64.startsWith("'") && cleanedBase64.endsWith("'"))
      ) {
        cleanedBase64 = cleanedBase64.slice(1, -1);
      }

      // Remove all whitespace characters (spaces, tabs, newlines, etc.)
      cleanedBase64 = cleanedBase64.replace(/\s+/g, "");

      if (!cleanedBase64) {
        throw new Error("Base64 string is empty after cleaning");
      }

      // Validate Base64 format (basic check)
      const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Pattern.test(cleanedBase64)) {
        throw new Error(
          `Base64 string contains invalid characters. Length: ${cleanedBase64.length}`,
        );
      }

      // Decode Base64 to binary
      const cookiesContent = atob(cleanedBase64);
      const cookiesBytes = encoder.encode(cookiesContent);

      // Create temporary file
      const tempPath = await tempManager.createTempFile(
        "youtube_cookies",
        "txt",
      );
      await Deno.writeFile(tempPath, cookiesBytes);

      return { path: tempPath, isTemporary: true };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error("Failed to create cookies file from Base64:", errorMessage);

      if (
        errorMessage.includes("InvalidCharacterError") ||
        errorMessage.includes("Failed to decode")
      ) {
        console.error(
          "Please ensure YOUTUBE_COOKIES_BASE64 contains only valid Base64 characters.",
        );
      }

      return { path: null, isTemporary: false };
    }
  }

  return { path: null, isTemporary: false };
}

/**
 * Builds yt-dlp cookie-related arguments based on configuration
 * Returns an array of arguments to be added to yt-dlp command
 * @param cookiesFilePath Path to cookies file (if any)
 */
function getCookieArgs(cookiesFilePath: string | null): string[] {
  const args: string[] = [];

  if (cookiesFilePath) {
    args.push("--cookies", cookiesFilePath);
  }

  return args;
}

function getProxyArgs(): string[] {
  return config.youtubeProxy ? ["--proxy", config.youtubeProxy] : [];
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    // Support YouTube and other yt-dlp compatible sites like Loom, Vimeo
    // Exclude Vimeo review URLs (/reviews/{uuid}/videos/{id}) - handled by VimeoReviewAdapter
    if (hostname.includes("vimeo.com") && /\/reviews\/[^/]+\/videos\/\d+/.test(parsed.pathname)) {
      return false;
    }
    return hostname.includes("youtube.com") ||
           hostname === "youtu.be" ||
           hostname.endsWith("youtube-nocookie.com") ||
           hostname.includes("loom.com") ||
           hostname.includes("vimeo.com");
  } catch {
    return false;
  }
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // For Loom, Vimeo, and other yt-dlp sites, return the full URL
    if (hostname.includes("loom.com") || hostname.includes("vimeo.com")) {
      return url;
    }

    if (hostname === "youtu.be") {
      const id = parsed.pathname.replace(/^\//, "");
      return id || null;
    }

    if (parsed.searchParams.has("v")) {
      return parsed.searchParams.get("v");
    }

    const pathMatchers = [
      /^\/shorts\/([^/?]+)/,
      /^\/embed\/([^/?]+)/,
      /^\/live\/([^/?]+)/,
      /^\/v\/([^/?]+)/,
    ];

    for (const matcher of pathMatchers) {
      const pathMatch = parsed.pathname.match(matcher);
      if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function getYouTubeFileMetadata(
  videoId: string,
): Promise<CloudFileMetadata> {
  await ensureYtDlpAvailable();
  const url = createYouTubeWatchUrl(videoId);

  // Create cookies file if needed
  const cookiesInfo = await createCookiesFileIfNeeded();
  const cookieArgs = getCookieArgs(cookiesInfo.path);
  const proxyArgs = getProxyArgs();

  try {
    const command = new Deno.Command("yt-dlp", {
      args: [
        "--dump-json",
        "--skip-download",
        "--no-warnings",
        ...cookieArgs,
        ...proxyArgs,
        url,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stdout, stderr } = await command.output();

    if (!success) {
      const errorText = decoder.decode(stderr).trim();
      throw new Error(`Failed to fetch YouTube metadata: ${errorText}`);
    }

    const stdoutText = decoder.decode(stdout).trim();

    if (!stdoutText) {
      throw new Error("Received empty metadata from yt-dlp");
    }

    let metadata: {
      id: string;
      title: string;
      duration?: number;
      filesize?: number;
      filesize_approx?: number;
    };
    try {
      metadata = JSON.parse(stdoutText);
    } catch (error) {
      throw new Error(
        `Failed to parse YouTube metadata: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const sanitizedTitle = sanitizeFilename(metadata.title || videoId) ||
      videoId;
    const filename = `${sanitizedTitle}.mp3`;

    const sizeValue = metadata.filesize ?? metadata.filesize_approx;

    return {
      id: metadata.id ?? videoId,
      filename,
      mimeType: "audio/mpeg",
      size: typeof sizeValue === "number" ? sizeValue : undefined,
    };
  } finally {
    // Clean up temporary cookies file if we created one
    if (cookiesInfo.isTemporary && cookiesInfo.path) {
      try {
        await tempManager.cleanupFileAndDir(cookiesInfo.path);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export async function downloadYouTubeAudioToPath(
  videoId: string,
  outputPath: string,
): Promise<void> {
  await ensureYtDlpAvailable();
  const url = createYouTubeWatchUrl(videoId);

  // Create cookies file if needed
  const cookiesInfo = await createCookiesFileIfNeeded();
  const cookieArgs = getCookieArgs(cookiesInfo.path);
  const proxyArgs = getProxyArgs();

  try {
    // Try multiple format selection strategies for better compatibility
    // First try audio-only formats, then fallback to video formats if needed
    const command = new Deno.Command("yt-dlp", {
      args: [
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best[ext=m4a]/bestaudio[acodec!=none]/bestaudio/best[acodec!=none][height<=720]/best[height<=720]",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "192K",
        "--no-playlist",
        "--ignore-errors", // Continue even if some formats fail
        ...cookieArgs,
        ...proxyArgs,
        "-o",
        outputPath,
        url,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await command.output();
    const stderrText = decoder.decode(stderr).trim();

    // Check if output file exists first (yt-dlp may report errors for warnings)
    let fileExists = false;
    let actualOutputPath = outputPath;
    try {
      const stat = await Deno.stat(outputPath);
      fileExists = stat.isFile && stat.size > 0;
    } catch {
      // File doesn't exist at expected path, check if yt-dlp created a different filename
      const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
      try {
        for await (const entry of Deno.readDir(outputDir)) {
          if (entry.isFile && entry.name.includes(".mp3")) {
            const fullPath = `${outputDir}/${entry.name}`;
            const stat = await Deno.stat(fullPath);
            if (stat.size > 0) {
              actualOutputPath = fullPath;
              fileExists = true;
              break;
            }
          }
        }
      } catch {
        // Could not check directory
      }
    }

    // If file exists and has content, consider it successful even if yt-dlp reported failure
    // (this handles cases where warnings are written to stderr)
    if (fileExists) {
      // If file was found at a different path, move/rename it to expected path
      if (actualOutputPath !== outputPath) {
        await Deno.rename(actualOutputPath, outputPath);
      }
      return;
    }

    // If file doesn't exist and command failed, check if it's a format error
    if (!success) {
      const errorText = stderrText || "Unknown error";

      // Check if the error is about format availability
      if (errorText.includes("Requested format is not available")) {
        console.error(
          "Error: Requested audio format is not available for this video.",
        );
        console.error(
          "This may happen with age-restricted or region-restricted videos.",
        );
        console.error(
          "Try using cookies for authentication or check if the video is accessible.",
        );
        throw new Error(
          `YouTube format not available: The requested audio format could not be downloaded. ${
            errorText.substring(0, 200)
          }`,
        );
      }

      throw new Error(
        `Failed to download audio from YouTube: ${errorText.substring(0, 500)}`,
      );
    }

    // If command succeeded but file doesn't exist, that's also an error
    throw new Error(
      "YouTube audio download completed but output file was not found",
    );
  } finally {
    // Clean up temporary cookies file if we created one
    if (cookiesInfo.isTemporary && cookiesInfo.path) {
      try {
        await tempManager.cleanupFileAndDir(cookiesInfo.path);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
