import type {
  TranscriptionJob,
  TranscriptionJobResult,
} from "../api/transcription-job-types.ts";

export interface TranscriptionJobStore {
  create(job: TranscriptionJob): Promise<TranscriptionJob>;
  get(id: string): Promise<TranscriptionJob | null>;
  update(id: string, values: Partial<TranscriptionJob>): Promise<void>;
  claim(
    id: string,
    maxAttempts?: number,
    workerExecution?: string,
  ): Promise<TranscriptionJob | null>;
}

export class JobAlreadyExistsError extends Error {
  constructor(public readonly job: TranscriptionJob) {
    super(`Transcription job ${job.id} already exists`);
    this.name = "JobAlreadyExistsError";
  }
}

export interface TranscriptionResultStore {
  save(jobId: string, result: TranscriptionJobResult): Promise<string>;
  get(objectName: string): Promise<TranscriptionJobResult>;
}

export interface TranscriptionJobDispatcher {
  dispatch(jobId: string): Promise<string>;
}

export function canClaimTranscriptionJob(
  job: TranscriptionJob,
  maxAttempts: number,
  workerExecution: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (job.status === "succeeded" || job.attempts >= maxAttempts) return false;
  if (job.status !== "processing" || !job.startedAt) return true;

  // Cloud Run retries a crashed task inside the same execution. Let that retry
  // reclaim immediately, while duplicate executions must wait for lease expiry.
  if (workerExecution && job.workerExecution === workerExecution) return true;
  const leaseAgeMs = nowMs - Date.parse(job.startedAt);
  return !Number.isFinite(leaseAgeMs) || leaseAgeMs >= 2 * 60 * 60 * 1000;
}
