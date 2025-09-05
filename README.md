# ElevenLabs Transcribe Bot for Slack & Discord

A multi-platform bot that uses the [ElevenLabs Scribe API](https://elevenlabs.io/speech-to-text) to transcribe audio and video files. Supports both Slack and Discord platforms with unified transcription capabilities. Built with Deno and runs on Google Cloud Run.

## Features

- **Multi-platform support:** Works with both Slack and Discord
- Transcribes audio and video files when mentioned or via slash commands
- **Cloud storage integration:** Supports Google Drive and Dropbox links for transcription
- **Speaker diarization:** Identifies different speakers in the conversation
- **Automatic timestamps:** Adds timestamps for better navigation
- **Audio event detection:** Detects music, laughter, and other audio events
- **Flexible output:** Returns transcripts as text files in the conversation thread

## Transcription Options

You can customize the transcription by adding options when mentioning the bot:

- `--no-diarize` - Disable speaker identification (default: enabled)
- `--no-timestamp` - Disable timestamps (default: enabled)
- `--no-audio-events` - Disable audio event detection (default: enabled)
- `--num-speakers N` - Specify the number of speakers (1-32, default: 2 when diarization is enabled)
- `--speaker-names "<name1>,<name2>"` - Specify speaker names (AI will automatically identify who is who)

Example:
```
@bot transcribe this file --no-timestamp --no-diarize
@bot transcribe this file --num-speakers 3
@bot https://drive.google.com/file/d/xxxxx/view --num-speakers 4
@bot https://www.dropbox.com/s/xxxxx/audio.mp3?dl=0 --speaker-names "田中,山田"
@bot transcribe this file --speaker-names "Alice,Bob"
```

**Note:** 
- The `--num-speakers` option only works when speaker diarization is enabled (default). If you use `--no-diarize`, the num-speakers setting will be ignored.
- The `--speaker-names` option uses OpenAI to automatically identify which speaker is which based on the conversation content. You need to set `OPENAI_API_KEY` in your environment variables for this feature to work.

## Project Structure

```
src/
├── index.ts          # Main entry point and request router
├── slack-handler.ts  # Slack event handler
├── discord-handler.ts # Discord interaction handler
├── scribe.ts         # ElevenLabs Scribe API integration
├── slack.ts          # Slack API utilities
├── discord.ts        # Discord API utilities
├── types.ts          # TypeScript type definitions
└── utils.ts          # Helper functions for text processing
```

## Tech Stack

- [Deno](https://deno.land/) - JavaScript/TypeScript runtime
- [Google Cloud Run](https://cloud.google.com/run) - Container hosting platform
- [ElevenLabs Scribe API](https://elevenlabs.io/docs/api-reference/speech-to-text) - Speech-to-text transcription
- Slack Events API - Slack bot event handling
- Discord Interactions API - Discord bot interaction handling

## Setup

### Prerequisites

- [Deno](https://deno.land/manual/getting_started/installation) installed
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- An ElevenLabs account and API key.
- A Google Cloud project with Cloud Run enabled.
- A Slack app with bot token and signing secret (for Slack bot).
- A Discord application with bot token and public key (for Discord bot).

### 1. Clone the repository

```bash
git clone <repository-url>
cd <repository-name>
```

### 2. Set up environment variables

Create a `.env` file in the project root directory and add the following environment variables.

```
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
SLACK_BOT_TOKEN="your-slack-bot-token"
DISCORD_APPLICATION_ID="your-discord-app-id"
DISCORD_PUBLIC_KEY="your-discord-public-key"
DISCORD_BOT_TOKEN="your-discord-bot-token"
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"..."}'  # Google service account JSON
```

### 3. Deploy to Cloud Run

Deploy the bot to Google Cloud Run:

```bash
make deploy
```

Or manually:

```bash
gcloud run deploy scribe-bot \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated
```

### 4. Set up the Slack App

1. Create a new Slack app at https://api.slack.com/apps
2. Go to "OAuth & Permissions" and add the following bot token scopes:
   - `app_mentions:read` - To detect when the bot is mentioned
   - `files:read` - To read file information
   - `files:write` - To upload transcript files
   - `chat:write` - To send messages
3. Install the app to your workspace and copy the Bot User OAuth Token
4. Go to "Event Subscriptions" and enable events
5. Set the Request URL to your Cloud Run URL:
   ```
   https://YOUR-CLOUD-RUN-URL/slack/events
   ```
6. Subscribe to the following bot events:
   - `app_mention` - To detect when the bot is mentioned with files
7. Go to "Basic Information" and copy the Signing Secret

### 5. Set up the Discord Bot

1. Create a new Discord application at https://discord.com/developers/applications
2. Go to the "Bot" section and create a bot
3. Copy the Bot Token (you'll need this for `DISCORD_BOT_TOKEN`)
4. Go to the "General Information" section and copy:
   - Application ID (for `DISCORD_APPLICATION_ID`)
   - Public Key (for `DISCORD_PUBLIC_KEY`)
5. Go to the "Interactions Endpoint URL" section and set it to:
   ```
   https://YOUR-CLOUD-RUN-URL/discord/interactions
   ```
6. In the "Bot" section, enable the following Privileged Gateway Intents:
   - MESSAGE CONTENT INTENT (to read message content)
7. Generate an invite URL from the "OAuth2 > URL Generator" section with:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Attach Files`, `Read Message History`
8. Use the generated URL to invite the bot to your Discord server
9. Register slash commands by running:
   ```bash
   npm run register-discord-commands
   ```

The Cloud Run URL can be found in the output of the `gcloud run deploy` command or in your Google Cloud Console.

## Usage

### Slack

#### With file uploads:
1. Upload an audio or video file to a Slack channel
2. Mention the bot in the same message or as a reply
3. (Optional) Add transcription options like `--no-timestamp` or `--no-diarize`
4. The bot will process the file and reply with a transcript text file

#### With Google Drive links:
1. Share a Google Drive video/audio file link in a message
2. Mention the bot in the same message with the link
3. (Optional) Add transcription options
4. The bot will download from Google Drive and transcribe

Example: `@bot https://drive.google.com/file/d/xxxxx/view --num-speakers 3`

### Discord

#### Using slash commands:
1. Use the `/transcribe` command in any channel
2. Attach an audio or video file to the command
3. (Optional) Add transcription options as command parameters
4. The bot will reply with the transcript as a text file

#### With file uploads:
1. Upload an audio or video file to a Discord channel
2. Reply to the message with `/transcribe` command
3. (Optional) Add transcription options
4. The bot will process and return the transcript

#### With Google Drive links:
1. Use `/transcribe url:<drive_link>` command
2. (Optional) Add transcription options as parameters
3. The bot will download and transcribe the file

Example: `/transcribe url:https://drive.google.com/file/d/xxxxx/view speakers:3`

### Supported File Formats

- Audio: MP3, WAV, M4A, AAC, OGG, WebM
- Video: MP4, MOV, AVI, MPEG, WebM

### Output Format

The transcript will be formatted based on your options:

**With speaker diarization (default):**
```
[0:00] speaker_0: こんにちは、今日の会議を始めます。
[0:05] speaker_1: よろしくお願いします。
```

**Without speaker diarization:**
```
[0:00] こんにちは、今日の会議を始めます。
[0:05] よろしくお願いします。
```

**Without timestamps:**
```
speaker_0: こんにちは、今日の会議を始めます。
speaker_1: よろしくお願いします。
```
