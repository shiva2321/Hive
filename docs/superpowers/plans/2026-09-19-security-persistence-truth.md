# Security & Persistence Truth Implementation Plan

> **For agentic workers:** Execute this plan task-by-task, in order. Each task ends with a commit. Do not skip verification steps. When done, report: final output of every verification command, and explicitly confirm whether the new `.env` now contains a freshly-generated `ENCRYPTION_MASTER_KEY` (Task 1's expected side effect) so the human reviewer knows to back it up.

**Goal:** Make Hive's security and durability claims actually true for the deployment mode it actually runs in — local-first, single machine, single user — rather than half-built enterprise/multi-tenant scaffolding that nothing exercises. Specifically: real encryption-at-rest with a real key, a job queue that survives a restart, and closing the gap where the entire authenticated API surface has an open duplicate.

**Architecture:** This plan deliberately does NOT attempt to make Hive a real multi-tenant SaaS (real distributed BullMQ+Redis, enforced RLS-backed tenant isolation across many users). Nothing in this codebase's actual usage — one person, one machine, one local database — calls for that, and building it would be scope creep in the same direction that produced this audit's findings in the first place. Instead: encryption becomes real for the SQLite path that's actually used; the fake "BullMQ" queue becomes a real *durable local* queue (SQLite-backed, no new infrastructure); the authenticated API surface gets consistently applied instead of having an open twin. If you later do want real multi-user hosting, that's a bigger, separate design — this plan does not block it, but does not build it either.

**Tech Stack:** TypeScript, better-sqlite3 (already a dependency — no new infrastructure added), the existing `ZeroKnowledgeCrypto` class, Zod.

---

## Before you start

```bash
npx tsc --noEmit
```
Expected: no output, exit code 0.

```bash
grep -n "ENCRYPTION_MASTER_KEY" .env
```
Expected: either no output (key not set) or a line — either way, note the current value before you start; Task 1 will change it if it's unset or is the known-insecure default `0123456789abcdef0123456789abcdef`.

---

### Task 1: Provision a real encryption key and stop defaulting secrets

**Files:**
- Modify: `src/config/env.ts` (full rewrite)

Today, `ENCRYPTION_MASTER_KEY` and `JWT_SECRET` default to hardcoded strings shipped in source (`0123456789abcdef0123456789abcdef` and `super-secure-enterprise-jwt-secret-key-1234`), and the catch-all error handler silently falls back to those defaults on ANY validation failure, in any environment. This task removes both defaults, auto-generates a real key on first run (so local usage stays frictionless), and makes the app refuse to start in production without a real `JWT_SECRET`.

- [ ] **Step 1: Replace the entire contents of `src/config/env.ts`**

```typescript
import { z } from "zod";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";

dotenv.config();

/**
 * Returns a real ENCRYPTION_MASTER_KEY. If one isn't configured, generates a
 * cryptographically random one and persists it to .env so it survives
 * restarts, instead of falling back to a hardcoded value shipped in source.
 */
function ensureMasterKey(): string {
  const existing = process.env.ENCRYPTION_MASTER_KEY;
  if (existing && existing.trim().length >= 32) {
    return existing.trim();
  }

  const generated = crypto.randomBytes(32).toString("hex");
  const envPath = path.resolve(process.cwd(), ".env");
  try {
    const existingContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    const prefix = existingContent.trim().length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(envPath, `${prefix}ENCRYPTION_MASTER_KEY=${generated}\n`);
    console.warn("[Hive] No ENCRYPTION_MASTER_KEY was configured. Generated a new one and saved it to .env — back this up. Losing it makes any data encrypted with it unrecoverable.");
  } catch {
    console.warn("[Hive] No ENCRYPTION_MASTER_KEY was configured and .env could not be written. Using a key generated for this process only — encrypted data will be unreadable after restart until you set ENCRYPTION_MASTER_KEY explicitly.");
  }
  process.env.ENCRYPTION_MASTER_KEY = generated;
  return generated;
}

const resolvedMasterKey = ensureMasterKey();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(42424),
  HOST: z.string().default("0.0.0.0"),

  // Storage Mode
  STORAGE_MODE: z.enum(["sqlite", "postgres"]).default("sqlite"),
  SQLITE_DB_PATH: z.string().default("./memory_graph.sqlite"),
  DATABASE_URL: z.string().optional(),

  // Redis & Queues
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ENABLE_ASYNC_WORKERS: z.coerce.boolean().default(false),

  // Security & Encryption — no hardcoded defaults; see ensureMasterKey() above
  // and the production check below.
  ENCRYPTION_MASTER_KEY: z.string().min(32, "Master key must be at least 32 characters"),
  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),

  // CORS
  ALLOWED_ORIGINS: z.string().default("*"),

  // OpenRouter LLM Substrate
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_DEFAULT_MODEL: z.string().default("google/gemini-2.0-flash-001")
});

type ParsedEnv = z.infer<typeof envSchema>;
export type EnvConfig = ParsedEnv & { JWT_SECRET: string };

let parsed: ParsedEnv;
try {
  parsed = envSchema.parse({ ...process.env, ENCRYPTION_MASTER_KEY: resolvedMasterKey });
} catch (err: any) {
  console.error("❌ Environment configuration validation failed:", err.format ? err.format() : err);
  throw err;
}

if (parsed.NODE_ENV === "production" && !parsed.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET must be explicitly set in the environment when NODE_ENV=production. " +
    "Refusing to start with no secret — generate one with `openssl rand -hex 32` (or " +
    "`node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` on Windows) and set it in .env."
  );
}

const config: EnvConfig = {
  ...parsed,
  JWT_SECRET: parsed.JWT_SECRET || "local-dev-only-jwt-secret-do-not-use-in-production"
};

export { config };
```

- [ ] **Step 2: Verify a fresh key gets generated**

Confirm your current `.env` does NOT already have a real (non-default) `ENCRYPTION_MASTER_KEY` — if it's unset or still the old `0123456789abcdef0123456789abcdef`, remove that line first:
```bash
grep -v "^ENCRYPTION_MASTER_KEY=" .env > .env.tmp && mv .env.tmp .env
```

Then run:
```bash
npx tsx -e "require('./src/config/env'); console.log('OK');"
```
Expected output includes:
```
[Hive] No ENCRYPTION_MASTER_KEY was configured. Generated a new one and saved it to .env — back this up. Losing it makes any data encrypted with it unrecoverable.
OK
```
And:
```bash
grep "^ENCRYPTION_MASTER_KEY=" .env
```
Expected: a line with a 64-character hex string that is NOT `0123456789abcdef0123456789abcdef`.

- [ ] **Step 3: Verify production mode refuses to start without JWT_SECRET**

```bash
NODE_ENV=production npx tsx -e "require('./src/config/env');" 2>&1 | tail -5
```
Expected: throws with the message `JWT_SECRET must be explicitly set in the environment when NODE_ENV=production...` and a non-zero exit code.

- [ ] **Step 4: Verify dev mode still works with no JWT_SECRET set**

```bash
npx tsx -e "const { config } = require('./src/config/env'); console.log('JWT_SECRET length:', config.JWT_SECRET.length);"
```
Expected: `JWT_SECRET length: 44` (or similar — any positive number), no crash.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/config/env.ts .env
git commit -m "fix: stop shipping hardcoded encryption/JWT secret defaults

ENCRYPTION_MASTER_KEY and JWT_SECRET previously defaulted to fixed
strings in source. Now a real key is auto-generated and persisted to
.env on first run if missing, and production mode refuses to start
without an explicit JWT_SECRET instead of silently using the old
hardcoded value."
```

> **Note on committing `.env`:** check `.gitignore` before this commit — if `.env` is listed there (it should be, and `cat .gitignore` before Step 5 to confirm), `git add .env` will be a no-op and that's correct: the key must stay out of version control. If `.gitignore` does NOT exclude `.env`, add `.env` to it before committing anything else, and do not commit the real key.

---

### Task 2: Actually persist encrypted content (it's currently computed and discarded)

**Files:**
- Modify: `src/storage/graph_store.ts` (constructor, `saveConversations`, `getConversation`, `getAllSubstantialConversations`)
- Create: `test/test_encryption_persistence.ts`
- Modify: `package.json` (add a script entry)

Today, `ZeroKnowledgeCrypto.encrypt()` is only ever called in `src/workers/ingestion_worker.ts`, which computes an encrypted payload, attaches it to a throwaway in-memory property, and then calls `store.saveConversations()` — which only ever reads the plaintext `content` field and never looks at the encrypted one. This task makes `GraphStore` itself responsible for encrypting on write and decrypting on read, so every ingestion path gets it for free without each caller needing to know about crypto.

- [ ] **Step 1: Add the crypto import and a local key field**

In `src/storage/graph_store.ts`, update the imports at the top:

```typescript
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  CanonicalConversation,
  GraphEdge,
  GraphNode,
  ProjectCluster,
  UserInsight,
  HiveInquiry
} from "../core/types";
import { ZeroKnowledgeCrypto } from "../core/crypto";
import { config } from "../config/env";
```

Then update the class to derive a key in the constructor. Find:

```typescript
export class GraphStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), "memory_graph.sqlite");
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }
```

Replace it with:

```typescript
export class GraphStore {
  private db: Database.Database;
  private localKey: Buffer;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), "memory_graph.sqlite");
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();

    // Single local tenant — this is a local-first, single-user store.
    this.localKey = ZeroKnowledgeCrypto.deriveTenantKey("local");
  }
