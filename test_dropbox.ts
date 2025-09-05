#!/usr/bin/env deno run --allow-net --allow-write --allow-read

import { parseDropboxUrl, convertToDirectDownloadUrl, isDropboxUrl } from "./src/dropbox.ts";

// Test cases for Dropbox URL parsing
const testUrls = [
  // Standard sharing link
  "https://www.dropbox.com/s/abc123xyz/audio.mp3?dl=0",
  "https://www.dropbox.com/s/def456abc/video.mp4?dl=1",
  
  // Scoped file link
  "https://www.dropbox.com/scl/fi/xyz789abc/recording.wav?rlkey=key123&dl=0",
  
  // Shared folder link
  "https://www.dropbox.com/sh/folder123/xyz789?dl=0",
  
  // Direct download link
  "https://dl.dropboxusercontent.com/s/abc123/file.mp3",
  
  // Invalid URLs
  "https://google.com/file.mp3",
  "https://drive.google.com/file/d/123/view",
  "https://example.com/dropbox.mp3",
];

console.log("Testing Dropbox URL Detection and Parsing:");
console.log("=" .repeat(50));

for (const url of testUrls) {
  const isValid = isDropboxUrl(url);
  const parsed = parseDropboxUrl(url);
  
  console.log(`\nURL: ${url}`);
  console.log(`  Valid Dropbox URL: ${isValid}`);
  console.log(`  Parsed Result: ${parsed || "null"}`);
  
  if (parsed) {
    const directUrl = convertToDirectDownloadUrl(parsed);
    console.log(`  Direct Download URL: ${directUrl}`);
  }
}

// Test actual download (requires a valid Dropbox link)
console.log("\n" + "=" .repeat(50));
console.log("Download Test:");
console.log("To test actual download, run with a valid Dropbox link:");
console.log("  deno run --allow-net --allow-write test_dropbox.ts <dropbox_url>");

if (Deno.args.length > 0) {
  const testUrl = Deno.args[0];
  
  if (isDropboxUrl(testUrl)) {
    console.log(`\nTesting download from: ${testUrl}`);
    
    try {
      const { downloadDropboxFile } = await import("./src/dropbox.ts");
      const tempPath = `/tmp/test_dropbox_${Date.now()}.tmp`;
      
      console.log("Downloading file...");
      const { filename, mimeType } = await downloadDropboxFile(testUrl, tempPath);
      
      console.log(`✅ Download successful!`);
      console.log(`  Filename: ${filename}`);
      console.log(`  MIME Type: ${mimeType}`);
      console.log(`  Saved to: ${tempPath}`);
      
      // Get file size
      const fileInfo = await Deno.stat(tempPath);
      console.log(`  File Size: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Clean up
      await Deno.remove(tempPath);
      console.log("  Temp file cleaned up");
      
    } catch (error) {
      console.error(`❌ Download failed: ${error.message}`);
    }
  } else {
    console.log(`❌ Invalid Dropbox URL: ${testUrl}`);
  }
}