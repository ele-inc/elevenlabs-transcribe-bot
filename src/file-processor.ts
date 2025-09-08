import { TranscriptionOptions } from "./types.ts";
import { transcribeAudioFile } from "./scribe.ts";
import { extractGoogleDriveUrls } from "./utils.ts";
import { FileDownloader } from "./services/file-downloader.ts";

export interface FileInfo {
  filename: string;
  mimeType: string;
  url?: string;
  tempPath?: string;
}

export interface ProcessingResult {
  success: boolean;
  filename?: string;
  error?: string;
}

export function generateOptionInfo(options: TranscriptionOptions): string[] {
  const optionInfo: string[] = [];
  
  if (!options.diarize) optionInfo.push("話者識別OFF");
  if (!options.showTimestamp) optionInfo.push("タイムスタンプOFF");
  if (!options.tagAudioEvents) optionInfo.push("音声イベントOFF");
  if (options.diarize && options.numSpeakers && options.numSpeakers !== 2) {
    optionInfo.push(`話者数: ${options.numSpeakers}`);
  }
  if (options.speakerNames && options.speakerNames.length > 0) {
    optionInfo.push(`話者名: ${options.speakerNames.join(", ")}`);
  }
  
  return optionInfo;
}

export function formatOptionsText(options: TranscriptionOptions): string {
  const optionInfo = generateOptionInfo(options);
  return optionInfo.length > 0 ? ` (${optionInfo.join(", ")})` : "";
}

export function isValidAudioVideoFile(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/");
}

export async function processGoogleDriveFile(
  url: string,
  options: {
    channelId: string;
    timestamp: string;
    userId: string;
    transcriptionOptions: TranscriptionOptions;
    platform: "discord" | "slack";
  }
): Promise<ProcessingResult> {
  try {
    const tempDir = await Deno.makeTempDir();
    const tempPath = `${tempDir}/gdrive_${Date.now()}.tmp`;

    // Extract file ID from URL
    const fileId = FileDownloader.parseGoogleDriveUrl(url);
    if (!fileId) {
      return { success: false, error: "Invalid Google Drive URL" };
    }

    // Download using unified downloader
    const fileDownloader = new FileDownloader();
    const metadata = await fileDownloader.downloadToPath({
      platform: "googledrive",
      fileId,
      outputPath: tempPath
    });
    
    const { filename, mimeType } = metadata;

    await transcribeAudioFile({
      fileURL: `file://${tempPath}`,
      fileType: mimeType || "",
      duration: 0,
      channelId: options.channelId,
      timestamp: options.timestamp,
      userId: options.userId,
      options: options.transcriptionOptions,
      filename,
      isGoogleDrive: true,
      tempPath,
      platform: options.platform,
    });

    return { success: true, filename };
  } catch (error) {
    console.error("Google Drive processing error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

export function extractMediaInfo(text: string): {
  googleDriveUrls: string[];
  hasUrls: boolean;
} {
  const googleDriveUrls = extractGoogleDriveUrls(text || "");
  return {
    googleDriveUrls,
    hasUrls: googleDriveUrls.length > 0
  };
}