```

- [ ] **Step 2: Add encrypt/decrypt helpers**

Immediately after the `initSchema()` method (which ends right before `public saveConversations`), add:

```typescript
  /**
   * Encrypts message content before it's written to disk. Stores the
   * EncryptedPayload as a JSON string in the same `content` column that
   * used to hold plaintext — no schema change needed.
   */
  private encryptContent(plaintext: string): string {
    if (!plaintext) return plaintext;
    const encrypted = ZeroKnowledgeCrypto.encrypt(plaintext, this.localKey);
    return JSON.stringify(encrypted);
  }

  /**
   * Decrypts message content read back from disk. Falls back to returning
   * the raw stored value unchanged if it isn't in the encrypted JSON shape —
   * this is what makes reading pre-existing plaintext rows (saved before
   * this fix existed) safe, with no forced migration required.
   */
  private decryptContent(stored: string): string {
    if (!stored) return stored;
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && parsed.iv && parsed.ciphertext && parsed.tag) {
        return ZeroKnowledgeCrypto.decrypt(parsed, this.localKey);
      }
    } catch {
      // Not JSON, or not our encrypted shape — pre-existing plaintext row.
    }
    return stored;
  }
```

- [ ] **Step 3: Encrypt on write in `saveConversations`**

Find:

```typescript
        for (const m of c.messages) {
          insertMsg.run({
            id: m.id,
            conversation_id: c.id,
            role: m.role,
            timestamp: m.timestamp,
            content: m.content,
            code_snippets_json: JSON.stringify(m.codeSnippets),
            token_count: m.tokenCountEst
          });
        }
