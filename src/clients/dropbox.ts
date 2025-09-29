// Deno global for type checking in non-Deno-aware tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;
// Minimal Dropbox shared link support without OAuth
// We handle public shared file links by converting them to direct-download URLs (dl=1)

interface DropboxMetadata {
  name: string;
  mimeType: string;
  size?: number;
}

function ensureDlOne(url: URL): URL {
  // Dropbox respects dl=1 for direct download
  if (url.searchParams.has("dl")) {
    url.searchParams.set("dl", "1");
  } else {
    url.searchParams.append("dl", "1");
  }
  return url;
}

/**
 * Convert a Dropbox share URL into a direct-download URL
 * Supports patterns like:
 * - https://www.dropbox.com/s/<id>/<filename>?dl=0
 * - https://www.dropbox.com/scl/fi/<id>/<filename>?rlkey=...&dl=0
 * - https://dl.dropboxusercontent.com/s/<id>/<filename>
 */
export function toDropboxDirectUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();

    // Accept only share/file endpoints, skip folders or unsupported pages
    const isSharePath = url.pathname.startsWith("/s/") || url.pathname.startsWith("/scl/fi/");

    if (hostname === "dl.dropboxusercontent.com") {
      return ensureDlOne(url).toString();
    }

    if (hostname.endsWith("dropbox.com") && isSharePath) {
      return ensureDlOne(url).toString();
    }

    return null;
  } catch {
    return null;
  }
}

export function isDropboxUrl(input: string): boolean {
  return toDropboxDirectUrl(input) !== null;
}

function parseFilenameFromContentDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;
  // content-disposition: attachment; filename="name.ext"; filename*=UTF-8''name.ext
  const filenameStarMatch = contentDisposition.match(/filename\*=(?:UTF-8''|utf-8'')([^;\n]+)/);
  if (filenameStarMatch) {
    try {
      return decodeURIComponent(filenameStarMatch[1]);
    } catch {
      return filenameStarMatch[1];
    }
  }
  const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
  if (filenameMatch) {
    return filenameMatch[1];
  }
  return undefined;
}

async function headOrRangeFetch(url: string): Promise<Response> {
  // Try HEAD first
  try {
    const headResp = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (headResp.ok) return headResp;
  } catch {
    // fallthrough
  }
  // Fallback to range GET to minimize data
  const getResp = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
  });
  return getResp;
}

export async function getDropboxFileMetadata(directUrl: string): Promise<DropboxMetadata> {
  const resp = await headOrRangeFetch(directUrl);
  if (!resp.ok) {
    throw new Error(`Failed to access Dropbox link (status ${resp.status})`);
  }
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  const contentLength = resp.headers.get("content-length");
  const contentDisposition = resp.headers.get("content-disposition");

  let name = parseFilenameFromContentDisposition(contentDisposition);
  if (!name) {
    try {
      const urlObj = new URL(directUrl);
      const parts = urlObj.pathname.split("/");
      const last = parts[parts.length - 1];
      name = last || "dropbox_file";
    } catch {
      name = "dropbox_file";
    }
  }

  return {
    name,
    mimeType: contentType,
    size: contentLength ? parseInt(contentLength) : undefined,
  };
}

/**
 * Download Dropbox file to path. Returns false if non-media and should be skipped.
 */
export async function downloadDropboxFileToPath(directUrl: string, tempPath: string): Promise<boolean> {
  // Fetch with streaming
  const resp = await fetch(directUrl, { method: "GET", redirect: "follow" });
  if (!resp.ok || !resp.body) {
    throw new Error(`Failed to download Dropbox file (status ${resp.status})`);
  }

  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  const isMedia = contentType.startsWith("audio/") || contentType.startsWith("video/") || contentType === "application/ogg" || contentType === "application/octet-stream";

  if (!isMedia) {
    // Skip non-media files silently
    return false;
  }

  // Stream to disk
  const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
  try {
    const writer = file.writable.getWriter();
    let downloadedBytes = 0;
    try {
      for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        await writer.write(buffer);
        downloadedBytes += buffer.length;
      }
    } finally {
      await writer.close();
    }
    return true;
  } finally {
    file.close();
  }
}

