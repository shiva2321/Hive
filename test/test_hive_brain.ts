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

  // 1. Audit and discover discrepancies
  console.log("\n[Test 1] Autonomous Audit Cycle");
  const auditRes = HiveBrain.auditAndSynthesize(store);
  console.log(`  ✓ Audit executed: ${auditRes.detectedDiscrepancies} checks, ${auditRes.newInquiries} inquiries created.`);
  if (auditRes.newInquiries === 0) throw new Error("Expected inquiries to be created");

  // 2. List inquiries
  console.log("\n[Test 2] Query Inquiries");
  const inquiries = store.listInquiries("pending");
  console.log(`  ✓ Found ${inquiries.length} pending inquiries.`);
  if (inquiries.length === 0) throw new Error("Expected at least 1 pending inquiry");

  // 3. Resolve an inquiry
  console.log("\n[Test 3] Resolve Inquiry & Update Graph");
  const target = inquiries[0];
  const resolveRes = store.resolveInquiry(target.id, "Retain PPMI Clustered Similarity for WikiText latency", "opt_ppmi");
  console.log(`  ✓ Resolved inquiry '${target.id}': status = ${resolveRes.inquiry?.status}`);
  if (!resolveRes.success || resolveRes.inquiry?.status !== "resolved") {
    throw new Error("Failed to resolve inquiry");
  }

  // 4. Verify telemetry
  console.log("\n[Test 4] Telemetry Verification");
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
