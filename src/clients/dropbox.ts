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

async function headOrRangeFetch(url: string): Promise<{ resp: Response; originalFilename?: string }> {
  // For Dropbox scl/fi links, we need to handle redirects manually to preserve filename
  const isScl = url.includes("/scl/fi/");

  // First, get the filename from the initial redirect response
  let originalFilename: string | undefined;

  if (isScl) {
    try {
      // Don't follow redirects to capture the original content-disposition
      const initialResp = await fetch(url, {
        method: "HEAD",
        redirect: "manual"  // Don't follow redirect
      });

      const disposition = initialResp.headers.get("content-disposition");

      if (disposition) {
        originalFilename = parseFilenameFromContentDisposition(disposition) || undefined;
      }
    } catch {
      // Ignore errors from initial response
    }
  }

  // Now proceed with the actual request
  if (!isScl) {
    // Try HEAD first for non-scl links
    try {
      const headResp = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (headResp.ok) {
        const ct = headResp.headers.get("content-type");
        // Don't trust HEAD if it returns JSON
        if (!ct?.includes("json")) {
          return { resp: headResp, originalFilename };
        }
      }
    } catch {
      // HEAD request failed, fall back to Range GET
    }
  }

  // Use range GET to get actual content-type
  const getResp = await fetch(url, {
    method: "GET",
    headers: { Range: "bytes=0-100" },  // Get first 100 bytes to check content
    redirect: "follow",
  });

  return { resp: getResp, originalFilename };
}

export async function getDropboxFileMetadata(directUrl: string): Promise<DropboxMetadata> {
  const { resp, originalFilename } = await headOrRangeFetch(directUrl);
  if (!resp.ok) {
    throw new Error(`Failed to access Dropbox link (status ${resp.status})`);
  }
  let contentType = resp.headers.get("content-type") || "application/octet-stream";
  const contentLength = resp.headers.get("content-length");
  const contentDisposition = resp.headers.get("content-disposition");

  // Try to get filename from multiple sources
  let name = originalFilename || parseFilenameFromContentDisposition(contentDisposition);
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

  // If content-type is unreliable, try to determine from file extension
  // Dropbox sometimes returns JSON for errors or binary/octet-stream for media files
  const unreliableTypes = [
    "application/octet-stream",
    "application/json",
    "application/binary",
    "binary/octet-stream",
    "application/x-binary"
  ];

  if (unreliableTypes.includes(contentType) && name) {
    const ext = name.toLowerCase().split('.').pop();

    if (ext) {
      // Common video extensions
      if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'].includes(ext)) {
        contentType = `video/${ext === 'mov' ? 'quicktime' : ext}`;
      }
      // Common audio extensions
      else if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(ext)) {
        contentType = `audio/${ext === 'mp3' ? 'mpeg' : ext}`;
      }
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
  const disposition = resp.headers.get("content-disposition") || "";

  const isMedia =
    contentType.startsWith("audio/") ||
    contentType.startsWith("video/") ||
    contentType.includes("octet-stream") ||
    contentType === "application/ogg" ||
    contentType === "application/binary" ||
    contentType === "binary/octet-stream" ||
    contentType === "application/x-binary" ||
    /attachment/i.test(disposition);

  if (!isMedia) {
    // Skip non-media files silently
    return false;
  }

  // Stream to disk using Web Streams reader (Deno)
  const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
  const writer = file.writable.getWriter();
  try {
    const body = resp.body;
    const reader = body.getReader();
    let downloadedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await writer.write(value);
        downloadedBytes += value.length;
      }
    }
    await writer.close();
    return true;
  } finally {
    try { file.close(); } catch {
      // File might already be closed
    }
  }
}

