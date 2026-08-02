#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-automatic-recording-of-minutes}"
REGION="${GCP_REGION:-asia-northeast1}"
SERVICE="scribe-api"
JOB_NAME="${TRANSCRIPTION_JOB_NAME:-scribe-transcription-worker}"
RESULTS_BUCKET="${TRANSCRIPTION_RESULTS_BUCKET:-${PROJECT_ID}-scribe-results}"
API_SERVICE_ACCOUNT="${TRANSCRIPTION_API_SERVICE_ACCOUNT:-scribe-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
WORKER_SERVICE_ACCOUNT="${TRANSCRIPTION_WORKER_SERVICE_ACCOUNT:-scribe-worker-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
RESULT_WRITER_ROLE_ID="scribeTranscriptionResultWriter"
RESULT_WRITER_ROLE="projects/${PROJECT_ID}/roles/${RESULT_WRITER_ROLE_ID}"
RESULT_PREFIX_CONDITION="expression=resource.name.startsWith('projects/_/buckets/${RESULTS_BUCKET}/objects/transcription-results/'),title=transcription_results_only,description=文字起こし結果プレフィックスだけに限定"
WORKER_SECRETS=(
  ELEVENLABS_API_KEY
  GOOGLE_CLIENT_EMAIL
  GOOGLE_IMPERSONATE_EMAIL
  GOOGLE_PRIVATE_KEY
  GOOGLE_GENERATIVE_AI_API_KEY
  YOUTUBE_PROXY
  YOUTUBE_COOKIES_BASE64
)

echo "Firestore、Cloud Run、Cloud Storage、IAM、Secret Manager API を有効化しています..."
gcloud services enable \
  firestore.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

ensure_service_account() {
  local email="$1"
  local account_id="${email%%@*}"
  local display_name="$2"
  if ! gcloud iam service-accounts describe "$email" \
    --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "サービスアカウント $email を作成しています..."
    gcloud iam service-accounts create "$account_id" \
      --project="$PROJECT_ID" \
      --display-name="$display_name"
  fi
}

bucket_has_unconditional_binding() {
  local role="$1"
  local member="$2"
  gcloud storage buckets get-iam-policy "gs://${RESULTS_BUCKET}" \
    --format="value[separator='\n'](bindings.filter(\"role=${role} AND -condition:*\").members.flatten())" |
    grep -Fxq "$member"
}

ensure_service_account "$API_SERVICE_ACCOUNT" "Scribe transcription API"
ensure_service_account "$WORKER_SERVICE_ACCOUNT" "Scribe transcription worker"

if gcloud iam roles describe "$RESULT_WRITER_ROLE_ID" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "文字起こし結果書き込みロールを更新しています..."
  gcloud iam roles update "$RESULT_WRITER_ROLE_ID" \
    --project="$PROJECT_ID" \
    --permissions='storage.objects.create,storage.objects.delete' \
    --stage=GA >/dev/null
else
  echo "文字起こし結果書き込みロールを作成しています..."
  gcloud iam roles create "$RESULT_WRITER_ROLE_ID" \
    --project="$PROJECT_ID" \
    --title='Scribe文字起こし結果書き込み' \
    --description='文字起こし結果の作成と上書きに必要な最小権限' \
    --permissions='storage.objects.create,storage.objects.delete' \
    --stage=GA >/dev/null
fi

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

echo "API サービスアカウントへジョブ状態の管理権限と結果の読取権限を付与しています..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${API_SERVICE_ACCOUNT}" \
  --role='roles/datastore.user' >/dev/null
if bucket_has_unconditional_binding \
  'roles/storage.objectViewer' "serviceAccount:${API_SERVICE_ACCOUNT}"; then
  gcloud storage buckets remove-iam-policy-binding "gs://${RESULTS_BUCKET}" \
    --member="serviceAccount:${API_SERVICE_ACCOUNT}" \
    --role='roles/storage.objectViewer' \
    --condition=None >/dev/null
fi
gcloud storage buckets add-iam-policy-binding "gs://${RESULTS_BUCKET}" \
  --member="serviceAccount:${API_SERVICE_ACCOUNT}" \
  --role='roles/storage.objectViewer' \
  --condition="$RESULT_PREFIX_CONDITION" >/dev/null

