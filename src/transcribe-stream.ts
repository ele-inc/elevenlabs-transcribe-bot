// FormDataは使わず、手組みのmultipartを使用
import {
  TranscriptionOptions,
  WordItem,
} from "./types.ts";
import {
  formatTimestamp,
  extractSentences,
  groupBySpeaker,
} from "./utils.ts";
import { identifySpeakers, replaceSpeakerLabels } from "./openai-client.ts";
import { config } from "./config.ts";
import { GoogleDriveStreamer, parseGoogleDriveUrl } from "./googledrive-stream.ts";

export interface TranscriptionResult {
  transcript: string;
  languageCode: string | null;
  words?: WordItem[];
}

/**
 * ストリームを/tmpファイルにスプールしてから文字起こし（OOM回避）
 * @param audioStream - 音声データのストリーム
 * @param options - 文字起こしオプション
 * @param filename - オプションのファイル名
 * @returns 文字起こし結果
 */
export async function transcribeViaTmpFile(
  audioStream: ReadableStream<Uint8Array>,
  options: TranscriptionOptions,
  filename?: string
): Promise<TranscriptionResult> {
  // 1) /tmpにスプール（メモリ常数）
  const tmpFileName = audio_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3;
  const tmpPath = /tmp/${tmpFileName};

  console.log(Spooling audio stream to tmp file: ${tmpPath});

  // ストリームを/tmpファイルに書き込み
  const file = await Deno.open(tmpPath, { create: true, write: true, truncate: true });
  let totalBytes = 0;

  try {
    // 進捗表示付きでストリームを書き込み
    const writer = file.writable.getWriter();
    const reader = audioStream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      await writer.write(value);
      totalBytes += value.length;

      // 10MBごとに進捗表示
      if (totalBytes % (10 * 1024 * 1024) < value.length) {
        console.log(Spooled to tmp: ${(totalBytes / 1024 / 1024).toFixed(2)}MB);
      }
    }

    await writer.close();
    console.log(Total audio spooled: ${(totalBytes / 1024 / 1024).toFixed(2)}MB);
  } catch (error) {
    file.close();
    // クリーンアップ
    try { await Deno.remove(tmpPath); } catch { /* ignore */ }
    throw error;
  }

  try {
    // 2) ファイルサイズを取得
    const fileInfo = await Deno.stat(tmpPath);
    const fileSize = fileInfo.size;
    console.log(Tmp file size: ${(fileSize / 1024 / 1024).toFixed(2)}MB);

    // 3) 手組みのmultipart/form-dataでストリーミング送信
    console.log("Sending audio to ElevenLabs API via multipart stream...");

    // boundaryを生成
    const boundary = "--------------------------" + crypto.randomUUID().replace(/-/g, "");
    const encoder = new TextEncoder();

    // multipartのフィールドを構築
    let preamble = --${boundary}\r\n;
    preamble += Content-Disposition: form-data; name="model_id"\r\n\r\n;
    preamble += scribe_v1\r\n;

    // language_codeフィールド
    preamble += --${boundary}\r\n;
    preamble += Content-Disposition: form-data; name="language_code"\r\n\r\n;
    preamble += ja\r\n;

    // オプションフィールドを追加
    if (options.diarize !== undefined) {
      preamble += --${boundary}\r\n;
      preamble += Content-Disposition: form-data; name="diarize"\r\n\r\n;
      preamble += ${options.diarize}\r\n;
    }

    if (options.tagAudioEvents !== undefined) {
      preamble += --${boundary}\r\n;
      preamble += Content-Disposition: form-data; name="tag_audio_events"\r\n\r\n;
      preamble += ${options.tagAudioEvents}\r\n;
    }

    if (options.numSpeakers !== undefined) {
      preamble += --${boundary}\r\n;
      preamble += Content-Disposition: form-data; name="num_speakers"\r\n\r\n;
      preamble += ${options.numSpeakers}\r\n;
    }

    // ファイルフィールドのヘッダー
    preamble += --${boundary}\r\n;
    preamble += Content-Disposition: form-data; name="file"; filename="${filename || "audio.mp3"}"\r\n;
    preamble += Content-Type: audio/mpeg\r\n\r\n;

    const epilogue = \r\n--${boundary}--\r\n;

    // Web ReadableStreamを作成（チャンク送信）
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // 1) プレアンブルを送信
          controller.enqueue(encoder.encode(preamble));

          // 2) ファイル本体をチャンクで送信
          const file = await Deno.open(tmpPath, { read: true });
          try {
            const buffer = new Uint8Array(64 * 1024); // 64KB chunks
            while (true) {
              const bytesRead = await file.read(buffer);
              if (bytesRead === null) break;
              controller.enqueue(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
            }
          } finally {
            file.close();
          }

          // 3) エピローグを送信
          controller.enqueue(encoder.encode(epilogue));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });

    // API呼び出し
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": multipart/form-data; boundary=${boundary},
      },
      body: stream,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(ElevenLabs API failed: ${response.status} ${response.statusText} - ${errorText});
    }

    const scribeResult = await response.json();

    // 4) 結果の処理
    const words: WordItem[] | undefined = scribeResult.words;
    let transcript = "";

    // 文字起こし結果の処理
    if (options.diarize && Array.isArray(words) && words.length > 0) {
      const grouped = groupBySpeaker(words);
      transcript = grouped
        .map((u) => {
          const speakerLabel = typeof u.speaker === "number"
            ? speaker_${u.speaker}
            : ${u.speaker};
          if (options.showTimestamp) {
            return ${formatTimestamp(u.start)} ${speakerLabel}: ${u.text.trim()};
          } else {
            return ${speakerLabel}: ${u.text.trim()};
          }
        })
        .join("\n");
    } else if (!options.diarize && Array.isArray(words) && words.length > 0) {
      const sentences = extractSentences(words);
      transcript = sentences
        .map((s) => {
          if (options.showTimestamp) {
            return ${formatTimestamp(s.start)} ${s.text};
          } else {
            return s.text;
          }
        })
        .join("\n");
    } else {
      const plain = (scribeResult.text || "").trim();
      transcript = plain.replace(/([。.!！?？])\s*/g, "$1\n").trim();
    }

    // 話者名のマッピング
    if (options.diarize && options.speakerNames && options.speakerNames.length > 0 && transcript) {
      try {
        console.log("Identifying speakers with names:", options.speakerNames);
        const speakerMapping = await identifySpeakers(transcript, options.speakerNames);
        transcript = replaceSpeakerLabels(transcript, speakerMapping);
        console.log("Speaker labels replaced successfully");
      } catch (error) {
        console.error("Failed to identify speakers:", error);
      }
    }

    const languageCode = scribeResult.language_code || null;

    return {
      transcript,
      languageCode,
      words,
    };
  } finally {
    // 5) 後片付け（必ず実行）
    try {
      await Deno.remove(tmpPath);
      console.log(Cleaned up tmp file: ${tmpPath});
    } catch (error) {
      console.error(Failed to remove tmp file ${tmpPath}:, error);
    }
  }
}

