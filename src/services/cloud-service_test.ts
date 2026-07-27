import {
  BaseCloudService,
  type CloudDownloadOptions,
  type CloudFileMetadata,
  resolveCloudFileMetadata,
} from "./cloud-service.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

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
