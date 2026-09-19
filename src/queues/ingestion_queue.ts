import EventEmitter from "events";
import Database from "better-sqlite3";
import path from "path";
import { config } from "../config/env";

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
  progress: number;
  result?: any;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/**
 * Durable, SQLite-backed ingestion job queue. Job status/progress/result
 * survive a process restart because they're written to disk immediately.
 *
 * This replaces a previous implementation that was a plain in-memory array —
 * despite being called "BullMQ" in a few places elsewhere in this codebase,
 * no Redis or BullMQ has ever actually been used here. This class keeps the
 * exact same public interface and event names so IngestionWorker does not
 * need to change.
 *
 * Scope note: only job STATUS is durable. Job PAYLOADS (the raw conversation
 * data or file path for a queued-but-not-yet-started job) are kept in memory
 * only. A job that was still queued when the process restarts is marked
 * failed on recovery rather than silently lost forever — see
 * recoverIncompleteJobs(). Making payloads themselves durable across a crash
 * is a larger change (payloads can be large) and is out of scope here.
 */
export class IngestionQueue extends EventEmitter {
  private static instance: IngestionQueue;
  private db: Database.Database;
  private pendingData = new Map<string, IngestionJobData>();
  private isProcessing = false;

  private constructor() {
    super();
    const dbPath = path.join(path.dirname(path.resolve(config.SQLITE_DB_PATH)), "ingestion_jobs.sqlite");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        status TEXT,
        progress INTEGER,
        result_json TEXT,
        error TEXT,
        created_at TEXT,
        completed_at TEXT
      );
    `);
    this.recoverIncompleteJobs();
  }

  public static getInstance(): IngestionQueue {
    if (!this.instance) {
      this.instance = new IngestionQueue();
    }
    return this.instance;
  }

  private recoverIncompleteJobs() {
    const stuck = this.db.prepare(`SELECT id FROM ingestion_jobs WHERE status IN ('queued', 'processing')`).all() as any[];
    for (const row of stuck) {
      this.db.prepare(`
        UPDATE ingestion_jobs SET status = 'failed', error = 'Job payload was lost when the process restarted before it could be processed.' WHERE id = ?
      `).run(row.id);
    }
  }

  private toRecord(row: any): IngestionJobRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      progress: row.progress,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined
    };
  }

  public enqueue(data: IngestionJobData): IngestionJobRecord {
    const record: IngestionJobRecord = {
      id: data.jobId,
      tenantId: data.tenantId,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString()
    };

    this.db.prepare(`
      INSERT INTO ingestion_jobs (id, tenant_id, status, progress, created_at)
      VALUES (?, ?, 'queued', 0, ?)
    `).run(record.id, record.tenantId, record.createdAt);

    this.pendingData.set(data.jobId, data);
    this.emit("job_enqueued", record);

    setImmediate(() => this.processNext());
    return record;
  }

  public getJob(jobId: string): IngestionJobRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM ingestion_jobs WHERE id = ?`).get(jobId) as any;
    return row ? this.toRecord(row) : undefined;
  }

  public updateJobProgress(jobId: string, progress: number, status?: JobStatus) {
    const clamped = Math.min(100, Math.max(0, progress));
    if (status) {
      this.db.prepare(`UPDATE ingestion_jobs SET progress = ?, status = ? WHERE id = ?`).run(clamped, status, jobId);
    } else {
      this.db.prepare(`UPDATE ingestion_jobs SET progress = ? WHERE id = ?`).run(clamped, jobId);
    }
    const job = this.getJob(jobId);
    if (job) this.emit("job_progress", job);
  }

  public completeJob(jobId: string, result: any) {
    const completedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE ingestion_jobs SET status = 'completed', progress = 100, result_json = ?, completed_at = ? WHERE id = ?
    `).run(JSON.stringify(result), completedAt, jobId);
    this.pendingData.delete(jobId);
    const job = this.getJob(jobId);
    if (job) this.emit("job_completed", job);
  }

  public failJob(jobId: string, error: string) {
    const completedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE ingestion_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?
    `).run(error, completedAt, jobId);
    this.pendingData.delete(jobId);
    const job = this.getJob(jobId);
    if (job) this.emit("job_failed", job);
  }

  private processNext() {
    if (this.isProcessing) return;

    const nextRow = this.db.prepare(`SELECT id FROM ingestion_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get() as any;
    if (!nextRow) return;

    const jobData = this.pendingData.get(nextRow.id);
    if (!jobData) {
      // Enqueued in a previous process lifetime; payload wasn't durable. See class docstring.
      this.failJob(nextRow.id, "Job payload was not available after a process restart.");
      setImmediate(() => this.processNext());
      return;
    }

    this.isProcessing = true;
    try {
      this.updateJobProgress(jobData.jobId, 10, "processing");
      this.emit("process_job", jobData);
    } catch (err: any) {
      this.failJob(jobData.jobId, err.message);
    } finally {
      this.isProcessing = false;
      const remaining = this.db.prepare(`SELECT COUNT(*) as c FROM ingestion_jobs WHERE status = 'queued'`).get() as any;
      if (remaining && remaining.c > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }
}
