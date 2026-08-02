import type {
  CreateTranscriptionJobRequest,
  TranscriptionJob,
} from "../api/transcription-job-types.ts";
import type { TranscriptionOptions } from "../core/types.ts";
import {
  JobAlreadyExistsError,
  type TranscriptionJobDispatcher,
  type TranscriptionJobStore,
  type TranscriptionResultStore,
} from "../services/transcription-job-contracts.ts";
import { jsonResponse } from "../utils/http-utils.ts";
import {
  AuthenticationError,
  getErrorMessage,
  handleHttpError,
} from "../utils/errors.ts";

interface CallerIdentityVerifier {
  verifyIdToken(options: { idToken: string }): Promise<{
    getPayload(): { email?: string; sub?: string } | undefined;
  }>;
}

export interface TranscriptionApiDependencies {
  jobs: TranscriptionJobStore;
  results: TranscriptionResultStore;
  dispatcher: TranscriptionJobDispatcher;
  isSupportedUrl: (url: string) => boolean;
  getCallerId: (req: Request) => Promise<string>;
}

type TranscriptionApiHandler = (req: Request) => Promise<Response>;

let defaultHandlerPromise: Promise<TranscriptionApiHandler> | null = null;

/** 永続化文字起こし API のリクエストを処理する。 */
export async function handleTranscriptionApi(req: Request): Promise<Response> {
  try {
    const handler = await getDefaultHandler();
    return await handler(req);
  } catch (error) {
    return handleUnexpectedError(error);
  }
}

async function getDefaultHandler(): Promise<TranscriptionApiHandler> {
  if (!defaultHandlerPromise) {
    defaultHandlerPromise = buildDefaultHandler().catch((error) => {
      defaultHandlerPromise = null;
      throw error;
    });
  }
  return await defaultHandlerPromise;
}

async function buildDefaultHandler(): Promise<TranscriptionApiHandler> {
  const [
    { FirestoreTranscriptionJobStore },
    { GcsTranscriptionResultStore },
    { CloudRunTranscriptionJobDispatcher },
    { cloudServiceManager },
    { OAuth2Client },
  ] = await Promise.all([
    import("../services/transcription-job-store.ts"),
    import("../services/transcription-result-store.ts"),
    import("../services/cloud-run-job-dispatcher.ts"),
    import("../services/cloud-service-manager.ts"),
    import("google-auth-library"),
  ]);
  const callerIdentityVerifier = new OAuth2Client();
  return createTranscriptionApiHandler({
    jobs: new FirestoreTranscriptionJobStore(),
    results: new GcsTranscriptionResultStore(),
    dispatcher: new CloudRunTranscriptionJobDispatcher(),
    isSupportedUrl: (url) => cloudServiceManager.isApiSourceUrlSupported(url),
    getCallerId: (req) => getGoogleCallerId(req, callerIdentityVerifier),
  });
}

/** 依存関係を差し替え可能な文字起こし API ハンドラーを生成する。 */
export function createTranscriptionApiHandler(
  dependencies: TranscriptionApiDependencies,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const pathname = new URL(req.url).pathname;

      if (pathname === "/v1/transcription-jobs" && req.method === "POST") {
        return await createJob(req, dependencies);
      }

      const match = pathname.match(
        /^\/v1\/transcription-jobs\/([a-zA-Z0-9_-]+)(?:\/(result|retry))?$/,
      );
      if (!match) return jsonResponse({ error: "見つかりません" }, 404);

      const [, jobId, action] = match;
      if (!action && req.method === "GET") {
        return await getJob(jobId, dependencies.jobs);
      }
      if (action === "result" && req.method === "GET") {
        return await getResult(jobId, dependencies);
      }
      if (action === "retry" && req.method === "POST") {
        return await retryJob(jobId, dependencies);
      }
      return jsonResponse({ error: "許可されていないメソッドです" }, 405, {
        Allow: action === "retry" ? "POST" : "GET",
      });
    } catch (error) {
      return handleUnexpectedError(error);
    }
  };
}

