import { JWT } from "npm:google-auth-library@9.15.0";

// External proxy approach - bypass GCP internal routing completely
export async function downloadViaExternalRoute(fileId: string, tempPath: string): Promise<void> {
  const startTime = performance.now();
  
  // Get access token
  const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY")!.replace(/\\n/g, '\n');
  const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL") || "n8n-app@automatic-recording-of-minutes.iam.gserviceaccount.com";
  const impersonateEmail = Deno.env.get("GOOGLE_IMPERSONATE_EMAIL");
  
  const auth = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    subject: impersonateEmail,
  });
  
  console.log("[External] Getting access token...");
  const tokenStart = performance.now();
  const tokens = await auth.authorize();
  console.log(`[External] Token obtained in ${(performance.now() - tokenStart).toFixed(2)}ms`);
  
  // Use external DNS resolution by adding explicit headers
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  
  console.log("[External] Starting download via external route...");
  const fetchStart = performance.now();
  
  // Force external resolution with custom headers
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Host': 'www.googleapis.com',
      'User-Agent': 'Mozilla/5.0 (compatible; CloudRun/1.0)', // Disguise as browser
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  
  console.log(`[External] Response headers received in ${(performance.now() - fetchStart).toFixed(2)}ms`);
  
  // Download with progress tracking
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let lastLog = Date.now();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    totalBytes += value.byteLength;
    
    // Log progress every second
    if (Date.now() - lastLog > 1000) {
      const elapsed = (performance.now() - fetchStart) / 1000;
      const speed = (totalBytes / (1024 * 1024)) / elapsed;
      console.log(`[External] Progress: ${(totalBytes / (1024 * 1024)).toFixed(2)}MB, Speed: ${speed.toFixed(2)}MB/s`);
      lastLog = Date.now();
    }
  }
  
  // Combine chunks and write to file
  const fullBuffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    fullBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  
  await Deno.writeFile(tempPath, fullBuffer);
  
  const totalTime = (performance.now() - startTime) / 1000;
  const downloadTime = (performance.now() - fetchStart) / 1000;
  const fileSizeMB = totalBytes / (1024 * 1024);
  const speed = fileSizeMB / downloadTime;
  
  console.log(`[External] Download complete:
    - File size: ${fileSizeMB.toFixed(2)}MB
    - Total time: ${totalTime.toFixed(2)}s
    - Download time: ${downloadTime.toFixed(2)}s
    - Average speed: ${speed.toFixed(2)}MB/s`);
}