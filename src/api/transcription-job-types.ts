import type { TranscriptionOptions, WordItem } from "../core/types.ts";
import type { TranscriptionTimings } from "../core/transcribe-core.ts";

export type TranscriptionJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export interface TranscriptionJob {
  id: string;
  status: TranscriptionJobStatus;
  sourceUrl: string;
  options: TranscriptionOptions;
  requestFingerprint: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  attempts: number;
  dispatchOperationName?: string;
  workerExecution?: string;
  filename?: string;
  mimeType?: string;
  languageCode?: string | null;
  resultObject?: string;
  error?: string;
}

export interface TranscriptionJobResult {
  jobId: string;
  transcript: string;
  languageCode: string | null;
  words?: WordItem[];
  timings: TranscriptionTimings;
  summary?: string;
}

export interface CreateTranscriptionJobRequest {
  sourceUrl: string;
  options: TranscriptionOptions;
}
