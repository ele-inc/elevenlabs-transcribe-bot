import type {
  TranscriptionJob,
  TranscriptionJobResult,
} from "../api/transcription-job-types.ts";
import { TRANSCRIPTION_LEASE_TTL_MS } from "./transcription-job-settings.ts";

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
    super(`文字起こしジョブ ${job.id} はすでに存在します`);
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

/** 現在の実行がジョブを安全に取得できるかを判定する。 */
export function canClaimTranscriptionJob(
  job: TranscriptionJob,
  maxAttempts: number,
  workerExecution: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (job.status === "succeeded" || job.attempts >= maxAttempts) return false;
  if (job.status !== "processing" || !job.startedAt) return true;

  // 同じ Cloud Run 実行内の再試行はすぐ再取得できるようにし、
  // 別実行による重複処理はリースが切れるまで待たせる。
  if (workerExecution && job.workerExecution === workerExecution) return true;
  const leaseAgeMs = nowMs - Date.parse(job.startedAt);
  return !Number.isFinite(leaseAgeMs) ||
    leaseAgeMs >= TRANSCRIPTION_LEASE_TTL_MS;
}
