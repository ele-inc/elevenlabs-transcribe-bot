import { JWT } from "npm:google-auth-library@9.15.0";
import { google } from "npm:googleapis@144.0.0";
import { config } from "./config.ts";

// Types for Google Drive file metadata
interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

// Parse Google Drive URL to extract file ID
export function parseGoogleDriveUrl(url: string): string | null {
  // Handle various Google Drive URL formats
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9-_]+)/,
    /docs\.google\.com\/[a-z]+\/d\/([a-zA-Z0-9-_]+)/,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9-_]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// Initialize Google Drive client with service account
function initializeGoogleDriveClient() {
  if (!config.googlePrivateKey) {
    throw new Error("GOOGLE_PRIVATE_KEY environment variable is not set");
  }

  // Replace escaped newlines with actual newlines in private key
  const formattedPrivateKey = config.googlePrivateKey.replace(/\\n/g, '\n');

  const auth = new JWT({
    email: config.googleClientEmail,
    key: formattedPrivateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],  // Match the scope in Admin Console
    subject: config.googleImpersonateEmail, // Impersonate a user in the organization (optional)
  });

  return google.drive({ version: "v3", auth });
}

// Get file metadata from Google Drive
export async function getGoogleDriveFileMetadata(fileId: string): Promise<GoogleDriveFile> {
  const drive = initializeGoogleDriveClient();

  try {
    const response = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
      supportsAllDrives: true, // Support for shared drives
    });

    return response.data as GoogleDriveFile;
  } catch (error) {
    const err = error as { code?: number; message?: string; errors?: unknown };
    console.error("Google Drive API error details:", {
      code: err.code,
      message: err.message,
      errors: err.errors,
      fileId: fileId,
    });

    if (err.code === 404) {
      throw new Error(`File not found (ID: ${fileId}). Check if the URL is correct and the file exists.`);
    }
    if (err.code === 403) {
      throw new Error(`Permission denied. The Google Drive API might not be enabled for this project.`);
    }
    throw new Error(`Failed to get file metadata: ${err.message}`);
  }
}

// Download Google Drive file to temporary path with streaming
// Returns true if download was successful, false if file was skipped (non-media)
export async function downloadGoogleDriveFileToPath(
  fileId: string,
  tempPath: string,
): Promise<boolean> {
  const drive = initializeGoogleDriveClient();

  try {
    const startTime = performance.now();

    // Get file metadata first
    const metadata = await getGoogleDriveFileMetadata(fileId);
    const fileSizeMB = metadata.size ? parseInt(metadata.size) / (1024 * 1024) : 0;

    console.log(`Starting download: ${metadata.name} (${fileSizeMB.toFixed(2)}MB)`);

    // Check if it's a Google Docs/Sheets/Slides file
    const googleDocsTypes = [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
      "application/vnd.google-apps.drawing",
      "application/vnd.google-apps.form",
      "application/vnd.google-apps.map",
      "application/vnd.google-apps.site",
      "application/vnd.google-apps.script",
      "application/vnd.google-apps.jamboard",
    ];

    if (googleDocsTypes.includes(metadata.mimeType)) {
      // Skip Google Docs files silently
      console.log(`Skipping Google Docs file: ${metadata.name} (${metadata.mimeType})`);
      return false;
    }

    // Check if it's a media file (audio or video)
    const isMediaFile = 
      metadata.mimeType.toLowerCase().startsWith("audio/") ||
      metadata.mimeType.toLowerCase().startsWith("video/") ||
      metadata.mimeType === "application/ogg";  // Can be audio or video

    if (!isMediaFile) {
      // Skip non-media files silently
      console.log(`Skipping non-media file: ${metadata.name} (${metadata.mimeType})`);
      return false;
    }

    // Download all files with streaming
    const response = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "stream",
        timeout: 3600000, // 1 hour
      }
    );

    // Stream download with chunked writing
    const file = await Deno.open(tempPath, { write: true, create: true, truncate: true });
    const writer = file.writable.getWriter();

    let downloadedBytes = 0;
    let lastProgressTime = performance.now();

    try {
      // Node.js Readable stream from googleapis
      const stream = response.data; // Node.js Readable stream

      // Convert Node.js Readable stream to chunks
      for await (const chunk of stream) {
        const buffer = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        await writer.write(buffer);
        downloadedBytes += buffer.length;

        // Log progress every second
        const currentTime = performance.now();
        if (currentTime - lastProgressTime > 1000) {
          const progress = metadata.size ? (downloadedBytes / parseInt(metadata.size) * 100).toFixed(1) : '?';
          const speed = (downloadedBytes / 1024 / 1024) / ((currentTime - startTime) / 1000);
          console.log(`Download progress: ${progress}% (${speed.toFixed(2)}MB/s)`);
          lastProgressTime = currentTime;
        }
      }
    } finally {
      await writer.close();
    }

    const downloadTime = (performance.now() - startTime) / 1000;
    const actualSizeMB = downloadedBytes / (1024 * 1024);
    console.log(`Download complete: ${actualSizeMB.toFixed(2)}MB in ${downloadTime.toFixed(2)}s (${(actualSizeMB / downloadTime).toFixed(2)}MB/s)`);
    return true;

  } catch (error) {
    const err = error as { code?: number; message?: string };
    if (err.code === 403) {
      throw new Error("Access denied. The file might be private or restricted.");
    }
    if (err.code === 404) {
      throw new Error("File not found or you don't have permission to access it.");
    }
    throw new Error(`Failed to download file: ${err.message}`);
  }
}

// Check if URL is a Google Drive URL
export function isGoogleDriveUrl(url: string): boolean {
  return parseGoogleDriveUrl(url) !== null;
}

// Download Google Drive file and return metadata
// Returns null if file was skipped (non-media)
export async function downloadGoogleDriveFile(
  url: string,
  tempPath: string,
): Promise<{ filename: string; mimeType: string } | null> {
  const fileId = parseGoogleDriveUrl(url);

  if (!fileId) {
    throw new Error("Invalid Google Drive URL");
  }

  // Get file metadata
  const metadata = await getGoogleDriveFileMetadata(fileId);

  // Download file (returns false if skipped)
  const downloaded = await downloadGoogleDriveFileToPath(fileId, tempPath);
  
  if (!downloaded) {
    return null;  // File was skipped
  }

  return {
    filename: metadata.name,
    mimeType: metadata.mimeType,
  };
}
