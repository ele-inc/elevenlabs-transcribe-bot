import { Storage } from "@google-cloud/storage";
import type { TranscriptionJobResult } from "../api/transcription-job-types.ts";
import { config } from "../core/config.ts";
import type { TranscriptionResultStore } from "./transcription-job-contracts.ts";

/** Cloud Storage に完成した文字起こし結果を保存する。 */
export class GcsTranscriptionResultStore implements TranscriptionResultStore {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(
    bucketName = config.transcriptionResultsBucket,
    projectId = config.gcpProjectId,
  ) {
    if (!bucketName) {
      throw new Error(
        "文字起こし API には TRANSCRIPTION_RESULTS_BUCKET が必要です",
      );
    }
    if (!projectId) {
      throw new Error("文字起こし API には GCP_PROJECT_ID が必要です");
    }
    this.bucketName = bucketName;
    this.storage = new Storage({ projectId });
  }

  async save(jobId: string, result: TranscriptionJobResult): Promise<string> {
    const objectName = `transcription-results/${jobId}.json`;
    await this.storage.bucket(this.bucketName).file(objectName).save(
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
    const [contents] = await this.storage.bucket(this.bucketName).file(
      objectName,
    ).download();
    return JSON.parse(new TextDecoder().decode(contents));
  }
}
