#!/usr/bin/env deno run --allow-all

// Test filename extraction from Content-Disposition headers

function extractFilename(contentDisposition: string): string {
  let filename = "unknown_file";
  
  // First try to extract filename* (RFC 5987 encoded filename for non-ASCII characters)
  const encodedFilenameMatch = contentDisposition.match(/filename\*=([^;]+)/);
  if (encodedFilenameMatch) {
    // Format: UTF-8''encoded-filename
    const encodedPart = encodedFilenameMatch[1];
    const parts = encodedPart.split("''");
    if (parts.length === 2) {
      // Decode the percent-encoded UTF-8 filename
      filename = decodeURIComponent(parts[1]);
    }
  } else {
    // Fallback to regular filename parameter
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch) {
      filename = filenameMatch[1].replace(/['"]/g, "");
      // Try to decode if it appears to be encoded
      try {
        if (filename.includes('%')) {
          filename = decodeURIComponent(filename);
        }
      } catch {
        // Keep original if decoding fails
      }
    }
  }
  
  return filename;
}

// Test cases
const testCases = [
  {
    header: 'attachment; filename="test.mp3"',
    expected: "test.mp3",
    description: "Simple ASCII filename with quotes"
  },
  {
    header: 'attachment; filename=test.mp3',
    expected: "test.mp3",
    description: "Simple ASCII filename without quotes"
  },
  {
    header: "attachment; filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88.mp3",
    expected: "テスト.mp3",
    description: "Japanese filename with RFC 5987 encoding"
  },
  {
    header: "attachment; filename*=UTF-8''%E4%BC%9A%E8%AD%B0%E9%8C%B2%E9%9F%B3_2024%E5%B9%B4.wav",
    expected: "会議録音_2024年.wav",
    description: "Complex Japanese filename"
  },
  {
    header: 'attachment; filename="%E3%83%86%E3%82%B9%E3%83%88.mp3"',
    expected: "テスト.mp3",
    description: "Percent-encoded filename in regular parameter"
  },
  {
    header: "attachment; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB%E5%90%8D.mp4",
    expected: "日本語ファイル名.mp4",
    description: "Japanese text 'Japanese filename'"
  },
  {
    header: 'attachment; filename="音声メモ.m4a"',
    expected: "音声メモ.m4a",
    description: "Japanese filename without encoding (may not work correctly)"
  },
];

console.log("Testing Filename Extraction from Content-Disposition Headers");
console.log("=" .repeat(60));

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = extractFilename(testCase.header);
  const isPass = result === testCase.expected;
  
  console.log(`\n${testCase.description}:`);
  console.log(`  Header: ${testCase.header}`);
  console.log(`  Expected: ${testCase.expected}`);
  console.log(`  Result: ${result}`);
  console.log(`  Status: ${isPass ? "✅ PASS" : "❌ FAIL"}`);
  
  if (isPass) {
    passed++;
  } else {
    failed++;
  }
}

console.log("\n" + "=" .repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);

// Test with actual Dropbox URLs if provided
if (Deno.args.length > 0) {
  console.log("\n" + "=" .repeat(60));
  console.log("Testing with actual Dropbox URL:");
  
  const url = Deno.args[0];
  console.log(`URL: ${url}`);
  
  // Convert to direct download URL
  let directUrl = url;
  if (directUrl.includes("dl=0")) {
    directUrl = directUrl.replace(/dl=0/g, "dl=1");
  } else if (!directUrl.includes("dl=1")) {
    if (directUrl.includes("?")) {
      directUrl += "&dl=1";
    } else {
      directUrl += "?dl=1";
    }
  }
  directUrl = directUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com");
  
  console.log(`Direct URL: ${directUrl}`);
  
  try {
    // Make HEAD request to get headers without downloading
    const response = await fetch(directUrl, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TranscribeBot/1.0)",
      },
    });
    
    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition) {
      console.log(`\nContent-Disposition: ${contentDisposition}`);
      const filename = extractFilename(contentDisposition);
      console.log(`Extracted Filename: ${filename}`);
    } else {
      console.log("No Content-Disposition header found");
    }
    
    // Also show other relevant headers
    console.log("\nOther Headers:");
    console.log(`  Content-Type: ${response.headers.get("content-type")}`);
    console.log(`  Content-Length: ${response.headers.get("content-length")}`);
    
  } catch (error) {
    console.error(`Error fetching headers: ${error.message}`);
  }
}