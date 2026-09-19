import assert from "assert";
import path from "path";
import fs from "fs";
import { MCPServerRunner } from "../src/serving/mcp_server";

console.log("================================================");
console.log(" Testing Universal MCP Intelligence Server     ");
console.log("================================================\n");

async function testMcp() {
  const testDb = path.join(__dirname, "test_mcp_memory.sqlite");
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  const runner = new MCPServerRunner(testDb);
  const store = runner.getStore();

  console.log("[Test 1] Bidirectional Memory: record_decision tool");
  const recordRes = store.recordDecision(
    "HyperScale Engine",
    "Adopted Apache Arrow for in-memory columnar processing",
    "Protobuf",
    "Excessive deserialization latency on high-throughput streams"
  );

  assert.strictEqual(recordRes.success, true);
  assert.ok(recordRes.decisionRecorded.includes("Apache Arrow"));
  assert.ok(recordRes.guardrailRecorded?.includes("Avoid Protobuf"));
  console.log("  ✓ Successfully recorded live decision and rejected anti-pattern via MCP.\n");

  console.log("[Test 2] Querying Recorded Decision via MCP Store");
  const queryRes = store.queryProjectMemory("Arrow");
  assert.ok(queryRes.matchedProjects.length > 0, "Failed: Could not find HyperScale Engine by tech!");
  assert.strictEqual(queryRes.matchedProjects[0].name, "HyperScale Engine");
  assert.ok(queryRes.matchedProjects[0].decisions.length > 0);
  console.log("  ✓ Query retrieved newly recorded project and decision.\n");

  console.log("[Test 3] Context Pack Generation via MCP");
  const graph = store.getFullGraph();
  const projects = store.listProjects();
  const proj = projects[0];
  const { ContextGenerator } = require("../src/serving/context_generator");
  const md = ContextGenerator.generateClaudeMd(proj, graph.nodes, graph.edges);

  assert.ok(md.includes("HyperScale Engine"), "Markdown missing project name.");
  assert.ok(md.includes("Apache Arrow"), "Markdown missing decision.");
  assert.ok(md.includes("Avoid Protobuf"), "Markdown missing guardrail.");
  console.log("  ✓ Ready-to-inject LLM context pack verified.\n");

  console.log("[Test 4] Negative Knowledge / Guardrails Extraction");
  const guardrails = graph.nodes.filter(n => n.type === "NegativeKnowledge");
  assert.strictEqual(guardrails.length, 1);
  assert.strictEqual(guardrails[0].name, "Avoid Protobuf");
  console.log("  ✓ Negative knowledge guardrails verified.\n");

  store.close();
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  console.log("================================================");
  console.log(" ALL MCP INTELLIGENCE SERVER TESTS PASSED!      ");
  console.log("================================================");
}

testMcp().catch(err => {
  console.error("MCP test failed:", err);
  process.exit(1);
});
