# Intelligence Layer Rewire Implementation Plan

> **For agentic workers:** Execute this plan task-by-task, in order. Each task ends with a commit. Do not skip the verification step of any task — if a command's actual output doesn't match "Expected", stop and fix before moving on. When all tasks are done, write a short report: which tasks completed clean, which needed deviation from the plan and why, and the final output of every verification command in Task 4 and 5.

**Goal:** Replace the fabricated/dead parts of Hive's intelligence layer — a `UserPreference` extractor that doesn't exist (breaks `npm test`), a `HiveBrain` that inserts fictional hardcoded data instead of analyzing the graph, and a well-built LLM extraction pipeline that's wired to nothing — with real, working versions, without touching the parts that already work (parsers, clustering, storage).

**Architecture:** All four tasks are additive or surgical replacements inside existing files. No new files except one rewritten test. `MemoryExtractor.extract()` gets one new private method. `HiveBrain.auditAndSynthesize()` gets a full rewrite that reads the real graph instead of returning fiction. `LlmExtractor` (already built, currently unused by anything except a manual dashboard endpoint) gets wired into the two ingestion entry points that matter: `cli.ts` (what you run by hand) and `ingest.routes.ts` (what the browser extension and dashboard call).

**Tech Stack:** TypeScript, better-sqlite3, existing Zod schemas in `llm_extractor.ts`, `tsx` for running without a build step.

---

## Before you start

Run these two commands and confirm the starting state matches what this plan assumes:

```bash
npx tsc --noEmit
```
Expected: no output, exit code 0 (the project currently typechecks cleanly — if it doesn't, something changed since this plan was written; stop and investigate before proceeding).

```bash
npm test
```
Expected: crashes on Test 5 with `AssertionError [ERR_ASSERTION]: Failed: User preferences not extracted.` This is the bug Task 1 fixes. If you see a different failure, stop and investigate — this plan assumes this exact starting point.

---

### Task 1: Real `UserPreference` extraction

**Files:**
- Modify: `src/pipeline/extractor.ts:232-236` (inside `MemoryExtractor.extract`, the per-message loop)
- Test: `test/run_tests.ts` (already exists, already asserts this — no test changes needed)

The existing test fixture `MOCK_CHATGPT_EXPORT` in `test/fixtures/sample_data.ts` (node_3, line 51) contains the sentence *"Also I prefer strict TypeScript with zero any."* Test 5 in `test/run_tests.ts` (lines 72-73) already asserts a `UserPreference` node gets created from this. Nothing extracts it today — `UserPreference` is defined in `src/core/types.ts:64` and read by `mcp_server.ts` and `context_generator.ts`, but never written anywhere in `src/`. This task adds the writer.

- [ ] **Step 1: Confirm the current failure precisely**

Run: `npx tsx test/run_tests.ts`
Expected: Tests 1-4 print their `✓` lines, then the process crashes with:
```
AssertionError [ERR_ASSERTION]: Failed: User preferences not extracted.
```

- [ ] **Step 2: Add the `extractPreferences` method to `MemoryExtractor`**

Open `src/pipeline/extractor.ts`. Find the `extractRejectionsAndDecisions` method (starts at line 266, ends at line 320 with the closing `}`). Immediately after that method's closing brace (right before `private static connectEvolutionaryLinks`), insert this new method:

```typescript
  private static extractPreferences(
    content: string,
    projNodeId: string,
    timestamp: string,
    msgId: string,
    nodesMap: Map<string, GraphNode>,
    edges: GraphEdge[]
  ) {
    if (!content || content.length < 15) return;

    const PREFERENCE_PATTERNS = [
      /(?:I|we)\s+(?:always\s+)?prefer(?:s)?\s+(?:to\s+use\s+|using\s+)?([^.\n]{3,80})/gi,
      /(?:I|we)\s+(?:really\s+)?(?:like|love)\s+(?:to\s+use\s+|using\s+)?([^.\n]{3,80})/gi,
      /(?:I|we)\s+(?:always|usually|typically)\s+use\s+([^.\n]{3,80})/gi
    ];

    for (const regex of PREFERENCE_PATTERNS) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const subject = match[1].trim().replace(/[.,;!?]+$/, "");
        if (subject.length < 3) continue;

        const prefNodeId = `node_pref_${subject.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40)}`;
        if (nodesMap.has(prefNodeId)) continue;

        nodesMap.set(prefNodeId, {
          id: prefNodeId,
          type: "UserPreference",
          name: subject.slice(0, 60),
          summary: `User preference: ${subject}`,
          attributes: { rawStatement: match[0].trim() },
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          confidence: 0.85
        });

        edges.push({
          id: `edge_${projNodeId}_prefers_${prefNodeId}`,
          sourceNodeId: projNodeId,
          targetNodeId: prefNodeId,
          relation: "PREFERS",
          context: match[0].trim(),
          timestamp,
          validFrom: timestamp,
          validTo: null,
          status: "active",
          evidenceMessageIds: [msgId]
        });
      }
    }
  }
```