```

Replace it with:

```typescript
        for (const m of c.messages) {
          insertMsg.run({
            id: m.id,
            conversation_id: c.id,
            role: m.role,
            timestamp: m.timestamp,
            content: this.encryptContent(m.content),
            code_snippets_json: JSON.stringify(m.codeSnippets),
            token_count: m.tokenCountEst
          });
        }
```

- [ ] **Step 4: Decrypt on read in `getConversation`**

Find:

```typescript
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        timestamp: m.timestamp,
        content: m.content,
        codeSnippets: JSON.parse(m.code_snippets_json || "[]"),
        tokenCount: m.token_count
      }))
    };
  }

  public getAllSubstantialConversations(): CanonicalConversation[] {
```

Replace it with:

```typescript
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        timestamp: m.timestamp,
        content: this.decryptContent(m.content),
        codeSnippets: JSON.parse(m.code_snippets_json || "[]"),
        tokenCount: m.token_count
      }))
    };
  }

  public getAllSubstantialConversations(): CanonicalConversation[] {
```

- [ ] **Step 5: Decrypt on read in `getAllSubstantialConversations`**

Find:

```typescript
          messages: msgs.map(m => ({
            id: m.id,
            role: m.role,
            timestamp: m.timestamp,
            content: m.content,
            codeSnippets: JSON.parse(m.code_snippets_json || "[]"),
            tokenCountEst: m.token_count || Math.ceil((m.content || "").length / 4)
          }))
```

Replace it with:

```typescript
          messages: msgs.map(m => ({
            id: m.id,
            role: m.role,
            timestamp: m.timestamp,
            content: this.decryptContent(m.content),
            codeSnippets: JSON.parse(m.code_snippets_json || "[]"),
            tokenCountEst: m.token_count || Math.ceil((this.decryptContent(m.content) || "").length / 4)
          }))
```

- [ ] **Step 6: Write the verification test**

Create `test/test_encryption_persistence.ts`:

```typescript
import assert from "assert";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { GraphStore } from "../src/storage/graph_store";
import { CanonicalConversation } from "../src/core/types";

console.log("=========================================");
console.log(" Testing Encryption-at-Rest Persistence  ");
console.log("=========================================\n");

const testDbPath = path.join(__dirname, "test_encryption.sqlite");
for (const suffix of ["", "-shm", "-wal"]) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const SECRET_PLAINTEXT = "The launch codes are hidden in the AegisQuant config, do not repeat this anywhere.";

const testConvo: CanonicalConversation = {
  id: "convo_encryption_test",
  source: "claude",
  sourceId: "convo_encryption_test",
  title: "Encryption Persistence Test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [
    {
      id: "msg_encryption_test_1",
      role: "user",
      timestamp: new Date().toISOString(),
      content: SECRET_PLAINTEXT,
      codeSnippets: [],
      tokenCountEst: 20
    }
  ]
};

