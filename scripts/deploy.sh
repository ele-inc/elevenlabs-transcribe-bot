#!/bin/bash
set -euo pipefail

PROJECT_ID="automatic-recording-of-minutes"
REGION="asia-northeast1"
BOT_SERVICE="scribe-bot"
API_SERVICE="scribe-api"
MAX_CONCURRENT_TRANSCRIPTIONS="8"
GEMINI_MODEL="gemini-3.6-flash"
JOB_NAME="scribe-transcription-worker"
API_SERVICE_ACCOUNT="${TRANSCRIPTION_API_SERVICE_ACCOUNT:-scribe-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
WORKER_SERVICE_ACCOUNT="${TRANSCRIPTION_WORKER_SERVICE_ACCOUNT:-scribe-worker-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
RESULTS_BUCKET="${PROJECT_ID}-scribe-results"
JOBS_COLLECTION="${TRANSCRIPTION_JOBS_COLLECTION:-transcription_jobs}"
HLS_ALLOWED_HOSTS="${TRANSCRIPTION_HLS_ALLOWED_HOSTS:-}"

BOT_SECRETS=(
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
WORKER_SECRETS=(
  ELEVENLABS_API_KEY
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
for name in "${BOT_SECRETS[@]}"; do
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

bot_mapping=""
for name in "${BOT_SECRETS[@]}"; do
  bot_mapping+="${name}=${name}:latest,"
done
bot_mapping="${bot_mapping%,}"

worker_mapping=""
for name in "${WORKER_SECRETS[@]}"; do
  worker_mapping+="${name}=${name}:latest,"
done
worker_mapping="${worker_mapping%,}"

BOT_ENV="MAX_CONCURRENT_TRANSCRIPTIONS=$MAX_CONCURRENT_TRANSCRIPTIONS,GEMINI_MODEL=$GEMINI_MODEL,GCP_REGION=$REGION"
API_ENV="GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,TRANSCRIPTION_JOB_NAME=$JOB_NAME,TRANSCRIPTION_JOBS_COLLECTION=$JOBS_COLLECTION,TRANSCRIPTION_RESULTS_BUCKET=$RESULTS_BUCKET,TRANSCRIPTION_HLS_ALLOWED_HOSTS=$HLS_ALLOWED_HOSTS"
WORKER_ENV="MAX_CONCURRENT_TRANSCRIPTIONS=$MAX_CONCURRENT_TRANSCRIPTIONS,GEMINI_MODEL=$GEMINI_MODEL,GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,TRANSCRIPTION_JOBS_COLLECTION=$JOBS_COLLECTION,TRANSCRIPTION_RESULTS_BUCKET=$RESULTS_BUCKET"

echo "🚀 Bot サービス $BOT_SERVICE をデプロイしています..."
gcloud run deploy "$BOT_SERVICE" \
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
  --set-env-vars="$BOT_ENV" \
  --set-secrets="$bot_mapping"

SERVICE_IMAGE=$(gcloud run services describe "$BOT_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(spec.template.spec.containers[0].image)')

echo "🚀 文字起こしワーカージョブ $JOB_NAME をデプロイしています..."
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
  --service-account="$WORKER_SERVICE_ACCOUNT" \
  --set-env-vars="$WORKER_ENV" \
  --set-secrets="$worker_mapping"

echo "🚀 API サービス $API_SERVICE をデプロイしています..."
gcloud run deploy "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$SERVICE_IMAGE" \
  --command=deno \
  --args=run,--allow-net,--allow-env,--allow-read,api-server.ts \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=80 \
  --timeout=60 \
  --no-allow-unauthenticated \
  --execution-environment=gen2 \
  --min-instances=0 \
  --max-instances=10 \
  --port=8080 \
  --service-account="$API_SERVICE_ACCOUNT" \
  --set-env-vars="$API_ENV"

echo "✅ デプロイが完了しました"
echo "Bot サービス URL:"
gcloud run services describe "$BOT_SERVICE" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)"
echo "API サービス URL:"
gcloud run services describe "$API_SERVICE" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)"
