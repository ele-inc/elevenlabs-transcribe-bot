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
import { getErrorMessage } from "../utils/errors.ts";

export interface TranscriptionApiDependencies {
  jobs: TranscriptionJobStore;
  results: TranscriptionResultStore;
  dispatcher: TranscriptionJobDispatcher;
  isSupportedUrl: (url: string) => boolean;
}

let defaultHandler: ((req: Request) => Promise<Response>) | null = null;

export function handleTranscriptionApi(req: Request): Promise<Response> {
  return getDefaultHandler().then((handler) => handler(req));
}

async function getDefaultHandler(): Promise<
  (req: Request) => Promise<Response>
> {
  if (!defaultHandler) {
    const [
      { FirestoreTranscriptionJobStore },
      { GcsTranscriptionResultStore },
      { CloudRunTranscriptionJobDispatcher },
      { cloudServiceManager },
    ] = await Promise.all([
      import("../services/transcription-job-store.ts"),
      import("../services/transcription-result-store.ts"),
      import("../services/cloud-run-job-dispatcher.ts"),
      import("../services/cloud-service-manager.ts"),
    ]);
    defaultHandler = createTranscriptionApiHandler({
      jobs: new FirestoreTranscriptionJobStore(),
      results: new GcsTranscriptionResultStore(),
      dispatcher: new CloudRunTranscriptionJobDispatcher(),
      isSupportedUrl: (url) => cloudServiceManager.isSupportedUrl(url),
    });
  }
  return defaultHandler;
}

export function createTranscriptionApiHandler(
  dependencies: TranscriptionApiDependencies,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const pathname = new URL(req.url).pathname;

    if (pathname === "/v1/transcription-jobs" && req.method === "POST") {
      return await createJob(req, dependencies);
    }

    const match = pathname.match(
      /^\/v1\/transcription-jobs\/([a-zA-Z0-9_-]+)(?:\/(result|retry))?$/,
    );
    if (!match) return jsonResponse({ error: "Not found" }, 404);

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
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: action === "retry" ? "POST" : "GET",
    });
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
    return jsonResponse({ error: "A JSON request body is required" }, 400);
  }

  const parsed = parseCreateRequest(input, dependencies.isSupportedUrl);
  if (typeof parsed === "string") {
    return jsonResponse({ error: parsed }, 400);
  }

  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (idempotencyKey && idempotencyKey.length > 200) {
    return jsonResponse(
      { error: "Idempotency-Key must be 200 characters or fewer" },
      400,
    );
  }

  const requestFingerprint = await sha256Hex(JSON.stringify(parsed));
  const jobId = idempotencyKey
    ? `idem_${await sha256Hex(idempotencyKey)}`
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
        { error: "Idempotency-Key was already used for a different request" },
        409,
      );
    }
    if (
      job.status === "processing" || job.status === "succeeded" ||
      (job.status === "queued" && job.executionName)
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

  try {
    const executionName = await dependencies.dispatcher.dispatch(job.id);
    await dependencies.jobs.update(job.id, {
      status: "queued",
      executionName,
      error: undefined,
    });
    job = { ...job, status: "queued", executionName, error: undefined };
  } catch (error) {
    const message = `Could not start transcription worker: ${
      getErrorMessage(error)
    }`;
    await dependencies.jobs.update(job.id, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    return jsonResponse(
      { ...publicJob(job), status: "failed", error: message },
      503,
    );
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
  if (!job) return jsonResponse({ error: "Transcription job not found" }, 404);
  return jsonResponse(publicJob(job), 200, { "Cache-Control": "no-store" });
}

async function getResult(
  jobId: string,
  dependencies: TranscriptionApiDependencies,
): Promise<Response> {
  const job = await dependencies.jobs.get(jobId);
  if (!job) return jsonResponse({ error: "Transcription job not found" }, 404);
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
  if (!job) return jsonResponse({ error: "Transcription job not found" }, 404);
  if (job.status !== "failed") {
    return jsonResponse(
      { error: "Only failed transcription jobs can be retried" },
      409,
    );
  }

  await dependencies.jobs.update(jobId, {
    status: "queued",
    attempts: 0,
    startedAt: undefined,
    completedAt: undefined,
    workerExecution: undefined,
    error: undefined,
  });
  try {
    const executionName = await dependencies.dispatcher.dispatch(jobId);
    await dependencies.jobs.update(jobId, { executionName });
    return jsonResponse(
      publicJob({
        ...job,
        status: "queued",
        attempts: 0,
        executionName,
        startedAt: undefined,
        completedAt: undefined,
        workerExecution: undefined,
        error: undefined,
      }),
      202,
    );
  } catch (error) {
    const message = `Could not restart transcription worker: ${
      getErrorMessage(error)
    }`;
    await dependencies.jobs.update(jobId, { status: "failed", error: message });
    return jsonResponse({ error: message }, 503);
  }
}

export function parseCreateRequest(
  input: unknown,
  isSupportedUrl: (url: string) => boolean,
): CreateTranscriptionJobRequest | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Request body must be a JSON object";
  }
  const body = input as Record<string, unknown>;
  if (typeof body.sourceUrl !== "string" || !body.sourceUrl.trim()) {
    return "sourceUrl is required";
  }

  const sourceUrl = body.sourceUrl.trim();
  try {
    const parsedUrl = new URL(sourceUrl);
    if (parsedUrl.protocol !== "https:") return "sourceUrl must use HTTPS";
  } catch {
    return "sourceUrl must be a valid URL";
  }
  if (sourceUrl.length > 8192) return "sourceUrl is too long";
  if (!isSupportedUrl(sourceUrl)) return "sourceUrl is not supported";

  if (
    body.options !== undefined &&
    (!body.options || typeof body.options !== "object" ||
      Array.isArray(body.options))
  ) {
    return "options must be a JSON object";
  }
  const raw = (body.options || {}) as Record<string, unknown>;

  for (
    const key of ["diarize", "showTimestamp", "tagAudioEvents", "summarize"]
  ) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      return `options.${key} must be a boolean`;
    }
  }
  if (
    raw.numSpeakers !== undefined &&
    (!Number.isInteger(raw.numSpeakers) || Number(raw.numSpeakers) < 1 ||
      Number(raw.numSpeakers) > 32)
  ) {
    return "options.numSpeakers must be an integer between 1 and 32";
  }
  if (
    raw.speakerNames !== undefined &&
    (!Array.isArray(raw.speakerNames) || raw.speakerNames.length > 32 ||
      raw.speakerNames.some((name) =>
        typeof name !== "string" || !name.trim() || name.length > 100
      ))
  ) {
    return "options.speakerNames must contain 1 to 32 non-empty strings";
  }

  const speakerNames = Array.isArray(raw.speakerNames)
    ? raw.speakerNames.map((name) => String(name).trim())
    : undefined;
  const diarize = raw.diarize === undefined ? true : raw.diarize as boolean;
  if (!diarize && (raw.numSpeakers !== undefined || speakerNames)) {
    return "speaker options require options.diarize to be enabled";
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
