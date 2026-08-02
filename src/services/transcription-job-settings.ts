/** Cloud Run Job の1回の実行に許可する最大秒数。 */
export const TRANSCRIPTION_WORKER_TIMEOUT_SECONDS = 7_200;

/**
 * 別実行によるジョブの再取得を待つ時間。
 * Cloud Run Job の実行上限と同じ値を保つ。
 */
export const TRANSCRIPTION_LEASE_TTL_MS = TRANSCRIPTION_WORKER_TIMEOUT_SECONDS *
  1_000;
