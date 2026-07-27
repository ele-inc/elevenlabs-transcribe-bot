import type { PlatformAdapter } from "../adapters/platform-adapter.ts";
import { summarizeTranscript } from "../clients/gemini-client.ts";
import type { TranscriptionOptions } from "../core/types.ts";
import { createTranscriptionHeader } from "../utils/utils.ts";
import { elapsedMs } from "../utils/performance.ts";

export async function deliverTranscriptionResult({
  transcript,
  filename,
  sourceUrl,
  options,
  adapter,
}: {
  transcript: string;
  filename?: string;
  sourceUrl?: string;
  options: TranscriptionOptions;
  adapter: PlatformAdapter;
}): Promise<{ transcriptUploadMs: number; summaryMs: number }> {
  if (!transcript) {
    await adapter.sendErrorMessage(
      "文字起こしの生成に失敗しました。もう一度お試しください。",
    );
    return { transcriptUploadMs: 0, summaryMs: 0 };
  }

  const finalTranscript = sourceUrl || filename
    ? createTranscriptionHeader(filename, sourceUrl) + transcript
    : transcript;

  const uploadStartedAt = performance.now();
  await adapter.uploadTranscript(finalTranscript, filename);
  const transcriptUploadMs = elapsedMs(uploadStartedAt);

  let summaryMs = 0;
  if (options.summarize !== false) {
    const summaryStartedAt = performance.now();
    try {
      const summary = await summarizeTranscript(finalTranscript);
      await adapter.sendSummary(summary, { filename, options });
    } catch (error) {
      console.error("Failed to generate or send transcript summary:", error);
    } finally {
      summaryMs = elapsedMs(summaryStartedAt);
    }
  } else {
    console.log("Summary generation skipped by --no-summarize option");
  }

  return { transcriptUploadMs, summaryMs };
}
