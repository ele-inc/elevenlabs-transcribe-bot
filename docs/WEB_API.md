# 文字起こし Web API

文字起こし Web API
は、1件の文字起こしを永続化された非同期ジョブとして実行します。呼び出し元が HTTP
接続を維持する必要はありません。返されたジョブ ID
を保存しておけば、画面の再読み込みやプロセスの再起動後も状態と結果を取得できます。

リクエスト・レスポンスの完全な定義は [OpenAPI 仕様](openapi.yaml)
を参照してください。

## 基盤のセットアップ

ジョブ状態は Firestore、結果は Cloud Storage に保存し、文字起こしは Cloud Run
Job
で実行します。初回は次の順番でセットアップとデプロイを行います。ワーカージョブの作成後に
API
のサービスアカウントへ実行権限を付けるため、セットアップスクリプトを最後にもう一度実行します。

```bash
./scripts/setup-transcription-api.sh
make deploy
./scripts/setup-transcription-api.sh
```

既定値は次のとおりです。

- Firestore データベース: `(default)`
- Firestore コレクション: `transcription_jobs`
- Cloud Run Job: `scribe-transcription-worker`
- 結果バケット: `${GCP_PROJECT_ID}-scribe-results`
- リージョン: `asia-northeast1`

必要に応じて、次の環境変数で上書きできます。

- `TRANSCRIPTION_JOBS_COLLECTION`
- `TRANSCRIPTION_JOB_NAME`
- `TRANSCRIPTION_RESULTS_BUCKET`
- `GCP_REGION`
- `TRANSCRIPTION_HLS_ALLOWED_HOSTS`

HLS URL を Web API から受け付ける場合は、`TRANSCRIPTION_HLS_ALLOWED_HOSTS`
に許可するホストをセミコロン区切りで指定してください。未指定の場合、Web API の HLS
入力はすべて拒否します。`localhost`、プライベート IP、リンクローカル IP
は許可リストに含めても拒否されます。

```bash
export TRANSCRIPTION_HLS_ALLOWED_HOSTS="media.example.com;cdn.example.net"
```

## 認証

Cloud Run サービスは IAM
認証を必須のまま運用します。呼び出すサービスごとに専用のサービスアカウントを用意し、`scribe-bot`
に `roles/run.invoker` を付与してください。この API
のためだけにサービスを一般公開しないでください。

API は `Authorization: Bearer <ID_TOKEN>` を受け取ります。`Idempotency-Key`
を指定した場合は、Google 署名済み ID
トークンから呼び出し元を検証し、呼び出し元ごとに冪等キーの名前空間を分離します。

セットアップスクリプトは別途、API の実行サービスアカウントへワーカージョブの
`roles/run.jobsExecutorWithOverrides` を付与します。各ワーカー実行へジョブ ID
を環境変数で渡すため、この権限が必要です。

## ジョブの作成

```http
POST /v1/transcription-jobs
Authorization: Bearer <ID_TOKEN>
Content-Type: application/json
Idempotency-Key: 呼び出し元で一意なリクエストID

{
  "sourceUrl": "https://www.youtube.com/watch?v=...",
  "options": {
    "diarize": true,
    "showTimestamp": true,
    "tagAudioEvents": true,
    "numSpeakers": 2,
    "speakerNames": ["田中", "山田"],
    "summarize": false
  }
}
```

`sourceUrl` には HTTPS URL を指定します。Google Drive、Dropbox、YouTube、Vimeo
Review、Utage、および許可済みホストの HLS URL
に対応しています。初期版ではファイルの直接アップロードには対応していません。大きなファイルは、先に対応サービスへアップロードしてください。

`options` には次を指定できます。

| JSON フィールド  | CLI での相当オプション     | 内容                     | 既定値  |
| ---------------- | -------------------------- | ------------------------ | ------- |
| `diarize`        | 話者分離の有効・無効       | 話者分離を行うか         | `true`  |
| `showTimestamp`  | `--no-timestamp` の反対    | タイムスタンプを含めるか | `true`  |
| `tagAudioEvents` | `--no-audio-events` の反対 | 音声イベントを検出するか | `true`  |
| `numSpeakers`    | `--num-speakers`           | 話者数（1〜32）          | 未指定  |
| `speakerNames`   | `--speaker-names`          | 話者名候補（1〜32件）    | 未指定  |
| `summarize`      | `--no-summarize` の反対    | 要約を生成するか         | `false` |

`speakerNames` を指定した場合は、その要素数を `numSpeakers`
として自動設定します。`numSpeakers` と `speakerNames` は `diarize: true`
の場合だけ使用できます。

正常に登録されると `202 Accepted` を返します。

```json
{
  "id": "b2e1...",
  "status": "queued",
  "createdAt": "2026-08-02T00:00:00.000Z",
  "updatedAt": "2026-08-02T00:00:00.000Z",
  "attempts": 0,
  "statusUrl": "/v1/transcription-jobs/b2e1...",
  "resultUrl": "/v1/transcription-jobs/b2e1.../result"
}
```

`Idempotency-Key`
の指定を推奨します。同じ呼び出し元が同じキーと同じ内容で再送すると、新しい文字起こしを開始せず元のジョブを返します。同じキーで内容が異なる場合は
`409 Conflict` です。キーは呼び出し元の中で一意にしてください。

## 状態と結果の取得

```http
GET /v1/transcription-jobs/{jobId}
GET /v1/transcription-jobs/{jobId}/result
```

ジョブ状態は次の4種類です。

- `queued`: 実行待ち
- `processing`: 処理中
- `succeeded`: 成功
- `failed`: 失敗

状態エンドポイントは5秒程度の間隔でポーリングしてください。結果が未完成の場合、結果エンドポイントは
`Retry-After: 5` を付けて `202 Accepted`
を返します。成功結果には文字起こし本文、検出言語、単語ごとの時刻、処理時間、任意の要約が含まれます。

失敗したジョブは明示的に再試行できます。

```http
POST /v1/transcription-jobs/{jobId}/retry
```

ブラウザ UI では `jobId` をアプリケーションの永続状態または `localStorage`
に保存します。画面の再読み込み後に状態 URL
を再度呼び出してポーリングを再開してください。文字起こし本体は Cloud Run Job
上で独立して動き続けます。

## Cloud Run IAM を使った呼び出し例

```bash
SERVICE_URL=$(gcloud run services describe scribe-bot \
  --region=asia-northeast1 --format='value(status.url)')
ID_TOKEN=$(gcloud auth print-identity-token)

curl -X POST "${SERVICE_URL}/v1/transcription-jobs" \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-001" \
  -d '{"sourceUrl":"https://www.youtube.com/watch?v=..."}'
```
