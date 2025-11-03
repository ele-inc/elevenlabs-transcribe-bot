#!/usr/bin/env -S deno run --allow-all

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { transcribeFile } from "./core/transcribe-core.ts";
import { TranscriptionOptions } from "./core/types.ts";
import { createTranscriptionHeader } from "./utils/utils.ts";
import { cloudServiceManager } from "./services/cloud-service-manager.ts";

interface CliOptions extends TranscriptionOptions {
  output?: string;
  format: "text" | "json";
  noSave?: boolean;
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
  };

  // Parse speaker count
  const speakerIndex = args.indexOf("--num-speakers");
  if (speakerIndex !== -1 && args[speakerIndex + 1]) {
    const num = parseInt(args[speakerIndex + 1], 10);
    if (!isNaN(num) && num > 0) {
      options.numSpeakers = num;
    }
  }

  // Parse speaker names
  const speakerNamesIndex = args.indexOf("--speaker-names");
  if (speakerNamesIndex !== -1 && args[speakerNamesIndex + 1]) {
    options.speakerNames = args[speakerNamesIndex + 1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
 * Print help message
 */
function printHelp(): void {
  console.log(`
ElevenLabs Transcription CLI

Usage: deno run --allow-all src/cli.ts [options] <file>

Arguments:
  <file>                Path to audio/video file to transcribe, or supported URL (Google Drive/Dropbox/YouTube)

Options:
  -h, --help           Show this help message
  -o, --output <file>  Output file path (default: transcripts/<filename>_<timestamp>.txt)
  -f, --format <type>  Output format: text or json (default: text)
  --no-save            Output to stdout instead of saving to file

Transcription Options:
  --no-diarize         Disable speaker identification (default: enabled)
  --num-speakers <n>   Number of speakers (default: auto-detect)
  --speaker-names <names>  Comma-separated speaker names
                           Example: --speaker-names "Alice,Bob,Charlie"
  --no-timestamp       Disable timestamps in output
  --no-audio-events    Disable audio event tagging

Examples:
  # Basic transcription to stdout
  deno run --allow-all src/cli.ts audio.mp3

  # Save to file with speaker names
  deno run --allow-all src/cli.ts -o transcript.txt --speaker-names "Alice,Bob" meeting.mp4

  # JSON output without timestamps
  deno run --allow-all src/cli.ts -f json --no-timestamp audio.m4a

  # Disable speaker diarization
  deno run --allow-all src/cli.ts --no-diarize recording.wav

  # Transcribe from a supported URL (Dropbox / Google Drive / YouTube)
  deno run --allow-all src/cli.ts "https://www.youtube.com/watch?v=xxxxxxx" --speaker-names "Alice,Bob"

Note: Video files (mp4, mkv, mov, etc.) will be automatically converted to audio before transcription.
`);
}

/**
 * Main function
 */
async function main() {
  try {
    const { filePath, options } = parseArgs();

    let actualFilePath = filePath;
    let tempFilePath: string | undefined;
    let filename = filePath;

    // Check if input is a URL (specifically a supported cloud URL)
    if (cloudServiceManager.isSupportedUrl(filePath)) {
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
      console.log(`File downloaded successfully: ${filename}`);
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
      console.error(
        "Error: ELEVENLABS_API_KEY not found in environment variables",
      );
      console.error(
        "Please ensure .env file exists and contains ELEVENLABS_API_KEY",
      );
      Deno.exit(1);
    }

    console.log(`Transcribing: ${filename}`);
    console.log("Options:", {
      diarize: options.diarize,
      numSpeakers: options.numSpeakers,
      speakerNames: options.speakerNames,
      showTimestamp: options.showTimestamp,
      tagAudioEvents: options.tagAudioEvents,
      format: options.format,
    });

    // Perform transcription
    const result = await transcribeFile(actualFilePath, options);

    if (!result.transcript) {
      console.error("Error: No transcript was generated");
      Deno.exit(1);
    }

    // Add filename header to transcript
    const baseFilename = filename.split("/").pop() || filename;
    const finalTranscript = createTranscriptionHeader(baseFilename) +
      result.transcript;

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
      outputPath =
        `${transcriptsDir}/${cleanedFilename}_${timestamp}.${extension}`;

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
