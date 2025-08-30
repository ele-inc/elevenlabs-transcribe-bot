import { JWT } from "npm:google-auth-library@9.15.0";
import { google } from "npm:googleapis@144.0.0";

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
  // Get individual service account components from environment variables
  const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
  const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL")
  const impersonateEmail = Deno.env.get("GOOGLE_IMPERSONATE_EMAIL"); // Optional: email to impersonate
  
  if (!privateKey) {
    throw new Error("GOOGLE_PRIVATE_KEY environment variable is not set");
  }

  // Replace escaped newlines with actual newlines in private key
  const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

  const auth = new JWT({
    email: clientEmail,
    key: formattedPrivateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],  // Match the scope in Admin Console
    subject: impersonateEmail, // Impersonate a user in the organization (optional)
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
  } catch (error: any) {
    console.error("Google Drive API error details:", {
      code: error.code,
      message: error.message,
      errors: error.errors,
      fileId: fileId,
    });
    
    if (error.code === 404) {
      throw new Error(`File not found (ID: ${fileId}). Check if the URL is correct and the file exists.`);
    }
    if (error.code === 403) {
      throw new Error(`Permission denied. The Google Drive API might not be enabled for this project.`);
    }
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
}

// Download Google Drive file to temporary path
export async function downloadGoogleDriveFileToPath(
  fileId: string,
  tempPath: string,
): Promise<void> {
  const drive = initializeGoogleDriveClient();

  try {
    // Get file metadata first to check if it's a Google Docs file
    const metadata = await getGoogleDriveFileMetadata(fileId);
    
    // Check if it's a Google Docs/Sheets/Slides file that needs export
    const exportMimeTypes: Record<string, string> = {
      "application/vnd.google-apps.document": "application/pdf",
      "application/vnd.google-apps.spreadsheet": "application/pdf",
      "application/vnd.google-apps.presentation": "application/pdf",
      "application/vnd.google-apps.drawing": "application/pdf",
    };

    let response;
    
    if (exportMimeTypes[metadata.mimeType]) {
      // Export Google Docs files
      response = await drive.files.export(
        {
          fileId,
          mimeType: exportMimeTypes[metadata.mimeType],
        },
        { responseType: "stream" }
      );
    } else {
      // Download regular files
      response = await drive.files.get(
        {
          fileId,
          alt: "media",
          supportsAllDrives: true,
        },
        { responseType: "stream" }
      );
    }

    // Write stream to file directly without buffering in memory
    const file = await Deno.open(tempPath, {
      create: true,
      write: true,
      truncate: true,
    });

    try {
      // Write chunks directly to file as they arrive
      let totalBytes = 0;
      
      // response.data is a Node.js Readable stream
      for await (const chunk of response.data as any) {
        const uint8Chunk = new Uint8Array(chunk);
        await file.write(uint8Chunk);
        totalBytes += uint8Chunk.length;
        
        // Log progress for large files
        if (totalBytes % (10 * 1024 * 1024) === 0) {
          console.log(`Downloaded ${(totalBytes / (1024 * 1024)).toFixed(1)}MB...`);
        }
      }
      
      console.log(`Download complete: ${(totalBytes / (1024 * 1024)).toFixed(2)}MB`);
    } finally {
      file.close();
    }
  } catch (error: any) {
    if (error.code === 403) {
      throw new Error("Access denied. The file might be private or restricted.");
    }
    if (error.code === 404) {
      throw new Error("File not found or you don't have permission to access it.");
    }
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

// Check if URL is a Google Drive URL
export function isGoogleDriveUrl(url: string): boolean {
  return parseGoogleDriveUrl(url) !== null;
}

// Download Google Drive file and return metadata
export async function downloadGoogleDriveFile(
  url: string,
  tempPath: string,
): Promise<{ filename: string; mimeType: string }> {
  const fileId = parseGoogleDriveUrl(url);
  
  if (!fileId) {
    throw new Error("Invalid Google Drive URL");
  }

  // Get file metadata
  const metadata = await getGoogleDriveFileMetadata(fileId);
  
  // Download file
  await downloadGoogleDriveFileToPath(fileId, tempPath);

  // For Google Docs files that were exported, adjust the mime type
  const exportedTypes: Record<string, string> = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet": "application/pdf",
    "application/vnd.google-apps.presentation": "application/pdf",
    "application/vnd.google-apps.drawing": "application/pdf",
  };

  const actualMimeType = exportedTypes[metadata.mimeType] || metadata.mimeType;

  return {
    filename: metadata.name,
    mimeType: actualMimeType,
  };
}