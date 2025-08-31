#!/usr/bin/env -S deno run --allow-net --allow-env

// Discord Slash Commands登録スクリプト
// 使用方法: deno run --allow-net --allow-env register-discord-commands.ts

const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
const DISCORD_APPLICATION_ID = Deno.env.get("DISCORD_APPLICATION_ID");

if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID) {
  console.error("❌ DISCORD_BOT_TOKEN と DISCORD_APPLICATION_ID を環境変数に設定してください");
  Deno.exit(1);
}

// Slash Command定義
const commands = [
  {
    name: "transcribe",
    description: "音声/動画ファイルを文字起こしします",
    options: [
      {
        name: "file",
        description: "文字起こしするファイル",
        type: 11, // ATTACHMENT type
        required: false,
      },
      {
        name: "url",
        description: "Google DriveのURL",
        type: 3, // STRING type
        required: false,
      },
      {
        name: "options",
        description: "オプション (--no-diarize, --no-timestamp, --num-speakers 3 など)",
        type: 3, // STRING type
        required: false,
      },
    ],
  },
  // Message Context Menu Command (右クリックメニュー)
  {
    name: "Transcribe Audio/Video",
    type: 3, // MESSAGE command type
  },
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;
  
  for (const command of commands) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ コマンド登録成功: ${command.name}`);
        console.log(`   ID: ${data.id}`);
      } else {
        const error = await response.text();
        console.error(`❌ コマンド登録失敗: ${command.name}`);
        console.error(`   エラー: ${error}`);
      }
    } catch (error) {
      console.error(`❌ エラー: ${command.name}`, error);
    }
  }
}

// 既存のコマンドを確認
async function listCommands() {
  const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;
  
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    });

    if (response.ok) {
      const commands = await response.json();
      console.log("\n📋 登録済みコマンド一覧:");
      for (const cmd of commands) {
        console.log(`   - ${cmd.name} (ID: ${cmd.id})`);
      }
      return commands;
    }
  } catch (error) {
    console.error("❌ コマンド一覧取得エラー:", error);
  }
  return [];
}

// コマンドを削除（必要な場合）
async function deleteCommand(commandId: string) {
  const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands/${commandId}`;
  
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    });

    if (response.ok || response.status === 204) {
      console.log(`✅ コマンド削除成功: ${commandId}`);
    } else {
      const error = await response.text();
      console.error(`❌ コマンド削除失敗: ${commandId}`, error);
    }
  } catch (error) {
    console.error(`❌ 削除エラー: ${commandId}`, error);
  }
}

// メイン処理
async function main() {
  console.log("🤖 Discord Bot Slash Commands 登録スクリプト");
  console.log(`📱 Application ID: ${DISCORD_APPLICATION_ID}`);
  console.log();

  // 既存のコマンドを確認
  const existingCommands = await listCommands();
  
  // 既存のコマンドを削除（オプション）
  if (existingCommands.length > 0) {
    console.log("\n既存のコマンドを削除しますか？ (y/n)");
    const answer = prompt(">");
    
    if (answer?.toLowerCase() === "y") {
      for (const cmd of existingCommands) {
        await deleteCommand(cmd.id);
      }
      console.log();
    }
  }

  // 新しいコマンドを登録
  console.log("📝 コマンドを登録中...\n");
  await registerCommands();
  
  console.log("\n✨ 完了！");
  console.log("Discord サーバーで /transcribe コマンドが使えるようになりました。");
  console.log("注: グローバルコマンドの反映には最大1時間かかる場合があります。");
}

// 実行
if (import.meta.main) {
  await main();
}