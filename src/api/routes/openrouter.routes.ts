import { Router, Request, Response } from "express";
import { OpenRouterClient } from "../../pipeline/openrouter_client";
import { ConversationChunker } from "../../pipeline/chunker";
import { LlmExtractor } from "../../pipeline/llm_extractor";
import { DatabaseManager } from "../../db/postgres_pool";
import { CanonicalConversation } from "../../core/types";
import { config } from "../../config/env";

const router = Router();

interface ExtractionJobState {
  isRunning: boolean;
  jobId: string;
  model: string;
  totalConversations: number;
  processedConversations: number;
  totalChunks: number;
  processedChunks: number;
  nodesCreated: number;
  edgesCreated: number;
  currentTitle: string;
  logs: Array<{ time: string; level: "info" | "success" | "warn" | "error"; message: string }>;
  cancelRequested: boolean;
  completedAt?: string;
  error?: string;
}

let activeJob: ExtractionJobState = {
  isRunning: false,
  jobId: "",
  model: "",
  totalConversations: 0,
  processedConversations: 0,
  totalChunks: 0,
  processedChunks: 0,
  nodesCreated: 0,
  edgesCreated: 0,
  currentTitle: "",
  logs: [],
  cancelRequested: false
};

function addLog(level: "info" | "success" | "warn" | "error", message: string) {
  const time = new Date().toLocaleTimeString();
  activeJob.logs.push({ time, level, message });
  if (activeJob.logs.length > 200) {
    activeJob.logs.shift();
  }
}

