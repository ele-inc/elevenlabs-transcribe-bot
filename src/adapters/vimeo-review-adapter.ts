import {
  BaseCloudService,
  CloudFileMetadata,
} from "../services/cloud-service.ts";
import {
  downloadVimeoReviewAudioToPath,
  extractVimeoReviewId,
  getVimeoReviewFileMetadata,
  isVimeoReviewUrl,
} from "../clients/vimeo-review.ts";

export class VimeoReviewAdapter extends BaseCloudService {
  readonly name = "Vimeo Review";

  isValidUrl(url: string): boolean {
    return isVimeoReviewUrl(url);
  }

  extractFileId(url: string): string | null {
    return extractVimeoReviewId(url);
  }

  async getFileMetadata(reviewUrl: string): Promise<CloudFileMetadata> {
    return await getVimeoReviewFileMetadata(reviewUrl);
  }

  async downloadFile(reviewUrl: string, tempPath: string): Promise<boolean> {
    await downloadVimeoReviewAudioToPath(reviewUrl, tempPath);
    return true;
  }

  override getPreferredFileExtension(): string {
    return "mp3";
  }
}
