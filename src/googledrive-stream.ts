import { JWT } from "npm:google-auth-library@9.15.0";
import { google } from "npm:googleapis@144.0.0";
import { config } from "./config.ts";

/**
 * Google Driveファイルをストリーミングで処理
 * ディスク書き込みを完全に回避
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
   * Google DriveファイルをReadableStreamとして取得
   * @param fileId - Google DriveのファイルID
   * @returns Web Streams APIのReadableStream
   */
  async getFileStream(fileId: string): Promise<ReadableStream<Uint8Array>> {
    console.log(`Starting streaming download for file: ${fileId}`);

    // Node.js Streamを取得
    const response = await this.drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "stream",
        timeout: 3600000, // 1 hour
      }
    );

    const nodeStream = response.data;
    let downloadedBytes = 0;
    let lastProgressTime = performance.now();
    const startTime = performance.now();

    // Node.js StreamをWeb Streams APIに変換
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of nodeStream) {
            const buffer = chunk instanceof Uint8Array 
              ? chunk 
              : new Uint8Array(chunk);
            
            controller.enqueue(buffer);
            downloadedBytes += buffer.length;

            // 進捗表示（1秒ごと）
            const currentTime = performance.now();
            if (currentTime - lastProgressTime > 1000) {
              const speed = (downloadedBytes / 1024 / 1024) / ((currentTime - startTime) / 1000);
              console.log(`Streaming: ${(downloadedBytes / 1024 / 1024).toFixed(2)}MB at ${speed.toFixed(2)}MB/s`);
              lastProgressTime = currentTime;
            }
          }
          
          const totalTime = (performance.now() - startTime) / 1000;
          const totalMB = downloadedBytes / (1024 * 1024);
          console.log(`Streaming complete: ${totalMB.toFixed(2)}MB in ${totalTime.toFixed(2)}s`);
          
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  /**
   * 動画ファイルをストリーミングで音声に変換
   * @param fileId - Google DriveのファイルID
   * @returns MP3音声のReadableStream
   */
  async streamVideoToAudio(fileId: string): Promise<ReadableStream<Uint8Array>> {
    const metadata = await this.getFileMetadata(fileId);
    console.log(`Converting video to audio: ${metadata.name} (${metadata.mimeType})`);

    // 動画ファイルかチェック
    if (!metadata.mimeType.startsWith("video/")) {
      throw new Error(`File is not a video: ${metadata.mimeType}`);
    }

    // Google Driveからストリーミング取得
    const videoStream = await this.getFileStream(fileId);

    // ffmpegでストリーミング変換
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-i", "pipe:0",           // 標準入力から読む
        "-vn",                    // 動画トラックを無視
        "-acodec", "libmp3lame",  // MP3エンコーダー
        "-ab", "128k",            // ビットレート
        "-ar", "16000",           // サンプリングレート（音声認識に最適）
        "-ac", "1",               // モノラル
        "-f", "mp3",              // 出力フォーマット
        "pipe:1"                  // 標準出力へ
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // エラーログを非同期で処理
    (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of process.stderr) {
        const text = decoder.decode(chunk);
        // ffmpegの進捗情報をログ（エラー以外）
        if (!text.includes("Error") && !text.includes("error")) {
          console.log("ffmpeg:", text.trim());
        }
      }
    })();

    // 入力ストリームをffmpegへパイプ
    const writer = process.stdin.getWriter();
    const reader = videoStream.getReader();

    // パイプ処理を待機する必要がある
    const pipePromise = (async () => {
      try {
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("Finished reading from Google Drive");
            break;
          }
          
          await writer.write(value);
          totalBytes += value.length;
          
          // 定期的に進捗表示
          if (totalBytes % (10 * 1024 * 1024) < value.length) {
            console.log(`Piped ${(totalBytes / 1024 / 1024).toFixed(0)}MB to ffmpeg`);
          }
        }
        console.log(`Total piped to ffmpeg: ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
      } catch (error) {
        console.error("Error piping to ffmpeg:", error);
        throw error;
      } finally {
        try {
          await writer.close();
          console.log("Closed ffmpeg stdin");
        } catch (e) {
          console.error("Error closing writer:", e);
        }
      }
    })();

    // ffmpegの処理完了を確実に待つ
    const audioChunks: Uint8Array[] = [];
    const outputReader = process.stdout.getReader();
    
    try {
      while (true) {
        const { done, value } = await outputReader.read();
        if (done) break;
        audioChunks.push(value);
      }
    } finally {
      outputReader.releaseLock();
    }

    // パイプ処理の完了を待つ
    await pipePromise;
    
    // ffmpegプロセスの終了を待つ
    const status = await process.status;
    if (!status.success) {
      throw new Error(`ffmpeg failed with code ${status.code}`);
    }

    // 音声データをReadableStreamとして返す
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of audioChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    });
  }

  /**
   * 音声ファイルをそのままストリーミング
   * @param fileId - Google DriveのファイルID
   * @returns 音声のReadableStream
   */
  async streamAudio(fileId: string): Promise<ReadableStream<Uint8Array>> {
    const metadata = await this.getFileMetadata(fileId);
    console.log(`Streaming audio: ${metadata.name} (${metadata.mimeType})`);

    // 音声ファイルかチェック
    if (!metadata.mimeType.startsWith("audio/")) {
      throw new Error(`File is not audio: ${metadata.mimeType}`);
    }

    // そのままストリーミング
    return this.getFileStream(fileId);
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