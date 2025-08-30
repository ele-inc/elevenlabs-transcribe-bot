#!/bin/bash

# Quick Deploy Script - Alternative deployment method
set -e

echo "🚀 Quick Deploy for ElevenLabs Scribe Bot"
echo "=========================================="
echo ""

# Load .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check available projects with billing enabled
echo "📋 Checking available projects with billing enabled..."
echo ""

PROJECTS_WITH_BILLING=""
for project in $(gcloud projects list --format="value(projectId)"); do
    BILLING=$(gcloud billing projects describe $project --format="value(billingAccountName)" 2>/dev/null || echo "")
    if [ -n "$BILLING" ]; then
        echo "✅ $project (Billing enabled)"
        PROJECTS_WITH_BILLING="$PROJECTS_WITH_BILLING $project"
    else
        echo "❌ $project (No billing)"
    fi
done

echo ""
echo "Choose an option:"
echo "1) Use a project with billing enabled"
echo "2) Create a new project"
echo "3) Deploy using Docker Hub instead (no GCP build required)"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        # Use existing project with billing
        if [ -z "$PROJECTS_WITH_BILLING" ]; then
            echo "❌ No projects with billing enabled found."
            echo "Please enable billing on a project or create a new one."
            exit 1
        fi
        
        echo "Available projects with billing:"
        echo "$PROJECTS_WITH_BILLING"
        read -p "Enter PROJECT_ID: " PROJECT_ID
        
        # Update .env
        sed -i.bak "s/^GCP_PROJECT_ID=.*/GCP_PROJECT_ID=$PROJECT_ID/" .env
        echo "✅ Updated .env with PROJECT_ID=$PROJECT_ID"
        
        # Set project
        gcloud config set project $PROJECT_ID
        
        # Enable APIs
        echo "Enabling required APIs..."
        gcloud services enable cloudbuild.googleapis.com run.googleapis.com containerregistry.googleapis.com --project $PROJECT_ID
        
        # Deploy
        echo "Deploying to Cloud Run..."
        make deploy
        ;;
        
    2)
        # Create new project
        read -p "Enter a name for your project (lowercase, no spaces): " PROJECT_NAME
        PROJECT_ID="$PROJECT_NAME-$(date +%s)"
        
        echo "Creating project: $PROJECT_ID"
        gcloud projects create $PROJECT_ID --name="$PROJECT_NAME"
        
        # List billing accounts
        echo ""
        echo "📊 Available billing accounts:"
        gcloud billing accounts list
        
        read -p "Enter BILLING_ACCOUNT_ID: " BILLING_ACCOUNT
        gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT
        
        # Update .env
        sed -i.bak "s/^GCP_PROJECT_ID=.*/GCP_PROJECT_ID=$PROJECT_ID/" .env
        echo "✅ Updated .env with PROJECT_ID=$PROJECT_ID"
        
        # Set project and enable APIs
        gcloud config set project $PROJECT_ID
        gcloud services enable cloudbuild.googleapis.com run.googleapis.com containerregistry.googleapis.com --project $PROJECT_ID
        
        # Deploy
        echo "Deploying to Cloud Run..."
        make deploy
        ;;
        
    3)
        # Alternative: Use pre-built image or build locally
        echo ""
        echo "🐳 Alternative deployment using local Docker build"
        echo ""
        
        read -p "Enter PROJECT_ID for Cloud Run deployment: " PROJECT_ID
        
        # Update .env
        sed -i.bak "s/^GCP_PROJECT_ID=.*/GCP_PROJECT_ID=$PROJECT_ID/" .env
        
        # Build locally and push to Docker Hub
        echo "Building Docker image locally..."
        docker build -t elevenlabs-scribe-bot .
        
        echo ""
        echo "To deploy this image:"
        echo "1. Push to Docker Hub:"
        echo "   docker tag elevenlabs-scribe-bot YOUR_DOCKERHUB_USERNAME/elevenlabs-scribe-bot"
        echo "   docker push YOUR_DOCKERHUB_USERNAME/elevenlabs-scribe-bot"
        echo ""
        echo "2. Deploy to Cloud Run:"
        echo "   gcloud run deploy scribe-bot \\"
        echo "     --image YOUR_DOCKERHUB_USERNAME/elevenlabs-scribe-bot \\"
        echo "     --region asia-northeast1 \\"
        echo "     --allow-unauthenticated \\"
        echo "     --set-env-vars \"\$(cat .env | grep -v '^#' | paste -sd ',' -)\""
        echo ""
        echo "Or use Google Artifact Registry without Cloud Build:"
        echo "   gcloud artifacts repositories create scribe-bot --repository-format=docker --location=asia"
        echo "   docker tag elevenlabs-scribe-bot asia-docker.pkg.dev/$PROJECT_ID/scribe-bot/app"
        echo "   docker push asia-docker.pkg.dev/$PROJECT_ID/scribe-bot/app"
        ;;
esac

echo ""
echo "✅ Setup complete!"