// 1. GET Current Configuration & Key Verification
router.get("/config", async (req: Request, res: Response) => {
  try {
    const key = OpenRouterClient.getActiveKey();
    const masked = key ? `${key.slice(0, 8)}...${key.slice(-4)}` : null;
    let status = null;

    if (key) {
      status = await OpenRouterClient.verifyKey(key);
    }

    res.json({
      hasKey: !!key,
      maskedKey: masked,
      defaultModel: config.OPENROUTER_DEFAULT_MODEL || "google/gemini-2.5-flash",
      status
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST Save Configuration
router.post("/config", async (req: Request, res: Response) => {
  try {
    const { apiKey, defaultModel } = req.body;
    if (apiKey && typeof apiKey === "string" && apiKey.trim().length > 0) {
      OpenRouterClient.saveKey(apiKey.trim());
    }

    if (defaultModel && typeof defaultModel === "string") {
      config.OPENROUTER_DEFAULT_MODEL = defaultModel.trim();
    }

    const verification = await OpenRouterClient.verifyKey();
    res.json({
      success: true,
      status: verification,
      defaultModel: config.OPENROUTER_DEFAULT_MODEL
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET OpenRouter Models Catalog with Search & Filters
router.get("/models", async (req: Request, res: Response) => {
  try {
    const models = await OpenRouterClient.listModels();
    const search = ((req.query.search as string) || "").toLowerCase().trim();
    const provider = ((req.query.provider as string) || "").toLowerCase().trim();
    const recommendedOnly = req.query.recommended === "true";

    let filtered = models;

    if (recommendedOnly) {
      filtered = filtered.filter(m => m.is_recommended);
    }

    if (provider) {
      filtered = filtered.filter(m => m.provider.toLowerCase() === provider);
    }

    if (search) {
      filtered = filtered.filter(m =>
        m.id.toLowerCase().includes(search) ||
        m.name.toLowerCase().includes(search) ||
        m.description.toLowerCase().includes(search) ||
        m.provider.toLowerCase().includes(search)
      );
    }

    res.json({
      total: filtered.length,
      models: filtered.slice(0, 100) // Cap display at 100 for fast UI rendering
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST Test Key Connection
router.post("/test", async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    const status = await OpenRouterClient.verifyKey(apiKey);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// 5. GET Current Extraction Job Status
router.get("/extract/status", (req: Request, res: Response) => {
  res.json(activeJob);
});

// 6. POST Cancel Active Extraction Job
router.post("/extract/cancel", (req: Request, res: Response) => {
  if (activeJob.isRunning) {
    activeJob.cancelRequested = true;
    addLog("warn", "Cancellation requested by user. Terminating at next safe step...");
    return res.json({ success: true, message: "Cancelling extraction..." });
  }
  res.json({ success: true, message: "No extraction job is currently active." });
});

// 7. POST Start AI Model Extraction
router.post("/extract", async (req: Request, res: Response) => {
  if (activeJob.isRunning) {
    return res.status(409).json({ error: "An extraction job is already in progress. Please wait or cancel it first." });
  }

  const {
    mode = "all", // "single" | "project" | "all"
    targetId,
    model = config.OPENROUTER_DEFAULT_MODEL || "google/gemini-2.5-flash",
    maxTokensPerChunk = 8000,
    limit
  } = req.body;

  const key = OpenRouterClient.getActiveKey();
  if (!key) {
    return res.status(400).json({ error: "OpenRouter API Key is missing. Please configure your key first." });
  }

  const store = DatabaseManager.getLocalStore();
  const allConversations = store.getAllSubstantialConversations();
  const projects = store.listProjects();

  let targetConversations: CanonicalConversation[] = [];
  const projectMap = new Map<string, { id: string; name: string }>();

  for (const p of projects) {
    for (const cid of p.conversationIds) {
      projectMap.set(cid, { id: p.id, name: p.name });
    }
  }

  if (mode === "single" && targetId) {
    const found = allConversations.find((c: CanonicalConversation) => c.id === targetId);
    if (!found) return res.status(404).json({ error: `Conversation ${targetId} not found.` });
    targetConversations = [found];
  } else if (mode === "project" && targetId) {
    const proj = projects.find(p => p.id === targetId);
    if (!proj) return res.status(404).json({ error: `Project ${targetId} not found.` });
    const cidSet = new Set(proj.conversationIds);
    targetConversations = allConversations.filter((c: CanonicalConversation) => cidSet.has(c.id));
  } else {
    // Mode all
    targetConversations = allConversations.filter((c: CanonicalConversation) => c.messages && c.messages.length >= 2);
  }

  if (limit && typeof limit === "number" && limit > 0) {
    targetConversations = targetConversations.slice(0, limit);
  }

  if (targetConversations.length === 0) {
    return res.status(400).json({ error: "No conversations found matching the selection." });
  }

  // Initialize Job
  activeJob = {
    isRunning: true,
    jobId: `job_${Date.now()}`,
    model,
    totalConversations: targetConversations.length,
    processedConversations: 0,
    totalChunks: 0,
    processedChunks: 0,
    nodesCreated: 0,
    edgesCreated: 0,
    currentTitle: "",
    logs: [],
    cancelRequested: false
  };

  addLog("info", `🚀 Started AI Extraction using OpenRouter model '${model}' on ${targetConversations.length} conversation(s)...`);

  // Respond immediately so UI can monitor
  res.json({
    success: true,
    jobId: activeJob.jobId,
    totalConversations: targetConversations.length,
    model
  });

  // Run in background asynchronously
  (async () => {
    try {
      for (let i = 0; i < targetConversations.length; i++) {
        if (activeJob.cancelRequested) {
          addLog("warn", "Extraction job safely cancelled by user.");
          break;
        }

        const convo = targetConversations[i];
        activeJob.currentTitle = convo.title || convo.id;
        activeJob.processedConversations = i + 1;

        const projInfo = projectMap.get(convo.id);
        const chunks = ConversationChunker.chunkConversation(convo, maxTokensPerChunk);
        activeJob.totalChunks += chunks.length;

        addLog("info", `[${i + 1}/${targetConversations.length}] Processing "${convo.title.slice(0, 40)}" (${chunks.length} ${chunks.length === 1 ? "pass" : "chunks"})...`);

        for (const chunk of chunks) {
          if (activeJob.cancelRequested) break;

          activeJob.processedChunks++;
          try {
            const payload = await LlmExtractor.extractFromChunk(chunk, {
              apiKey: key,
              model,
              projectId: projInfo?.id,
              projectName: projInfo?.name
            });

            const result = LlmExtractor.ingestPayload(payload, {
              conversationId: convo.id,
              conversationTitle: convo.title,
              projectId: projInfo?.id,
              projectName: projInfo?.name,
              timestamp: convo.createdAt
            });

            activeJob.nodesCreated += result.nodes.length;
            activeJob.edgesCreated += result.edges.length;

            if (result.nodes.length > 0) {
              const sample = result.nodes[0];
              addLog("success", `[+] Ingested ${result.nodes.length} nodes & ${result.edges.length} edges (e.g. ${sample.type}: "${sample.name.slice(0, 35)}")`);
            }
          } catch (chunkErr: any) {
            addLog("error", `Error processing chunk in "${convo.title.slice(0, 30)}": ${chunkErr.message}`);
          }
        }
      }

      activeJob.completedAt = new Date().toISOString();
      addLog("success", `🎉 Extraction complete! Ingested a total of ${activeJob.nodesCreated} nodes and ${activeJob.edgesCreated} edges into the Knowledge Graph.`);
    } catch (jobErr: any) {
      activeJob.error = jobErr.message;
      addLog("error", `Fatal job error: ${jobErr.message}`);
    } finally {
      activeJob.isRunning = false;
      activeJob.cancelRequested = false;
    }
  })();
});

export default router;
