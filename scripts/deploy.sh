#!/bin/bash
set -euo pipefail

PROJECT_ID="automatic-recording-of-minutes"
REGION="asia-northeast1"
SERVICE="scribe-bot"

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

echo "🚀 Deploying $SERVICE from local source to Cloud Run..."
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --source=. \
  --region="$REGION" \
  --memory=16Gi \
  --cpu=4 \
  --timeout=3600 \
  --no-allow-unauthenticated \
  --execution-environment=gen2 \
  --cpu-boost \
  --no-cpu-throttling \
  --min-instances=0 \
  --max-instances=1 \
  --port=8080 \
  --clear-env-vars \
  --set-secrets="$mapping"

echo "✅ Deployed"
echo "Service URL:"
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)"
