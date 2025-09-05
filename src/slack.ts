import { config } from "./config.ts";
import { downloadWithAuth, cleanupTempFile } from "./lib/download.ts";

export async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.slackBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });

  return await response.json();
}

export async function uploadTranscriptToSlack(
  transcript: string,
  channelId: string,
  timestamp: string,
) {
  console.log("Uploading transcript to Slack...");

  const fileTimestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "_")
    .slice(0, 15);
  const transcriptFilename = `transcript_${fileTimestamp}.txt`;

  console.log("Using Slack Files API v2");

  const fileBytes = new TextEncoder().encode(transcript);
  console.log("File size:", fileBytes.length, "bytes");

  const formData1 = new FormData();
  formData1.append("filename", transcriptFilename);
  formData1.append("length", fileBytes.length.toString());

  const uploadUrlResponse = await fetch(
    "https://slack.com/api/files.getUploadURLExternal",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.slackBotToken}`,
      },
      body: formData1,
    },
  );

  const uploadUrlResult = await uploadUrlResponse.json();
  console.log(
    "Upload URL response:",
    JSON.stringify(uploadUrlResult, null, 2),
  );

  if (!uploadUrlResult.ok) {
    throw new Error(`Failed to get upload URL: ${uploadUrlResult.error}`);
  }

  const fileUploadResponse = await fetch(uploadUrlResult.upload_url, {
    method: "POST",
    body: fileBytes,
  });

  if (!fileUploadResponse.ok) {
    throw new Error(
      `Failed to upload file: ${fileUploadResponse.statusText}`,
    );
  }

  const formData2 = new FormData();
  formData2.append(
    "files",
    JSON.stringify([{
      id: uploadUrlResult.file_id,
      title: transcriptFilename,
    }]),
  );
  formData2.append("channel_id", channelId);
  formData2.append("initial_comment", "文字起こしが完了しました！📝");
  formData2.append("thread_ts", timestamp);

  const completeResponse = await fetch(
    "https://slack.com/api/files.completeUploadExternal",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.slackBotToken}`,
      },
      body: formData2,
    },
  );

  const completeResult = await completeResponse.json();
  console.log(
    "Complete upload response:",
    JSON.stringify(completeResult, null, 2),
  );

  if (!completeResult.ok) {
    throw new Error(`Failed to complete upload: ${completeResult.error}`);
  }

  console.log("Transcript successfully uploaded to Slack");
}

export async function downloadSlackFile(fileURL: string): Promise<ArrayBuffer> {
  console.log("fetching file");
  const downloadedFile = await downloadWithAuth(
    fileURL,
    config.slackBotToken,
    'Bearer',
    undefined,
    {
      maxRetries: 3,
      timeoutMs: 300000,
    }
  );

  try {
    const data = await Deno.readFile(downloadedFile.path);
    console.log("File size:", data.byteLength, "bytes");
    return data.buffer;
  } finally {
    // Clean up temp file
    await cleanupTempFile(downloadedFile.path);
  }
}

export async function downloadSlackFileToPath(fileURL: string, filePath: string): Promise<void> {
  console.log("streaming file to:", filePath);
  const response = await fetch(fileURL, {
    headers: {
      "Authorization": `Bearer ${config.slackBotToken}`,
    },
  });

  console.log("Response status:", response.status);
  console.log("Response content-type:", response.headers.get("content-type"));

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  if (response.headers.get("content-type")?.includes("text/html")) {
    const htmlContent = await response.text();
    console.log(
      "HTML Response (first 500 chars):",
      htmlContent.substring(0, 500),
    );
    throw new Error(
      "Received HTML instead of audio file - likely authentication error",
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    console.log("File size:", contentLength, "bytes");
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const file = await Deno.open(filePath, { write: true, create: true });
  try {
    const reader = response.body.getReader();
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      await file.write(value);
      totalBytes += value.byteLength;

      if (totalBytes % (10 * 1024 * 1024) === 0) {
        console.log(`Downloaded ${totalBytes / (1024 * 1024)}MB...`);
      }
    }

    console.log(`Download complete: ${totalBytes} bytes`);
  } finally {
    file.close();
  }
}
