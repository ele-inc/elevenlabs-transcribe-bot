import { TranscriptionOptions } from "../core/types.ts";
import { transcribeAudioFile } from "../core/scribe.ts";
import { cloudServiceManager } from "./cloud-service-manager.ts";

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

export async function processCloudFile(
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
    const result = await cloudServiceManager.downloadFromUrl(url);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    if (!result.metadata || !result.tempPath) {
      return { success: false, error: "Failed to get file metadata" };
    }

    await transcribeAudioFile({
      fileURL: `file://${result.tempPath}`,
      fileType: result.metadata.mimeType,
      duration: 0,
      channelId: options.channelId,
      timestamp: options.timestamp,
      userId: options.userId,
      options: options.transcriptionOptions,
      filename: result.metadata.filename,
      isGoogleDrive: true, // TODO: Update to isCloudFile
      tempPath: result.tempPath,
      platform: options.platform,
    });

    return { success: true, filename: result.metadata.filename };
  } catch (error) {
    console.error("Cloud file processing error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  } finally {
    // Cleanup is handled by cloudServiceManager
    await cloudServiceManager.cleanup();
  }
}

// Keep backward compatibility
export const processGoogleDriveFile = processCloudFile;

export function extractMediaInfo(text: string): {
  cloudUrls: string[];
  googleDriveUrls: string[]; // For backward compatibility
  hasUrls: boolean;
} {
  const cloudServices = cloudServiceManager.extractCloudUrls(text || "");
  const cloudUrls = cloudServices.map(cs => cs.url);
  
  // Filter Google Drive URLs for backward compatibility
  const googleDriveUrls = cloudServices
    .filter(cs => cs.service.name === "Google Drive")
    .map(cs => cs.url);
  
  return {
    cloudUrls,
    googleDriveUrls, // Keep for backward compatibility
    hasUrls: cloudUrls.length > 0
  };
}