async function createJob(
  req: Request,
  dependencies: TranscriptionApiDependencies,
): Promise<Response> {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return jsonResponse({ error: "JSON のリクエスト本文が必要です" }, 400);
  }

  const parsed = parseCreateRequest(input, dependencies.isSupportedUrl);
  if (typeof parsed === "string") {
    return jsonResponse({ error: parsed }, 400);
  }

  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (idempotencyKey && idempotencyKey.length > 200) {
    return jsonResponse(
      { error: "Idempotency-Key は200文字以内にしてください" },
      400,
    );
  }

  const requestFingerprint = await sha256Hex(JSON.stringify(parsed));
  const callerId = idempotencyKey
    ? await dependencies.getCallerId(req)
    : undefined;
  const jobId = idempotencyKey
    ? `idem_${await sha256Hex(`${callerId}\0${idempotencyKey}`)}`
    : crypto.randomUUID();
  const now = new Date().toISOString();
  const candidate: TranscriptionJob = {
    id: jobId,
    status: "queued",
    sourceUrl: parsed.sourceUrl,
    options: parsed.options,
    requestFingerprint,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };

  let job = candidate;
  try {
    job = await dependencies.jobs.create(candidate);
  } catch (error) {
    if (!(error instanceof JobAlreadyExistsError)) throw error;
    job = error.job;
    if (job.requestFingerprint !== requestFingerprint) {
      return jsonResponse(
        { error: "同じ Idempotency-Key が別のリクエストで使用済みです" },
        409,
      );
    }
    if (
      job.status === "processing" || job.status === "succeeded" ||
      (job.status === "queued" && job.dispatchOperationName)
    ) {
      return jsonResponse(
        publicJob(job),
        job.status === "succeeded" ? 200 : 202,
        {
          "Cache-Control": "no-store",
        },
      );
    }
  }

  const dispatch = await requeueJob(
    job.id,
    dependencies,
    "文字起こしワーカーを開始できませんでした",
  );
  job = { ...job, ...dispatch };
  if (dispatch.status === "failed") {
    return jsonResponse(publicJob(job), 503);
  }

  return jsonResponse(publicJob(job), 202, {
    Location: `/v1/transcription-jobs/${job.id}`,
    "Cache-Control": "no-store",
  });
}

async function getJob(
  jobId: string,
  jobs: TranscriptionJobStore,
): Promise<Response> {
  const job = await jobs.get(jobId);
  if (!job) {
    return jsonResponse({ error: "文字起こしジョブが見つかりません" }, 404);
  }
  return jsonResponse(publicJob(job), 200, { "Cache-Control": "no-store" });
}

async function getResult(
  jobId: string,
  dependencies: TranscriptionApiDependencies,
): Promise<Response> {
  const job = await dependencies.jobs.get(jobId);
  if (!job) {
    return jsonResponse({ error: "文字起こしジョブが見つかりません" }, 404);
  }
  if (job.status === "failed") {
    return jsonResponse({ status: job.status, error: job.error }, 409, {
      "Cache-Control": "no-store",
    });
  }
  if (job.status !== "succeeded" || !job.resultObject) {
    return jsonResponse({ status: job.status }, 202, {
      "Cache-Control": "no-store",
      "Retry-After": "5",
    });
  }
  const result = await dependencies.results.get(job.resultObject);
  return jsonResponse(result, 200, { "Cache-Control": "private, no-store" });
}

async function retryJob(
  jobId: string,
  dependencies: TranscriptionApiDependencies,
): Promise<Response> {
  const job = await dependencies.jobs.get(jobId);
  if (!job) {
    return jsonResponse({ error: "文字起こしジョブが見つかりません" }, 404);
  }
  if (job.status !== "failed") {
    return jsonResponse(
      { error: "失敗した文字起こしジョブだけ再試行できます" },
      409,
    );
  }

  const dispatch = await requeueJob(
    jobId,
    dependencies,
    "文字起こしワーカーを再開できませんでした",
  );
  if (dispatch.status === "failed") {
    return jsonResponse({ error: dispatch.error }, 503);
  }
  return jsonResponse(publicJob({ ...job, ...dispatch }), 202, {
    Location: `/v1/transcription-jobs/${jobId}`,
    "Cache-Control": "no-store",
  });
}

type RequeueJobResult =
  | {
    status: "queued";
    attempts: 0;
    dispatchOperationName: string;
    startedAt: undefined;
    completedAt: undefined;
    workerExecution: undefined;
    error: undefined;
  }
  | {
    status: "failed";
    attempts: 0;
    dispatchOperationName: undefined;
    startedAt: undefined;
    completedAt: string;
    workerExecution: undefined;
    error: string;
  };

async function requeueJob(
  jobId: string,
  dependencies: TranscriptionApiDependencies,
  failureMessage: string,
): Promise<RequeueJobResult> {
  const reset = {
    status: "queued" as const,
    attempts: 0 as const,
    dispatchOperationName: undefined,
    startedAt: undefined,
    completedAt: undefined,
    workerExecution: undefined,
    error: undefined,
  };
  await dependencies.jobs.update(jobId, reset);

  try {
    const dispatchOperationName = await dependencies.dispatcher.dispatch(jobId);
    await dependencies.jobs.update(jobId, { dispatchOperationName });
    return { ...reset, dispatchOperationName };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = `${failureMessage}: ${getErrorMessage(error)}`;
    await dependencies.jobs.update(jobId, {
      status: "failed",
      error: message,
      completedAt,
    });
    return {
      ...reset,
      status: "failed",
      completedAt,
      error: message,
    };
  }
}

