import {
  BaseCloudService,
  type CloudDownloadOptions,
  type CloudFileMetadata,
  resolveCloudFileMetadata,
} from "./cloud-service.ts";
import { assertEquals } from "@std/assert";
import { isAllowedHlsApiUrl } from "../utils/hls-url-policy.ts";

class MetadataReuseService extends BaseCloudService {
  readonly name = "Metadata reuse test";
  metadataCalls = 0;

  isValidUrl(): boolean {
    return true;
  }

  extractFileId(): string {
    return "file-1";
  }

  getFileMetadata(): Promise<CloudFileMetadata> {
    this.metadataCalls++;
    return Promise.resolve({
      id: "file-1",
      filename: "from-provider.mp3",
      mimeType: "audio/mpeg",
    });
  }

  downloadFile(
    _fileId: string,
    _tempPath: string,
    _opts?: CloudDownloadOptions,
  ): Promise<boolean> {
    return Promise.resolve(true);
  }
}

Deno.test("HLS API URL は許可したホストとそのサブドメインだけ受け付ける", () => {
  const allowedHosts = ["media.example.com"];
  assertEquals(
    isAllowedHlsApiUrl(
      "https://media.example.com/live/playlist.m3u8",
      allowedHosts,
    ),
    true,
  );
  assertEquals(
    isAllowedHlsApiUrl(
      "https://edge.media.example.com/live/playlist.m3u8",
      allowedHosts,
    ),
    true,
  );
  assertEquals(
    isAllowedHlsApiUrl(
      "https://untrusted.example.net/live/playlist.m3u8",
      allowedHosts,
    ),
    false,
  );
});

Deno.test("HLS API URL はローカル・プライベートIPを拒否する", () => {
  for (
    const hostname of [
      "localhost",
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "[::1]",
      "[fd00::1]",
    ]
  ) {
    assertEquals(
      isAllowedHlsApiUrl(
        `https://${hostname}/live/playlist.m3u8`,
        [hostname.replace(/^\[|\]$/g, "")],
      ),
      false,
    );
  }
});

Deno.test("resolved cloud metadata bypasses provider lookup", async () => {
  const service = new MetadataReuseService();
  const metadata: CloudFileMetadata = {
    id: "file-1",
    filename: "known.mp3",
    mimeType: "audio/mpeg",
  };

  const result = await resolveCloudFileMetadata(
    service,
    "file-1",
    { metadata },
  );

  assertEquals(result, metadata);
  assertEquals(service.metadataCalls, 0);
});

Deno.test("cloud metadata is fetched when none was resolved", async () => {
  const service = new MetadataReuseService();

  const result = await resolveCloudFileMetadata(service, "file-1");

  assertEquals(result.filename, "from-provider.mp3");
  assertEquals(service.metadataCalls, 1);
});
