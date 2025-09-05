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

// Check if URL is a Google Drive URL
export function isGoogleDriveUrl(url: string): boolean {
  return parseGoogleDriveUrl(url) !== null;
}
