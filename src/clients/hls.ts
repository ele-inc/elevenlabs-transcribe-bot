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
): Promise<CloudFileMetadata> {
  await ensureFfmpegAvailable();
  const filename = deriveFilename(streamUrl);
  const duration = await probeDuration(streamUrl);

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
): Promise<void> {
  await ensureFfmpegAvailable();

  const command = new Deno.Command("ffmpeg", {
    args: [
      "-y",
      "-i",
      streamUrl,
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

  try {
    const stat = await Deno.stat(outputPath);
    if (!stat.isFile || stat.size === 0) {
      throw new Error("Output file is empty after ffmpeg conversion");
    }
  } catch (error) {
    throw new Error(
      `HLS audio output verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
