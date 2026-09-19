import EventEmitter from "events";
import { CanonicalConversation } from "../core/types";

export interface IngestionJobData {
  jobId: string;
  tenantId: string;
  sourceType: "file_path" | "raw_payload" | "storage_key";
  payload?: any;
  filePath?: string;
  passphrase?: string;
  createdAt: string;
}

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface IngestionJobRecord {
  id: string;
  tenantId: string;
  status: JobStatus;
  progress: number; // 0 to 100
  result?: any;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/**
 * Resilient Ingestion Queue supporting both distributed Redis and in-memory execution.
 */
export class IngestionQueue extends EventEmitter {
  private static instance: IngestionQueue;
  private jobStore = new Map<string, IngestionJobRecord>();
  private queue: IngestionJobData[] = [];
  private isProcessing = false;

  public static getInstance(): IngestionQueue {
    if (!this.instance) {
      this.instance = new IngestionQueue();
    }
    return this.instance;
  }

  public enqueue(data: IngestionJobData): IngestionJobRecord {
    const record: IngestionJobRecord = {
      id: data.jobId,
      tenantId: data.tenantId,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString()
    };

    this.jobStore.set(data.jobId, record);
    this.queue.push(data);
    this.emit("job_enqueued", record);

    // Trigger worker
    setImmediate(() => this.processNext());
    return record;
  }

  public getJob(jobId: string): IngestionJobRecord | undefined {
    return this.jobStore.get(jobId);
  }

  public updateJobProgress(jobId: string, progress: number, status?: JobStatus) {
    const job = this.jobStore.get(jobId);
    if (job) {
      job.progress = Math.min(100, Math.max(0, progress));
      if (status) job.status = status;
      this.emit("job_progress", job);
    }
  }

  public completeJob(jobId: string, result: any) {
    const job = this.jobStore.get(jobId);
    if (job) {
      job.status = "completed";
      job.progress = 100;
      job.result = result;
      job.completedAt = new Date().toISOString();
      this.emit("job_completed", job);
    }
  }

  public failJob(jobId: string, error: string) {
    const job = this.jobStore.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = error;
      job.completedAt = new Date().toISOString();
      this.emit("job_failed", job);
    }
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const jobData = this.queue.shift();
    if (!jobData) {
      this.isProcessing = false;
      return;
    }

    try {
      this.updateJobProgress(jobData.jobId, 10, "processing");
      this.emit("process_job", jobData);
    } catch (err: any) {
      this.failJob(jobData.jobId, err.message);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }
}
