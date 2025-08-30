# Cloud Run 公開アクセス制限の回避方法

## 問題
組織ポリシー `iam.allowedPolicyMemberDomains` により、Cloud Runサービスに`allUsers`での公開アクセスを設定できません。これにより、SlackとDiscordのWebhookが機能しません。

## 解決策

### オプション1: API Gateway を使用
Google Cloud API Gatewayを前段に配置して、公開エンドポイントを提供します。

```bash
# 1. OpenAPI仕様を作成
cat > openapi-spec.yaml << 'EOF'
swagger: '2.0'
info:
  title: Scribe Bot API
  version: 1.0.0
schemes:
  - https
produces:
  - application/json
paths:
  /slack/events:
    post:
      operationId: slackEvents
      x-google-backend:
        address: https://scribe-bot-804300863743.asia-northeast1.run.app/slack/events
        jwt_audience: https://scribe-bot-804300863743.asia-northeast1.run.app
      responses:
        '200':
          description: OK
  /discord/interactions:
    post:
      operationId: discordInteractions
      x-google-backend:
        address: https://scribe-bot-804300863743.asia-northeast1.run.app/discord/interactions
        jwt_audience: https://scribe-bot-804300863743.asia-northeast1.run.app
      responses:
        '200':
          description: OK
EOF

# 2. API Gatewayを作成
gcloud api-gateway apis create scribe-bot-api --project=automatic-recording-of-minutes
gcloud api-gateway api-configs create scribe-bot-config \
  --api=scribe-bot-api \
  --openapi-spec=openapi-spec.yaml \
  --project=automatic-recording-of-minutes
gcloud api-gateway gateways create scribe-bot-gateway \
  --api=scribe-bot-api \
  --api-config=scribe-bot-config \
  --location=asia-northeast1 \
  --project=automatic-recording-of-minutes
```

### オプション2: Firebase Hosting + Cloud Run
Firebase Hostingのrewritesを使用してCloud Runにプロキシします。

```bash
# 1. Firebaseプロジェクトを初期化
npm install -g firebase-tools
firebase init hosting

# 2. firebase.jsonを設定
cat > firebase.json << 'EOF'
{
  "hosting": {
    "public": "public",
    "rewrites": [
      {
        "source": "/slack/**",
        "run": {
          "serviceId": "scribe-bot",
          "region": "asia-northeast1"
        }
      },
      {
        "source": "/discord/**",
        "run": {
          "serviceId": "scribe-bot",
          "region": "asia-northeast1"
        }
      }
    ]
  }
}
EOF

# 3. デプロイ
firebase deploy
```

### オプション3: Load Balancer を使用
HTTP(S) Load Balancerを設定して、バックエンドとしてCloud Runを使用します。

```bash
# 1. NEGを作成
gcloud compute network-endpoint-groups create scribe-bot-neg \
  --region=asia-northeast1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=scribe-bot

# 2. Backend Serviceを作成
gcloud compute backend-services create scribe-bot-backend \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED

# 3. NEGをBackend Serviceに追加
gcloud compute backend-services add-backend scribe-bot-backend \
  --global \
  --network-endpoint-group=scribe-bot-neg \
  --network-endpoint-group-region=asia-northeast1

# 4. URL Mapを作成
gcloud compute url-maps create scribe-bot-lb \
  --default-service=scribe-bot-backend

# 5. HTTPS Proxyを作成
gcloud compute target-https-proxies create scribe-bot-https-proxy \
  --url-map=scribe-bot-lb \
  --ssl-certificates=YOUR_SSL_CERT

# 6. Forwarding Ruleを作成
gcloud compute forwarding-rules create scribe-bot-https-rule \
  --global \
  --target-https-proxy=scribe-bot-https-proxy \
  --ports=443
```

### オプション4: 別のプロジェクトを使用
組織ポリシーが適用されていない個人プロジェクトを使用します。

### オプション5: Cloud Functions に移行
Cloud FunctionsはHTTPS関数として公開できる可能性があります。

```bash
# Functions用にコードを調整してデプロイ
gcloud functions deploy scribe-bot \
  --runtime nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --region=asia-northeast1
```

## 推奨される解決策

**API Gateway（オプション1）** が最も簡単で、追加コストも最小限です。API Gatewayは公開エンドポイントを提供でき、バックエンドのCloud Runサービスに認証付きでリクエストを転送します。

## 一時的な回避策

開発/テスト用には、ngrokやCloudflare Tunnelなどのトンネリングサービスを使用して、ローカルで実行しているサービスを公開できます。

```bash
# ローカルで実行
make docker-run

# 別のターミナルでngrokを起動
ngrok http 8080
```