#!/bin/bash

# Update Cloud Run service with all environment variables from .env

set -e

SERVICE_NAME="scribe-bot"
REGION="asia-northeast1"

echo "🔄 Updating Cloud Run environment variables from .env..."

# Load .env file and create a temporary file with escaped values
temp_file=$(mktemp)

# Read .env and properly escape values
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue
    
    # Remove surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    
    # For JSON values, keep them as-is
    if [[ $key == "GOOGLE_SERVICE_ACCOUNT_KEY" ]]; then
        # Write to temp file for special handling
        echo "$key=$value" >> $temp_file
    else
        echo "$key=$value" >> $temp_file
    fi
done < .env

# Update Cloud Run service with environment variables
echo "Setting environment variables on Cloud Run..."

# Read the service account key specially
GOOGLE_KEY=$(grep "^GOOGLE_SERVICE_ACCOUNT_KEY=" .env | cut -d'=' -f2- | sed "s/^'//" | sed "s/'$//")

# Update with all variables
gcloud run services update $SERVICE_NAME \
    --region=$REGION \
    --update-env-vars="$(grep -v '^GOOGLE_SERVICE_ACCOUNT_KEY=' $temp_file | paste -sd ',' -)" \
    --set-env-vars="GOOGLE_SERVICE_ACCOUNT_KEY=$GOOGLE_KEY"

# Clean up
rm -f $temp_file

echo "✅ Environment variables updated successfully!"

# Show service URL
echo ""
echo "Service URL:"
gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)"