const store = new GraphStore(testDbPath);
store.saveConversations([testConvo]);

// Test 1: the raw bytes on disk must NOT contain the plaintext.
console.log("[Test 1] Raw SQLite row does not contain plaintext");
const rawDb = new Database(testDbPath, { readonly: true });
const rawRow = rawDb.prepare(`SELECT content FROM messages WHERE id = ?`).get("msg_encryption_test_1") as any;
rawDb.close();

assert.ok(rawRow, "Failed: message row not found at all.");
assert.ok(
  !rawRow.content.includes(SECRET_PLAINTEXT),
  `Failed: raw stored content contains the plaintext secret! Stored value: ${rawRow.content}`
);
const storedShape = JSON.parse(rawRow.content);
assert.ok(storedShape.iv && storedShape.ciphertext && storedShape.tag, "Failed: stored content is not in the expected EncryptedPayload shape.");
console.log("  ✓ Raw stored content is ciphertext, not plaintext.\n");

// Test 2: reading it back through GraphStore returns the original plaintext.
console.log("[Test 2] GraphStore.getConversation decrypts transparently");
const readBack = store.getConversation("convo_encryption_test");
assert.ok(readBack, "Failed: could not read conversation back.");
assert.strictEqual(readBack.messages[0].content, SECRET_PLAINTEXT, "Failed: decrypted content does not match original plaintext.");
console.log("  ✓ getConversation() returns the original plaintext.\n");

console.log("[Test 3] GraphStore.getAllSubstantialConversations decrypts transparently");
const allConvos = store.getAllSubstantialConversations();
const found = allConvos.find(c => c.id === "convo_encryption_test");
assert.ok(found, "Failed: conversation not found via getAllSubstantialConversations.");
assert.strictEqual(found!.messages[0].content, SECRET_PLAINTEXT, "Failed: decrypted content mismatch via getAllSubstantialConversations.");
console.log("  ✓ getAllSubstantialConversations() returns the original plaintext.\n");

// Test 4: pre-existing plaintext rows (from before this fix existed) must
// still read back correctly — no forced migration, no crash on old data.
console.log("[Test 4] Pre-existing plaintext rows (old data) still read correctly");
const rawDbWrite = new Database(testDbPath);
rawDbWrite.prepare(`
  INSERT INTO conversations (id, source, source_id, title, created_at, updated_at, metadata_json)
  VALUES ('convo_legacy_plaintext', 'claude', 'convo_legacy_plaintext', 'Legacy Plaintext Conversation', ?, ?, '{}')
`).run(new Date().toISOString(), new Date().toISOString());
rawDbWrite.prepare(`
  INSERT INTO messages (id, conversation_id, role, timestamp, content, code_snippets_json, token_count)
  VALUES ('msg_legacy_1', 'convo_legacy_plaintext', 'user', ?, 'This was saved before encryption existed.', '[]', 10)
`).run(new Date().toISOString());
rawDbWrite.close();