- [ ] **Step 3: Call the new method from the existing message loop**

In the same file, find this block (originally lines 232-236):

```typescript
        // Extract Guardrails & Explicit Rejections from chat text
        for (const msg of convo.messages) {
          this.extractRejectionsAndDecisions(msg.content, projNodeId, msg.timestamp, msg.id, nodesMap, edges);
        }
```

Replace it with:

```typescript
        // Extract Guardrails, Explicit Rejections, and User Preferences from chat text
        for (const msg of convo.messages) {
          this.extractRejectionsAndDecisions(msg.content, projNodeId, msg.timestamp, msg.id, nodesMap, edges);
          this.extractPreferences(msg.content, projNodeId, msg.timestamp, msg.id, nodesMap, edges);
        }
```

- [ ] **Step 4: Run the test suite to verify it passes**

Run: `npx tsx test/run_tests.ts`
Expected: all 7 tests print `✓`, ending with:
```
=========================================
 ALL 7 TEST SUITES PASSED FLAWLESSLY!
=========================================
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/pipeline/extractor.ts
git commit -m "fix: extract real UserPreference nodes from conversation text

Test 5 in run_tests.ts already asserted this; nothing implemented it.
Adds a regex-based preference detector alongside the existing
rejection/decision extractor, using the same pattern."
```

---

### Task 2: Replace `HiveBrain` with a real contradiction detector

**Files:**
- Modify: `src/core/hive_brain.ts` (full rewrite of the class body)
- Modify: `test/test_hive_brain.ts` (full rewrite — the current test asserts on the fabricated data this task removes)

The current `HiveBrain.auditAndSynthesize` ignores its `store` argument's actual content and inserts three hardcoded fictional inquiries about projects named "Resonance-X" and "NSCK" with invented technical details. This task replaces it with logic that reads the real graph and detects a genuine, generalizable contradiction pattern: **a technology one project explicitly rejected (a `NegativeKnowledge` node reached via a `REJECTED` edge) that another project is actively using (reached via a `USES_TECH` edge).** This uses only data the existing pipeline already produces — no new node types, no new edges.

- [ ] **Step 1: Read the current file to confirm line ranges match**

Run: `cat src/core/hive_brain.ts` (or open it) and confirm it's 91 lines with the hardcoded `potentialDiscrepancies` array. If the file differs from what this plan assumes, stop and adapt — but the replacement in Step 2 is a full-file replacement, so exact prior line numbers don't matter.

- [ ] **Step 2: Replace the entire contents of `src/core/hive_brain.ts`**

