#!/bin/bash

# Cloud Run Deployment Script with Secret Manager
# This script uses Google Secret Manager for secure credential storage

set -e

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"your-project-id"}
REGION=${GCP_REGION:-"asia-northeast1"}
SERVICE_NAME="scribe-bot"

echo "🔐 Deploying ElevenLabs Scribe Bot with Secret Manager..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Set the project
echo "Setting GCP project..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable secretmanager.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Function to create or update a secret
create_or_update_secret() {
    local secret_name=$1
    local secret_value=$2
    
    # Check if secret exists
    if gcloud secrets describe $secret_name &>/dev/null; then
        echo "Updating secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets versions add $secret_name --data-file=-
    else
        echo "Creating secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets create $secret_name --data-file=-
    fi
}

# Load secrets from .env file if it exists
if [ -f .env ]; then
    echo "📋 Found .env file. Loading secrets..."
    
    # Parse .env file and create secrets
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ $key =~ ^#.*$ ]] && continue
        [[ -z $key ]] && continue
        
        # Remove quotes from value
        value="${value%\"}"
        value="${value#\"}"
        
        # Convert to lowercase and replace underscores with hyphens for secret name
        secret_name=$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
        
        echo "Processing: $key -> $secret_name"
        create_or_update_secret "$secret_name" "$value"
    done < .env
    
    echo ""
    echo "✅ Secrets created/updated in Secret Manager"
else
    echo "⚠️  No .env file found. You'll need to create secrets manually."
    echo ""
    echo "Example commands to create secrets:"
    echo "  echo -n 'your-api-key' | gcloud secrets create elevenlabs-api-key --data-file=-"
    echo "  echo -n 'xoxb-your-token' | gcloud secrets create slack-bot-token --data-file=-"
    echo ""
    read -p "Press Enter to continue with deployment..."
fi

# Build and deploy
echo ""
echo "🏗️  Building and deploying with Cloud Build..."
gcloud builds submit --config cloudbuild.yaml .

# Grant Cloud Run service account access to secrets
echo ""
echo "🔑 Granting Cloud Run access to secrets..."
SERVICE_ACCOUNT=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(spec.template.spec.serviceAccountName)")

# List of secrets to grant access to
SECRETS=(
    "elevenlabs-api-key"
    "slack-bot-token"
    "discord-application-id"
    "discord-public-key"
    "discord-bot-token"
    "supabase-url"
    "supabase-service-role-key"
    "google-service-account-key"
    "google-impersonate-email"
)

for secret in "${SECRETS[@]}"; do
    if gcloud secrets describe $secret &>/dev/null; then
        echo "Granting access to secret: $secret"
        gcloud secrets add-iam-policy-binding $secret \
            --member="serviceAccount:$SERVICE_ACCOUNT" \
            --role="roles/secretmanager.secretAccessor" &>/dev/null
    fi
done

# Update Cloud Run service to use secrets
echo ""
echo "🔗 Linking secrets to Cloud Run service..."

# Build the secrets configuration
SECRETS_CONFIG=""
if gcloud secrets describe elevenlabs-api-key &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}ELEVENLABS_API_KEY=elevenlabs-api-key:latest,"
fi
if gcloud secrets describe slack-bot-token &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}SLACK_BOT_TOKEN=slack-bot-token:latest,"
fi
if gcloud secrets describe discord-application-id &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}DISCORD_APPLICATION_ID=discord-application-id:latest,"
fi
if gcloud secrets describe discord-public-key &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}DISCORD_PUBLIC_KEY=discord-public-key:latest,"
fi
if gcloud secrets describe discord-bot-token &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}DISCORD_BOT_TOKEN=discord-bot-token:latest,"
fi
if gcloud secrets describe supabase-url &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}SUPABASE_URL=supabase-url:latest,"
fi
if gcloud secrets describe supabase-service-role-key &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,"
fi
if gcloud secrets describe google-service-account-key &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}GOOGLE_SERVICE_ACCOUNT_KEY=google-service-account-key:latest,"
fi
if gcloud secrets describe google-impersonate-email &>/dev/null; then
    SECRETS_CONFIG="${SECRETS_CONFIG}GOOGLE_IMPERSONATE_EMAIL=google-impersonate-email:latest,"
fi

# Remove trailing comma
SECRETS_CONFIG="${SECRETS_CONFIG%,}"

if [ -n "$SECRETS_CONFIG" ]; then
    gcloud run services update $SERVICE_NAME \
        --region $REGION \
        --set-secrets="$SECRETS_CONFIG"
fi

# Get the service URL
echo ""
echo "Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo "Service URL: $SERVICE_URL"
echo ""
echo "📌 Next steps:"
echo "1. Verify secrets are properly set:"
echo "   gcloud run services describe $SERVICE_NAME --region $REGION"
echo ""
echo "2. Update Slack app configuration:"
echo "   - Event Subscriptions URL: ${SERVICE_URL}/slack/events"
echo ""
echo "3. Update Discord app configuration:"
echo "   - Interactions Endpoint URL: ${SERVICE_URL}/discord/interactions"
echo ""
echo "📚 To manage secrets:"
echo "   - List: gcloud secrets list"
echo "   - Update: echo -n 'new-value' | gcloud secrets versions add SECRET_NAME --data-file=-"
echo "   - View: gcloud secrets versions access latest --secret=SECRET_NAME"