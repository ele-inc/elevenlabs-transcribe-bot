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
  readonly description =
    "Vimeo の Review ページ（プライベート共有用 URL）。通常の Vimeo は YouTube/Loom/Vimeo アダプタで処理。";
  readonly urlExamples = [
    "https://vimeo.com/<VIDEO_ID>/<REVIEW_HASH>",
  ];

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
