#!/bin/bash

# GCP Project Setup Script
echo "🔧 Setting up GCP Project for ElevenLabs Scribe Bot"
echo ""

# Set project ID
PROJECT_ID="automatic-recording-of-minutes"
echo "Using project: $PROJECT_ID"

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo ""
echo "📦 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID || echo "Cloud Build API might already be enabled or you need permissions"
gcloud services enable run.googleapis.com --project=$PROJECT_ID || echo "Cloud Run API might already be enabled or you need permissions"
gcloud services enable containerregistry.googleapis.com --project=$PROJECT_ID || echo "Container Registry API might already be enabled or you need permissions"
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID || echo "Secret Manager API might already be enabled or you need permissions"

# Check current user
echo ""
echo "👤 Current user:"
gcloud config get-value account

# Check IAM permissions
echo ""
echo "🔐 Checking your permissions..."
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:$(gcloud config get-value account)" \
  --format="table(bindings.role)"

echo ""
echo "📝 If you're missing permissions, ask your project admin to grant you these roles:"
echo "  - Cloud Build Editor (roles/cloudbuild.builds.editor)"
echo "  - Cloud Run Admin (roles/run.admin)"
echo "  - Service Usage Consumer (roles/serviceusage.serviceUsageConsumer)"
echo "  - Storage Admin (roles/storage.admin) - for Cloud Build artifacts"
echo ""
echo "Admin can run:"
echo "  gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "    --member='user:$(gcloud config get-value account)' \\"
echo "    --role='roles/cloudbuild.builds.editor'"
echo ""
echo "  gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "    --member='user:$(gcloud config get-value account)' \\"
echo "    --role='roles/run.admin'"
echo ""
echo "  gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "    --member='user:$(gcloud config get-value account)' \\"
echo "    --role='roles/storage.admin'"