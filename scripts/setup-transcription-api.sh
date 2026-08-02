#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-automatic-recording-of-minutes}"
REGION="${GCP_REGION:-asia-northeast1}"
SERVICE="scribe-bot"
JOB_NAME="${TRANSCRIPTION_JOB_NAME:-scribe-transcription-worker}"
RESULTS_BUCKET="${TRANSCRIPTION_RESULTS_BUCKET:-${PROJECT_ID}-scribe-results}"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SERVICE_ACCOUNT="${TRANSCRIPTION_RUNTIME_SERVICE_ACCOUNT:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "Firestore、Cloud Run、Cloud Storage API を有効化しています..."
gcloud services enable \
  firestore.googleapis.com \
  run.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

if ! gcloud firestore databases describe \
  --project="$PROJECT_ID" \
  --database='(default)' >/dev/null 2>&1; then
  echo "既定の Firestore データベースを作成しています..."
  gcloud firestore databases create \
    --project="$PROJECT_ID" \
    --database='(default)' \
    --location="$REGION" \
    --type=firestore-native
fi

if ! gcloud storage buckets describe "gs://${RESULTS_BUCKET}" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "結果バケット gs://${RESULTS_BUCKET} を作成しています..."
  gcloud storage buckets create "gs://${RESULTS_BUCKET}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi

echo "実行サービスアカウントへジョブ状態と結果のアクセス権を付与しています..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role='roles/datastore.user' >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${RESULTS_BUCKET}" \
  --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role='roles/storage.objectAdmin' >/dev/null

if gcloud run jobs describe "$JOB_NAME" \
  --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  echo "API のサービスアカウントへワーカージョブの実行権限を付与しています..."
  gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
    --role='roles/run.jobsExecutorWithOverrides' >/dev/null
else
  echo "ワーカージョブは未デプロイです。make deploy の後にこのスクリプトを再実行してください。"
fi

echo "文字起こし API の基盤準備が完了しました。"
echo "サービス: ${SERVICE}"
echo "ワーカージョブ: ${JOB_NAME}"
echo "結果バケット: gs://${RESULTS_BUCKET}"
