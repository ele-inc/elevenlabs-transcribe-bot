import { BaseCloudService, CloudDownloadOptions, CloudFileMetadata } from "../services/cloud-service.ts";
import {
  extractYouTubeVideoId,
  getYouTubeFileMetadata,
  downloadYouTubeAudioToPath,
  isYouTubeUrl,
} from "../clients/youtube.ts";

export class YouTubeAdapter extends BaseCloudService {
  readonly name = "YouTube/Loom/Vimeo";
  readonly description =
    "YouTube・Loom・通常の Vimeo 動画。yt-dlp で音声を取得。メンバー限定動画は YOUTUBE_COOKIES_BASE64 が必要。パスワード付き Vimeo は modal でパスワードを入力。";
  readonly urlExamples = [
    "https://www.youtube.com/watch?v=<VIDEO_ID>",
    "https://youtu.be/<VIDEO_ID>",
    "https://www.loom.com/share/<SHARE_ID>",
    "https://vimeo.com/<VIDEO_ID>",
  ];

  isValidUrl(url: string): boolean {
    return isYouTubeUrl(url);
  }

  extractFileId(url: string): string | null {
    return extractYouTubeVideoId(url);
  }

  async getFileMetadata(videoId: string, opts?: CloudDownloadOptions): Promise<CloudFileMetadata> {
    return await getYouTubeFileMetadata(videoId, { password: opts?.password });
  }

  async downloadFile(videoId: string, tempPath: string, opts?: CloudDownloadOptions): Promise<boolean> {
    await downloadYouTubeAudioToPath(videoId, tempPath, { password: opts?.password });
    return true;
  }

  override getPreferredFileExtension(): string {
    return "mp3";
  }
}