```typescript
import { GraphStore } from "../storage/graph_store";

export class HiveBrain {
  /**
   * Autonomous audit cycle: finds real cross-project contradictions in the
   * knowledge graph — specifically, a technology one project explicitly
   * rejected that another project is actively using — and files a Hive
   * inquiry for each one not already on record.
   */
  public static auditAndSynthesize(store: GraphStore): { detectedDiscrepancies: number; newInquiries: number } {
    const projects = store.listProjects();
    const graph = store.getFullGraph();
    const existingInquiries = store.listInquiries();

    const projectById = new Map(projects.map(p => [`node_proj_${p.id}`, p]));
    const nodeNameById = new Map(graph.nodes.map(n => [n.id, n.name] as const));
    const nodeById = new Map(graph.nodes.map(n => [n.id, n] as const));

    // techName (lowercase) -> set of project node ids that actively USE it
    const usersOfTech = new Map<string, Set<string>>();
    // techName (lowercase) -> map of rejecting project node id -> reason
    const rejectersOfTech = new Map<string, Map<string, string>>();

    for (const edge of graph.edges) {
      if (edge.status !== "active" || !projectById.has(edge.sourceNodeId)) continue;

      if (edge.relation === "USES_TECH") {
        const techName = (nodeNameById.get(edge.targetNodeId) || "").toLowerCase().trim();
        if (!techName) continue;
        if (!usersOfTech.has(techName)) usersOfTech.set(techName, new Set());
        usersOfTech.get(techName)!.add(edge.sourceNodeId);
      }

      if (edge.relation === "REJECTED") {
        const targetNode = nodeById.get(edge.targetNodeId);
        if (!targetNode) continue;
        // NegativeKnowledge node names are always "Avoid <subject>" (see extractor.ts / llm_extractor.ts)
        const rejectedName = targetNode.name.replace(/^Avoid\s+/i, "").toLowerCase().trim();
        if (!rejectedName) continue;
        if (!rejectersOfTech.has(rejectedName)) rejectersOfTech.set(rejectedName, new Map());
        rejectersOfTech.get(rejectedName)!.set(edge.sourceNodeId, edge.context || targetNode.summary || "no reason recorded");
      }
    }

    let checksRun = 0;
    let newInquiriesCount = 0;

    for (const [techName, rejecterMap] of rejectersOfTech.entries()) {
      const userProjectIds = usersOfTech.get(techName);
      if (!userProjectIds || userProjectIds.size === 0) continue;

      for (const [rejecterId, reason] of rejecterMap.entries()) {
        for (const userId of userProjectIds) {
          checksRun++;
          if (rejecterId === userId) continue; // same project rejecting+using isn't a cross-project contradiction

          const rejecterProj = projectById.get(rejecterId);
          const userProj = projectById.get(userId);
          if (!rejecterProj || !userProj) continue;

          const inquiryId = `inq_contradiction_${techName.replace(/[^a-z0-9]/g, "_")}_${rejecterProj.id}_${userProj.id}`;
          if (existingInquiries.some(e => e.id === inquiryId)) continue;

          store.createInquiry({
            id: inquiryId,
            projectId: userProj.id,
            projectName: userProj.name,
            category: "architecture_conflict",
            question: `"${userProj.name}" actively uses ${techName}, but "${rejecterProj.name}" explicitly rejected it. Is that still the right call for "${userProj.name}"?`,
            options: [
              { id: "opt_keep", label: `Keep ${techName} in ${userProj.name}`, details: "The rejection recorded in the other project doesn't apply here." },
              { id: "opt_reconsider", label: `Reconsider ${techName} in ${userProj.name}`, details: `Reason it was rejected elsewhere: ${reason}` }
            ],
            context: `${rejecterProj.name} rejected ${techName} (${reason}). ${userProj.name} currently uses it.`
          });
          newInquiriesCount++;
        }
      }
    }

    return { detectedDiscrepancies: checksRun, newInquiries: newInquiriesCount };
  }
}
```

- [ ] **Step 3: Replace the entire contents of `test/test_hive_brain.ts`**

The old test asserted against the fabricated data this task deletes. This replacement seeds two real projects with a genuine contradiction (Project Alpha rejects Redis, Project Beta uses it) and verifies the real detector — not a hardcoded fixture — finds exactly that.

