#!/bin/bash
set -euo pipefail

PROJECT_ID="automatic-recording-of-minutes"
REGION="asia-northeast1"
SERVICE="scribe-bot"
MAX_CONCURRENT_TRANSCRIPTIONS="8"
GEMINI_MODEL="gemini-3.6-flash"
JOB_NAME="scribe-transcription-worker"
RESULTS_BUCKET="${PROJECT_ID}-scribe-results"
HLS_ALLOWED_HOSTS="${TRANSCRIPTION_HLS_ALLOWED_HOSTS:-}"

SECRETS=(
  ELEVENLABS_API_KEY
  SLACK_BOT_TOKEN
  DISCORD_BOT_TOKEN
  DISCORD_PUBLIC_KEY
  DISCORD_APPLICATION_ID
  GCP_PROJECT_ID
  GOOGLE_CLIENT_EMAIL
  GOOGLE_IMPERSONATE_EMAIL
  GOOGLE_PRIVATE_KEY
  GOOGLE_GENERATIVE_AI_API_KEY
  YOUTUBE_PROXY
  YOUTUBE_COOKIES_BASE64
)

if ! gcloud auth print-access-token &>/dev/null; then
  echo "⚠️  gcloud にログインしていません。ログインを開始します..."
  gcloud auth login
fi

echo "🔍 Secret Manager に必須シークレットが揃っているか確認..."
MISSING=()
for name in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    MISSING+=("$name")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ Secret Manager に未登録のシークレットがあります:" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  echo "   例: printf '%s' \"\$VALUE\" | gcloud secrets create NAME --replication-policy=automatic --data-file=- --project=$PROJECT_ID" >&2
  exit 1
fi

mapping=""
for name in "${SECRETS[@]}"; do
  mapping+="${name}=${name}:latest,"
done
mapping="${mapping%,}"

echo "🚀 $SERVICE をローカルソースから Cloud Run へデプロイしています..."
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --source=. \
  --region="$REGION" \
  --memory=32Gi \
  --cpu=8 \
  --concurrency=8 \
  --timeout=3600 \
  --no-allow-unauthenticated \
  --execution-environment=gen2 \
  --cpu-boost \
  --no-cpu-throttling \
  --min-instances=0 \
  --max-instances=1 \
  --port=8080 \
  --set-env-vars="MAX_CONCURRENT_TRANSCRIPTIONS=$MAX_CONCURRENT_TRANSCRIPTIONS,GEMINI_MODEL=$GEMINI_MODEL,GCP_REGION=$REGION,TRANSCRIPTION_JOB_NAME=$JOB_NAME,TRANSCRIPTION_RESULTS_BUCKET=$RESULTS_BUCKET,TRANSCRIPTION_HLS_ALLOWED_HOSTS=$HLS_ALLOWED_HOSTS" \
  --set-secrets="$mapping"

SERVICE_IMAGE=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(spec.template.spec.containers[0].image)')

echo "🚀 永続化文字起こしワーカージョブをデプロイしています..."
gcloud run jobs deploy "$JOB_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$SERVICE_IMAGE" \
  --command=deno \
  --args=run,--allow-net,--allow-env,--allow-read,--allow-write,--allow-run,job-worker.ts \
  --memory=32Gi \
  --cpu=8 \
  --tasks=1 \
  --max-retries=1 \
  --task-timeout=7200s \
  --set-env-vars="MAX_CONCURRENT_TRANSCRIPTIONS=$MAX_CONCURRENT_TRANSCRIPTIONS,GEMINI_MODEL=$GEMINI_MODEL,GCP_REGION=$REGION,TRANSCRIPTION_JOB_NAME=$JOB_NAME,TRANSCRIPTION_RESULTS_BUCKET=$RESULTS_BUCKET,TRANSCRIPTION_HLS_ALLOWED_HOSTS=$HLS_ALLOWED_HOSTS" \
  --set-secrets="$mapping"

echo "✅ Deployed"
echo "Service URL:"
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)"
