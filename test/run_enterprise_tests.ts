import assert from "assert";
import { ZeroKnowledgeCrypto } from "../src/core/crypto";
import { IngestionQueue } from "../src/queues/ingestion_queue";
import { IngestionWorker } from "../src/workers/ingestion_worker";
import { DatabaseManager } from "../src/db/postgres_pool";
import { MOCK_CHATGPT_EXPORT } from "./fixtures/sample_data";

console.log("=================================================");
console.log(" Running Enterprise Production-Grade Test Suite ");
console.log("=================================================\n");

async function runTests() {
  // Test 1: Zero-Knowledge AES-256-GCM Encryption
  console.log("[Test 1] Zero-Knowledge AES-256-GCM Encryption & Tamper Proofing");
  const tenantKeyA = ZeroKnowledgeCrypto.deriveTenantKey("tenant_alpha_123");
  const secretPayload = "Proprietary algorithm: Using differential privacy with epsilon 0.1";
  
  const encrypted = ZeroKnowledgeCrypto.encrypt(secretPayload, tenantKeyA);
  assert.ok(encrypted.ciphertext.length > 0, "Ciphertext empty!");
  assert.ok(encrypted.tag.length > 0, "Auth tag missing!");

  // Decrypt with correct key
  const decrypted = ZeroKnowledgeCrypto.decrypt(encrypted, tenantKeyA);
  assert.strictEqual(decrypted, secretPayload, "Decrypted text mismatch!");

  // Tamper check: alter 1 char in ciphertext
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext, "base64");
  tamperedCiphertext[0] ^= 1; // flip 1 bit
  const tamperedPayload = { ...encrypted, ciphertext: tamperedCiphertext.toString("base64") };

  assert.throws(() => {
    ZeroKnowledgeCrypto.decrypt(tamperedPayload, tenantKeyA);
  }, /Unsupported state or unable to authenticate data|bad decrypt/i, "Failed: Tampered ciphertext was not rejected!");

  console.log("  ✓ AES-256-GCM authenticated encryption verified. Tampering rejected.\n");

  // Test 2: Cryptographic Tenant Isolation
  console.log("[Test 2] Cryptographic Tenant Isolation");
  const tenantKeyB = ZeroKnowledgeCrypto.deriveTenantKey("tenant_beta_456");
  assert.notDeepStrictEqual(tenantKeyA, tenantKeyB, "Different tenants received identical encryption keys!");

  assert.throws(() => {
    // Attempting to decrypt Tenant A's data using Tenant B's key
    ZeroKnowledgeCrypto.decrypt(encrypted, tenantKeyB);
  }, "Failed: Tenant B was able to decrypt Tenant A's ciphertext!");

  console.log("  ✓ Cryptographic isolation verified: Cross-tenant key decryption rejected.\n");

  // Test 3: Blind Index Generation
  console.log("[Test 3] HMAC Blind Index for Search on Encrypted Data");
  const blindIndex1 = ZeroKnowledgeCrypto.generateBlindIndex("Next.js", "tenant_alpha_123");
  const blindIndex2 = ZeroKnowledgeCrypto.generateBlindIndex("next.js", "tenant_alpha_123");
  const blindIndexB = ZeroKnowledgeCrypto.generateBlindIndex("Next.js", "tenant_beta_456");

  assert.strictEqual(blindIndex1, blindIndex2, "Blind indexes for same term did not match!");
  assert.notStrictEqual(blindIndex1, blindIndexB, "Blind indexes across different tenants collided!");
  console.log("  ✓ Blind indexing verified for zero-knowledge search.\n");

  // Test 4: Asynchronous Queue & Distributed Worker
  console.log("[Test 4] Asynchronous Queue & Ingestion Worker Pipeline");
  const queue = IngestionQueue.getInstance();
  const worker = new IngestionWorker();

  let progressObserved = false;
  queue.on("job_progress", (job) => {
    if (job.progress > 0) progressObserved = true;
  });

  const job = queue.enqueue({
    jobId: `test_job_${Date.now()}`,
    tenantId: "enterprise_tenant_001",
    sourceType: "raw_payload",
    payload: MOCK_CHATGPT_EXPORT,
    createdAt: new Date().toISOString()
  });

  assert.strictEqual(job.status, "queued");

  // Wait for worker execution
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Worker timed out")), 5000);
    queue.on("job_completed", (completedJob) => {
      if (completedJob.id === job.id) {
        clearTimeout(timeout);
        assert.strictEqual(completedJob.status, "completed");
        assert.strictEqual(completedJob.progress, 100);
        assert.ok(completedJob.result.projectsDiscovered > 0);
        assert.strictEqual(completedJob.result.isZeroKnowledgeEncrypted, true);
        resolve();
      }
    });
  });

  assert.ok(progressObserved, "Failed: Job progress events were not emitted!");
  console.log("  ✓ Asynchronous BullMQ worker pipeline verified with 100% completion.\n");

  // Test 5: Database Manager Health Probes
  console.log("[Test 5] High-Availability Health Probes");
  const health = await DatabaseManager.healthCheck();
  assert.ok(health.sqlite || health.postgres, "Health check failed: No active database available!");
  console.log(`  ✓ Database probe verified (Active Mode: ${health.mode}, SQLite: ${health.sqlite}).\n`);

  console.log("=================================================");
  console.log(" ALL 5 ENTERPRISE SYSTEM TESTS PASSED!           ");
  console.log("=================================================");

  await DatabaseManager.closeAll();
}

runTests().catch((err) => {
  console.error("Enterprise test failed:", err);
  process.exit(1);
});
