import { JWT } from "npm:google-auth-library@9.15.0";
import { google } from "npm:googleapis@144.0.0";
import { config } from "./config.ts";

/**
 * Google Driveファイルをストリーミングで処理（最終版）
 * ChatGPT提案の実装を採用
 */
export class GoogleDriveStreamer {
  private drive: any;

  constructor() {
    if (!config.googlePrivateKey) {
      throw new Error("GOOGLE_PRIVATE_KEY environment variable is not set");
    }

    const formattedPrivateKey = config.googlePrivateKey.replace(/\\n/g, '\n');

    const auth = new JWT({
      email: config.googleClientEmail,
      key: formattedPrivateKey,
      scopes: ["https://www.googleapis.com/auth/drive"],
      subject: config.googleImpersonateEmail,
    });

    this.drive = google.drive({ version: "v3", auth });
  }

  /**
   * ファイルメタデータを取得
   */
  async getFileMetadata(fileId: string) {
    const response = await this.drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
      supportsAllDrives: true,
    });
    return response.data;
  }

  /**
   * 動画ファイルをストリーミングで音声に変換（ChatGPT提案版）
   * @param fileId - Google DriveのファイルID
   * @returns stream: MP3音声のReadableStream, done: 完了Promise
   */
  async streamVideoToAudio(fileId: string): Promise<{
    stream: ReadableStream<Uint8Array>,
    done: Promise<void>
  }> {
    const metadata = await this.getFileMetadata(fileId);
    console.log(`Converting video to audio: ${metadata.name} (${metadata.mimeType})`);
    console.log(`File size: ${(parseInt(metadata.size || '0') / (1024 * 1024)).toFixed(2)}MB`);

    // ffmpegプロセスを起動（エラー出力を最小限に）
    const proc = new Deno.Command("ffmpeg", {
      args: [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", "pipe:0",           // 標準入力から読む
        "-vn",                    // 動画トラックを無視
        "-acodec", "libmp3lame",  // MP3エンコーダー
        "-ab", "128k",            // ビットレート
        "-ar", "16000",           // サンプリングレート
        "-ac", "1",               // モノラル
        "-f", "mp3",              // 出力フォーマット
        "pipe:1"                  // 標準出力へ
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    // stderrをログへ（エラーのみ）
    (async () => {
      const decoder = new TextDecoder();
      const reader = proc.stderr.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value).trim();
          if (text) console.log("ffmpeg:", text);
        }
      } catch (e) {
        console.error("Error reading ffmpeg stderr:", e);
      }
    })();

    // Google Driveから Node Readable を取得
    const { data: nodeStream } = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream", timeout: 3600000 }
    );

    // Node Stream → Web Stream に変換
    // Deno は Node.js 互換レイヤーを持っている
    const { Readable } = await import("node:stream");
    const webReadable = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    // 進捗表示を追加
    let downloadedBytes = 0;
    const startTime = performance.now();
    let lastProgressTime = startTime;

    const monitoredStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        downloadedBytes += chunk.length;
        const currentTime = performance.now();

        // 1秒ごとに進捗表示
        if (currentTime - lastProgressTime > 1000) {
          const speed = (downloadedBytes / (1024 * 1024)) / ((currentTime - startTime) / 1000);
          console.log(`Streaming: ${(downloadedBytes / (1024 * 1024)).toFixed(2)}MB at ${speed.toFixed(2)}MB/s`);
          lastProgressTime = currentTime;
        }

        controller.enqueue(chunk);
      },
      flush() {
        const totalTime = (performance.now() - startTime) / 1000;
        const totalMB = downloadedBytes / (1024 * 1024);
        console.log(`Download complete: ${totalMB.toFixed(2)}MB in ${totalTime.toFixed(2)}s`);
      }
    });

    // pipeTo でバックプレッシャーとエラー伝播を自動処理
    const inputPump = webReadable
      .pipeThrough(monitoredStream)
      .pipeTo(proc.stdin);

    // 呼び出し側に返す出力ストリーム
    const stream = proc.stdout;

    // 完了Promise（入力完了→ffmpeg終了コード検査まで）
    const done = (async () => {
      try {
        await inputPump;  // 入力のポンプ完了を待つ
        console.log("Input pump completed, waiting for ffmpeg to finish...");

        const status = await proc.status;
        if (!status.success) {
          throw new Error(`ffmpeg failed with exit code: ${status.code}`);
        }
        console.log("ffmpeg completed successfully");
      } catch (error) {
        console.error("Processing error:", error);
        throw error;
      }
    })();

    return { stream, done };
  }

  /**
   * 音声ファイルをそのままストリーミング
   * @param fileId - Google DriveのファイルID
   * @returns stream: 音声のReadableStream, done: 完了Promise
   */
  async streamAudio(fileId: string): Promise<{
    stream: ReadableStream<Uint8Array>,
    done: Promise<void>
  }> {
    const metadata = await this.getFileMetadata(fileId);
    console.log(`Streaming audio: ${metadata.name} (${metadata.mimeType})`);

    const { data: nodeStream } = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream", timeout: 3600000 }
    );

    // Node Stream → Web Stream
    const { Readable } = await import("node:stream");
    const stream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    // 完了Promiseは即座に解決（音声は変換不要）
    const done = Promise.resolve();

    return { stream, done };
  }
}

/**
 * Google Drive URLからファイルIDを抽出
 */
export function parseGoogleDriveUrl(url: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9-_]+)/,
    /docs\.google\.com\/[a-z]+\/d\/([a-zA-Z0-9-_]+)/,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9-_]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
