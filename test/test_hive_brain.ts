import { GraphStore } from "../src/storage/graph_store";
import { HiveBrain } from "../src/core/hive_brain";
import path from "path";
import fs from "fs";

async function testHiveBrain() {
  console.log("================================================");
  console.log(" Testing Hive Brain & Self-Overseeing Inquiries ");
  console.log("================================================");

  const testDb = path.join(__dirname, "test_hive_brain.sqlite");
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  const store = new GraphStore(testDb);
  const now = new Date().toISOString();

  // Seed a genuine cross-project contradiction: Alpha rejects Redis, Beta uses it.
  store.saveProjects([
    { id: "proj_alpha", name: "Project Alpha", description: "Test project A", confidence: 1, conversationIds: [], primaryTechStack: [], keyDecisions: [], createdAt: now, updatedAt: now },
    { id: "proj_beta", name: "Project Beta", description: "Test project B", confidence: 1, conversationIds: [], primaryTechStack: ["Redis"], keyDecisions: [], createdAt: now, updatedAt: now }
  ]);

  store.saveGraph(
    [
      { id: "node_proj_proj_alpha", type: "Project", name: "Project Alpha", summary: "", attributes: {}, firstSeenAt: now, lastSeenAt: now, confidence: 1 },
      { id: "node_proj_proj_beta", type: "Project", name: "Project Beta", summary: "", attributes: {}, firstSeenAt: now, lastSeenAt: now, confidence: 1 },
      { id: "node_tech_redis", type: "Database", name: "Redis", summary: "Redis", attributes: {}, firstSeenAt: now, lastSeenAt: now, confidence: 1 },
      { id: "node_neg_redis", type: "NegativeKnowledge", name: "Avoid Redis", summary: "Rejected due to memory bloat", attributes: { rejectedSubject: "redis" }, firstSeenAt: now, lastSeenAt: now, confidence: 1 }
    ],
    [
      { id: "edge_alpha_rejects_redis", sourceNodeId: "node_proj_proj_alpha", targetNodeId: "node_neg_redis", relation: "REJECTED", context: "Rejected Redis due to memory bloat", timestamp: now, validFrom: now, validTo: null, status: "active", evidenceMessageIds: [] },
      { id: "edge_beta_uses_redis", sourceNodeId: "node_proj_proj_beta", targetNodeId: "node_tech_redis", relation: "USES_TECH", context: "Beta uses Redis", timestamp: now, validFrom: now, validTo: null, status: "active", evidenceMessageIds: [] }
    ]
  );

  console.log("\n[Test 1] Autonomous Audit Cycle Detects Real Contradiction");
  const auditRes = HiveBrain.auditAndSynthesize(store);
  console.log(`  ✓ Audit executed: ${auditRes.detectedDiscrepancies} checks, ${auditRes.newInquiries} inquiries created.`);
  if (auditRes.newInquiries !== 1) throw new Error(`Expected exactly 1 inquiry for the Alpha/Beta Redis contradiction, got ${auditRes.newInquiries}`);

  console.log("\n[Test 2] Query Inquiries");
  const inquiries = store.listInquiries("pending");
  console.log(`  ✓ Found ${inquiries.length} pending inquiries.`);
  if (inquiries.length !== 1) throw new Error("Expected exactly 1 pending inquiry");
  const target = inquiries[0];
  if (!target.question.includes("Project Beta") || !target.question.toLowerCase().includes("redis")) {
    throw new Error(`Inquiry does not reference the real contradiction: ${target.question}`);
  }

  console.log("\n[Test 3] Idempotent Re-Audit (no duplicate inquiries)");
  const secondAudit = HiveBrain.auditAndSynthesize(store);
  if (secondAudit.newInquiries !== 0) throw new Error("Re-running the audit should not create duplicate inquiries");
  console.log("  ✓ Re-audit created 0 duplicate inquiries.");

  console.log("\n[Test 4] Resolve Inquiry & Update Graph");
  const resolveRes = store.resolveInquiry(target.id, "Keep Redis in Project Beta — different latency profile than Alpha", "opt_keep");
  console.log(`  ✓ Resolved inquiry '${target.id}': status = ${resolveRes.inquiry?.status}`);
  if (!resolveRes.success || resolveRes.inquiry?.status !== "resolved") {
    throw new Error("Failed to resolve inquiry");
  }

  console.log("\n[Test 5] Telemetry Verification");
  const tel = store.getTelemetry();
  console.log(`  ✓ Telemetry verified: pending inquiries = ${tel.inquiries.pending}, resolved = ${tel.inquiries.resolved}`);
  if (tel.inquiries.resolved !== 1) throw new Error("Expected 1 resolved inquiry");

  store.close();
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  console.log("\n================================================");
  console.log(" ALL HIVE BRAIN SELF-OVERSEEING TESTS PASSED!   ");
  console.log("================================================");
}

testHiveBrain().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
