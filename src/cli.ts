#!/usr/bin/env -S deno run --allow-all

import { load } from "@std/dotenv";
import { basename, join } from "@std/path";
import { transcribeFile } from "./core/transcribe-core.ts";
import { TranscriptionOptions } from "./core/types.ts";
import { createTranscriptionHeader } from "./utils/utils.ts";
import { cloudServiceManager } from "./services/cloud-service-manager.ts";
import { cloudServiceRegistry } from "./services/cloud-service.ts";
import { runInit } from "./init.ts";

function userConfigEnvPath(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  return join(home, ".config", "scribe", ".env");
}

async function loadEnvFromKnownLocations(): Promise<void> {
  if (Deno.env.get("ELEVENLABS_API_KEY")) return;

  const candidates = [join(Deno.cwd(), ".env"), userConfigEnvPath()];
  for (const path of candidates) {
    try {
      await Deno.stat(path);
      await load({ envPath: path, export: true });
      return;
    } catch {
      // try next candidate
    }
  }
}

async function copyToClipboard(content: string): Promise<void> {
  const candidates: Array<{ cmd: string; args: string[] }> = Deno.build.os ===
      "darwin"
    ? [{ cmd: "pbcopy", args: [] }]
    : Deno.build.os === "windows"
    ? [{ cmd: "clip.exe", args: [] }, { cmd: "clip", args: [] }]
    : [
      { cmd: "wl-copy", args: [] },
      { cmd: "xclip", args: ["-selection", "clipboard"] },
      { cmd: "xsel", args: ["--clipboard", "--input"] },
    ];

  for (const { cmd, args } of candidates) {
    try {
      const proc = new Deno.Command(cmd, { args, stdin: "piped" }).spawn();
      const writer = proc.stdin.getWriter();
      await writer.write(new TextEncoder().encode(content));
      await writer.close();
      const { success } = await proc.output();
      if (success) {
        console.log("\n📋 Transcript copied to clipboard!");
        return;
      }
    } catch {
      // try next candidate
    }
  }
}

interface CliOptions extends TranscriptionOptions {
  output?: string;
  format: "text" | "json";
  noSave?: boolean;
  summarize?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { filePath: string; options: CliOptions } {
  const args = Deno.args;

  // Show help if no arguments or help flag
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    Deno.exit(0);
  }

  // Find the file path (first non-flag argument)
  const filePath = args.find((arg) => !arg.startsWith("-")) || "";
  if (!filePath) {
    console.error("Error: File path is required");
    printHelp();
    Deno.exit(1);
  }

  // Parse options
  const options: CliOptions = {
    diarize: !args.includes("--no-diarize"),
    showTimestamp: !args.includes("--no-timestamp"),
    tagAudioEvents: !args.includes("--no-audio-events"),
    format: "text",
    noSave: args.includes("--no-save"),
    summarize: !args.includes("--no-summarize"),
  };