```typescript
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
```

- [ ] **Step 4: Run the rewritten test**

Run: `npx tsx test/test_hive_brain.ts`
Expected:
```
================================================
 ALL HIVE BRAIN SELF-OVERSEEING TESTS PASSED!
================================================
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/core/hive_brain.ts test/test_hive_brain.ts
git commit -m "fix: replace fabricated HiveBrain with a real contradiction detector

The old HiveBrain ignored its GraphStore argument and inserted three
hardcoded fictional inquiries about invented projects. This version
reads real USES_TECH/REJECTED edges and flags genuine cross-project
tech contradictions. The old test asserted on the fabricated data and
is rewritten to seed a real contradiction and verify detection."
```

---

### Task 3: Wire the real LLM extractor into `cli.ts` as an optional enrichment pass

**Files:**
- Modify: `src/cli.ts:34-67` (the `import` case) and `:69-92` (the `scan-local` case)

`src/pipeline/llm_extractor.ts` (`LlmExtractor`) is fully built — real Zod schema, anti-hallucination system prompt, JSON parsing with fallback — but its only caller anywhere in `src/` is the manual dashboard endpoint in `openrouter.routes.ts`. This task adds it as a second pass in the CLI, after the existing fast regex-based `MemoryExtractor.extract()`, gated on an `OPENROUTER_API_KEY` being configured. This is additive, not a replacement: if no key is set, behavior is unchanged (matches the "works fully offline" design), and the existing fast path still runs first so there's always a baseline result even if the LLM call fails or is slow.

- [ ] **Step 1: Add the imports**

In `src/cli.ts`, after the existing import block (after `import { OmniScanner } from "./ingestion/omni_scanner";`), add:

```typescript
import { ConversationChunker } from "./pipeline/chunker";
import { LlmExtractor } from "./pipeline/llm_extractor";
import { OpenRouterClient } from "./pipeline/openrouter_client";
import { config } from "./config/env";
```

- [ ] **Step 2: Add a shared enrichment helper**

Immediately after the imports, before `async function main() {`, add:

```typescript
/**
 * Runs each substantial conversation through the real LLM extraction pipeline
 * (llm_extractor.ts) as an enrichment pass on top of the fast regex extractor.
 * No-ops cleanly if no OpenRouter key is configured.
 */
async function runLlmEnrichment(
  substantial: import("./core/types").CanonicalConversation[],
  projects: import("./core/types").ProjectCluster[]
): Promise<{ ranLlmPass: boolean; llmNodesCreated: number }> {
  const apiKey = OpenRouterClient.getActiveKey();
  if (!apiKey) {
    console.log(`[i] No OPENROUTER_API_KEY configured — skipping LLM enrichment pass (regex-based extraction above is still saved).`);
    return { ranLlmPass: false, llmNodesCreated: 0 };
  }

  console.log(`[+] OPENROUTER_API_KEY found — running LLM enrichment pass with ${config.OPENROUTER_DEFAULT_MODEL}...`);
  let llmNodesCreated = 0;
  const projectByConvoId = new Map<string, import("./core/types").ProjectCluster>();
  for (const p of projects) {
    for (const cid of p.conversationIds) projectByConvoId.set(cid, p);
  }

  for (const convo of substantial) {
    const project = projectByConvoId.get(convo.id);
    const chunks = ConversationChunker.chunkConversation(convo);

    for (const chunk of chunks) {
      try {
        const payload = await LlmExtractor.extractFromChunk(chunk, {
          apiKey,
          model: config.OPENROUTER_DEFAULT_MODEL,
          projectId: project?.id,
          projectName: project?.name
        });
        const { nodes } = LlmExtractor.ingestPayload(payload, {
          conversationId: convo.id,
          conversationTitle: convo.title,
          projectId: project?.id,
          projectName: project?.name
        });
        llmNodesCreated += nodes.length;
      } catch (err: any) {
        console.warn(`[!] LLM enrichment failed for "${convo.title}" (chunk ${chunk.chunkIndex}/${chunk.totalChunks}): ${err.message}. Continuing — regex-based extraction is already saved.`);
      }
    }
  }

  console.log(`[✓] LLM enrichment pass complete: ${llmNodesCreated} additional nodes created.`);
  return { ranLlmPass: true, llmNodesCreated };
}
```

