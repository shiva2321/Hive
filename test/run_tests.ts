import assert from "assert";
import fs from "fs";
import path from "path";
import { SecretSanitizer } from "../src/ingestion/sanitizer";
import { ChatGPTParser } from "../src/ingestion/parsers/chatgpt_parser";
import { ClaudeParser } from "../src/ingestion/parsers/claude_parser";
import { GeminiParser } from "../src/ingestion/parsers/gemini_parser";
import { ConversationFilter } from "../src/pipeline/filter";
import { ProjectClusterer } from "../src/pipeline/clustering";
import { MemoryExtractor } from "../src/pipeline/extractor";
import { GraphStore } from "../src/storage/graph_store";
import { ContextGenerator } from "../src/serving/context_generator";
import { MOCK_CHATGPT_EXPORT, MOCK_CLAUDE_EXPORT, MOCK_GEMINI_EXPORT } from "./fixtures/sample_data";

console.log("=========================================");
console.log(" Running Universal AI Memory Test Suite ");
console.log("=========================================\n");

// Test 1: Secret Sanitization
console.log("[Test 1] Secret & PII Sanitizer");
const dirtyString = "Connect to postgres://user:password123@localhost:5432/mydb with sk-abcdef12345678901234567890abcdef12 and token ghp_1234567890abcdefghijklmnopqrstuv";
const sanitized = SecretSanitizer.sanitize(dirtyString);
assert.ok(!sanitized.cleanedText.includes("password123"), "Failed: Password was not redacted!");
assert.ok(!sanitized.cleanedText.includes("sk-abcdef"), "Failed: OpenAI key was not redacted!");
assert.ok(!sanitized.cleanedText.includes("ghp_1234"), "Failed: GitHub token was not redacted!");
assert.strictEqual(sanitized.redactedCount, 3, "Failed: Expected 3 redacted items.");
console.log("  ✓ Secrets and connection strings 100% sanitized.\n");

// Test 2: Ingestion Parsers
console.log("[Test 2] Cross-Platform Ingestion Parsers");
const cgConvos = ChatGPTParser.parse(MOCK_CHATGPT_EXPORT);
assert.strictEqual(cgConvos.length, 2, "Failed: Expected 2 conversations from ChatGPT export.");
assert.strictEqual(cgConvos[0].messages.length, 3, "Failed: Expected 3 messages in ChatGPT thread.");
assert.ok(cgConvos[0].messages[1].codeSnippets.length > 0, "Failed: Code snippet extraction failed.");

const clConvos = ClaudeParser.parse(MOCK_CLAUDE_EXPORT);
assert.strictEqual(clConvos.length, 1, "Failed: Expected 1 conversation from Claude export.");
assert.strictEqual(clConvos[0].messages.length, 2, "Failed: Expected 2 messages in Claude thread.");

const gmConvos = GeminiParser.parse(MOCK_GEMINI_EXPORT);
assert.strictEqual(gmConvos.length, 1, "Failed: Expected 1 conversation from Gemini export.");
assert.strictEqual(gmConvos[0].messages.length, 2, "Failed: Expected 2 messages in Gemini turn.");
console.log("  ✓ ChatGPT, Claude, and Gemini schemas parsed and normalized.\n");

// Test 3: Ephemeral & Noise Filtering
console.log("[Test 3] Ephemeral Noise Filter");
const substantiveFilter = ConversationFilter.evaluate(cgConvos[0]);
assert.strictEqual(substantiveFilter.isEphemeral, false, "Substantive technical thread was incorrectly flagged as ephemeral!");
const ephemeralFilter = ConversationFilter.evaluate(cgConvos[1]);
assert.strictEqual(ephemeralFilter.isEphemeral, true, "Ephemeral one-off translation was not filtered!");
console.log(`  ✓ Noise filtered: Translation thread flagged (Score: ${ephemeralFilter.score.toFixed(2)}), Code thread kept (Score: ${substantiveFilter.score.toFixed(2)}).\n`);

// Test 4: Project Isolation & Workstream Clustering
console.log("[Test 4] Project Isolation Clustering");
const keptConvos = [cgConvos[0], clConvos[0], gmConvos[0]];
const clusters = ProjectClusterer.cluster(keptConvos);
assert.ok(clusters.length >= 2, "Failed: Projects were not isolated into discrete clusters.");
console.log(`  ✓ Successfully grouped ${keptConvos.length} chats across 3 providers into ${clusters.length} isolated projects:`);
clusters.forEach(c => console.log(`    - ${c.name}: [${c.primaryTechStack.join(", ")}]`));
console.log("");

// Test 5: Entity, Relation & Negative Knowledge Extraction
console.log("[Test 5] Knowledge Graph & Negative Knowledge Extraction");
const extraction = MemoryExtractor.extract(clusters, keptConvos);
assert.ok(extraction.nodes.length > 0, "No nodes extracted.");
assert.ok(extraction.edges.length > 0, "No edges extracted.");

const rejectedNodes = extraction.nodes.filter(n => n.type === "NegativeKnowledge");
assert.ok(rejectedNodes.some(n => n.name.toLowerCase().includes("prisma") || n.name.toLowerCase().includes("redis")), 
  "Failed: Negative knowledge (avoid Prisma/Redis) was not extracted!");

const prefNodes = extraction.nodes.filter(n => n.type === "UserPreference");
assert.ok(prefNodes.length > 0, "Failed: User preferences not extracted.");
console.log(`  ✓ Extracted ${extraction.nodes.length} nodes, ${extraction.edges.length} relations, and ${extraction.insights.length} meta-insights.`);
console.log(`  ✓ Identified Anti-patterns / Negative Knowledge: ${rejectedNodes.map(r => r.name).join(", ")}`);
console.log("");

// Test 6: Embedded SQLite Storage & Query Engine
console.log("[Test 6] Embedded SQLite Store & Queries");
const testDbPath = path.join(__dirname, "test_memory.sqlite");
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const store = new GraphStore(testDbPath);
store.saveConversations(keptConvos);
store.saveProjects(clusters);
store.saveGraph(extraction.nodes, extraction.edges);
store.saveInsights(extraction.insights);

const stats = store.getStats();
assert.strictEqual(stats.conversations, 3);
assert.strictEqual(stats.projects, clusters.length);

const queryRes = store.queryProjectMemory("Tailwind");
assert.ok(queryRes.matchedProjects.length > 0 || queryRes.entities.length > 0, "Failed to query project memory!");
console.log(`  ✓ SQLite Graph Store verified (Conversations: ${stats.conversations}, Nodes: ${stats.graphNodes}, Edges: ${stats.graphEdges}).\n`);

// Test 7: Context Generation (CLAUDE.md / .cursorrules)
console.log("[Test 7] Workspace Rule File Generator");
const claudeMd = ContextGenerator.generateClaudeMd(clusters[0], extraction.nodes, extraction.edges);
assert.ok(claudeMd.includes("Architecture Guardrails"), "CLAUDE.md missing Guardrails section.");
console.log("  ✓ Auto-generated CLAUDE.md successfully synthesized from memory graph.\n");

// Cleanup test DB
store.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

console.log("=========================================");
console.log(" ALL 7 TEST SUITES PASSED FLAWLESSLY!    ");
console.log("=========================================");
