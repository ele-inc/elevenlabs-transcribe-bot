import { BaseCloudService, CloudFileMetadata } from "../services/cloud-service.ts";
import {
  downloadHlsAudioToPath,
  extractHlsStreamId,
  getHlsFileMetadata,
  isHlsUrl,
} from "../clients/hls.ts";

export class HlsAdapter extends BaseCloudService {
  readonly name = "HLS";

  isValidUrl(url: string): boolean {
    return isHlsUrl(url);
  }

  extractFileId(url: string): string | null {
    return extractHlsStreamId(url);
  }

  async getFileMetadata(streamUrl: string): Promise<CloudFileMetadata> {
    return await getHlsFileMetadata(streamUrl);
  }

  async downloadFile(streamUrl: string, tempPath: string): Promise<boolean> {
    await downloadHlsAudioToPath(streamUrl, tempPath);
    return true;
  }

  override getPreferredFileExtension(): string {
    return "mp3";
  }
}