const legacy = store.getConversation("convo_legacy_plaintext");
assert.ok(legacy, "Failed: could not read legacy plaintext conversation.");
assert.strictEqual(legacy.messages[0].content, "This was saved before encryption existed.", "Failed: legacy plaintext row was mangled by decryptContent.");
console.log("  ✓ Legacy plaintext row read back unchanged, no crash.\n");

store.close();
for (const suffix of ["", "-shm", "-wal"]) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log("=========================================");
console.log(" ALL ENCRYPTION PERSISTENCE TESTS PASSED! ");
console.log("=========================================");
```

- [ ] **Step 7: Add an npm script and run the test**

In `package.json`, add this entry to `"scripts"` (next to the existing `"test:mcp"` line):

```json
    "test:encryption": "tsx test/test_encryption_persistence.ts",
```

Also update the `"test:all"` script to include it:

```json
    "test:all": "tsx test/run_tests.ts && tsx test/run_enterprise_tests.ts && tsx test/test_mcp_tools.ts && tsx test/test_encryption_persistence.ts",
```

Run: `npm run test:encryption`
Expected:
```
=========================================
 ALL ENCRYPTION PERSISTENCE TESTS PASSED!
=========================================
```

- [ ] **Step 8: Run the full existing suite to confirm nothing else broke**

Run: `npm test` (Task 1 of the intelligence-layer-rewire plan must already be applied for this to pass — if it isn't, run that plan first)
Expected: `ALL 7 TEST SUITES PASSED FLAWLESSLY!`

Run: `npm run test:mcp`
Expected: `ALL MCP INTELLIGENCE SERVER TESTS PASSED!`

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/storage/graph_store.ts test/test_encryption_persistence.ts package.json
git commit -m "fix: actually persist encrypted message content

GraphStore.saveConversations previously stored m.content as plaintext
unconditionally; the encryption computed in ingestion_worker.ts was
discarded before it reached the database. GraphStore now encrypts on
write and decrypts transparently on the two read paths that return
message content, with a graceful fallback for pre-existing plaintext
rows so no forced migration is required.

Note: this does not retroactively encrypt data already on disk before
this fix. Re-running 'npm run cli scan-local' or re-importing existing
sources will re-save (and thus encrypt) currently-tracked conversations,
since saveConversations uses INSERT OR REPLACE."
```

---

### Task 3: Replace the fake in-memory "BullMQ" queue with a real durable one

**Files:**
- Modify: `src/queues/ingestion_queue.ts` (full rewrite, same public interface)
- Modify: `test/run_enterprise_tests.ts:95` (fix the misleading log line)
- Modify: `docs/THREAT_MODEL.md:15` (fix the false mitigation claim)
- Modify: `README.md` (fix the source-tree comment)

`IngestionQueue` is a plain in-memory array plus an `EventEmitter`. There is no Redis, no BullMQ, anywhere in this codebase (verified: `grep -rn "ioredis\|bullmq" src/` returns nothing) — despite the class's own docstring, the README's source tree comment, the threat model's DoS mitigation, and this test's success message all saying otherwise. This task keeps the exact same public interface (`getInstance`, `enqueue`, `getJob`, `updateJobProgress`, `completeJob`, `failJob`, and the same five event names) so `ingestion_worker.ts` needs zero changes, but backs it with SQLite so job status survives a process restart.

- [ ] **Step 1: Replace the entire contents of `src/queues/ingestion_queue.ts`**

```typescript
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
```

- [ ] **Step 2: Fix the misleading test success message**

In `test/run_enterprise_tests.ts`, find:

```typescript
  console.log("  ✓ Asynchronous BullMQ worker pipeline verified with 100% completion.\n");
```

Replace it with:

```typescript
  console.log("  ✓ Durable SQLite-backed ingestion queue verified with 100% completion.\n");
```

Also find the test's title comment just above it:
```typescript
  // Test 4: Asynchronous Queue & Distributed Worker
  console.log("[Test 4] Asynchronous Queue & Ingestion Worker Pipeline");
```
Replace with:
```typescript
  // Test 4: Durable Local Queue & Ingestion Worker
  console.log("[Test 4] Durable Ingestion Queue & Worker Pipeline");
```

- [ ] **Step 3: Fix the threat model's DoS mitigation claim**

In `docs/THREAT_MODEL.md`, find the Denial of Service row:

```
| **Denial of Service** | Ingestion flood: uploading 1GB zip archives simultaneously to exhaust server RAM and CPU. | High | **Asynchronous BullMQ worker queues** with concurrency caps, streaming unzippers, and sliding-window token bucket rate limiters (HTTP 429). |
```

