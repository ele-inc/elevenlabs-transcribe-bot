#!/bin/bash

echo "🚀 Deploying with all environment variables and CPU optimization..."

# Load environment variables from .env file
source .env

# Extract private key from JSON
GOOGLE_PRIVATE_KEY=$(echo "$GOOGLE_SERVICE_ACCOUNT_KEY" | python3 -c "import sys, json; print(json.load(sys.stdin)['private_key'])")

# Build environment variables list
ENV_VARS="ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY,SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN,DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN,DISCORD_PUBLIC_KEY=$DISCORD_PUBLIC_KEY,DISCORD_APPLICATION_ID=$DISCORD_APPLICATION_ID,GCP_PROJECT_ID=$GCP_PROJECT_ID,GOOGLE_CLIENT_EMAIL=$GOOGLE_CLIENT_EMAIL,GOOGLE_IMPERSONATE_EMAIL=$GOOGLE_IMPERSONATE_EMAIL,GOOGLE_PRIVATE_KEY=$GOOGLE_PRIVATE_KEY,OPENAI_API_KEY=$OPENAI_API_KEY"

# Add optional YouTube cookies if set
if [ -n "$YOUTUBE_COOKIES_BASE64" ]; then
  ENV_VARS="$ENV_VARS,YOUTUBE_COOKIES_BASE64=$YOUTUBE_COOKIES_BASE64"
  echo "✅ Including YouTube cookies in deployment"
fi

# Deploy with all environment variables and CPU optimization
gcloud run deploy scribe-bot \
  --source . \
  --region=asia-northeast1 \
  --memory=32Gi \
  --cpu=8 \
  --timeout=3600 \
  --no-allow-unauthenticated \
  --execution-environment=gen2 \
  --cpu-boost \
  --no-cpu-throttling \
  --min-instances=0 \
  --max-instances=3 \
  --port=8080 \
  --set-env-vars="$ENV_VARS"

echo "✅ Deployed with all environment variables"
echo "Service URL:"
gcloud run services describe scribe-bot --region=asia-northeast1 --format="value(status.url)"
