# Supabase to Cloud Run Migration Guide

## Overview
This guide explains how to migrate the ElevenLabs Scribe Bot from Supabase Edge Functions to Google Cloud Run while keeping the Deno/TypeScript implementation.

## Architecture Changes

### Before (Supabase)
- Hosted on Supabase Edge Functions
- Deno runtime with Edge Runtime APIs
- Database integration (not used)

### After (Cloud Run)
- Hosted on Google Cloud Run
- Native Deno runtime in Docker container
- No database dependency
- Direct HTTP server using Deno.serve()

## Prerequisites

1. Google Cloud Project with billing enabled
2. gcloud CLI installed and configured
3. Docker installed (for local testing)
4. Required APIs enabled:
   - Cloud Run API
   - Cloud Build API
   - Container Registry API

## Migration Steps

### 1. Enable Required APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

### 2. Set Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Deploy to Cloud Run

Run the deployment script:

```bash
./deploy.sh
```

Or deploy manually:

```bash
# Build the Docker image
docker build -t gcr.io/YOUR_PROJECT_ID/scribe-bot .

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT_ID/scribe-bot

# Deploy to Cloud Run
gcloud run deploy scribe-bot \
  --image gcr.io/YOUR_PROJECT_ID/scribe-bot \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10
```

### 4. Configure Environment Variables

Set the required environment variables in Cloud Run:

```bash
gcloud run services update scribe-bot \
  --region asia-northeast1 \
  --set-env-vars \
    SLACK_BOT_TOKEN=xoxb-your-token,\
    DISCORD_APPLICATION_ID=your-id,\
    DISCORD_PUBLIC_KEY=your-key,\
    DISCORD_BOT_TOKEN=your-token,\
    ELEVENLABS_API_KEY=your-key
```

### 5. Update Webhook URLs

After deployment, update your webhook URLs:

#### Slack
1. Go to your Slack App settings
2. Navigate to "Event Subscriptions"
3. Update the Request URL to: `https://YOUR_CLOUD_RUN_URL/slack/events`

#### Discord
1. Go to your Discord Application settings
2. Navigate to "General Information"
3. Update the Interactions Endpoint URL to: `https://YOUR_CLOUD_RUN_URL/discord/interactions`

## Local Development

### Run with Docker

```bash
# Build the image
docker build -t scribe-bot-local .

# Run locally
docker run -p 8080:8080 \
  -e SLACK_BOT_TOKEN=your-token \
  -e DISCORD_APPLICATION_ID=your-id \
  -e DISCORD_PUBLIC_KEY=your-key \
  -e DISCORD_BOT_TOKEN=your-token \
  -e ELEVENLABS_API_KEY=your-key \
  scribe-bot-local
```

### Run with Deno directly

```bash
cd src

# Set environment variables
export SLACK_BOT_TOKEN=your-token
# ... set other variables

# Run the server
deno run --allow-net --allow-env --allow-read --allow-write \
  --unstable-kv --unstable-temporal index.ts
```

## URL Endpoints

The service exposes the following endpoints:

- `/` - Health check
- `/slack/events` - Slack event subscriptions
- `/discord/interactions` - Discord interactions

## Monitoring

View logs in Cloud Console:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=scribe-bot" \
  --limit 50 \
  --format json
```

Or use the Cloud Console UI:
1. Go to Cloud Run in GCP Console
2. Click on "scribe-bot" service
3. Navigate to "Logs" tab

## Cost Optimization

Cloud Run charges based on:
- CPU and memory allocated while handling requests
- Number of requests
- Outbound network traffic

Tips for optimization:
1. Set appropriate memory limits (1Gi is usually sufficient)
2. Configure max instances to prevent runaway costs
3. Use Cloud Run's automatic scaling
4. Monitor usage in Cloud Console

## Rollback

If you need to rollback to a previous version:

```bash
# List all revisions
gcloud run revisions list --service scribe-bot --region asia-northeast1

# Route traffic to a specific revision
gcloud run services update-traffic scribe-bot \
  --region asia-northeast1 \
  --to-revisions REVISION_NAME=100
```

## Troubleshooting

### Common Issues

1. **Container fails to start**
   - Check logs: `gcloud logging read "resource.type=cloud_run_revision"`
   - Verify Dockerfile syntax
   - Ensure all dependencies are cached

2. **Authentication errors**
   - Verify environment variables are set correctly
   - Check API keys and tokens are valid

3. **Timeout errors**
   - Increase timeout in Cloud Run settings (max 3600 seconds)
   - Optimize file processing for large files

4. **Memory errors**
   - Increase memory allocation in Cloud Run
   - Implement streaming for large file processing

## Support

For issues or questions:
1. Check Cloud Run logs
2. Review the error messages in Slack/Discord
3. Verify webhook URLs are correctly configured
4. Ensure all environment variables are set
