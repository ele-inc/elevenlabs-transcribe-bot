#!/bin/bash
set -euo pipefail

# Load environment variables from .env file
if [ ! -f .env ]; then
  echo "❌ .env が見つかりません" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

# Check gcloud authentication
if ! gcloud auth print-access-token &>/dev/null; then
  echo "⚠️  gcloud にログインしていません。ログインを開始します..."
  gcloud auth login
fi

# Validate required env vars before building the deploy payload
REQUIRED_VARS=(
  ELEVENLABS_API_KEY
  SLACK_BOT_TOKEN
  DISCORD_BOT_TOKEN
  DISCORD_PUBLIC_KEY
  DISCORD_APPLICATION_ID
  GCP_PROJECT_ID
  GOOGLE_CLIENT_EMAIL
  GOOGLE_IMPERSONATE_EMAIL
  GOOGLE_SERVICE_ACCOUNT_KEY
  GOOGLE_GENERATIVE_AI_API_KEY
)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ 以下の必須環境変数が未設定です:" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  exit 1
fi

echo "🚀 Deploying with all environment variables and CPU optimization..."

# Extract private key from service account JSON (must contain a non-empty private_key)
if ! GOOGLE_PRIVATE_KEY=$(printf '%s' "$GOOGLE_SERVICE_ACCOUNT_KEY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    sys.stderr.write(f'JSON parse error: {e}\n')
    sys.exit(2)
pk = d.get('private_key') if isinstance(d, dict) else None
if not pk:
    sys.stderr.write('GOOGLE_SERVICE_ACCOUNT_KEY に private_key が含まれていません\n')
    sys.exit(3)
print(pk)
"); then
  echo "❌ GOOGLE_SERVICE_ACCOUNT_KEY の抽出に失敗しました。サービスアカウント JSON を .env に正しく設定してください。" >&2
  exit 1
fi
if [ -z "$GOOGLE_PRIVATE_KEY" ]; then
  echo "❌ GOOGLE_PRIVATE_KEY が空です。デプロイを中止します。" >&2
  exit 1
fi

# Build environment variables list
ENV_VARS="ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY,SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN,DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN,DISCORD_PUBLIC_KEY=$DISCORD_PUBLIC_KEY,DISCORD_APPLICATION_ID=$DISCORD_APPLICATION_ID,GCP_PROJECT_ID=$GCP_PROJECT_ID,GOOGLE_CLIENT_EMAIL=$GOOGLE_CLIENT_EMAIL,GOOGLE_IMPERSONATE_EMAIL=$GOOGLE_IMPERSONATE_EMAIL,GOOGLE_PRIVATE_KEY=$GOOGLE_PRIVATE_KEY,GOOGLE_GENERATIVE_AI_API_KEY=$GOOGLE_GENERATIVE_AI_API_KEY"

# Add optional YouTube cookies if set
if [ -n "${YOUTUBE_COOKIES_BASE64:-}" ]; then
  ENV_VARS="$ENV_VARS,YOUTUBE_COOKIES_BASE64=$YOUTUBE_COOKIES_BASE64"
  echo "✅ Including YouTube cookies in deployment"
fi

# Add optional YouTube proxy if set
if [ -n "${YOUTUBE_PROXY:-}" ]; then
  ENV_VARS="$ENV_VARS,YOUTUBE_PROXY=$YOUTUBE_PROXY"
  echo "✅ Including YouTube proxy in deployment"
fi

# Deploy with all environment variables and CPU optimization
gcloud run deploy scribe-bot \
  --project="$GCP_PROJECT_ID" \
  --source . \
  --region=asia-northeast1 \
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
  --set-env-vars="$ENV_VARS"

echo "✅ Deployed with all environment variables"
echo "Service URL:"
gcloud run services describe scribe-bot --project="$GCP_PROJECT_ID" --region=asia-northeast1 --format="value(status.url)"
