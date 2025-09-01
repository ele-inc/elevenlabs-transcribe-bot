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
   * 動画ファイルをストリーミングで音声に変換（URL直接指定版）
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

    // アクセストークンを取得
    // @ts-ignore - 内部APIを使用
    const auth = this.drive.context._options.auth;
    const accessToken = await auth.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;

    if (!token) {
      throw new Error("Failed to get access token for Google Drive");
    }

    // Google Drive APIのダウンロードURL
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    // ffmpegプロセスを起動（URLを直接指定）
    const proc = new Deno.Command("ffmpeg", {
      args: [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
        // HTTPヘッダーでアクセストークンを渡す
        "-headers", `Authorization: Bearer ${token}`,
        // ネットワークタイムアウトを60秒に設定
        "-rw_timeout", "60000000",
        // より高速な処理のための設定
        "-threads", "0",          // 自動的に最適なスレッド数を使用
        // Google Drive URLを直接入力
        "-i", mediaUrl,
        "-vn",                    // 動画トラックを無視
        "-acodec", "libmp3lame", "-ab", "128k", "-ar", "16000", "-ac", "1",
        "-f", "mp3", "pipe:1",
        "-progress", "pipe:2",
      ],
      stdin: "null",  // stdinは使わない
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    // stderrをログへ
    (async () => {
      const decoder = new TextDecoder();
      const reader = proc.stderr.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value).trim();
          if (text) {
            console.log("ffmpeg:", text);
            // libmp3lameが無い場合のエラーを検出
            if (text.includes("Unknown encoder 'libmp3lame'")) {
              console.error("Warning: libmp3lame not available, consider using WAV fallback");
            }
          }
        }
      } catch (e) {
        console.error("Error reading ffmpeg stderr:", e);
      }
    })();

    // 出力ストリームにバイト数カウンターを追加
    let outputBytes = 0;
    const countedStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        outputBytes += chunk.length;
        controller.enqueue(chunk);
      },
      flush() {
        console.log(`Total audio output: ${(outputBytes / (1024 * 1024)).toFixed(2)}MB`);
        if (outputBytes === 0) {
          console.error("WARNING: ffmpeg produced 0 bytes output!");
        }
      }
    });

    // ffmpegの出力をカウンター経由で返す
    const stream = proc.stdout.pipeThrough(countedStream);

    // 完了Promise（ffmpeg終了コード検査）
    const done = (async () => {
      try {
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
    console.log(`File size: ${(parseInt(metadata.size || '0') / (1024 * 1024)).toFixed(2)}MB`);

    // アクセストークンを取得
    // @ts-ignore - 内部APIを使用
    const auth = this.drive.context._options.auth;
    const accessToken = await auth.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;

    if (!token) {
      throw new Error("Failed to get access token for Google Drive");
    }

    // Google Drive APIのダウンロードURL
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    // fetchを使用して直接ストリーミング
    const response = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch audio file: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body available');
    }

    // バイト数カウンターを追加
    let downloadedBytes = 0;
    const startTime = performance.now();

    const countedStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        downloadedBytes += chunk.length;
        controller.enqueue(chunk);
      },
      flush() {
        const totalTime = (performance.now() - startTime) / 1000;
        const totalMB = downloadedBytes / (1024 * 1024);
        console.log(`Audio download complete: ${totalMB.toFixed(2)}MB in ${totalTime.toFixed(2)}s`);
      }
    });

    // レスポンスボディをカウンター経由で返す
    const stream = response.body.pipeThrough(countedStream);

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
