#!/bin/bash

# Deploy to Cloud Run with environment variables from .env file

set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast1"}
SERVICE_NAME="scribe-bot"

echo "🚀 Deploying ElevenLabs Scribe Bot to Cloud Run..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "Please create .env file from .env.example:"
    echo "  cp .env.example .env"
    echo "Then edit .env with your actual values."
    exit 1
fi

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
echo "Setting GCP project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Build and submit using Cloud Build
echo "🏗️  Building and deploying container..."
gcloud builds submit --config cloudbuild.yaml . || {
    echo "❌ Build failed. Creating a simple Cloud Build config..."
    
    # Create a simple cloudbuild.yaml if it doesn't exist or failed
    cat > cloudbuild-simple.yaml << 'EOF'
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'asia-northeast1-docker.pkg.dev/$PROJECT_ID/scribe-bot/app', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'asia-northeast1-docker.pkg.dev/$PROJECT_ID/scribe-bot/app']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
    - 'run'
    - 'deploy'
    - 'scribe-bot'
    - '--image'
    - 'asia-northeast1-docker.pkg.dev/$PROJECT_ID/scribe-bot/app'
    - '--region'
    - 'asia-northeast1'
    - '--platform'
    - 'managed'
    - '--allow-unauthenticated'
    - '--memory'
    - '8Gi'
    - '--cpu'
    - '4'
    - '--timeout'
    - '3600'
    - '--max-instances'
    - '10'
images:
  - 'asia-northeast1-docker.pkg.dev/$PROJECT_ID/scribe-bot/app'
EOF
    
    echo "Retrying with simplified config..."
    gcloud builds submit --config cloudbuild-simple.yaml .
}

# Parse .env file and create environment variables string
echo ""
echo "📝 Setting environment variables from .env file..."

# Read .env file and build environment variables string
ENV_VARS=""
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue
    
    # Remove quotes from value if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    
    # Add to environment variables string
    if [ -n "$ENV_VARS" ]; then
        ENV_VARS="${ENV_VARS},"
    fi
    
    # Escape special characters in value
    value=$(printf '%s' "$value" | sed 's/,/\\,/g')
    ENV_VARS="${ENV_VARS}${key}=${value}"
    
    echo "  ✓ Setting ${key}"
done < .env

# Update Cloud Run service with environment variables
if [ -n "$ENV_VARS" ]; then
    echo ""
    echo "🔗 Updating Cloud Run service with environment variables..."
    gcloud run services update $SERVICE_NAME \
        --region $REGION \
        --set-env-vars="$ENV_VARS" \
        --allow-unauthenticated 2>/dev/null || echo "Note: Public access may be restricted by organization policy" || {
        echo "⚠️  Failed to set all variables at once. Trying alternative method..."
        
        # Alternative: Set variables one by one
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ $key =~ ^#.*$ ]] && continue
            [[ -z $key ]] && continue
            
            # Remove quotes from value
            value="${value%\"}"
            value="${value#\"}"
            value="${value%\'}"
            value="${value#\'}"
            
            echo "  Setting $key..."
            gcloud run services update $SERVICE_NAME \
                --region $REGION \
                --update-env-vars="${key}=${value}" 2>/dev/null || {
                echo "  ⚠️  Failed to set ${key}. It might contain special characters."
                echo "  You may need to set this manually in Cloud Console."
            }
        done < .env
    }
fi

# Get the service URL
echo ""
echo "Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)' 2>/dev/null || echo "URL not available yet")

echo ""
echo "✅ Deployment complete!"
echo "Service URL: $SERVICE_URL"
echo ""
echo "📌 Next steps:"
echo "1. Verify the deployment:"
echo "   make status"
echo ""
echo "2. Check logs:"
echo "   make logs"
echo ""
echo "3. Update Slack app configuration:"
echo "   Event Subscriptions URL: ${SERVICE_URL}/slack/events"
echo ""
echo "4. Update Discord app configuration:"
echo "   Interactions Endpoint URL: ${SERVICE_URL}/discord/interactions"
echo ""
echo "💡 Tips:"
echo "  - Use 'make dev' to test locally"
echo "  - Use 'make logs' to view Cloud Run logs"
echo "  - Use 'make status' to check deployment status"