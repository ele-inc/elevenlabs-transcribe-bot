import {
  BaseCloudService,
  CloudFileMetadata,
} from "../services/cloud-service.ts";
import {
  downloadHlsAudioToPath,
  extractHlsStreamId,
  getHlsFileMetadata,
  isHlsUrl,
} from "../clients/hls.ts";

/** HLS アダプターを識別する安定したサービス名。 */
export const HLS_SERVICE_NAME = "HLS";

export class HlsAdapter extends BaseCloudService {
  readonly name = HLS_SERVICE_NAME;
  readonly description =
    "HLS 動画ストリーム（.m3u8 マニフェスト）。ffmpeg で音声を抽出。";
  readonly urlExamples = [
    "https://example.com/path/to/playlist.m3u8",
  ];

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