- [ ] **Step 3: Call it from the `import` case**

Find this block in `src/cli.ts` (the end of the `case "import":` block, right before `break;`):

```typescript
      console.log(`[✓] Successfully updated memory graph:`);
      console.log(`    - Nodes: ${extraction.nodes.length}`);
      console.log(`    - Relations: ${extraction.edges.length}`);
      console.log(`    - Behavioral Insights: ${extraction.insights.length}`);
      break;
    }
```

Replace it with:

```typescript
      console.log(`[✓] Successfully updated memory graph:`);
      console.log(`    - Nodes: ${extraction.nodes.length}`);
      console.log(`    - Relations: ${extraction.edges.length}`);
      console.log(`    - Behavioral Insights: ${extraction.insights.length}`);

      await runLlmEnrichment(substantial, projects);
      break;
    }
```

- [ ] **Step 4: Call it from the `scan-local` case**

Find this block (the end of the `case "scan-local":` block):

```typescript
        const extraction = MemoryExtractor.extract(projects, substantial);
        store.saveGraph(extraction.nodes, extraction.edges);
        store.saveInsights(extraction.insights);
        console.log(`[✓] Indexed ${projects.length} projects, ${extraction.nodes.length} knowledge nodes, and ${extraction.edges.length} graph relations!`);
      }
      break;
    }
```

Replace it with:

```typescript
        const extraction = MemoryExtractor.extract(projects, substantial);
        store.saveGraph(extraction.nodes, extraction.edges);
        store.saveInsights(extraction.insights);
        console.log(`[✓] Indexed ${projects.length} projects, ${extraction.nodes.length} knowledge nodes, and ${extraction.edges.length} graph relations!`);

        await runLlmEnrichment(substantial, projects);
      }
      break;
    }
```

- [ ] **Step 5: Verify with a real import — no API key case**

Run:
```bash
mv .env .env.bak 2>/dev/null; echo "OPENROUTER_API_KEY=" > .env.test-empty
OPENROUTER_API_KEY= npx tsx src/cli.ts stats
```
This just confirms the CLI still runs with no key configured. Then restore your real `.env`:
```bash
rm -f .env.test-empty; mv .env.bak .env 2>/dev/null
```

- [ ] **Step 6: Verify with a real import — API key present case**