Replace it with:

```
| **Denial of Service** | Ingestion flood: uploading 1GB zip archives simultaneously to exhaust server RAM and CPU. | High | Durable SQLite-backed ingestion queue (jobs process one at a time, survive a process restart) plus sliding-window token bucket rate limiting (HTTP 429). No true concurrency cap or streaming unzipper exists yet — see the ingestion-completeness plan for follow-up. |
```

- [ ] **Step 4: Fix the README source tree comment**

In `README.md`, find:

```
│   └── workers/             # BullMQ async ingestion workers
```

Replace it with:

```
│   └── workers/             # Durable local ingestion queue + worker
```

- [ ] **Step 5: Run the enterprise test suite**

Run: `npm run test:enterprise`
Expected: all 5 tests pass, and Test 4's line now reads:
```
  ✓ Durable SQLite-backed ingestion queue verified with 100% completion.
```

- [ ] **Step 6: Verify durability across a restart**

```bash
npx tsx -e "
const { IngestionQueue } = require('./src/queues/ingestion_queue');
const q = IngestionQueue.getInstance();
const job = q.enqueue({ jobId: 'durability_check_1', tenantId: 'local', sourceType: 'raw_payload', payload: { x: 1 }, createdAt: new Date().toISOString() });
q.completeJob(job.id, { ok: true });
console.log('Job after complete:', q.getJob(job.id));
"
npx tsx -e "
const { IngestionQueue } = require('./src/queues/ingestion_queue');
const q = IngestionQueue.getInstance();
console.log('Job after restart (fresh process):', q.getJob('durability_check_1'));
"
```
Expected: the second command (a brand-new process) still prints the completed job with `status: 'completed'` — proving it read the job back from disk, not memory.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/queues/ingestion_queue.ts test/run_enterprise_tests.ts docs/THREAT_MODEL.md README.md
git commit -m "fix: replace fake in-memory 'BullMQ' queue with a real durable one