  // Parse speaker names first (takes priority for determining numSpeakers)
  const speakerNamesIndex = args.indexOf("--speaker-names");
  if (speakerNamesIndex !== -1 && args[speakerNamesIndex + 1]) {
    options.speakerNames = args[speakerNamesIndex + 1]
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Determine numSpeakers: speakerNames takes priority if provided
  if (options.speakerNames && options.speakerNames.length > 0) {
    options.numSpeakers = options.speakerNames.length;
  } else {
    // Parse speaker count only if speaker names are not provided
    const speakerIndex = args.indexOf("--num-speakers");
    if (speakerIndex !== -1 && args[speakerIndex + 1]) {
      const num = parseInt(args[speakerIndex + 1], 10);
      if (!isNaN(num) && num > 0) {
        options.numSpeakers = num;
      }
    }
  }

  // Parse output file
  const outputIndex = args.indexOf("--output");
  const outputShortIndex = args.indexOf("-o");
  const outIndex = outputIndex !== -1 ? outputIndex : outputShortIndex;
  if (outIndex !== -1 && args[outIndex + 1]) {
    options.output = args[outIndex + 1];
  }

  // Parse format
  const formatIndex = args.indexOf("--format");
  const formatShortIndex = args.indexOf("-f");
  const fmtIndex = formatIndex !== -1 ? formatIndex : formatShortIndex;
  if (fmtIndex !== -1 && args[fmtIndex + 1]) {
    const format = args[fmtIndex + 1].toLowerCase();
    if (format === "json" || format === "text") {
      options.format = format;
    }
  }

  return { filePath, options };
}

/**
 * Build a "Supported sources" section by reading from the registry.
 * Adapters that set `description` are listed; URL examples come from
 * `urlExamples`. New adapters appear automatically without touching cli.ts.
 */
function buildSupportedSourcesSection(): string {
  const services = cloudServiceRegistry.getAllServices()
    .filter((s) => s.description);
  if (services.length === 0) return "";

  const lines = ["Supported URL sources:"];
  for (const s of services) {
    lines.push(`  ${s.name}`);
    lines.push(`    ${s.description}`);
    if (s.urlExamples?.length) {
      for (const ex of s.urlExamples) {
        lines.push(`    e.g. ${ex}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
ElevenLabs Transcription CLI

Usage: scribe [options] <file-or-url>
       scribe init
       scribe list-sources

Subcommands:
  init                 Interactively set API keys (saved to ~/.config/scribe/.env)
  list-sources         Print supported URL sources and exit

Arguments:
  <file-or-url>        Path to a local audio/video file, or a URL from one of
                       the supported sources (run \`scribe list-sources\` to see all).

Options:
  -h, --help           Show this help message
  -o, --output <file>  Output file path (default: transcripts/<filename>_<timestamp>.txt)
  -f, --format <type>  Output format: text or json (default: text)
  --no-save            Output to stdout instead of saving to file
  --no-summarize       Skip generating a summary after transcription

Transcription Options:
  --no-diarize         Disable speaker identification (default: enabled)
  --speaker-names <names>  Comma-separated speaker names (auto-sets speaker count).
                           Names are matched to speaker_N labels via Gemini.
                           Example: --speaker-names "Alice,Bob,Charlie"
  --num-speakers <n>   Number of speakers (only used if --speaker-names not provided)
  --no-timestamp       Disable timestamps in output
  --no-audio-events    Disable audio event tagging

Examples:
  # Local file → transcripts/<name>_<timestamp>.txt
  scribe meeting.mp4

  # Save to specific path with speaker names (Gemini maps speaker_N → real name)
  scribe interview.mp4 --speaker-names "Alice,Bob" -o ./out.txt

  # Stdout (no file save), JSON, no timestamps
  scribe audio.m4a --no-save -f json --no-timestamp

  # Single speaker — disable diarization for cleaner output
  scribe monologue.wav --no-diarize

  # YouTube / Loom / Google Drive / Dropbox / Vimeo / Utage / HLS URL
  scribe 'https://youtu.be/<VIDEO_ID>' --speaker-names "Host,Guest"

${buildSupportedSourcesSection()}Note: Video files (mp4, mkv, mov, etc.) are automatically converted to audio
      before transcription via ffmpeg.
`);
}

/**
 * Print supported sources for `scribe list-sources`.
 */
function printSources(): void {
  const section = buildSupportedSourcesSection();
  if (section) {
    console.log(section.trimEnd());
  } else {
    console.log("No URL sources are registered.");
  }
}

/**
 * Main function
 */
async function main() {
  if (Deno.args[0] === "init") {
    await runInit(userConfigEnvPath());
    return;
  }

  if (Deno.args[0] === "list-sources") {
    printSources();
    return;
  }

  await loadEnvFromKnownLocations();

  let tempFilePath: string | undefined;

  try {
    const { filePath, options } = parseArgs();

    let actualFilePath = filePath;
    let filename = filePath;
    let mimeType: string | undefined;
    let sourceUrl: string | undefined;

    // Check if input is a URL (specifically a supported cloud URL)
    if (cloudServiceManager.isSupportedUrl(filePath)) {
      sourceUrl = filePath;
      console.log(`Detected supported cloud URL: ${filePath}`);
      console.log("Downloading file...");

      const downloadResult = await cloudServiceManager.downloadFromUrl(
        filePath,
      );

      if (!downloadResult.success) {
        console.error(`Error downloading file: ${downloadResult.error}`);
        Deno.exit(1);
      }

      if (!downloadResult.tempPath || !downloadResult.metadata) {
        console.error(
          "Error: Download succeeded but no file path or metadata returned",
        );
        Deno.exit(1);
      }

      actualFilePath = downloadResult.tempPath;
      tempFilePath = downloadResult.tempPath;
      filename = downloadResult.metadata.filename;
      mimeType = downloadResult.metadata.mimeType;
      console.log(`File downloaded successfully: ${filename} (${mimeType})`);
    } else {
      // Check if local file exists
      try {
        await Deno.stat(filePath);
      } catch {
        console.error(`Error: File not found: ${filePath}`);
        Deno.exit(1);
      }
    }

    // Check if API key is loaded
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      console.error("Error: ELEVENLABS_API_KEY not found.");
      console.error("Run `scribe init` to configure API keys.");
      Deno.exit(1);
    }

    console.log(`Transcribing: ${filename}`);
    console.log("Options:", {
      diarize: options.diarize,
      numSpeakers: options.numSpeakers,
      speakerNames: options.speakerNames,
      showTimestamp: options.showTimestamp,
      tagAudioEvents: options.tagAudioEvents,
      summarize: options.summarize,
      format: options.format,
    });

    // Perform transcription (pass mimeType if available from cloud service)
    const result = await transcribeFile(actualFilePath, options, mimeType);

    if (!result.transcript) {
      console.error("Error: No transcript was generated");
      Deno.exit(1);
    }

    // Add header to transcript: URL takes precedence over filename when present
    const baseFilename = basename(filename);
    const finalTranscript =
      createTranscriptionHeader(baseFilename, sourceUrl) + result.transcript;

    // Determine output path
    let outputPath = options.output;

    // If no output specified and not --no-save, create default output path
    if (!outputPath && !options.noSave) {
      // Create transcripts directory if it doesn't exist
      const transcriptsDir = "transcripts";
      try {
        await Deno.mkdir(transcriptsDir, { recursive: true });
      } catch {
        // Directory might already exist
      }

      // Generate timestamp for filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(
        0,
        -5,
      );
      const cleanedFilename = baseFilename.replace(/\.[^/.]+$/, ""); // Remove extension
      const extension = options.format === "json" ? "json" : "txt";
      outputPath = join(
        transcriptsDir,
        `${cleanedFilename}_${timestamp}.${extension}`,
      );

      // Check if a file with the same name already exists (shouldn't happen, but let's be safe)
      try {
        const existingStat = await Deno.stat(outputPath);
        if (existingStat.isFile) {
          console.warn(`Warning: Output file already exists: ${outputPath}`);
        }
      } catch {
        // File doesn't exist yet, which is expected
      }
    }

    // Output result
    if (options.format === "json") {
      const jsonOutput = {
        file: baseFilename,
        transcript: finalTranscript,
        languageCode: result.languageCode,
        ...(result.words ? { words: result.words } : {}),
      };

      const jsonString = JSON.stringify(jsonOutput, null, 2);

      if (outputPath) {
        await Deno.writeTextFile(outputPath, jsonString);
        console.log(`\nTranscription saved to: ${outputPath}`);
      } else {
        console.log(jsonString);
      }
    } else {
      // Text format
      if (outputPath) {
        await Deno.writeTextFile(outputPath, finalTranscript);
        console.log(`\nTranscription saved to: ${outputPath}`);
      } else {
        console.log("\n" + finalTranscript);
      }
    }

    // Copy transcript text to clipboard
    const clipboardContent = options.format === "json"
      ? JSON.stringify(
          {
            file: baseFilename,
            transcript: finalTranscript,
            languageCode: result.languageCode,
            ...(result.words ? { words: result.words } : {}),
          },
          null,
          2,
        )
      : finalTranscript;

    await copyToClipboard(clipboardContent);

    console.log("\nTranscription completed successfully!");

    // Clean up temporary files if they were downloaded
    if (tempFilePath) {
      console.log("Cleaning up temporary files...");
      try {
        await cloudServiceManager.cleanup();
      } catch (cleanupError) {
        console.warn(
          "Warning: Failed to clean up temporary files:",
          cleanupError,
        );
      }
    }
  } catch (error) {
    console.error(
      "Error during transcription:",
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }

    // Clean up temporary files even on error
    if (tempFilePath) {
      try {
        await cloudServiceManager.cleanup();
      } catch (cleanupError) {
        console.warn(
          "Warning: Failed to clean up temporary files:",
          cleanupError,
        );
      }
    }

    Deno.exit(1);
  }
}

// Run main function
if (import.meta.main) {
  main();
}
