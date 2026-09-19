import { Router } from "express";
import path from "path";
import crypto from "crypto";
import { IngestionQueue } from "../../queues/ingestion_queue";
import { AuthenticatedRequest } from "../middleware/auth";
import { UniversalImporter } from "../../ingestion/importer";
import { ConversationFilter } from "../../pipeline/filter";
import { ProjectClusterer } from "../../pipeline/clustering";
import { MemoryExtractor } from "../../pipeline/extractor";
import { DatabaseManager } from "../../db/postgres_pool";
import { ConversationChunker } from "../../pipeline/chunker";
import { LlmExtractor } from "../../pipeline/llm_extractor";
import { OpenRouterClient } from "../../pipeline/openrouter_client";
import { SecretSanitizer } from "../../ingestion/sanitizer";
import { CanonicalConversation, CanonicalMessage } from "../../core/types";
import { config } from "../../config/env";
import AdmZip from "adm-zip";

const router = Router();
const queue = IngestionQueue.getInstance();

// 1. Asynchronous Ingestion Job Dispatch (For large archives & web sync)
router.post("/async", (req: AuthenticatedRequest, res) => {
  const tenantId = req.tenantId || "default_tenant";
  const { payload, filePath, passphrase } = req.body;

  if (!payload && !filePath) {
    return res.status(400).json({
      type: "urn:hive:error:bad-request",
      title: "Bad Request",
      status: 400,
      detail: "Either 'payload' or 'filePath' must be provided in request body."
    });
  }

  const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const job = queue.enqueue({
    jobId,
    tenantId,
    sourceType: filePath ? "file_path" : "raw_payload",
    payload,
    filePath,
    passphrase,
    createdAt: new Date().toISOString()
  });

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    statusUrl: `/api/v1/ingest/jobs/${job.id}`,
    message: "Ingestion job successfully queued for asynchronous processing."
  });
});

// 2. Poll Job Status
router.get("/jobs/:jobId", (req: AuthenticatedRequest, res) => {
  const jobId = String(req.params.jobId);
  const job = queue.getJob(jobId);
  if (!job) {
    return res.status(404).json({
      type: "urn:hive:error:not-found",
      title: "Not Found",
      status: 404,
      detail: `Job with ID '${jobId}' was not found.`
    });
  }

  res.json(job);
});

