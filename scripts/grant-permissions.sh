#!/bin/bash

# Grant GCP permissions script
# Run this as project owner/admin to grant permissions to a user

PROJECT_ID="automatic-recording-of-minutes"
USER_EMAIL="shun.tagami@ele-inc.com"

echo "🔐 Granting permissions to $USER_EMAIL for project $PROJECT_ID"
echo ""

# Cloud Build Editor
echo "Adding Cloud Build Editor role..."
gcloud projects add-iam-policy-binding $PROJECT_ID --member="user:$USER_EMAIL" --role="roles/cloudbuild.builds.editor"

# Cloud Run Admin
echo "Adding Cloud Run Admin role..."
gcloud projects add-iam-policy-binding $PROJECT_ID --member="user:$USER_EMAIL" --role="roles/run.admin"

# Storage Admin (for Cloud Build artifacts)
echo "Adding Storage Admin role..."
gcloud projects add-iam-policy-binding $PROJECT_ID --member="user:$USER_EMAIL" --role="roles/storage.admin"

# Service Usage Consumer
echo "Adding Service Usage Consumer role..."
gcloud projects add-iam-policy-binding $PROJECT_ID --member="user:$USER_EMAIL" --role="roles/serviceusage.serviceUsageConsumer"

# Secret Manager Admin (optional)
echo "Adding Secret Manager Admin role..."
gcloud projects add-iam-policy-binding $PROJECT_ID --member="user:$USER_EMAIL" --role="roles/secretmanager.admin"

echo ""
echo "✅ Permissions granted successfully!"
echo ""
echo "Verifying permissions..."
gcloud projects get-iam-policy $PROJECT_ID --flatten="bindings[].members" --filter="bindings.members:$USER_EMAIL" --format="table(bindings.role)"