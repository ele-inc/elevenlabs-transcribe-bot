import { BaseCloudService, CloudFileMetadata } from "../services/cloud-service.ts";
import {
  extractYouTubeVideoId,
  getYouTubeFileMetadata,
  downloadYouTubeAudioToPath,
  isYouTubeUrl,
} from "../clients/youtube.ts";

export class YouTubeAdapter extends BaseCloudService {
  readonly name = "YouTube/Loom/Vimeo";

  isValidUrl(url: string): boolean {
    return isYouTubeUrl(url);
  }

  extractFileId(url: string): string | null {
    return extractYouTubeVideoId(url);
  }

  async getFileMetadata(videoId: string): Promise<CloudFileMetadata> {
    return await getYouTubeFileMetadata(videoId);
  }

  async downloadFile(videoId: string, tempPath: string): Promise<boolean> {
    await downloadYouTubeAudioToPath(videoId, tempPath);
    return true;
  }

  override getPreferredFileExtension(): string {
    return "mp3";
  }
}
