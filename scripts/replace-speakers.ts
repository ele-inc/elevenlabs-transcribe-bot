#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { identifySpeakers, replaceSpeakerLabels } from "../src/clients/gemini-client.ts";

async function main() {
  const args = Deno.args;

  if (args.length < 2) {
    console.error("Usage: replace-speakers.ts <input-file> <speaker1,speaker2,...> [output-file]");
    console.error("Example: replace-speakers.ts transcript.txt 'John,Jane,Bob' output.txt");
    console.error("If output-file is not specified, the result will be printed to stdout");
    Deno.exit(1);
  }

  const inputFile = args[0];
  const speakersArg = args[1];
  const outputFile = args[2] || null;

  const speakerNames = speakersArg.split(",").map(s => s.trim()).filter(s => s.length > 0);

  if (speakerNames.length === 0) {
    console.error("Error: No speaker names provided");
    Deno.exit(1);
  }

  try {
    const transcript = await Deno.readTextFile(inputFile);

    console.error(`Identifying speakers in ${inputFile}...`);
    console.error(`Speaker candidates: ${speakerNames.join(", ")}`);

    const speakerMapping = await identifySpeakers(transcript, speakerNames);

    console.error("Speaker mapping:");
    for (const [label, name] of speakerMapping) {
      console.error(`  ${label} -> ${name}`);
    }

    const result = replaceSpeakerLabels(transcript, speakerMapping);

    if (outputFile) {
      await Deno.writeTextFile(outputFile, result);
      console.error(`\nOutput written to ${outputFile}`);
    } else {
      console.log(result);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}