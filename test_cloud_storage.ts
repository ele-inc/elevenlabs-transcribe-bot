#!/usr/bin/env deno run --allow-net --allow-write --allow-read

import {
  detectCloudStorageProvider,
  parseCloudStorageUrl,
  extractCloudStorageUrls,
  getProviderDisplayName,
  isCloudStorageUrl,
} from "./src/cloud-storage.ts";

// Test URLs
const testUrls = [
  // Google Drive URLs
  "https://drive.google.com/file/d/abc123xyz/view",
  "https://drive.google.com/open?id=def456",
  "https://docs.google.com/document/d/ghi789/edit",
  
  // Dropbox URLs
  "https://www.dropbox.com/s/abc123xyz/audio.mp3?dl=0",
  "https://www.dropbox.com/scl/fi/xyz789abc/recording.wav?rlkey=key123&dl=0",
  "https://dl.dropboxusercontent.com/s/abc123/file.mp3",
  
  // Invalid URLs
  "https://example.com/file.mp3",
  "https://youtube.com/watch?v=123",
];

console.log("Testing Cloud Storage URL Detection:");
console.log("=" .repeat(50));

// Test individual URL detection
for (const url of testUrls) {
  const provider = detectCloudStorageProvider(url);
  const urlInfo = parseCloudStorageUrl(url);
  const isValid = isCloudStorageUrl(url);
  
  console.log(`\nURL: ${url}`);
  console.log(`  Provider: ${provider}`);
  console.log(`  Display Name: ${getProviderDisplayName(provider)}`);
  console.log(`  Is Valid: ${urlInfo.isValid}`);
  console.log(`  Is Cloud Storage: ${isValid}`);
}

// Test extracting URLs from text
console.log("\n" + "=" .repeat(50));
console.log("Testing URL Extraction from Text:");

const sampleText = `
  Check out these files:
  - Google Drive: https://drive.google.com/file/d/abc123xyz/view
  - Dropbox: https://www.dropbox.com/s/def456/video.mp4?dl=0
  - Regular link: https://example.com/file.mp3
  And another one: https://docs.google.com/spreadsheets/d/xyz789/edit
`;

const extractedUrls = extractCloudStorageUrls(sampleText);

console.log(`\nOriginal text contains ${sampleText.match(/https?:\/\/[^\s]+/gi)?.length || 0} URLs`);
console.log(`Found ${extractedUrls.length} valid cloud storage URLs:`);

for (const urlInfo of extractedUrls) {
  console.log(`  - ${getProviderDisplayName(urlInfo.provider)}: ${urlInfo.originalUrl}`);
}

// Test actual download if URL provided as argument
if (Deno.args.length > 0) {
  const testUrl = Deno.args[0];
  
  console.log("\n" + "=" .repeat(50));
  console.log("Testing Download:");
  
  if (isCloudStorageUrl(testUrl)) {
    console.log(`\nTesting download from: ${testUrl}`);
    
    try {
      const { downloadCloudFile } = await import("./src/cloud-storage.ts");
      const tempPath = `/tmp/test_cloud_${Date.now()}.tmp`;
      
      console.log("Downloading file...");
      const metadata = await downloadCloudFile(testUrl, tempPath);
      
      console.log(`✅ Download successful!`);
      console.log(`  Provider: ${getProviderDisplayName(metadata.provider)}`);
      console.log(`  Filename: ${metadata.filename}`);
      console.log(`  MIME Type: ${metadata.mimeType}`);
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
    console.log(`❌ Not a valid cloud storage URL: ${testUrl}`);
  }
}