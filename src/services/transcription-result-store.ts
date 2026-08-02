import { Storage } from "@google-cloud/storage";
import type { TranscriptionJobResult } from "../api/transcription-job-types.ts";
import { config } from "../core/config.ts";
import type { TranscriptionResultStore } from "./transcription-job-contracts.ts";

export class GcsTranscriptionResultStore implements TranscriptionResultStore {
  private readonly storage: Storage;

  constructor(
    private readonly bucketName = config.transcriptionResultsBucket,
    projectId = config.gcpProjectId,
  ) {
    if (!bucketName) {
      throw new Error(
        "TRANSCRIPTION_RESULTS_BUCKET is required for the transcription API",
      );
    }
    if (!projectId) {
      throw new Error("GCP_PROJECT_ID is required for the transcription API");
    }
    this.storage = new Storage({ projectId });
  }

  async save(jobId: string, result: TranscriptionJobResult): Promise<string> {
    const objectName = `transcription-results/${jobId}.json`;
    await this.storage.bucket(this.bucketName!).file(objectName).save(
      JSON.stringify(result),
      {
        contentType: "application/json; charset=utf-8",
        resumable: false,
        metadata: { cacheControl: "private, max-age=0, no-store" },
      },
    );
    return objectName;
  }

  async get(objectName: string): Promise<TranscriptionJobResult> {
    const [contents] = await this.storage.bucket(this.bucketName!).file(
      objectName,
    ).download();
    return JSON.parse(new TextDecoder().decode(contents));
  }
}
