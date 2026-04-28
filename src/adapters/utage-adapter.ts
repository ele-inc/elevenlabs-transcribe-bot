import { BaseCloudService, CloudFileMetadata } from "../services/cloud-service.ts";
import {
  downloadUtageAudioToPath,
  getUtageFileMetadata,
  isUtageUrl,
} from "../clients/utage.ts";

export class UtageAdapter extends BaseCloudService {
  readonly name = "Utage";
  readonly description =
    "Utage 配信プラットフォームの動画。ページから埋め込み動画を抽出してダウンロード。";
  readonly urlExamples = [
    "https://<your-tenant>.utage-system.com/video/<VIDEO_ID>",
  ];

  isValidUrl(url: string): boolean {
    return isUtageUrl(url);
  }

  extractFileId(url: string): string | null {
    // Return full URL as ID since we need it to fetch the page
    return isUtageUrl(url) ? url : null;
  }

  async getFileMetadata(videoUrl: string): Promise<CloudFileMetadata> {
    return await getUtageFileMetadata(videoUrl);
  }

  async downloadFile(videoUrl: string, tempPath: string): Promise<boolean> {
    await downloadUtageAudioToPath(videoUrl, tempPath);
    return true;
  }

  override getPreferredFileExtension(): string {
    return "mp3";
  }
}
