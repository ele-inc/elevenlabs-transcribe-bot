import { FieldValue, Firestore } from "@google-cloud/firestore";
import type { TranscriptionJob } from "../api/transcription-job-types.ts";
import { config } from "../core/config.ts";
import {
  canClaimTranscriptionJob,
  JobAlreadyExistsError,
  type TranscriptionJobStore,
} from "./transcription-job-contracts.ts";

export class FirestoreTranscriptionJobStore implements TranscriptionJobStore {
  private readonly firestore: Firestore;

  constructor(
    projectId = config.gcpProjectId,
    private readonly collectionName = config.transcriptionJobsCollection,
  ) {
    if (!projectId) {
      throw new Error("GCP_PROJECT_ID is required for the transcription API");
    }
    this.firestore = new Firestore({ projectId });
  }

  async create(job: TranscriptionJob): Promise<TranscriptionJob> {
    const ref = this.firestore.collection(this.collectionName).doc(job.id);
    try {
      await ref.create(job);
      return job;
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (code === 6 || code === "6" || code === "ALREADY_EXISTS") {
        const existing = await this.get(job.id);
        if (existing) throw new JobAlreadyExistsError(existing);
      }
      throw error;
    }
  }

  async get(id: string): Promise<TranscriptionJob | null> {
    const snapshot = await this.firestore.collection(this.collectionName).doc(
      id,
    )
      .get();
    return snapshot.exists ? snapshot.data() as TranscriptionJob : null;
  }

  async update(id: string, values: Partial<TranscriptionJob>): Promise<void> {
    const updates = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === undefined ? FieldValue.delete() : value,
      ]),
    );
    await this.firestore.collection(this.collectionName).doc(id).update({
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  async claim(
    id: string,
    maxAttempts = 2,
    workerExecution?: string,
  ): Promise<TranscriptionJob | null> {
    const ref = this.firestore.collection(this.collectionName).doc(id);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;

      const job = snapshot.data() as TranscriptionJob;
      if (!canClaimTranscriptionJob(job, maxAttempts, workerExecution)) {
        return null;
      }

      const now = new Date().toISOString();
      const claimed: TranscriptionJob = {
        ...job,
        status: "processing",
        attempts: job.attempts + 1,
        startedAt: now,
        updatedAt: now,
        workerExecution,
        error: undefined,
      };
      transaction.set(ref, withoutUndefined(claimed));
      return claimed;
    });
  }
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
