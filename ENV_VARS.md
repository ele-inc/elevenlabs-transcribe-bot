# Environment Variables Configuration

## Required Environment Variables

### Core Services

| Variable | Description | Example |
|----------|-------------|---------|
| `ELEVENLABS_API_KEY` | ElevenLabs API key for transcription | `sk_xxxxxxxxxxxxx` |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token | `xoxb-xxxxxxxxxxxxx` |

### Discord (Optional)
| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_APPLICATION_ID` | Discord Application ID | `123456789012345678` |
| `DISCORD_PUBLIC_KEY` | Discord Public Key for verification | `xxxxxxxxxxxxx` |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | `xxxxxxxxxxxxx` |

### Google Drive (Optional)
| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Service Account JSON key (as single line) | `{"type":"service_account",...}` |
| `GOOGLE_IMPERSONATE_EMAIL` | Email to impersonate (optional) | `user@example.com` |

### Supabase (Optional - for logging)
| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

## Setting Environment Variables in Cloud Run

### Method 1: Using gcloud CLI

```bash
gcloud run services update scribe-bot \
  --region asia-northeast1 \
  --set-env-vars \
    ELEVENLABS_API_KEY="your-api-key",\
    SLACK_BOT_TOKEN="xoxb-your-token",\
    DISCORD_APPLICATION_ID="your-app-id",\
    DISCORD_PUBLIC_KEY="your-public-key",\
    DISCORD_BOT_TOKEN="your-bot-token",\
    SUPABASE_URL="https://your-project.supabase.co",\
    SUPABASE_SERVICE_ROLE_KEY="your-service-key"
```

### Method 2: Using Secret Manager (Recommended for production)

1. Create secrets in Secret Manager:
```bash
# Create secrets
echo -n "your-api-key" | gcloud secrets create elevenlabs-api-key --data-file=-
echo -n "xoxb-your-token" | gcloud secrets create slack-bot-token --data-file=-
echo -n "your-service-account-json" | gcloud secrets create google-service-account --data-file=-
```

2. Update Cloud Run service to use secrets:
```bash
gcloud run services update scribe-bot \
  --region asia-northeast1 \
  --set-secrets \
    ELEVENLABS_API_KEY=elevenlabs-api-key:latest,\
    SLACK_BOT_TOKEN=slack-bot-token:latest,\
    GOOGLE_SERVICE_ACCOUNT_KEY=google-service-account:latest
```

### Method 3: Using Cloud Console

1. Go to Cloud Run in Google Cloud Console
2. Click on "scribe-bot" service
3. Click "Edit & Deploy New Revision"
4. Go to "Variables & Secrets" tab
5. Add environment variables or reference secrets

## Google Service Account Setup

### Creating a Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to "IAM & Admin" > "Service Accounts"
3. Click "Create Service Account"
4. Give it a name like "scribe-bot-drive-access"
5. Grant the role "Google Drive API > Drive File Access"
6. Create and download JSON key

### Preparing the JSON key for Cloud Run

The JSON key must be converted to a single line:

```bash
# Convert JSON to single line
cat service-account-key.json | jq -c . > service-account-key-single-line.json

# Or using Python
python -c "import json; print(json.dumps(json.load(open('service-account-key.json'))))"
```

### Enabling Google Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to "APIs & Services" > "Enable APIs and Services"
3. Search for "Google Drive API"
4. Click "Enable"

### Sharing Files with Service Account

For the service account to access Google Drive files:

1. Find the service account email (e.g., `scribe-bot@your-project.iam.gserviceaccount.com`)
2. Share the Google Drive files/folders with this email address
3. Give "Viewer" permission

## Local Development

Create a `.env` file in the project root:

```bash
cp .env.example .env
# Edit .env with your actual values
```

Run locally with environment variables:

```bash
# Load from .env file
export $(cat .env | grep -v '^#' | xargs)

# Run the server
cd supabase/functions/scribe-bot
deno run --allow-all index.ts
```

## Troubleshooting

### Missing Environment Variables

Check which variables are set:
```bash
gcloud run services describe scribe-bot \
  --region asia-northeast1 \
  --format="value(spec.template.spec.containers[0].env[].name)"
```

### Invalid Google Service Account Key

Common issues:
- JSON not properly formatted as single line
- Missing quotes or escaped characters
- Service account doesn't have necessary permissions
- Google Drive API not enabled

### Slack Token Issues

Verify your Slack token:
- Starts with `xoxb-` for bot tokens
- Has necessary scopes: `chat:write`, `files:read`, `app_mentions:read`

## Security Best Practices

1. **Never commit secrets to git**
   - Use `.gitignore` to exclude `.env` files
   - Use Secret Manager for production

2. **Rotate keys regularly**
   - Update API keys every 90 days
   - Use versioned secrets in Secret Manager

3. **Principle of least privilege**
   - Only grant necessary permissions
   - Use separate service accounts for different environments

4. **Monitor access**
   - Enable audit logging in Cloud Run
   - Monitor API usage in respective dashboards