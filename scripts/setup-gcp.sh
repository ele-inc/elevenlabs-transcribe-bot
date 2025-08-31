#!/bin/bash

# Complete GCP Setup Script with Permission Management
set -e

echo "🚀 Complete GCP Setup for ElevenLabs Scribe Bot"
echo "================================================"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed."
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get current user
CURRENT_USER=$(gcloud config get-value account)
if [ -z "$CURRENT_USER" ]; then
    echo "❌ Not logged in to gcloud."
    echo "Please run: gcloud auth login"
    exit 1
fi

echo "👤 Current user: $CURRENT_USER"
echo ""

# Function to check if user has owner/editor role
check_permissions() {
    local project=$1
    local roles=$(gcloud projects get-iam-policy $project \
        --flatten="bindings[].members" \
        --filter="bindings.members:$CURRENT_USER" \
        --format="value(bindings.role)" 2>/dev/null || echo "")

    if [[ $roles == *"owner"* ]] || [[ $roles == *"editor"* ]]; then
        return 0
    else
        return 1
    fi
}

# List available projects
echo "📋 Available projects:"
echo ""
gcloud projects list --format="table(projectId,name,createTime)" 2>/dev/null || {
    echo "❌ Could not list projects. You may need to login first."
    exit 1
}

echo ""
echo "Choose an option:"
echo "1) Use an existing project where you have permissions"
echo "2) Create a new project (recommended)"
echo "3) Request permissions for an existing project"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        # Use existing project
        read -p "Enter the PROJECT_ID from the list above: " PROJECT_ID

        # Check permissions
        if check_permissions $PROJECT_ID; then
            echo "✅ You have sufficient permissions for $PROJECT_ID"
        else
            echo "⚠️  You don't have owner/editor role. Attempting to add necessary permissions..."

            # Try to add permissions (will fail if not owner)
            echo "Attempting to grant permissions to yourself..."
            gcloud projects add-iam-policy-binding $PROJECT_ID \
                --member="user:$CURRENT_USER" \
                --role="roles/cloudbuild.builds.editor" 2>/dev/null || echo "Could not add Cloud Build Editor role"

            gcloud projects add-iam-policy-binding $PROJECT_ID \
                --member="user:$CURRENT_USER" \
                --role="roles/run.admin" 2>/dev/null || echo "Could not add Cloud Run Admin role"

            gcloud projects add-iam-policy-binding $PROJECT_ID \
                --member="user:$CURRENT_USER" \
                --role="roles/storage.admin" 2>/dev/null || echo "Could not add Storage Admin role"

            gcloud projects add-iam-policy-binding $PROJECT_ID \
                --member="user:$CURRENT_USER" \
                --role="roles/serviceusage.serviceUsageConsumer" 2>/dev/null || echo "Could not add Service Usage Consumer role"
        fi
        ;;

    2)
        # Create new project
        echo ""
        read -p "Enter a name for your new project (lowercase, hyphens allowed): " PROJECT_NAME
        PROJECT_ID="${PROJECT_NAME}-$(date +%s)"

        echo "Creating project: $PROJECT_ID"
        gcloud projects create $PROJECT_ID --name="$PROJECT_NAME" || {
            echo "❌ Failed to create project. Try a different name."
            exit 1
        }

        echo "✅ Project created successfully!"

        # Link billing account
        echo ""
        echo "📊 Available billing accounts:"
        BILLING_ACCOUNTS=$(gcloud billing accounts list --format="value(name)" 2>/dev/null)

        if [ -n "$BILLING_ACCOUNTS" ]; then
            echo "$BILLING_ACCOUNTS"
            read -p "Enter the billing account ID (or press Enter to skip): " BILLING_ACCOUNT

            if [ -n "$BILLING_ACCOUNT" ]; then
                gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT || {
                    echo "⚠️  Could not link billing account. You can do this later in Cloud Console."
                }
            fi
        else
            echo "⚠️  No billing accounts found. You'll need to set up billing in Cloud Console."
        fi
        ;;

    3)
        # Request permissions
        read -p "Enter the PROJECT_ID you need permissions for: " PROJECT_ID

        echo ""
        echo "📧 Send this to your project administrator:"
        echo "=========================================="
        echo ""
        echo "Subject: Request for GCP Project Permissions"
        echo ""
        echo "Hi,"
        echo ""
        echo "I need the following permissions for the project '$PROJECT_ID' to deploy the ElevenLabs Scribe Bot:"
        echo ""
        echo "Please run these commands:"
        echo ""
        cat << EOF
# Grant Cloud Build Editor role
gcloud projects add-iam-policy-binding $PROJECT_ID \\
    --member='user:$CURRENT_USER' \\
    --role='roles/cloudbuild.builds.editor'

