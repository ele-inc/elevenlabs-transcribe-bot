# Transcription Web API

The Web API runs each transcription as a durable asynchronous job. The caller
does not need to keep an HTTP connection open: persist the returned job ID and
fetch its status again after a page reload or process restart.

## Infrastructure setup

The API uses Firestore for job state, Cloud Storage for results, and a Cloud Run
Job for each transcription. Set up the backing resources once, deploy, then run
the setup script once more so the API service account can invoke the newly
created worker job.

```bash
./scripts/setup-transcription-api.sh
make deploy
./scripts/setup-transcription-api.sh
```

The defaults are:

- Firestore database: `(default)`
- Firestore collection: `transcription_jobs`
- Cloud Run Job: `scribe-transcription-worker`
- Results bucket: `${GCP_PROJECT_ID}-scribe-results`
- Region: `asia-northeast1`

Override these with `TRANSCRIPTION_JOBS_COLLECTION`,
`TRANSCRIPTION_JOB_NAME`, `TRANSCRIPTION_RESULTS_BUCKET`, and `GCP_REGION`.

The Cloud Run service remains IAM-authenticated. Give each calling service
account `roles/run.invoker` on `scribe-bot`; do not make the service public just
for this API. The setup script separately gives the API runtime identity
`roles/run.jobsExecutorWithOverrides` on the worker job, because each execution
receives its job ID through an environment override.

## Create a job

```http
POST /v1/transcription-jobs
Content-Type: application/json
Idempotency-Key: your-stable-request-id

{
  "sourceUrl": "https://www.youtube.com/watch?v=...",
  "options": {
    "diarize": true,
    "showTimestamp": true,
    "tagAudioEvents": true,
    "numSpeakers": 2,
    "speakerNames": ["Alice", "Bob"],
    "summarize": false
  }
}
```

Only HTTPS URLs supported by the existing Google Drive, Dropbox, YouTube,
Vimeo Review, Utage, or HLS adapters are accepted. Direct file upload is not
part of the initial API; upload large files to a supported source first.

A successful request returns `202 Accepted`:

```json
{
  "id": "b2e1...",
  "status": "queued",
  "createdAt": "2026-08-02T00:00:00.000Z",
  "updatedAt": "2026-08-02T00:00:00.000Z",
  "attempts": 0,
  "statusUrl": "/v1/transcription-jobs/b2e1...",
  "resultUrl": "/v1/transcription-jobs/b2e1.../result"
}
```

`Idempotency-Key` is strongly recommended. Repeating the same request with the
same key returns the original job instead of starting another transcription.
Keys must be globally unique among API callers.

## Status and result

```http
GET /v1/transcription-jobs/{jobId}
GET /v1/transcription-jobs/{jobId}/result
```

Job states are `queued`, `processing`, `succeeded`, and `failed`. Poll the
status endpoint every 5 seconds. While the result is not ready, the result
endpoint returns `202` with `Retry-After: 5`. A successful result includes the
transcript, detected language, word timestamps, timing metrics, and optional
summary.

Failed jobs can be restarted explicitly:

```http
POST /v1/transcription-jobs/{jobId}/retry
```

For a browser UI, store `jobId` in the application's persistent state or
`localStorage`. After a reload, call the status URL again and continue polling;
the transcription itself runs independently in Cloud Run Jobs.

## Example with Cloud Run IAM

```bash
SERVICE_URL=$(gcloud run services describe scribe-bot \
  --region=asia-northeast1 --format='value(status.url)')
ID_TOKEN=$(gcloud auth print-identity-token)

curl -X POST "${SERVICE_URL}/v1/transcription-jobs" \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-001" \
  -d '{"sourceUrl":"https://www.youtube.com/watch?v=..."}'
```
