/**
 * Adapter to use existing Google Drive code with CloudService interface
 */

import { BaseCloudService, CloudFileMetadata } from "../services/cloud-service.ts";
import {
  parseGoogleDriveUrl,
  isGoogleDriveUrl,
  downloadGoogleDriveFileToPath,
  getGoogleDriveFileMetadata
} from "../clients/googledrive.ts";

export class GoogleDriveAdapter extends BaseCloudService {
  readonly name = "Google Drive";
  readonly description =
    "Google Drive 上の音声・動画ファイル。共有リンクが必要（最大 20GB）。";
  readonly urlExamples = [
    "https://drive.google.com/file/d/<FILE_ID>/view",
  ];

  isValidUrl(url: string): boolean {
    return isGoogleDriveUrl(url);
  }

  extractFileId(url: string): string | null {
    return parseGoogleDriveUrl(url);
  }

  async getFileMetadata(fileId: string): Promise<CloudFileMetadata> {
    const metadata = await getGoogleDriveFileMetadata(fileId);
    return {
      id: fileId,
      filename: metadata.name,
      mimeType: metadata.mimeType,
      size: metadata.size ? parseInt(metadata.size) : undefined,
    };
  }

  async downloadFile(fileId: string, tempPath: string): Promise<boolean> {
    // This already handles non-media file skipping
    return await downloadGoogleDriveFileToPath(fileId, tempPath);
  }

  /**
   * Override to exclude Google Docs files
   */
  override isMediaFile(mimeType: string): boolean {
    // Check if it's a Google Docs/Sheets/Slides file (should be skipped)
    const googleDocsTypes = [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
      "application/vnd.google-apps.drawing",
      "application/vnd.google-apps.form",
      "application/vnd.google-apps.map",
      "application/vnd.google-apps.site",
      "application/vnd.google-apps.script",
      "application/vnd.google-apps.jamboard",
    ];

    if (googleDocsTypes.includes(mimeType)) {
      return false;
    }

    // Check if it's a media file (audio or video)
    return (
      mimeType.toLowerCase().startsWith("audio/") ||
      mimeType.toLowerCase().startsWith("video/") ||
      mimeType === "application/ogg" // Can be audio or video
    );
  }
}