function parseTextChat(content: string, filename: string): CanonicalConversation | null {
  const lines = content.split(/\r?\n/);
  let title = filename.replace(/\.(txt|md)$/i, "").replace(/^(\d+_)?/, "").replace(/_/g, " ");
  let source = "claude";
  let id = `txt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let createdAt = new Date().toISOString();

  for (const line of lines.slice(0, 15)) {
    if (/^TITLE:\s*(.+)/i.test(line)) title = line.replace(/^TITLE:\s*/i, "").trim();
    if (/^SOURCE:\s*(.+)/i.test(line)) source = line.replace(/^SOURCE:\s*/i, "").trim().toLowerCase();
    if (/^ID:\s*(.+)/i.test(line)) id = line.replace(/^ID:\s*/i, "").trim();
    if (/^DATE:\s*(.+)/i.test(line)) {
      const d = new Date(line.replace(/^DATE:\s*/i, "").trim());
      if (!isNaN(d.getTime())) createdAt = d.toISOString();
    }
  }

  const messages: any[] = [];
  let currentRole: "user" | "assistant" = "user";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (/^\[(USER|HUMAN)\]/i.test(line.trim())) {
      if (currentLines.length > 0) {
        const text = currentLines.join("\n").trim();
        if (text) {
          messages.push({
            id: `msg_${Date.now()}_${messages.length}`,
            role: currentRole,
            timestamp: createdAt,
            content: text,
            codeSnippets: [],
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
        currentLines = [];
      }
      currentRole = "user";
    } else if (/^\[(AI ASSISTANT|ASSISTANT|CLAUDE|CHATGPT|GEMINI)\]/i.test(line.trim())) {
      if (currentLines.length > 0) {
        const text = currentLines.join("\n").trim();
        if (text) {
          messages.push({
            id: `msg_${Date.now()}_${messages.length}`,
            role: currentRole,
            timestamp: createdAt,
            content: text,
            codeSnippets: [],
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
        currentLines = [];
      }
      currentRole = "assistant";
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const text = currentLines.join("\n").trim();
    if (text) {
      messages.push({
        id: `msg_${Date.now()}_${messages.length}`,
        role: currentRole,
        timestamp: createdAt,
        content: text,
        codeSnippets: [],
        tokenCountEst: Math.ceil(text.length / 4)
      });
    }
  }

  if (messages.length === 0) return null;

  return {
    id,
    source: (source as any) || "claude",
    sourceId: id,
    title,
    createdAt,
    updatedAt: createdAt,
    messages
  };
}

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
        if (err.statusCode === 401 || err.statusCode === 402 || /401|402|credits/i.test(err.message)) {
          console.warn(`[Hive] OpenRouter credit limit or auth failure encountered — halting remaining LLM pass.`);
          return { ranLlmPass: false, llmNodesCreated };
        }
      }
    }
  }

  return { ranLlmPass: true, llmNodesCreated };
}

async function processAndIngestConversations(rawData: any) {
  let convos: CanonicalConversation[] = [];

  if (Array.isArray(rawData)) {
    convos = rawData;
  } else if (rawData && rawData.conversations && Array.isArray(rawData.conversations)) {
    convos = rawData.conversations;
  } else if (rawData && (rawData.messages || rawData.content || rawData.title)) {
    convos = [rawData];
  } else if (typeof rawData === "string") {
    convos = UniversalImporter.importJson(rawData);
  }

  const store = DatabaseManager.getLocalStore();
  const existingList = store.getAllSubstantialConversations();
  const existingMap = new Map<string, CanonicalConversation>();

  for (const ex of existingList) {
    existingMap.set(ex.id, ex);
    if (ex.sourceId) existingMap.set(`${ex.source}:${ex.sourceId}`, ex);
    if (ex.title) existingMap.set(`${ex.source}:${ex.title.trim().toLowerCase()}`, ex);
  }

  const toSave: CanonicalConversation[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of convos) {
    if (!item) continue;
    
    const source = (item.source || "claude").toLowerCase();
    const title = (item.title || "AI Conversation").trim();
    const id = item.id || `${source}_web_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const sourceId = item.sourceId || id;
    const createdAt = item.createdAt || new Date().toISOString();
    const updatedAt = item.updatedAt || createdAt;

    let messages = Array.isArray(item.messages) ? item.messages : [];
    if (messages.length === 0 && (item as any).content) {
      messages = [{
        id: `msg_${Date.now()}_0`,
        role: "user",
        timestamp: createdAt,
        content: (item as any).content,
        codeSnippets: [],
        tokenCountEst: Math.ceil((item as any).content.length / 4)
      }];
    }

    if (messages.length === 0) continue;

    // Server-side secret sanitization on all incoming messages regardless of origin
    const sanitizedMessages: CanonicalMessage[] = messages.map(m => {
      const sanitized = SecretSanitizer.sanitize(m.content || "");
      return {
        ...m,
        content: sanitized.cleanedText,
        tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
      };
    });

    const match = existingMap.get(id) ||
                  existingMap.get(`${source}:${sourceId}`) ||
                  existingMap.get(`${source}:${title.toLowerCase()}`);

    if (match) {
      const existingCount = match.messages ? match.messages.length : 0;
      if (sanitizedMessages.length > existingCount) {
        const updatedConvo: CanonicalConversation = {
          id: match.id,
          source: (source as any) || "claude",
          sourceId: match.sourceId || sourceId,
          title,
          createdAt: match.createdAt || createdAt,
          updatedAt: new Date().toISOString(),
          messages: sanitizedMessages,
          metadata: item.metadata || match.metadata || {}
        };
        toSave.push(updatedConvo);
        existingMap.set(match.id, updatedConvo);
        updated++;
      } else {
        skipped++;
      }
    } else {
      const newConvo: CanonicalConversation = {
        id,
        source: (source as any) || "claude",
        sourceId,
        title,
        createdAt,
        updatedAt,
        messages: sanitizedMessages,
        metadata: item.metadata || {}
      };
      toSave.push(newConvo);
      existingMap.set(id, newConvo);
      existingMap.set(`${source}:${sourceId}`, newConvo);
      existingMap.set(`${source}:${title.toLowerCase()}`, newConvo);
      inserted++;
    }
  }

  let projectsCount = 0;
  let nodesCount = 0;
  let edgesCount = 0;
  let insightsCount = 0;

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

    await runLlmEnrichment(toSave, projects);
  } else {
    const stats = store.getStats();
    projectsCount = stats.projects;
    nodesCount = stats.graphNodes;
    edgesCount = stats.graphEdges;
  }

  return {
    success: true,
    inserted,
    updated,
    skipped,
    totalIndexed: existingMap.size,
    projects: projectsCount,
    nodes: nodesCount,
    edges: edgesCount,
    insights: insightsCount
  };
}

