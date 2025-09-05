#!/usr/bin/env -S deno run --allow-all

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { transcribeGoogleDriveStream, transcribeLocalFileStream } from "./transcribe-stream.ts";
import { TranscriptionOptions } from "./types.ts";
import { createTranscriptionHeader } from "./utils.ts";

interface CliOptions extends TranscriptionOptions {
  output?: string;
  format: "text" | "json";
  noSave?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { input: string; options: CliOptions } {
  const args = Deno.args;
  
  // Show help if no arguments or help flag
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    Deno.exit(0);
  }

  // Find the input (file path or Google Drive URL)
  const input = args.find((arg) => !arg.startsWith("-")) || "";
  if (!input) {
    console.error("Error: File path or Google Drive URL is required");
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
      .map(s => s.trim())
      .filter(s => s.length > 0);
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

  return { input, options };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
ElevenLabs Transcription CLI
================================================
Memory-efficient streaming processing for large files!

Usage: deno run --allow-all src/cli.ts [options] <input>

Arguments:
  <input>              Path to audio/video file OR Google Drive URL

Supported Inputs:
  - Local files:       audio.mp3, video.mp4, etc.
  - Google Drive URLs: https://drive.google.com/file/d/xxx/view

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
  # Transcribe local video file (streaming conversion)
  deno run --allow-all src/cli.ts video.mp4

  # Transcribe Google Drive video (no download to disk!)
  deno run --allow-all src/cli.ts "https://drive.google.com/file/d/xxx/view"

  # Save with speaker names
  deno run --allow-all src/cli.ts -o transcript.txt --speaker-names "Alice,Bob" meeting.mp4

  # JSON output from Google Drive
  deno run --allow-all src/cli.ts -f json "https://drive.google.com/file/d/xxx/view"

Benefits:
  ✅ No temporary files created for video conversion
  ✅ Streams directly from Google Drive without downloading
  ✅ Memory efficient - processes in chunks
  ✅ Faster - starts processing before download completes
`);
}

/**
 * Check if input is a Google Drive URL
 */
function isGoogleDriveUrl(input: string): boolean {
  return input.includes("drive.google.com") || input.includes("docs.google.com");
}

/**
 * Main function
 */
async function main() {
  try {
    const { input, options } = parseArgs();

    // Check if API key is loaded
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      console.error("Error: ELEVENLABS_API_KEY not found in environment variables");
      console.error("Please ensure .env file exists and contains ELEVENLABS_API_KEY");
      Deno.exit(1);
    }

    console.log(`🚀 Streaming Transcription Mode`);
    console.log(`Input: ${input}`);
    console.log("Options:", {
      diarize: options.diarize,
      numSpeakers: options.numSpeakers,
      speakerNames: options.speakerNames,
      showTimestamp: options.showTimestamp,
      tagAudioEvents: options.tagAudioEvents,
      format: options.format,
    });

    let result;
    let filename: string;

    if (isGoogleDriveUrl(input)) {
      console.log("📥 Streaming from Google Drive (no download to disk!)...");
      result = await transcribeGoogleDriveStream(input, options);
      filename = "google_drive_file";
    } else {
      // Check if local file exists
      try {
        await Deno.stat(input);
      } catch {
        console.error(`Error: File not found: ${input}`);
        Deno.exit(1);
      }
      
      console.log("📁 Processing local file with streaming...");
      result = await transcribeLocalFileStream(input, options);
      filename = input.split("/").pop() || input;
    }

    if (!result.transcript) {
      console.error("Error: No transcript was generated");
      Deno.exit(1);
    }

    // Add filename header to transcript
    const finalTranscript = createTranscriptionHeader(filename) + result.transcript;

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
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      const baseFilename = filename.replace(/\.[^/.]+$/, ""); // Remove extension
      const extension = options.format === "json" ? "json" : "txt";
      outputPath = `${transcriptsDir}/${baseFilename}_${timestamp}.${extension}`;
    }

    // Output result
    if (options.format === "json") {
      const jsonOutput = {
        file: filename,
        transcript: finalTranscript,
        languageCode: result.languageCode,
        ...(result.words ? { words: result.words } : {}),
      };
      
      const jsonString = JSON.stringify(jsonOutput, null, 2);
      
      if (outputPath) {
        await Deno.writeTextFile(outputPath, jsonString);
        console.log(`\n✅ Transcription saved to: ${outputPath}`);
      } else {
        console.log(jsonString);
      }
    } else {
      // Text format
      if (outputPath) {
        await Deno.writeTextFile(outputPath, finalTranscript);
        console.log(`\n✅ Transcription saved to: ${outputPath}`);
      } else {
        console.log("\n" + finalTranscript);
      }
    }

    console.log("\n🎉 Transcription completed successfully!");
    console.log("💡 Memory usage was minimized through streaming!");
  } catch (error) {
    console.error("❌ Error during transcription:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    Deno.exit(1);
  }
}

// Run main function
if (import.meta.main) {
  main();
}