echo "Worker サービスアカウントへ処理・結果保存権限を付与しています..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}" \
  --role='roles/datastore.user' >/dev/null
if bucket_has_unconditional_binding \
  'roles/storage.objectAdmin' "serviceAccount:${WORKER_SERVICE_ACCOUNT}"; then
  echo "Worker の既存Storage Object Admin権限を削除しています..."
  gcloud storage buckets remove-iam-policy-binding "gs://${RESULTS_BUCKET}" \
    --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}" \
    --role='roles/storage.objectAdmin' \
    --condition=None >/dev/null
fi
gcloud storage buckets add-iam-policy-binding "gs://${RESULTS_BUCKET}" \
  --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}" \
  --role="$RESULT_WRITER_ROLE" \
  --condition="$RESULT_PREFIX_CONDITION" >/dev/null

echo "Worker が使用するシークレットだけに参照権限を付与しています..."
PROJECT_SECRET_ACCESS=$(gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten='bindings[].members' \
  --filter="bindings.role=roles/secretmanager.secretAccessor AND bindings.members=serviceAccount:${WORKER_SERVICE_ACCOUNT} AND NOT bindings.condition:*" \
  --format='value(bindings.role)')
if [ -n "$PROJECT_SECRET_ACCESS" ]; then
  echo "Worker の既存プロジェクト単位シークレット権限を削除しています..."
  gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}" \
    --role='roles/secretmanager.secretAccessor' \
    --condition=None >/dev/null
fi
MISSING_SECRET_VALUES=()
for secret_name in "${WORKER_SECRETS[@]}"; do
  if ! gcloud secrets describe "$secret_name" \
    --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "シークレット ${secret_name} を作成しています..."
    gcloud secrets create "$secret_name" \
      --project="$PROJECT_ID" \
      --replication-policy=automatic >/dev/null
    MISSING_SECRET_VALUES+=("$secret_name")
  fi
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:${WORKER_SERVICE_ACCOUNT}" \
    --role='roles/secretmanager.secretAccessor' >/dev/null
done

if [ ${#MISSING_SECRET_VALUES[@]} -gt 0 ]; then
  echo "次のシークレットを作成しましたが、値はまだ登録されていません:" >&2
  printf '  - %s\n' "${MISSING_SECRET_VALUES[@]}" >&2
  echo "各値を次の形式で登録してから、このスクリプトを再実行してください。" >&2
  echo "printf '%s' \"\$VALUE\" | gcloud secrets versions add SECRET_NAME --data-file=- --project=${PROJECT_ID}" >&2
  exit 1
fi

CLOUD_BUILD_SERVICE_ACCOUNT=$(gcloud builds get-default-service-account \
  --project="$PROJECT_ID" 2>/dev/null || true)
if [ -n "$CLOUD_BUILD_SERVICE_ACCOUNT" ]; then
  echo "Cloud Build へ API・Worker サービスアカウントの使用権限を付与しています..."
  for runtime_account in "$API_SERVICE_ACCOUNT" "$WORKER_SERVICE_ACCOUNT"; do
    gcloud iam service-accounts add-iam-policy-binding "$runtime_account" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:${CLOUD_BUILD_SERVICE_ACCOUNT}" \
      --role='roles/iam.serviceAccountUser' >/dev/null
  done
fi

if gcloud run jobs describe "$JOB_NAME" \
  --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  echo "API サービスアカウントへワーカージョブの実行権限を付与しています..."
  gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --member="serviceAccount:${API_SERVICE_ACCOUNT}" \
    --role='roles/run.jobsExecutorWithOverrides' >/dev/null
else
  echo "ワーカージョブは未デプロイです。make deploy の後にこのスクリプトを再実行してください。"
fi

echo "文字起こし API の基盤準備が完了しました。"
echo "API サービス: ${SERVICE} (${API_SERVICE_ACCOUNT})"
echo "ワーカージョブ: ${JOB_NAME} (${WORKER_SERVICE_ACCOUNT})"
echo "結果バケット: gs://${RESULTS_BUCKET}"
