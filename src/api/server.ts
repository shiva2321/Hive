import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import { exec } from "child_process";
import AdmZip from "adm-zip";
import { config } from "../config/env";
import { authMiddleware } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate_limiter";
import { errorHandler } from "./middleware/error_handler";
import healthRoutes from "./routes/health.routes";
import ingestRoutes from "./routes/ingest.routes";
import projectRoutes from "./routes/projects.routes";
import graphRoutes from "./routes/graph.routes";
import openrouterRoutes from "./routes/openrouter.routes";
import { IngestionWorker } from "../workers/ingestion_worker";
import { DatabaseManager } from "../db/postgres_pool";
import { MCPServerRunner } from "../serving/mcp_server";
import { OmniScanner } from "../ingestion/omni_scanner";
import { ConversationFilter } from "../pipeline/filter";
import { ProjectClusterer } from "../pipeline/clustering";
import { MemoryExtractor } from "../pipeline/extractor";
import { HiveBrain } from "../core/hive_brain";

export function createEnterpriseApp(): express.Express {
  const app = express();

  // Basic security & parsing
  app.use(cors({
    origin: config.ALLOWED_ORIGINS === "*" ? "*" : config.ALLOWED_ORIGINS.split(","),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Tenant-ID", "X-Request-ID"]
  }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // Correlation ID middleware
  app.use((req, res, next) => {
    if (!req.headers["x-request-id"]) {
      req.headers["x-request-id"] = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
    res.setHeader("X-Request-ID", req.headers["x-request-id"] as string);
    next();
  });

  // Global Rate Limiter
  app.use(rateLimiter);

  // Health and Metrics (Public, no auth needed)
  app.use("/healthz", healthRoutes);

  // MCP Remote Server-Sent Events (SSE) Transport
  const mcpRunner = new MCPServerRunner();

  app.get("/sse", async (req, res) => {
    try {
      await mcpRunner.handleSseConnection(req, res);
    } catch (err: any) {
      console.error("Error in MCP SSE connection:", err);
      if (!res.headersSent) res.status(500).send(err.message);
    }
  });

  app.post("/messages", async (req, res) => {
    try {
      await mcpRunner.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error("Error in MCP POST /messages:", err);
      if (!res.headersSent) res.status(500).send(err.message);
    }
  });

  // 1-Click Scan All Local AI Tools, IDEs, and Agent Transcripts (Antigravity, Claude Code, Cursor, Gemini)
  app.post("/api/scan-local", async (req, res) => {
    try {
      const scanResult = OmniScanner.scanAll();

      if (scanResult.conversations.length > 0) {
        const substantial = scanResult.conversations.filter(c => !ConversationFilter.evaluate(c).isEphemeral);
        const store = DatabaseManager.getLocalStore();
        store.saveConversations(substantial);
        store.clearDerivedGraph();

        const projects = ProjectClusterer.cluster(substantial);
        store.saveProjects(projects);

        const extraction = MemoryExtractor.extract(projects, substantial);
        store.saveGraph(extraction.nodes, extraction.edges);
        store.saveInsights(extraction.insights);

        return res.json({
          success: true,
          scannedTranscripts: substantial.length,
          byTool: scanResult.byTool,
          projectsDiscovered: projects.length,
          knowledgeNodes: extraction.nodes.length,
          graphEdges: extraction.edges.length,
          insights: extraction.insights.length
        });
      }

      res.json({ success: true, scannedTranscripts: 0, message: "No local AI transcripts found." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Extension bundle download & handshake (Placed before express.static to enforce Content-Disposition headers)
  app.get(["/api/extension/download", "/api/extension/download/hive-ai-memory-extension.zip", "/hive-ai-memory-extension.zip"], (req, res) => {
    try {
      const staticZip = path.join(__dirname, "../../ui/hive-ai-memory-extension.zip");
      if (fs.existsSync(staticZip)) {
        res.setHeader("Content-Disposition", 'attachment; filename="hive-ai-memory-extension.zip"; filename*=UTF-8\'\'hive-ai-memory-extension.zip');
        return res.download(staticZip, "hive-ai-memory-extension.zip");
      }

      const extensionDir = path.join(__dirname, "../../extension");
      if (!fs.existsSync(extensionDir)) {
        return res.status(404).json({ error: "Extension directory not found" });
      }
      const zip = new AdmZip();
      zip.addLocalFolder(extensionDir);
      const zipBuffer = zip.toBuffer();

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="hive-ai-memory-extension.zip"; filename*=UTF-8\'\'hive-ai-memory-extension.zip');
      res.setHeader("Content-Length", zipBuffer.length);
      return res.send(zipBuffer);
    } catch (err: any) {
      console.error("Error generating extension bundle zip:", err);
      res.status(500).json({ error: "Failed to generate extension bundle" });
    }
  });

  app.post("/api/extension/export-to-downloads", (req, res) => {
    try {
      const downloadsDir = path.join(os.homedir(), "Downloads");
      const staticZip = path.join(__dirname, "../../ui/hive-ai-memory-extension.zip");
      const targetZip = path.join(downloadsDir, "hive-ai-memory-extension.zip");
      const targetFolder = path.join(downloadsDir, "hive-ai-memory-extension");

      if (fs.existsSync(staticZip)) {
        fs.copyFileSync(staticZip, targetZip);
        const zip = new AdmZip(staticZip);
        zip.extractAllTo(targetFolder, true);
        return res.json({
          success: true,
          zipPath: targetZip,
          folderPath: targetFolder,
          message: "Extension zip and extracted folder ready in Downloads!"
        });
      }

      const extensionDir = path.join(__dirname, "../../extension");
      const zip = new AdmZip();
      zip.addLocalFolder(extensionDir);
      zip.writeZip(targetZip);
      zip.extractAllTo(targetFolder, true);

      return res.json({
        success: true,
        zipPath: targetZip,
        folderPath: targetFolder,
        message: "Extension zip and extracted folder generated in Downloads!"
      });
    } catch (err: any) {
      console.error("Error exporting to downloads:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/extension/open-folder", (req, res) => {
    try {
      const folder = path.join(os.homedir(), "Downloads", "hive-ai-memory-extension");
      if (fs.existsSync(folder)) {
        exec(`explorer.exe "${folder}"`);
        return res.json({ success: true, folderPath: folder });
      }
      const repoExt = path.join(__dirname, "../../extension");
      exec(`explorer.exe "${repoExt}"`);
      return res.json({ success: true, folderPath: repoExt });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/extension/status", (req, res) => {
    const store = DatabaseManager.getLocalStore();
    res.json({
      status: "online",
      mode: "system_native",
      version: "2.1.0",
      stats: store.getStats()
    });
  });

  // Static Dashboard UI
  const uiPath = path.join(__dirname, "../../ui");
  if (fs.existsSync(uiPath)) {
    app.use(express.static(uiPath));
  }

  // Authenticated API V1 Routes
  app.use("/api/v1/ingest", authMiddleware, ingestRoutes);
  app.use("/api/v1/projects", authMiddleware, projectRoutes);
  app.use("/api/v1/graph", authMiddleware, graphRoutes);

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

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export function startEnterpriseServer() {
  const app = createEnterpriseApp();
  
  // Initialize Background Worker
  new IngestionWorker();

  // Run initial autonomous Hive Brain audit
  try {
    const store = DatabaseManager.getLocalStore();
    const auditRes = HiveBrain.auditAndSynthesize(store);
    console.log(`[HiveBrain] Initial audit complete: ${auditRes.detectedDiscrepancies} checks, ${auditRes.newInquiries} new inquiries flagged.`);
  } catch (err) {
    console.error("[HiveBrain] Audit error during startup:", err);
  }

  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`=======================================================`);
    console.log(`🐝 Hive Universal Cross-AI Memory & Collective Brain`);
    console.log(`- Environment: ${config.NODE_ENV}`);
    console.log(`- Base URL:    http://${config.HOST}:${config.PORT}`);
    console.log(`- Health:      http://${config.HOST}:${config.PORT}/healthz/readiness`);
    console.log(`- Metrics:     http://${config.HOST}:${config.PORT}/healthz/metrics`);
    console.log(`- Dashboard:   http://${config.HOST}:${config.PORT}/`);
    console.log(`- Inquiries:   http://${config.HOST}:${config.PORT}/api/inquiries`);
    console.log(`- Telemetry:   http://${config.HOST}:${config.PORT}/api/telemetry`);
    console.log(`=======================================================`);
  });

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Initiating graceful shutdown...`);
    server.close(async () => {
      console.log("[+] HTTP server closed.");
      await DatabaseManager.closeAll();
      console.log("[+] Database connection pools drained.");
      process.exit(0);
    });

    // Force close after 10s if stuck
    setTimeout(() => {
      console.error("[-] Forced shutdown after timeout.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (require.main === module) {
  startEnterpriseServer();
}
