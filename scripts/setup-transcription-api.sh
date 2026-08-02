#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-automatic-recording-of-minutes}"
REGION="${GCP_REGION:-asia-northeast1}"
SERVICE="scribe-bot"
JOB_NAME="${TRANSCRIPTION_JOB_NAME:-scribe-transcription-worker}"
RESULTS_BUCKET="${TRANSCRIPTION_RESULTS_BUCKET:-${PROJECT_ID}-scribe-results}"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SERVICE_ACCOUNT="${TRANSCRIPTION_RUNTIME_SERVICE_ACCOUNT:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "Enabling Firestore, Cloud Run, and Cloud Storage APIs..."
gcloud services enable \
  firestore.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

if ! gcloud firestore databases describe \
  --project="$PROJECT_ID" \
  --database='(default)' >/dev/null 2>&1; then
  echo "Creating the default Firestore database..."
  gcloud firestore databases create \
    --project="$PROJECT_ID" \
    --database='(default)' \
    --location="$REGION" \
    --type=firestore-native
fi

if ! gcloud storage buckets describe "gs://${RESULTS_BUCKET}" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating result bucket gs://${RESULTS_BUCKET}..."
  gcloud storage buckets create "gs://${RESULTS_BUCKET}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi

echo "Granting the runtime identity access to job state and results..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role='roles/datastore.user' >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${RESULTS_BUCKET}" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role='roles/storage.objectAdmin' >/dev/null

if gcloud run jobs describe "$JOB_NAME" \
  --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  echo "Allowing the API service identity to start the worker job..."
  gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
    --role='roles/run.jobsExecutorWithOverrides' >/dev/null
else
  echo "Worker job is not deployed yet; run this setup script again after make deploy."
fi

echo "Transcription API infrastructure is ready."
echo "Service: ${SERVICE}"
echo "Worker job: ${JOB_NAME}"
echo "Result bucket: gs://${RESULTS_BUCKET}"
