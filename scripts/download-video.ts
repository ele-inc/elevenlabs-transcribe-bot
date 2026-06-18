#!/usr/bin/env -S deno run --allow-all

import { load } from "@std/dotenv";
import { dirname, extname, fromFileUrl, join, resolve } from "@std/path";
import {
  downloadDropboxFileToPath,
  getDropboxFileMetadata,
  isDropboxUrl,
  toDropboxDirectUrl,
} from "../src/clients/dropbox.ts";
import {
  downloadGoogleDriveFileToPath,
  getGoogleDriveFileMetadata,
  isGoogleDriveUrl,
  parseGoogleDriveUrl,
} from "../src/clients/googledrive.ts";
import {
  downloadHlsVideoToPath,
  getHlsVideoMetadata,
  isHlsUrl,
} from "../src/clients/hls.ts";
import {
  downloadUtageVideoToPath,
  getUtageVideoMetadata,
  isUtageUrl,
} from "../src/clients/utage.ts";
import {
  downloadVimeoReviewVideoToPath,
  getVimeoReviewVideoMetadata,
  isVimeoReviewUrl,
} from "../src/clients/vimeo-review.ts";
import {
  downloadYouTubeVideoToPath,
  extractYouTubeVideoId,
  getYouTubeVideoMetadata,
  isYouTubeUrl,
} from "../src/clients/youtube.ts";
import { CloudFileMetadata } from "../src/services/cloud-service.ts";

interface CliOptions {
  url: string;
  output?: string;
  dir: string;
  force: boolean;
  password?: string;
}

interface DownloadPlan {
  serviceName: string;
  metadata: CloudFileMetadata;
  download: (outputPath: string) => Promise<void>;
}

const VIDEO_EXTENSIONS = new Set([
  ".3gp",
  ".avi",
  ".flv",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
  ".wmv",
]);

const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
]);

function projectRoot(): string {
  return dirname(dirname(fromFileUrl(import.meta.url)));
}

function userConfigEnvPath(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  return join(home, ".config", "scribe", ".env");
}

async function loadEnvFromKnownLocations(): Promise<void> {
  const candidates = [
    join(Deno.cwd(), ".env"),
    join(projectRoot(), ".env"),
    userConfigEnvPath(),
  ];

  for (const path of candidates) {
    try {
      await Deno.stat(path);
      await load({ envPath: path, export: true });
    } catch {
      // try next candidate
    }
  }
}

function printHelp(): void {
  const scriptPath = join(projectRoot(), "scripts/download-video.ts");
  const configPath = join(projectRoot(), "src/deno.json");

  console.log(`
Video Download CLI

Usage:
  dlvideo <url> [options]
  deno run --allow-all --config ${configPath} ${scriptPath} <url> [options]

Options:
  -h, --help             Show this help
  -o, --output <file>    Output file path. If no extension is given, .mp4 is added.
  --dir <dir>            Output directory (default: current directory)
  --force                Overwrite the output file if it exists
  --password <value>     Video password for yt-dlp sources such as private Vimeo/Zoom

Supported sources:
  Utage video pages
  Vimeo Review pages
  YouTube / Loom / regular Vimeo / Zoom recording URLs via yt-dlp
  Direct HLS .m3u8 URLs
  Google Drive and Dropbox video files

Examples:
  dlvideo 'https://example.utage-system.com/video/xxxxx'
  dlvideo 'https://vimeo.com/xxxxx' --password 'secret' -o video.mp4
  dlvideo 'https://us02web.zoom.us/rec/share/xxxxx' --password 'secret' -o zoom.mp4
  dlvideo 'https://vimeo.com/reviews/xxxxx/videos/123456789' --password 'secret'
  dlvideo 'https://example.com/video.m3u8' --dir ~/Downloads
`);
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    Deno.exit(0);
  }

  let url = "";
  let output: string | undefined;
  let dir = Deno.cwd();
  let force = false;
  let password: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-o" || arg === "--output") {
      output = readOptionValue(args, i, arg);
      i++;
      continue;
    }

    if (arg === "--dir") {
      dir = readOptionValue(args, i, arg);
      i++;
      continue;
    }

    if (arg === "--password") {
      password = readOptionValue(args, i, arg);
      i++;
      continue;
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (url) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    url = arg;
  }

  if (!url) {
    throw new Error("URL is required");
  }

  return { url, output, dir, force, password };
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  return sanitized || "video.mp4";
}

function filenameWithExtension(
  filename: string,
  fallbackExtension = ".mp4",
): string {
  const extension = extname(filename);
  return extension ? filename : `${filename}${fallbackExtension}`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveOutputPath(
  metadata: CloudFileMetadata,
  options: CliOptions,
): Promise<string> {
  const metadataFilename = filenameWithExtension(
    sanitizeFilename(metadata.filename),
    ".mp4",
  );
  let outputPath = options.output
    ? resolve(options.output)
    : resolve(options.dir, metadataFilename);

  if (options.output && await isDirectory(outputPath)) {
    outputPath = join(outputPath, metadataFilename);
  }

  outputPath = filenameWithExtension(
    outputPath,
    extname(metadataFilename) || ".mp4",
  );

  if (options.force) {
    return outputPath;
  }

  if (!await exists(outputPath)) {
    return outputPath;
  }

  const extension = extname(outputPath);
  const stem = extension ? outputPath.slice(0, -extension.length) : outputPath;

  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem} (${i})${extension}`;
    if (!await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not find an available output path for ${outputPath}`);
}

