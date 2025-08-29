# Discord Bot Setup Guide

このガイドでは、ElevenLabs Scribe BotをDiscordで使用するための設定方法を説明します。

## 前提条件

- Discord開発者アカウント
- Supabase Edge Functionがデプロイ済み
- 管理者権限を持つDiscordサーバー

## 1. Discord Applicationの作成

1. [Discord Developer Portal](https://discord.com/developers/applications)にアクセス
2. 「New Application」をクリック
3. アプリケーション名を入力（例：`ElevenLabs Scribe Bot`）
4. 作成後、以下の情報をメモ：
   - **Application ID**: General Information タブから取得
   - **Public Key**: General Information タブから取得

## 2. Botの設定

1. 左メニューから「Bot」を選択
2. 「Reset Token」をクリックしてBot Tokenを生成
3. **Bot Token**をメモ（一度しか表示されません）
4. Bot設定：
   - **Public Bot**: OFF（推奨）
   - **Requires OAuth2 Code Grant**: OFF
   - **Message Content Intent**: ON（メッセージ内容を読み取るため）

## 3. Slash Commandsの登録

以下のコマンドを登録します：

### /transcribe コマンド

```json
{
  "name": "transcribe",
  "description": "音声/動画ファイルを文字起こしします",
  "options": [
    {
      "name": "file",
      "description": "文字起こしするファイル",
      "type": 11,
      "required": false
    },
    {
      "name": "url",
      "description": "Google DriveのURL",
      "type": 3,
      "required": false
    },
    {
      "name": "options",
      "description": "オプション (--no-diarize, --no-timestamp, --num-speakers 3 など)",
      "type": 3,
      "required": false
    }
  ]
}
```

### Message Command (右クリックメニュー)

```json
{
  "name": "Transcribe Audio/Video",
  "type": 3
}
```

## 4. OAuth2設定とBot招待

### 重要: 必ず以下の手順でBotを招待してください

1. 左メニューから「OAuth2」→「URL Generator」を選択
2. **Scopes**で以下の**両方**を選択（両方必須）：
   - ✅ `bot` - Botユーザーをサーバーに追加するために必要
   - ✅ `applications.commands` - スラッシュコマンドを使用するために必要
3. **Bot Permissions**で以下を選択：
   - ✅ Send Messages
   - ✅ Send Messages in Threads
   - ✅ Attach Files
   - ✅ Read Message History
   - ✅ Use Slash Commands
   - （権限の整数値: `277025490944`）
4. ページ下部に生成されたURLをコピー
5. **生成されたURLをブラウザで直接開く**
6. Botを追加したいサーバーを選択して「認証」をクリック

### 注意事項
- `bot` scopeを選択しないと、スラッシュコマンドは使えてもBotがメッセージを送信できません
- URLは必ず生成されたものをそのまま使用してください

## 5. 環境変数の設定

`.env`ファイルに以下を追加：

```bash
# Discord Bot Configuration
DISCORD_BOT_TOKEN="your_bot_token_here"
DISCORD_PUBLIC_KEY="your_public_key_here"
DISCORD_APPLICATION_ID="your_application_id_here"
```

Supabaseにシークレットを設定：

```bash
supabase secrets set DISCORD_BOT_TOKEN="your_bot_token_here"
supabase secrets set DISCORD_PUBLIC_KEY="your_public_key_here"
supabase secrets set DISCORD_APPLICATION_ID="your_application_id_here"
```

## 6. Interaction Endpoint URLの設定

1. Discord Developer Portalに戻る
2. 「General Information」タブを選択
3. **Interactions Endpoint URL**に以下を入力：
   ```
   https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/scribe-bot
   ```
4. 「Save Changes」をクリック
   - 自動的に検証が行われます
   - 成功すると緑色のチェックマークが表示されます

## 7. 使い方

### Slash Command

```
/transcribe file:@audio.mp3
/transcribe url:https://drive.google.com/file/d/xxxxx/view
/transcribe url:https://drive.google.com/file/d/xxxxx/view options:--num-speakers 3 --no-timestamp
```

### メッセージから文字起こし

1. 音声/動画ファイルが添付されたメッセージを右クリック
2. 「アプリ」→「Transcribe Audio/Video」を選択

### オプション

- `--no-diarize`: 話者識別を無効化
- `--no-timestamp`: タイムスタンプを非表示
- `--no-audio-events`: 音声イベント（拍手、音楽など）のタグを無効化
- `--num-speakers <数>`: 話者数を指定（1-32、デフォルト: 2）

## トラブルシューティング

### 「アプリケーションが応答しませんでした」エラーが出る場合

1. Interaction Endpoint URLが正しく設定されているか確認
2. Edge Functionが正しくデプロイされているか確認
3. 環境変数（特にPublic Key）が正しく設定されているか確認

### Botがメッセージを送信できない（403エラー）場合

1. **OAuth2 URL Generatorで`bot`と`applications.commands`の両方のscopeを選択したか確認**
2. Botがサーバーのメンバーリストに表示されているか確認
3. チャンネルの権限設定でBotがメッセージ送信を許可されているか確認
4. プライベートチャンネルの場合、Botを明示的に追加する必要があります

### スラッシュコマンドは使えるがBotがメッセージを送信できない場合

これは`applications.commands` scopeのみで招待した場合に発生します。OAuth2 URL Generatorで`bot` scopeも含めて再度招待してください。

### Botがオフラインと表示される場合

これは正常です。WebhookベースのBotのため、常時オンラインである必要はありません。

### ファイルがダウンロードできない場合

Botに適切な権限（Attach Files）が付与されているか確認してください。

## セキュリティ注意事項

- Bot Tokenは絶対に公開しないでください
- Public Keyを使用してリクエストの検証を行っています
- 本番環境では、特定のサーバーやチャンネルのみでBotが動作するよう制限することを推奨します

## 制限事項

- Discord APIの制限により、ファイルサイズは最大25MBまで
- 大きなファイルの場合は、Google Drive経由での処理を推奨
- メッセージの文字数制限は2000文字（長い文字起こしは自動的にファイルとして送信）

## サポート

問題が発生した場合は、以下を確認してください：

1. Supabase Function のログ
2. Discord Developer Portal のエラーメッセージ
3. 環境変数が正しく設定されているか
