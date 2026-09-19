import path from "path";
import fs from "fs";
import os from "os";
import { UniversalImporter } from "./ingestion/importer";
import { ConversationFilter } from "./pipeline/filter";
import { ProjectClusterer } from "./pipeline/clustering";
import { MemoryExtractor } from "./pipeline/extractor";
import { GraphStore } from "./storage/graph_store";
import { ContextGenerator } from "./serving/context_generator";
import { LocalIDEParser } from "./ingestion/parsers/local_ide_parser";
import { OmniScanner } from "./ingestion/omni_scanner";
import { ConversationChunker } from "./pipeline/chunker";
import { LlmExtractor } from "./pipeline/llm_extractor";
import { OpenRouterClient } from "./pipeline/openrouter_client";
import { config } from "./config/env";

/**
 * Runs each substantial conversation through the real LLM extraction pipeline
 * (llm_extractor.ts) as an enrichment pass on top of the fast regex extractor.
 * No-ops cleanly if no OpenRouter key is configured.
 */
async function runLlmEnrichment(
  substantial: import("./core/types").CanonicalConversation[],
  projects: import("./core/types").ProjectCluster[]
): Promise<{ ranLlmPass: boolean; llmNodesCreated: number }> {
  if (process.env.SKIP_LLM === "true" || process.env.NO_LLM === "true" || process.argv.includes("--no-llm") || process.argv.includes("--skip-llm")) {
    console.log(`[i] LLM enrichment skipped via flag/environment.`);
    return { ranLlmPass: false, llmNodesCreated: 0 };
  }

  const apiKey = OpenRouterClient.getActiveKey();
  if (!apiKey) {
    console.log(`[i] No OPENROUTER_API_KEY configured — skipping LLM enrichment pass (regex-based extraction above is still saved).`);
    return { ranLlmPass: false, llmNodesCreated: 0 };
  }

  console.log(`[+] OPENROUTER_API_KEY found — running LLM enrichment pass with ${config.OPENROUTER_DEFAULT_MODEL} (${substantial.length} conversations)...`);
  let llmNodesCreated = 0;
  const projectByConvoId = new Map<string, import("./core/types").ProjectCluster>();
  for (const p of projects) {
    for (const cid of p.conversationIds) projectByConvoId.set(cid, p);
  }

  let convoIndex = 0;
  for (const convo of substantial) {
    convoIndex++;
    if (convoIndex % 10 === 1 || convoIndex === substantial.length) {
      console.log(`[+] LLM enrichment progress: ${convoIndex}/${substantial.length} conversations (${llmNodesCreated} nodes created so far)...`);
    }
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
        if (err.statusCode === 401 || err.statusCode === 402 || /401|402|credits/i.test(err.message)) {
          console.warn(`[!] OpenRouter credit limit or auth failure encountered — halting remaining LLM pass. All local conversations and graph structures are already indexed.`);
          return { ranLlmPass: false, llmNodesCreated };
        }
      }
    }
  }

  console.log(`[✓] LLM enrichment pass complete: ${llmNodesCreated} additional nodes created.`);
  return { ranLlmPass: true, llmNodesCreated };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const store = new GraphStore();

  if (!command || command === "help" || command === "--help") {
    console.log(`
Universal AI Memory CLI
-----------------------
Usage:
  npx ts-node src/cli.ts import <file.zip|file.json>   Import a ChatGPT, Claude, or Gemini export
  npx ts-node src/cli.ts scan-local                    Auto-scan local agent transcripts (Antigravity, Claude Code)
  npx ts-node src/cli.ts projects                      List all isolated projects
  npx ts-node src/cli.ts query <term>                  Query memory graph for past decisions and tech
  npx ts-node src/cli.ts generate-rules <project-id>   Generate CLAUDE.md for a project
  npx ts-node src/cli.ts stats                         Display knowledge graph statistics
`);
    return;
  }

  switch (command) {
    case "import": {
      const targetFile = args[1];
      if (!targetFile) {
        console.error("Error: Please provide a path to an export .zip or .json file.");
        process.exit(1);
      }

      console.log(`[+] Ingesting: ${targetFile}...`);
      const convos = await UniversalImporter.importFile(path.resolve(targetFile));
      console.log(`[+] Parsed ${convos.length} conversations.`);

      const substantial = convos.filter(c => !ConversationFilter.evaluate(c).isEphemeral);
      console.log(`[+] Filtered out ${convos.length - substantial.length} ephemeral/noise chats.`);
      console.log(`[+] Retained ${substantial.length} high-value conversations.`);

      store.saveConversations(substantial);

      console.log(`[+] Clustering into project workstreams...`);
      const projects = ProjectClusterer.cluster(substantial);
      store.saveProjects(projects);
      console.log(`[+] Discovered ${projects.length} discrete project(s):`);
      projects.forEach((p, idx) => console.log(`    ${idx + 1}. ${p.name} (${p.primaryTechStack.join(", ")}) - ${p.conversationIds.length} chats`));

      console.log(`[+] Extracting graph entities, decisions, and guardrails...`);
      const extraction = MemoryExtractor.extract(projects, substantial);
      store.saveGraph(extraction.nodes, extraction.edges);
      store.saveInsights(extraction.insights);

      console.log(`[✓] Successfully updated memory graph:`);
      console.log(`    - Nodes: ${extraction.nodes.length}`);
      console.log(`    - Relations: ${extraction.edges.length}`);
      console.log(`    - Behavioral Insights: ${extraction.insights.length}`);

      await runLlmEnrichment(substantial, projects);
      break;
    }

    case "scan-local": {
      console.log("[+] Scanning local environment for AI agent transcripts & IDE tools...");
      const scanResult = OmniScanner.scanAll();

      console.log(`[+] Discovered ${scanResult.totalFound} local AI sources:`);
      console.log(`    - Antigravity / Antigravity IDE: ${scanResult.byTool.antigravity} transcripts`);
      console.log(`    - Claude Code (Memory & History): ${scanResult.byTool.claudeCode} sources`);
      console.log(`    - Cursor IDE (Plans & Transcripts): ${scanResult.byTool.cursor} sources`);

      if (scanResult.conversations.length > 0) {
        const substantial = scanResult.conversations.filter(c => !ConversationFilter.evaluate(c).isEphemeral);
        console.log(`[+] Retained ${substantial.length} substantial engineering conversations.`);

        store.saveConversations(substantial);
        store.clearDerivedGraph();
        const projects = ProjectClusterer.cluster(substantial);
        store.saveProjects(projects);
        const extraction = MemoryExtractor.extract(projects, substantial);
        store.saveGraph(extraction.nodes, extraction.edges);
        store.saveInsights(extraction.insights);
        console.log(`[✓] Indexed ${projects.length} projects, ${extraction.nodes.length} knowledge nodes, and ${extraction.edges.length} graph relations!`);

        await runLlmEnrichment(substantial, projects);
      }
      break;
    }

    case "projects": {
      const projects = store.listProjects();
      console.log(`\nIsolated Projects (${projects.length}):`);
      projects.forEach((p, idx) => {
        console.log(`\n[${idx + 1}] ${p.name} (ID: ${p.id})`);
        console.log(`    Stack: ${p.primaryTechStack.join(", ") || "N/A"}`);
        console.log(`    Decisions: ${p.keyDecisions.slice(0, 2).join("; ") || "None recorded"}`);
        console.log(`    Tracked Chats: ${p.conversationIds.length}`);
      });
      break;
    }

    case "query": {
      const term = args[1];
      if (!term) {
        console.error("Please provide a query term.");
        return;
      }
      const res = store.queryProjectMemory(term);
      console.log("\nMemory Query Results:");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "generate-rules": {
      const projId = args[1];
      const projects = store.listProjects();
      const proj = projects.find(p => p.id === projId || p.name.toLowerCase().includes(projId?.toLowerCase() || ""));
      if (!proj) {
        console.error(`Project not found matching: ${projId}`);
        return;
      }
      const graph = store.getFullGraph();
      const content = ContextGenerator.generateClaudeMd(proj, graph.nodes, graph.edges);
      console.log("\nGenerated Context:\n");
      console.log(content);
      break;
    }

    case "stats": {
      console.log("\nDatabase Stats:", store.getStats());
      const insights = store.getInsights();
      console.log(`\nGenerated Insights (${insights.length}):`);
      insights.forEach(i => console.log(`- [${i.category}] ${i.title}: ${i.detail}`));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
  }
}

main().catch(console.error);
