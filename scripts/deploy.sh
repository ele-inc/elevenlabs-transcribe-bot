#!/bin/bash

# Cloud Run Deployment Script for ElevenLabs Scribe Bot

set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast1"}
SERVICE_NAME="scribe-bot"

echo "🚀 Deploying ElevenLabs Scribe Bot to Cloud Run..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Check if logged in to gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not logged in to gcloud. Please run: gcloud auth login"
    exit 1
fi

# Set the project
echo "Setting GCP project..."
gcloud config set project $PROJECT_ID

# Build and submit using Cloud Build
echo "Building and deploying with Cloud Build..."
gcloud builds submit --config cloudbuild.yaml .

# Set environment variables
echo ""
echo "📝 Setting environment variables..."
echo "Please run ONE of the following commands to set your environment variables:"
echo ""
echo "Option 1: Basic setup (Slack + ElevenLabs only)"
echo "================================================"
echo "gcloud run services update $SERVICE_NAME \\"
echo "  --region $REGION \\"
echo "  --set-env-vars \\"
echo "    ELEVENLABS_API_KEY=your-key,\\"
echo "    SLACK_BOT_TOKEN=xoxb-your-token"
echo ""
echo "Option 2: Full setup (All services)"
echo "===================================="
echo "gcloud run services update $SERVICE_NAME \\"
echo "  --region $REGION \\"
echo "  --set-env-vars \\"
echo "    ELEVENLABS_API_KEY=your-key,\\"
echo "    SLACK_BOT_TOKEN=xoxb-your-token,\\"
echo "    DISCORD_APPLICATION_ID=your-id,\\"
echo "    DISCORD_PUBLIC_KEY=your-key,\\"
echo "    DISCORD_BOT_TOKEN=your-token,\\"
echo "    SUPABASE_URL=https://your-project.supabase.co,\\"
echo "    SUPABASE_SERVICE_ROLE_KEY=your-service-key,\\"
echo "    GOOGLE_SERVICE_ACCOUNT_KEY='{\"type\":\"service_account\",...}'"
echo ""
echo "📚 See ENV_VARS.md for detailed configuration instructions"
echo ""

# Get the service URL
echo "Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo "Service URL: $SERVICE_URL"
echo ""
echo "📌 Next steps:"
echo "1. Set environment variables using the command above"
echo "2. Update Slack app configuration:"
echo "   - Event Subscriptions URL: ${SERVICE_URL}/slack/events"
echo "3. Update Discord app configuration:"
echo "   - Interactions Endpoint URL: ${SERVICE_URL}/discord/interactions"