/**
 * Google Driveファイルをストリーミングで文字起こし
 * @param driveUrl - Google DriveのURL
 * @param options - 文字起こしオプション
 * @returns 文字起こし結果
 */
export async function transcribeGoogleDriveStream(
  driveUrl: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  const fileId = parseGoogleDriveUrl(driveUrl);
  if (!fileId) {
    throw new Error("Invalid Google Drive URL");
  }

  const streamer = new GoogleDriveStreamer();

  // ファイルメタデータを取得
  const metadata = await streamer.getFileMetadata(fileId);
  console.log(Processing: ${metadata.name} (${metadata.mimeType}));

  let audioStream: ReadableStream<Uint8Array>;
  let processingDone: Promise<void>;

  // ファイルタイプに応じて処理
  if (metadata.mimeType.startsWith("video/")) {
    console.log("Streaming video and converting to audio...");
    const result = await streamer.streamVideoToAudio(fileId);
    audioStream = result.stream;
    processingDone = result.done;
  } else if (metadata.mimeType.startsWith("audio/")) {
    console.log("Streaming audio directly...");
    const result = await streamer.streamAudio(fileId);
    audioStream = result.stream;
    processingDone = result.done;
  } else {
    throw new Error(Unsupported file type: ${metadata.mimeType});
  }

  // tmpファイル経由で文字起こし
  const transcriptionResult = await transcribeViaTmpFile(audioStream, options, metadata.name);

  // ffmpeg処理の完了を待つ
  await processingDone;

  return transcriptionResult;
}

/**
 * ローカルファイルをストリーミングで処理（動画の場合）
 * @param filePath - ローカルファイルのパス
 * @param options - 文字起こしオプション
 * @returns 文字起こし結果
 */
export async function transcribeLocalFileStream(
  filePath: string,
  options: TranscriptionOptions
): Promise<TranscriptionResult> {
  // ファイル拡張子からMIMEタイプを判定
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const isVideo = ['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(extension);
  const filename = filePath.split('/').pop() || filePath;

  if (isVideo) {
    console.log("Converting local video to audio stream...");

    // ffmpegでストリーミング変換
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-i", filePath,           // 入力ファイル
        "-vn",                    // 動画トラックを無視
        "-acodec", "libmp3lame",  // MP3エンコーダー
        "-ab", "128k",            // ビットレート
        "-ar", "16000",           // サンプリングレート
        "-ac", "1",               // モノラル
        "-f", "mp3",              // 出力フォーマット
        "pipe:1"                  // 標準出力へ
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // エラーログを非同期で処理
    (async () => {
      const decoder = new TextDecoder();
      const reader = process.stderr.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          if (text.includes("Error") || text.includes("error")) {
            console.error("ffmpeg:", text.trim());
          }
        }
      } catch (error) {
        console.error("Error reading ffmpeg stderr:", error);
      }
    })();

    return transcribeViaTmpFile(process.stdout, options, filename);
  } else {
    // 音声ファイルの場合は、ファイルをストリームとして読む
    console.log("Streaming audio file...");
    const file = await Deno.open(filePath, { read: true });
    const stream = file.readable;

    return transcribeViaTmpFile(stream, options, filename);
  }
}