/** ジョブ作成リクエストを検証し、既定値を適用する。 */
export function parseCreateRequest(
  input: unknown,
  isSupportedUrl: (url: string) => boolean,
): CreateTranscriptionJobRequest | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "リクエスト本文は JSON オブジェクトにしてください";
  }
  const body = input as Record<string, unknown>;
  if (typeof body.sourceUrl !== "string" || !body.sourceUrl.trim()) {
    return "sourceUrl は必須です";
  }

  const sourceUrl = body.sourceUrl.trim();
  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== "https:") {
      return "sourceUrl は HTTPS にしてください";
    }
  } catch {
    return "sourceUrl は有効な URL にしてください";
  }
  if (sourceUrl.length > 8192) return "sourceUrl が長すぎます";
  if (!isSupportedUrl(sourceUrl)) return "sourceUrl は対応していません";

  if (
    body.options !== undefined &&
    (!body.options || typeof body.options !== "object" ||
      Array.isArray(body.options))
  ) {
    return "options は JSON オブジェクトにしてください";
  }
  const raw = (body.options || {}) as Record<string, unknown>;

  for (
    const key of ["diarize", "showTimestamp", "tagAudioEvents", "summarize"]
  ) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      return `options.${key} は真偽値にしてください`;
    }
  }
  if (
    raw.numSpeakers !== undefined &&
    (!Number.isInteger(raw.numSpeakers) || Number(raw.numSpeakers) < 1 ||
      Number(raw.numSpeakers) > 32)
  ) {
    return "options.numSpeakers は1〜32の整数にしてください";
  }
  if (
    raw.speakerNames !== undefined &&
    (!Array.isArray(raw.speakerNames) || raw.speakerNames.length < 1 ||
      raw.speakerNames.length > 32 ||
      raw.speakerNames.some((name) =>
        typeof name !== "string" || !name.trim() || name.length > 100
      ))
  ) {
    return "options.speakerNames は1〜32件の空でない文字列にしてください";
  }

  const speakerNames = Array.isArray(raw.speakerNames)
    ? raw.speakerNames.map((name) => String(name).trim())
    : undefined;
  const diarize = raw.diarize === undefined ? true : raw.diarize as boolean;
  if (!diarize && (raw.numSpeakers !== undefined || speakerNames)) {
    return "話者オプションを使うには options.diarize を有効にしてください";
  }

  const options: TranscriptionOptions = {
    diarize,
    showTimestamp: raw.showTimestamp === undefined
      ? true
      : raw.showTimestamp as boolean,
    tagAudioEvents: raw.tagAudioEvents === undefined
      ? true
      : raw.tagAudioEvents as boolean,
    summarize: raw.summarize === undefined ? false : raw.summarize as boolean,
  };
  if (speakerNames) {
    options.speakerNames = speakerNames;
    options.numSpeakers = speakerNames.length;
  } else if (raw.numSpeakers !== undefined) {
    options.numSpeakers = raw.numSpeakers as number;
  }

  return { sourceUrl, options };
}

function publicJob(job: TranscriptionJob): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    attempts: job.attempts,
    statusUrl: `/v1/transcription-jobs/${job.id}`,
    resultUrl: `/v1/transcription-jobs/${job.id}/result`,
  };
  if (job.startedAt) result.startedAt = job.startedAt;
  if (job.completedAt) result.completedAt = job.completedAt;
  if (job.filename) result.filename = job.filename;
  if (job.languageCode !== undefined) result.languageCode = job.languageCode;
  if (job.error) result.error = job.error;
  return result;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getGoogleCallerId(
  req: Request,
  verifier: CallerIdentityVerifier,
): Promise<string> {
  const authorization = req.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AuthenticationError("Bearer ID トークンが必要です");
  }

  try {
    const ticket = await verifier.verifyIdToken({
      idToken: match[1],
    });
    const payload = ticket.getPayload();
    const callerId = payload?.email || payload?.sub;
    if (!callerId) {
      throw new Error("呼び出し元を識別するクレームがありません");
    }
    return callerId;
  } catch {
    throw new AuthenticationError(
      "呼び出し元の ID トークンを検証できませんでした",
    );
  }
}

function handleUnexpectedError(error: unknown): Response {
  return handleHttpError(
    error instanceof Error ? error : new Error(getErrorMessage(error)),
  );
}