// 3. Primary Ingestion (Handles both single conversation and arrays from extension & client)
router.post("/", async (req, res) => {
  try {
    const result = await processAndIngestConversations(req.body);
    res.json(result);
  } catch (err: any) {
    console.error("[Hive] Error in POST /api/ingest:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Synchronous Ingestion Alias
router.post("/sync", async (req, res) => {
  try {
    const result = await processAndIngestConversations(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Import Chat Archive Zip (.zip containing txt and json chat files)
router.post("/import-archive", async (req, res) => {
  try {
    let zipBuffer: Buffer | null = null;

    if (req.body && req.body.zipBase64) {
      zipBuffer = Buffer.from(req.body.zipBase64, "base64");
    } else if (Buffer.isBuffer(req.body)) {
      zipBuffer = req.body;
    } else if (req.body && typeof req.body === "string" && req.body.startsWith("data:")) {
      const base64Data = req.body.split(",")[1];
      zipBuffer = Buffer.from(base64Data, "base64");
    }

    if (!zipBuffer) {
      return res.status(400).json({ error: "Missing zip archive data. Provide zipBase64 string or binary buffer." });
    }

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const extractedConvos: CanonicalConversation[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName;

      // Check for JSON conversation or manifest
      if (name.endsWith(".json")) {
        try {
          const jsonText = entry.getData().toString("utf8");
          const parsed = JSON.parse(jsonText);
          if (Array.isArray(parsed)) {
            parsed.forEach(p => { if (p && p.messages) extractedConvos.push(p); });
          } else if (parsed && parsed.conversations && Array.isArray(parsed.conversations)) {
            parsed.conversations.forEach((p: any) => { if (p && p.messages) extractedConvos.push(p); });
          } else if (parsed && parsed.messages) {
            extractedConvos.push(parsed);
          }
        } catch (e) {
          // ignore malformed json
        }
      }
      // Check for structured TXT chat file
      else if (name.endsWith(".txt") || name.endsWith(".md")) {
        try {
          const text = entry.getData().toString("utf8");
          const convo = parseTextChat(text, path.basename(name));
          if (convo) extractedConvos.push(convo);
        } catch (e) {
          // ignore
        }
      }
    }

    if (extractedConvos.length === 0) {
      return res.status(400).json({ error: "No valid .txt or .json conversations found in the uploaded zip archive." });
    }

    const result = await processAndIngestConversations(extractedConvos);
    res.json({
      ...result,
      archiveFilesProcessed: entries.length,
      extractedConversations: extractedConvos.length,
      message: `Successfully processed archive: ${result.inserted} new chats, ${result.updated} updated, ${result.skipped} duplicates skipped.`
    });
  } catch (err: any) {
    console.error("[Hive] Error importing archive zip:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