No Redis or BullMQ has ever existed in this codebase — IngestionQueue
was a plain in-memory array despite being described as BullMQ in its
own docstring, the README, the threat model, and a test's success
message. This is now backed by SQLite so job status survives a
process restart. Same public interface, same events — IngestionWorker
is unchanged. Docs and the test's log line now describe reality."
```

---

### Task 4: Close the unauthenticated shadow API surface, and stop hardcoding secrets in deploy configs

**Files:**
- Modify: `src/api/server.ts:210-266`
- Modify: `docker/docker-compose.prod.yml`
- Modify: `k8s/deployment-api.yaml`

`api/server.ts` mounts `ingestRoutes`/`projectRoutes`/`graphRoutes` twice: once at `/api/v1/*` behind `authMiddleware`, and again at legacy unversioned paths with no auth at all — and the dashboard and browser extension call the unauthenticated legacy paths. `authMiddleware` already auto-admits everything when `NODE_ENV !== "production"` (the default), so applying it to the legacy routes too changes nothing for local development and closes the gap the moment anyone sets `NODE_ENV=production`.

- [ ] **Step 1: Apply `authMiddleware` to every legacy route mount**

In `src/api/server.ts`, find this block:

```typescript
  // Backward compatibility alias for local dashboard & extension
  app.use("/api/stats", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getStats());
  });
  app.use("/api/projects", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.listProjects());
  });
  app.use("/api/graph", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getFullGraph());
  });
  app.use("/api/insights", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getInsights());
  });
  app.use("/api/inquiries", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    if (req.method === "GET") {
      const status = req.query.status as string | undefined;
      return res.json(store.listInquiries(status));
    }
    res.status(405).json({ error: "Method not allowed" });
  });
  app.post("/api/inquiries/:id/resolve", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    const { id } = req.params;
    const { resolution, chosenOptionId } = req.body;
    if (!resolution) {
      return res.status(400).json({ error: "Missing required parameter: resolution" });
    }
    const result = store.resolveInquiry(id, resolution, chosenOptionId);
    if (!result.success) {
      return res.status(404).json({ error: "Inquiry not found" });
    }
    res.json(result);
  });
  app.use("/api/conversations", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    if (req.path && req.path.length > 1) {
      const id = req.path.replace(/^\//, "");
      const convo = store.getConversation(id);
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      return res.json(convo);
    }
    const page = parseInt(req.query.page as string || "1", 10);
    const limit = parseInt(req.query.limit as string || "30", 10);
    const provider = req.query.provider as string | undefined;
    const q = req.query.q as string | undefined;
    res.json(store.listConversations(page, limit, provider, q));
  });
  app.use("/api/telemetry", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getTelemetry());
  });
  app.use("/api/openrouter", openrouterRoutes);
  app.use("/api/ingest", ingestRoutes);
```

Replace it with (only change: `authMiddleware` inserted as the second argument of every mount):

```typescript
  // Legacy unversioned aliases used by the local dashboard & extension.
  // These now go through authMiddleware, same as /api/v1/*. In local dev
  // (NODE_ENV != production, the default) authMiddleware auto-admits every
  // request, so nothing changes for you locally. In production, these now
  // actually require the same auth as the versioned routes instead of being
  // a wide-open duplicate of them.
  app.use("/api/stats", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getStats());
  });
  app.use("/api/projects", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.listProjects());
  });
  app.use("/api/graph", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getFullGraph());
  });
  app.use("/api/insights", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getInsights());
  });
  app.use("/api/inquiries", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    if (req.method === "GET") {
      const status = req.query.status as string | undefined;
      return res.json(store.listInquiries(status));
    }
    res.status(405).json({ error: "Method not allowed" });
  });
  app.post("/api/inquiries/:id/resolve", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    const { id } = req.params;
    const { resolution, chosenOptionId } = req.body;
    if (!resolution) {
      return res.status(400).json({ error: "Missing required parameter: resolution" });
    }
    const result = store.resolveInquiry(id, resolution, chosenOptionId);
    if (!result.success) {
      return res.status(404).json({ error: "Inquiry not found" });
    }
    res.json(result);
  });
  app.use("/api/conversations", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    if (req.path && req.path.length > 1) {
      const id = req.path.replace(/^\//, "");
      const convo = store.getConversation(id);
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      return res.json(convo);
    }
    const page = parseInt(req.query.page as string || "1", 10);
    const limit = parseInt(req.query.limit as string || "30", 10);
    const provider = req.query.provider as string | undefined;
    const q = req.query.q as string | undefined;
    res.json(store.listConversations(page, limit, provider, q));
  });
  app.use("/api/telemetry", authMiddleware, (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json(store.getTelemetry());
  });
  app.use("/api/openrouter", authMiddleware, openrouterRoutes);
  app.use("/api/ingest", authMiddleware, ingestRoutes);
```

Note: `/api/scan-local` and the `/api/extension/*` routes (defined earlier in the same file, before this block) are intentionally left as-is — they're local-machine-only operational endpoints (trigger a local filesystem scan, download the extension zip), not tenant data access, and `authMiddleware`'s dev-bypass would apply to them too if you choose to add it, but that's not required to close this finding.

- [ ] **Step 2: Verify the dashboard and extension still work locally**

```bash
npm run start:server &
sleep 2
curl -s http://localhost:42424/api/stats
kill %1
```
Expected: a JSON stats object (not a 401) — because `NODE_ENV` is unset/development here, `authMiddleware`'s dev bypass admits the request.

- [ ] **Step 3: Verify production mode now actually requires auth**

```bash
NODE_ENV=production npm run start:server &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:42424/api/stats
kill %1
```
Expected: `401` (assuming you have a real `JWT_SECRET` set per Task 1 — if the server fails to start instead, that's Task 1's production check working correctly; either way this confirms the route is no longer open).

- [ ] **Step 4: Stop hardcoding secrets in `docker/docker-compose.prod.yml`**

Find:

```yaml
  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile.api
    container_name: uam-api
    restart: always
    ports:
      - "42424:42424"
    environment:
      NODE_ENV: production
      PORT: 42424
      STORAGE_MODE: postgres
      DATABASE_URL: postgres://uam_admin:uam_secure_production_password_2026@postgres:5432/universal_memory
      REDIS_URL: redis://redis:6379
      ENCRYPTION_MASTER_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef"
      JWT_SECRET: "super-secure-enterprise-jwt-secret-key-1234"
    depends_on:
```

Replace it with:

```yaml
  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile.api
    container_name: uam-api
    restart: always
    ports:
      - "42424:42424"
    environment:
      NODE_ENV: production
      PORT: 42424
      STORAGE_MODE: postgres
      DATABASE_URL: postgres://uam_admin:${UAM_POSTGRES_PASSWORD}@postgres:5432/universal_memory
      REDIS_URL: redis://redis:6379
      ENCRYPTION_MASTER_KEY: ${UAM_ENCRYPTION_MASTER_KEY}
      JWT_SECRET: ${UAM_JWT_SECRET}
    depends_on:
```

And find the `postgres` service's hardcoded password:

```yaml
  postgres:
    image: pgvector/pgvector:pg16
    container_name: uam-postgres
    restart: always
    environment:
      POSTGRES_DB: universal_memory
      POSTGRES_USER: uam_admin
      POSTGRES_PASSWORD: uam_secure_production_password_2026
```

Replace it with:

```yaml
  postgres:
    image: pgvector/pgvector:pg16
    container_name: uam-postgres
    restart: always
    environment:
      POSTGRES_DB: universal_memory
      POSTGRES_USER: uam_admin
      POSTGRES_PASSWORD: ${UAM_POSTGRES_PASSWORD}
```

At the very top of `docker/docker-compose.prod.yml`, right after `version: '3.8'`, add a comment documenting the required file:

```yaml
version: '3.8'

# Requires a docker/.env file (NOT committed) with:
#   UAM_POSTGRES_PASSWORD=<random value>
#   UAM_ENCRYPTION_MASTER_KEY=<64 hex chars, e.g. `openssl rand -hex 32`>
#   UAM_JWT_SECRET=<random value, e.g. `openssl rand -hex 32`>
```

- [ ] **Step 5: Add the missing `JWT_SECRET` to `k8s/deployment-api.yaml`**

Find:

```yaml
        - name: ENCRYPTION_MASTER_KEY
          valueFrom:
            secretKeyRef:
              name: uam-secrets
              key: master-key
        resources:
```

Replace it with:

```yaml
        - name: ENCRYPTION_MASTER_KEY
          valueFrom:
            secretKeyRef:
              name: uam-secrets
              key: master-key
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: uam-secrets
              key: jwt-secret
        resources:
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/api/server.ts docker/docker-compose.prod.yml k8s/deployment-api.yaml
git commit -m "fix: close unauthenticated shadow API surface, stop hardcoding deploy secrets

Legacy unversioned routes duplicated the authenticated /api/v1/* ones
with no auth middleware at all, and the actual dashboard/extension
call the unauthenticated versions. authMiddleware is now applied
consistently; its existing dev-mode bypass means local usage is
unaffected. docker-compose.prod.yml and the k8s manifest no longer
hardcode ENCRYPTION_MASTER_KEY/JWT_SECRET/POSTGRES_PASSWORD."
```

---

## Explicitly out of scope for this plan

- **Building real multi-tenant Postgres RLS enforcement or a real distributed BullMQ+Redis pipeline.** As stated in Architecture above, this plan makes the *local, single-user* path honest rather than building infrastructure for a usage pattern (many concurrent tenants) that doesn't exist yet. The Postgres schema's RLS policies are already correctly written for if/when that's needed.
- **Retroactively re-encrypting the 483 conversations already on disk from before Task 2.** Deliberately non-destructive — see the note at the end of Task 2. Re-running ingestion on existing sources re-saves (and thus encrypts) them; a dedicated one-time migration script is a reasonable follow-up if you want it, but isn't required for correctness going forward.
- **A real concurrency cap or streaming unzip for the ingestion queue.** Task 3 makes the queue durable, not concurrent-safe under load or memory-bounded for huge archives. Flagged honestly in the updated `THREAT_MODEL.md` line rather than silently left as an unstated gap.
- **`sanitizer.ts`'s malformed OpenAI-key regex** (audit finding 14 — a botched quantifier in the legacy-key alternative). Low severity: the second alternative already catches modern-format keys. A clean one-line regex fix, but not a security-truth issue on its own — bundle it into whichever plan next touches `sanitizer.ts`.
- **The unused `audit_logs` Postgres table** (audit finding 12). Consistent with this plan's decision not to build out the real multi-tenant Postgres path yet — wiring writes to it is only worth doing alongside that larger effort, not in isolation.