# Grant Cloud Run Admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \\
    --member='user:$CURRENT_USER' \\
    --role='roles/run.admin'

# Grant Storage Admin role (for Cloud Build artifacts)
gcloud projects add-iam-policy-binding $PROJECT_ID \\
    --member='user:$CURRENT_USER' \\
    --role='roles/storage.admin'

# Grant Service Usage Consumer role
gcloud projects add-iam-policy-binding $PROJECT_ID \\
    --member='user:$CURRENT_USER' \\
    --role='roles/serviceusage.serviceUsageConsumer'

# Grant Secret Manager Admin role (optional, for secure credential storage)
gcloud projects add-iam-policy-binding $PROJECT_ID \\
    --member='user:$CURRENT_USER' \\
    --role='roles/secretmanager.admin'
EOF
        echo ""
        echo "Or alternatively, grant me the 'Editor' role for full access."
        echo ""
        echo "Thank you!"
        echo "=========================================="
        echo ""
        echo "📋 Copy the above message and send it to your administrator."
        exit 0
        ;;

    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# Set the project
echo ""
echo "🔧 Configuring project: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo ""
echo "📦 Enabling required APIs..."
echo "This may take a few minutes..."

gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID || echo "⚠️  Cloud Build API issue"
gcloud services enable run.googleapis.com --project=$PROJECT_ID || echo "⚠️  Cloud Run API issue"
gcloud services enable containerregistry.googleapis.com --project=$PROJECT_ID || echo "⚠️  Container Registry API issue"
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID || echo "⚠️  Artifact Registry API issue"
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID || echo "⚠️  Secret Manager API issue"
gcloud services enable serviceusage.googleapis.com --project=$PROJECT_ID || echo "⚠️  Service Usage API issue"

# Update .env file
echo ""
echo "📝 Updating .env file..."

if [ -f .env ]; then
    # Update existing .env
    if grep -q "^GCP_PROJECT_ID=" .env; then
        sed -i.bak "s/^GCP_PROJECT_ID=.*/GCP_PROJECT_ID=$PROJECT_ID/" .env
        echo "✅ Updated GCP_PROJECT_ID in .env"
    else
        echo "GCP_PROJECT_ID=$PROJECT_ID" >> .env
        echo "✅ Added GCP_PROJECT_ID to .env"
    fi
else
    # Create new .env from example
    if [ -f .env.example ]; then
        cp .env.example .env
        sed -i.bak "s/^GCP_PROJECT_ID=.*/GCP_PROJECT_ID=$PROJECT_ID/" .env
        echo "✅ Created .env from .env.example with correct PROJECT_ID"
        echo ""
        echo "⚠️  Please edit .env and add your API keys:"
        echo "  - ELEVENLABS_API_KEY"
        echo "  - SLACK_BOT_TOKEN"
        echo "  - Discord tokens (if needed)"
    else
        echo "GCP_PROJECT_ID=$PROJECT_ID" > .env
        echo "✅ Created new .env with PROJECT_ID"
    fi
fi

# Set application default credentials
echo ""
echo "🔐 Setting up application default credentials..."
gcloud auth application-default set-quota-project $PROJECT_ID 2>/dev/null || {
    echo "⚠️  Could not set quota project. Running alternative setup..."
    gcloud auth application-default login
}

# Verify setup
echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Configuration Summary:"
echo "  Project ID: $PROJECT_ID"
echo "  Current User: $CURRENT_USER"
echo "  Region: asia-northeast1 (default)"
echo ""

# Check if all required env vars are set
echo "🔍 Checking environment variables..."
if [ -f .env ]; then
    source .env

    if [ -z "$ELEVENLABS_API_KEY" ] || [ "$ELEVENLABS_API_KEY" = "your-elevenlabs-api-key" ]; then
        echo "  ⚠️  ELEVENLABS_API_KEY not set - required for transcription"
    else
        echo "  ✅ ELEVENLABS_API_KEY is set"
    fi

    if [ -z "$SLACK_BOT_TOKEN" ] || [ "$SLACK_BOT_TOKEN" = "xoxb-your-bot-token" ]; then
        echo "  ⚠️  SLACK_BOT_TOKEN not set - required for Slack integration"
    else
        echo "  ✅ SLACK_BOT_TOKEN is set"
    fi
fi

echo ""
echo "📌 Next steps:"
echo "  1. Edit .env file and add any missing API keys"
echo "  2. Run: make deploy"
echo ""
echo "💡 Useful commands:"
echo "  make deploy  - Deploy to Cloud Run"
echo "  make dev     - Run locally for testing"
echo "  make status  - Check deployment status"
echo "  make logs    - View Cloud Run logs"
