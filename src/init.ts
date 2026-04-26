import { dirname } from "@std/path";

async function readLine(): Promise<string> {
  const buf = new Uint8Array(4096);
  const n = await Deno.stdin.read(buf);
  if (n === null) return "";
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

async function ask(question: string): Promise<string> {
  await Deno.stdout.write(new TextEncoder().encode(question));
  return await readLine();
}

async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} [y/N]: `)).toLowerCase();
  return answer === "y" || answer === "yes";
}

function escapeEnvValue(value: string): string {
  if (/[\s"'\\$`]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export async function runInit(envPath: string): Promise<void> {
  console.log("transcribe-bot init — configure API keys\n");

  try {
    await Deno.stat(envPath);
    if (!(await confirm(`Config already exists at ${envPath}. Overwrite?`))) {
      console.log("Aborted. Existing config left untouched.");
      return;
    }
  } catch {
    // file does not exist — proceed
  }

  const elevenlabs = await ask("ElevenLabs API key (required): ");
  if (!elevenlabs) {
    console.error("Error: ElevenLabs API key is required.");
    Deno.exit(1);
  }

  const openai = await ask(
    "OpenAI API key (optional, used for --speaker-names): ",
  );

  const lines = [
    `ELEVENLABS_API_KEY=${escapeEnvValue(elevenlabs)}`,
  ];
  if (openai) lines.push(`OPENAI_API_KEY=${escapeEnvValue(openai)}`);

  await Deno.mkdir(dirname(envPath), { recursive: true });
  await Deno.writeTextFile(envPath, lines.join("\n") + "\n");

  if (Deno.build.os !== "windows") {
    await Deno.chmod(envPath, 0o600);
  }

  console.log(`\nConfig saved to ${envPath}`);
  console.log("You can now run: transcribe-bot <url-or-file>");
}
