import { GoogleAuth } from "google-auth-library";
import { config } from "../core/config.ts";
import type { TranscriptionJobDispatcher } from "./transcription-job-contracts.ts";

interface RunJobResponse {
  name?: string;
}

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
      throw new Error("GCP_PROJECT_ID is required for the transcription API");
    }
  }

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
      data: {
        overrides: {
          taskCount: 1,
          timeout: "7200s",
          containerOverrides: [{
            env: [{ name: "TRANSCRIPTION_JOB_ID", value: jobId }],
          }],
        },
      },
    });
    return response.data.name || "";
  }
}
