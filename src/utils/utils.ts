import {
  Sentence,
  SpeakerUtterance,
  TranscriptionOptions,
  WordItem,
} from "../core/types.ts";
import { isGoogleDriveUrl } from "../clients/googledrive.ts";

export const parseTranscriptionOptions = (
  text: string = "",
): TranscriptionOptions => {
  const diarize = !text.includes("--no-diarize");

  // Parse num-speakers from command, or use default of 2 when diarize is enabled
  let numSpeakers: number | undefined;
  if (diarize) {
    const numSpeakersMatch = text.match(/--num-speakers\s+(\d+)/);
    if (numSpeakersMatch) {
      const parsed = parseInt(numSpeakersMatch[1], 10);
      numSpeakers = (parsed >= 1 && parsed <= 32) ? parsed : 2;
    } else {
      numSpeakers = 2; // Default to 2 speakers when diarize is true
    }
  }

  // Parse speaker names (supports both quoted and unquoted format)
  let speakerNames: string[] | undefined;
  const namesMatch = text.match(
    /--speaker-names\s+(?:"([^"]+)"|([^-]+?)(?:\s+--|\s*$))/,
  );
  if (namesMatch) {
    const names = namesMatch[1] || namesMatch[2];
    // Split by both full-width and half-width comma
    speakerNames = names.trim().split(/[,，]/).map((name) => name.trim());
  }

  return {
    diarize,
    showTimestamp: !text.includes("--no-timestamp"),
    tagAudioEvents: !text.includes("--no-audio-events"),
    summarize: !text.includes("--no-summarize"),
    ...(numSpeakers ? { numSpeakers } : {}),
    ...(speakerNames ? { speakerNames } : {}),
  };
};

export const getFileExtensionFromMime = (mimeType: string): string => {
  const mimeToExt: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/mpeg": "mpg",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/webm": "webm",
  };
  return mimeToExt[mimeType] || mimeType.split("/")[1] || "bin";
};

export const formatTimestamp = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${
      secs.toString().padStart(2, "0")
    }`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const extractSentences = (words: WordItem[]): Sentence[] => {
  const sentences: Sentence[] = [];
  let currentSentence = "";
  let currentStart: number | null = null;

  for (const word of words) {
    if (currentSentence === "") {
      currentStart = word.start;
    }

    currentSentence += word.text;

    if (isSentenceEndMarker(word.text)) {
      if (currentSentence.trim() !== "" && currentStart !== null) {
        sentences.push({
          text: currentSentence.trim(),
          start: currentStart,
        });
      }
      currentSentence = "";
      currentStart = null;
    }
  }

  if (currentSentence.trim() !== "" && currentStart !== null) {
    sentences.push({ text: currentSentence.trim(), start: currentStart });
  }

  return sentences;
};

function isSentenceEndMarker(text: string): boolean {
  return /^[。！？.!?]$/.test(text);
}

export const createTranscriptionHeader = (filename: string): string => {
  return `Original filename: ${filename}\n\n# Transcription Result\n\n`;
};

export const groupBySpeaker = (words: WordItem[]): SpeakerUtterance[] => {
  const conversation: SpeakerUtterance[] = [];
  let currentSpeaker: string | number | null = null;
  let currentText = "";
  let currentStart = 0;

  for (const word of words) {
    const speakerId = word.speaker_id ?? "unknown_speaker";

    if (currentSpeaker === null) {
      currentSpeaker = speakerId;
      currentText = word.text;
      currentStart = word.start;
    } else if (currentSpeaker === speakerId) {
      currentText += word.text;
    } else {
      conversation.push({
        speaker: currentSpeaker,
        text: currentText,
        start: currentStart,
      });

      currentSpeaker = speakerId;
      currentText = word.text;
      currentStart = word.start;
    }
  }

  if (currentText && currentSpeaker !== null) {
    conversation.push({
      speaker: currentSpeaker,
      text: currentText,
      start: currentStart,
    });
  }

  return conversation;
};

export const extractGoogleDriveUrls = (text: string): string[] => {
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  const urls = text.match(urlPattern) || [];
  return urls.filter((url) => isGoogleDriveUrl(url));
};

/**
 * 動画ファイルから音声(WAV)を抽出する
 * Cloud Run等のコンテナ環境向けに最適化済み
 * * @param inputPath 入力動画ファイルのパス
 * @returns 変換された音声ファイルのパス
 */
export const convertVideoToAudio = async (
  inputPath: string,
): Promise<string> => {
  // 一時ディレクトリを作成
  const outputDir = await Deno.makeTempDir();

  try {
    // ファイル名生成（パス操作を少し堅牢に）
    const fileName = inputPath.split(/[/\\]/).pop() ?? "audio";
    // 拡張子(.mp4など)を除去して .wav を付与
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    const outputPath = `${outputDir}/${baseName}.wav`;

    console.log(`Converting video to audio: ${inputPath} -> ${outputPath}`);

    // ffmpegコマンド構築
    // Mac (AudioToolbox) と Linux (libavcodec) でデコーダが異なるため、
    // pan+soxr を明示して環境間の変換結果を統一する
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-hide_banner", // バナー情報（ビルド構成など）を非表示
        "-nostats", // 進捗バーを出さない（ログバッファ溢れ防止）
        "-nostdin", // 【重要】対話入力を無効化（バックグラウンド実行でのハング防止）
        "-y", // 上書き許可
        "-i",
        inputPath,
        "-map", "0:a:0", // 最初の音声ストリームのみ
        "-vn", // 映像無効
        "-sn", // 字幕無効
        "-dn", // データストリーム無効
        // フィルタ設定: mono化を明示 + swr（libswresample）でリサンプリング
        // Note: soxrは環境によってはインストールされていないため、
        // 全環境で利用可能なswrを使用
        "-af",
        "pan=mono|c0=0.5*c0+0.5*c1,highpass=f=60,aresample=resampler=swr",
        "-ar",
        "16000", // 16kHz
        "-c:a",
        "pcm_s16le", // 音質劣化のないWAV形式
        outputPath,
      ],
      stdout: "null", // 標準出力は捨てる（メモリ節約・安定化）
      stderr: "piped", // エラーログだけ取得する
    });

    // コマンド実行
    const { code, stderr } = await command.output();

    // 失敗時の処理
    if (code !== 0) {
      const errorText = new TextDecoder().decode(stderr);
      // エラーログが長すぎる場合があるので末尾500文字程度を表示など工夫しても良い
      throw new Error(
        `ffmpeg process exited with code ${code}. Error: ${errorText}`,
      );
    }

    console.log(`Audio extraction completed: ${outputPath}`);
    return outputPath;
  } catch (error) {
    // エラー時は一時フォルダを掃除
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    // エラーを再スロー（呼び出し元でハンドリングさせる）
    throw new Error(
      `Failed to convert video to audio: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * Check if a file is a video based on MIME type
 */
export const isVideoFile = (mimeType: string): boolean => {
  return mimeType.startsWith("video/");
};