With your real `.env` (which has `OPENROUTER_API_KEY` set) in place, pick any real bulk-export file you have (or use the test fixture path if you don't have one handy), and run:
```bash
npx tsx src/cli.ts scan-local
```
Expected output includes, after the existing "Indexed N projects..." line:
```
[+] OPENROUTER_API_KEY found — running LLM enrichment pass with google/gemini-2.0-flash-001...
[✓] LLM enrichment pass complete: N additional nodes created.
```
(N may be 0 if OpenRouter has no credit or the model call fails — check for `[!] LLM enrichment failed for ...` warnings if so; that's a runtime/billing issue, not a code issue, and the task is still done as long as the warning path works and the process doesn't crash.)

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/cli.ts
git commit -m "feat: wire LlmExtractor into cli.ts import/scan-local as enrichment pass

llm_extractor.ts was fully built but only ever called from the manual
dashboard 're-analyze' endpoint. This adds it as an additive pass after
the existing regex extraction, gated on OPENROUTER_API_KEY being set,
so offline behavior is unchanged when no key is configured."
```

---

### Task 4: Wire the same LLM enrichment into the REST ingestion path

**Files:**
- Modify: `src/api/routes/ingest.routes.ts:153-286` (`processAndIngestConversations`) and its two callers at `:289-297` and `:300-307`

This is the path the browser extension and dashboard actually call (`POST /api/ingest`, `/api/ingest/sync`, `/api/ingest/import-archive`). Same enrichment, same gating, same "additive, not replacing" principle as Task 3 — but `processAndIngestConversations` is currently synchronous and called from synchronous route handlers, so this task also makes it async.

- [ ] **Step 1: Add the imports**

At the top of `src/api/routes/ingest.routes.ts`, after the existing imports, add:

```typescript
import { ConversationChunker } from "../../pipeline/chunker";
import { LlmExtractor } from "../../pipeline/llm_extractor";
import { OpenRouterClient } from "../../pipeline/openrouter_client";
import { config } from "../../config/env";
```

- [ ] **Step 2: Add the same enrichment helper used in Task 3**

Add this function above `processAndIngestConversations` (it's the same logic as the CLI helper from Task 3, adapted to this file's types — duplicated rather than shared across `src/cli.ts` and `src/api/routes/ingest.routes.ts` because those two files don't currently share a common "pipeline runner" module; introducing one is out of scope for this plan):

```typescript
async function runLlmEnrichment(
  substantial: CanonicalConversation[],
  projects: import("../../core/types").ProjectCluster[]
): Promise<{ ranLlmPass: boolean; llmNodesCreated: number }> {
  const apiKey = OpenRouterClient.getActiveKey();
  if (!apiKey) {
    return { ranLlmPass: false, llmNodesCreated: 0 };
  }

  let llmNodesCreated = 0;
  const projectByConvoId = new Map<string, import("../../core/types").ProjectCluster>();
  for (const p of projects) {
    for (const cid of p.conversationIds) projectByConvoId.set(cid, p);
  }

  for (const convo of substantial) {
    const project = projectByConvoId.get(convo.id);
    const chunks = ConversationChunker.chunkConversation(convo);

    for (const chunk of chunks) {
      try {
        const payload = await LlmExtractor.extractFromChunk(chunk, {
          apiKey,
          model: config.OPENROUTER_DEFAULT_MODEL,
          projectId: project?.id,
          projectName: project?.name
        });
        const { nodes } = LlmExtractor.ingestPayload(payload, {
          conversationId: convo.id,
          conversationTitle: convo.title,
          projectId: project?.id,
          projectName: project?.name
        });
        llmNodesCreated += nodes.length;
      } catch (err: any) {
        console.warn(`[Hive] LLM enrichment failed for "${convo.title}": ${err.message}`);
      }
    }
  }

  return { ranLlmPass: true, llmNodesCreated };
}
```

- [ ] **Step 3: Make `processAndIngestConversations` async and call the enrichment**

Find the function signature:

```typescript
function processAndIngestConversations(rawData: any) {
```

Change it to:

```typescript
async function processAndIngestConversations(rawData: any) {
```

Find the block near the end of the function:

```typescript
  if (toSave.length > 0) {
    store.saveConversations(toSave);
    const allSubstantial = store.getAllSubstantialConversations();
    store.clearDerivedGraph();

    const projects = ProjectClusterer.cluster(allSubstantial);
    store.saveProjects(projects);

    const extraction = MemoryExtractor.extract(projects, allSubstantial);
    store.saveGraph(extraction.nodes, extraction.edges);
    store.saveInsights(extraction.insights);

    projectsCount = projects.length;
    nodesCount = extraction.nodes.length;
    edgesCount = extraction.edges.length;
    insightsCount = extraction.insights.length;
  } else {
```

Replace it with:

```typescript
  if (toSave.length > 0) {
    store.saveConversations(toSave);
    const allSubstantial = store.getAllSubstantialConversations();
    store.clearDerivedGraph();

    const projects = ProjectClusterer.cluster(allSubstantial);
    store.saveProjects(projects);

    const extraction = MemoryExtractor.extract(projects, allSubstantial);
    store.saveGraph(extraction.nodes, extraction.edges);
    store.saveInsights(extraction.insights);

    projectsCount = projects.length;
    nodesCount = extraction.nodes.length;
    edgesCount = extraction.edges.length;
    insightsCount = extraction.insights.length;

    await runLlmEnrichment(allSubstantial, projects);
  } else {
```

- [ ] **Step 4: Update the three callers to await it**

Find each of these three route handlers and add `async`/`await` as shown:

```typescript
router.post("/", (req, res) => {
  try {
    const result = processAndIngestConversations(req.body);
    res.json(result);
  } catch (err: any) {
    console.error("[Hive] Error in POST /api/ingest:", err);
    res.status(500).json({ error: err.message });
  }
});
```
becomes:
```typescript
router.post("/", async (req, res) => {
  try {
    const result = await processAndIngestConversations(req.body);
    res.json(result);
  } catch (err: any) {
    console.error("[Hive] Error in POST /api/ingest:", err);
    res.status(500).json({ error: err.message });
  }
});
```

Do the same for `router.post("/sync", ...)` (add `async`, add `await`).

For `router.post("/import-archive", ...)`, find:
```typescript
    const result = processAndIngestConversations(extractedConvos);
```
and change it to:
```typescript
    const result = await processAndIngestConversations(extractedConvos);
```
and add `async` to that handler's function signature too.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0. (If you see an error about `processAndIngestConversations` not returning a `Promise`-compatible type where it's used elsewhere, grep for other callers with `grep -rn "processAndIngestConversations" src/` and add `await`/`async` there too — this plan's Step 4 covers the three call sites that existed when this plan was written.)

- [ ] **Step 6: Verify end-to-end with the running server**

```bash
npm run start:server &
sleep 2
curl -s -X POST http://localhost:42424/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"id":"test_llm_wire","source":"claude","sourceId":"test_llm_wire","title":"LLM Wiring Smoke Test","createdAt":"2026-09-19T00:00:00.000Z","updatedAt":"2026-09-19T00:00:00.000Z","messages":[{"id":"m1","role":"user","timestamp":"2026-09-19T00:00:00.000Z","content":"We decided to use PostgreSQL instead of MongoDB because we need strong transactional guarantees.","codeSnippets":[],"tokenCountEst":20},{"id":"m2","role":"assistant","timestamp":"2026-09-19T00:00:01.000Z","content":"Good call. PostgreSQL with proper indexing will handle that well.","codeSnippets":[],"tokenCountEst":15}]}'
kill %1
```
Expected: a JSON response with `"success":true` and `"inserted":1`, and no unhandled promise rejection or crash in the server's stdout before you kill it.

- [ ] **Step 7: Commit**

```bash
git add src/api/routes/ingest.routes.ts
git commit -m "feat: wire LlmExtractor enrichment into the REST ingestion path

Same additive enrichment pass as cli.ts (previous commit), now applied
to the path the browser extension and dashboard actually call.
processAndIngestConversations and its three callers are now async."
```

---

## Explicitly out of scope for this plan

- **De-hardcoding `ProjectClusterer.identifyProjectKey()`'s 22-branch lookup table.** This is a real algorithm-design problem (how do you cluster a genuinely new project with no keyword overlap to anything seen before?), not a quick wiring fix. It deserves its own design pass, not a bolt-on here.
- **Making the LLM enrichment pass mandatory or synchronous-blocking.** It's additive by design so Hive keeps working fully offline. If you want it to eventually replace the regex pass as primary, that's a follow-up decision, not a silent side effect of this plan.
- **Extending `LlmExtractionSchema` to also emit `UserPreference`-equivalent data.** Task 1 fixes preference extraction in the regex path (`MemoryExtractor`), which is what the existing test covers. Teaching the LLM pipeline to also emit preferences is straightforward (add a field to the schema, a section to the prompt, a case in `ingestPayload`) but isn't required to close any current finding.
