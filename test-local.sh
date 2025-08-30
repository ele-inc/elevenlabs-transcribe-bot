#!/bin/bash

# Local testing script for Deno Cloud Run migration

echo "🧪 Testing ElevenLabs Scribe Bot locally..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "Please edit .env with your actual values and run this script again."
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Change to the function directory
cd supabase/functions/scribe-bot

echo "Starting Deno server on port 8080..."
echo "Endpoints:"
echo "  - Health check: http://localhost:8080/"
echo "  - Slack events: http://localhost:8080/slack/events"
echo "  - Discord interactions: http://localhost:8080/discord/interactions"
echo ""

# Run the server
PORT=8080 deno run \
  --allow-net \
  --allow-env \
  --allow-read \
  --allow-write \
  --allow-run \
  --unstable-kv \
  --unstable-temporal \
  --watch \
  index.ts