function looksLikeVideo(metadata: CloudFileMetadata): boolean {
  const mimeType = metadata.mimeType.toLowerCase();
  const extension = extname(metadata.filename).toLowerCase();

  if (mimeType.startsWith("video/")) {
    return true;
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return true;
  }

  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
    return false;
  }

  return mimeType === "application/octet-stream" &&
    !mimeType.startsWith("audio/");
}

function assertVideo(metadata: CloudFileMetadata, serviceName: string): void {
  if (!looksLikeVideo(metadata)) {
    throw new Error(
      `${serviceName} file does not look like a video: ${metadata.filename} (${metadata.mimeType})`,
    );
  }
}

async function buildDownloadPlan(
  url: string,
  options: CliOptions,
): Promise<DownloadPlan> {
  if (isUtageUrl(url)) {
    return {
      serviceName: "Utage",
      metadata: await getUtageVideoMetadata(url),
      download: (outputPath) => downloadUtageVideoToPath(url, outputPath),
    };
  }

  if (isVimeoReviewUrl(url) && options.password) {
    return {
      serviceName: "Vimeo Review",
      metadata: await getYouTubeVideoMetadata(url, {
        password: options.password,
      }),
      download: (outputPath) =>
        downloadYouTubeVideoToPath(url, outputPath, {
          password: options.password,
        }),
    };
  }

  if (isVimeoReviewUrl(url)) {
    return {
      serviceName: "Vimeo Review",
      metadata: await getVimeoReviewVideoMetadata(url),
      download: (outputPath) => downloadVimeoReviewVideoToPath(url, outputPath),
    };
  }

  if (isYouTubeUrl(url)) {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      throw new Error(
        "Could not extract video ID from YouTube/Loom/Vimeo/Zoom URL",
      );
    }

    return {
      serviceName: "YouTube/Loom/Vimeo/Zoom",
      metadata: await getYouTubeVideoMetadata(videoId, {
        password: options.password,
      }),
      download: (outputPath) =>
        downloadYouTubeVideoToPath(videoId, outputPath, {
          password: options.password,
        }),
    };
  }

  if (isGoogleDriveUrl(url)) {
    const fileId = parseGoogleDriveUrl(url);
    if (!fileId) {
      throw new Error("Could not extract file ID from Google Drive URL");
    }

    const driveMetadata = await getGoogleDriveFileMetadata(fileId);
    const metadata = {
      id: fileId,
      filename: driveMetadata.name,
      mimeType: driveMetadata.mimeType,
      size: driveMetadata.size ? parseInt(driveMetadata.size, 10) : undefined,
    };
    assertVideo(metadata, "Google Drive");

    return {
      serviceName: "Google Drive",
      metadata,
      download: async (outputPath) => {
        const downloaded = await downloadGoogleDriveFileToPath(
          fileId,
          outputPath,
        );
        if (!downloaded) {
          throw new Error(
            "Google Drive file was skipped because it is not media",
          );
        }
      },
    };
  }

  if (isDropboxUrl(url)) {
    const directUrl = toDropboxDirectUrl(url);
    if (!directUrl) {
      throw new Error("Could not convert Dropbox URL to direct download URL");
    }

    const dropboxMetadata = await getDropboxFileMetadata(directUrl);
    const metadata = {
      id: directUrl,
      filename: dropboxMetadata.name,
      mimeType: dropboxMetadata.mimeType,
      size: dropboxMetadata.size,
    };
    assertVideo(metadata, "Dropbox");

    return {
      serviceName: "Dropbox",
      metadata,
      download: async (outputPath) => {
        const downloaded = await downloadDropboxFileToPath(
          directUrl,
          outputPath,
        );
        if (!downloaded) {
          throw new Error("Dropbox file was skipped because it is not media");
        }
      },
    };
  }

  if (isHlsUrl(url)) {
    return {
      serviceName: "HLS",
      metadata: await getHlsVideoMetadata(url),
      download: (outputPath) => downloadHlsVideoToPath(url, outputPath),
    };
  }

  throw new Error("Unsupported URL. Run with --help to see supported sources.");
}

async function verifyOutputFile(path: string): Promise<number> {
  const stat = await Deno.stat(path);
  if (!stat.isFile || stat.size <= 0) {
    throw new Error(`Output file is empty: ${path}`);
  }
  return stat.size;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

async function main(): Promise<void> {
  try {
    await loadEnvFromKnownLocations();

    const options = parseArgs(Deno.args);
    const plan = await buildDownloadPlan(options.url, options);
    const outputPath = await resolveOutputPath(plan.metadata, options);

    await Deno.mkdir(dirname(outputPath), { recursive: true });

    console.log(`Source: ${plan.serviceName}`);
    console.log(`Title: ${plan.metadata.filename}`);
    console.log(`Output: ${outputPath}`);
    console.log("Downloading video...");

    await plan.download(outputPath);

    const size = await verifyOutputFile(outputPath);
    console.log(`Done: ${outputPath} (${formatBytes(size)})`);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
