import { GoogleAuth } from "google-auth-library";
import { config } from "../core/config.ts";
import type { TranscriptionJobDispatcher } from "./transcription-job-contracts.ts";
import { TRANSCRIPTION_WORKER_TIMEOUT_SECONDS } from "./transcription-job-settings.ts";

interface RunJobResponse {
  name?: string;
}

/** Cloud Run Jobs API を使って文字起こしワーカーを起動する。 */
export class CloudRunTranscriptionJobDispatcher
  implements TranscriptionJobDispatcher {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  constructor(
    private readonly projectId = config.gcpProjectId,
    private readonly region = config.gcpRegion,
    private readonly jobName = config.transcriptionJobName,
  ) {
    if (!projectId) {
      throw new Error("文字起こし API には GCP_PROJECT_ID が必要です");
    }
  }

  /** ワーカーを起動し、長時間実行 Operation の名前を返す。 */
  async dispatch(jobId: string): Promise<string> {
    const client = await this.auth.getClient();
    const parent = [
      "projects",
      encodeURIComponent(this.projectId!),
      "locations",
      encodeURIComponent(this.region),
      "jobs",
      encodeURIComponent(this.jobName),
    ].join("/");
    const response = await client.request<RunJobResponse>({
      url: `https://run.googleapis.com/v2/${parent}:run`,
      method: "POST",
      timeout: 15_000,
      data: {
        overrides: {
          taskCount: 1,
          timeout: `${TRANSCRIPTION_WORKER_TIMEOUT_SECONDS}s`,
          containerOverrides: [{
            env: [{ name: "TRANSCRIPTION_JOB_ID", value: jobId }],
          }],
        },
      },
    });
    if (!response.data.name) {
      throw new Error(
        "Cloud Run Jobs API から Operation 名が返されませんでした",
      );
    }
    return response.data.name;
  }
}
