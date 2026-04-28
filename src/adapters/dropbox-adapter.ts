/**
 * Adapter to use Dropbox shared links with CloudService interface
 */

import { BaseCloudService, CloudFileMetadata } from "../services/cloud-service.ts";
import {
  isDropboxUrl,
  toDropboxDirectUrl,
  getDropboxFileMetadata,
  downloadDropboxFileToPath,
} from "../clients/dropbox.ts";

export class DropboxAdapter extends BaseCloudService {
  readonly name = "Dropbox";
  readonly description =
    "Dropbox 共有リンク（ファイルまたはフォルダ）。dl=1 への自動変換に対応。";
  readonly urlExamples = [
    "https://www.dropbox.com/s/<HASH>/<FILE>?dl=0",
    "https://www.dropbox.com/scl/fi/<HASH>/<FILE>?dl=0",
  ];

  isValidUrl(url: string): boolean {
    return isDropboxUrl(url);
  }

  extractFileId(url: string): string | null {
    // For Dropbox, we treat the direct URL as the identifier
    return toDropboxDirectUrl(url);
  }

  async getFileMetadata(fileId: string): Promise<CloudFileMetadata> {
    const metadata = await getDropboxFileMetadata(fileId);
    return {
      id: fileId,
      filename: metadata.name,
      mimeType: metadata.mimeType,
      size: metadata.size,
    };
  }

  async downloadFile(fileId: string, tempPath: string): Promise<boolean> {
    return await downloadDropboxFileToPath(fileId, tempPath);
  }
}

