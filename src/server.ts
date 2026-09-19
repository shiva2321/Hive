import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { GraphStore } from "./storage/graph_store";
import { UniversalImporter } from "./ingestion/importer";
import { ConversationFilter } from "./pipeline/filter";
import { ProjectClusterer } from "./pipeline/clustering";
import { MemoryExtractor } from "./pipeline/extractor";
import { ContextGenerator } from "./serving/context_generator";
import { CanonicalConversation } from "./core/types";

const app = express();
const PORT = process.env.PORT || 42424;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Static UI directory
const uiDir = path.join(__dirname, "../ui");
if (fs.existsSync(uiDir)) {
  app.use(express.static(uiDir));
}

const store = new GraphStore();

// 1. Ingestion endpoint (called by Browser Extension or CLI)
app.post("/api/ingest", (req, res) => {
  try {
    const data = req.body;
    let conversations: CanonicalConversation[] = [];

    if (Array.isArray(data)) {
      conversations = data;
    } else if (data && data.messages) {
      conversations = [data];
    } else {
      return res.status(400).json({ error: "Invalid conversation payload format." });
    }

    // Filter ephemeral
    const substantial = conversations.filter(c => !ConversationFilter.evaluate(c).isEphemeral);
    if (substantial.length === 0) {
      return res.json({ message: "Conversations ingested but flagged as ephemeral noise.", count: 0 });
    }

    // Save conversations
    store.saveConversations(substantial);

    // Re-cluster and extract graph
    const allProjects = ProjectClusterer.cluster(substantial);
    store.saveProjects(allProjects);

    const extraction = MemoryExtractor.extract(allProjects, substantial);
    store.saveGraph(extraction.nodes, extraction.edges);
    store.saveInsights(extraction.insights);

    res.json({
      success: true,
      ingested: substantial.length,
      projectsDiscovered: allProjects.length,
      graphNodesAdded: extraction.nodes.length,
      graphEdgesAdded: extraction.edges.length,
      insightsGenerated: extraction.insights.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Import file/zip endpoint
app.post("/api/import-file", async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: "Missing filePath in request body." });
    }

    const convos = await UniversalImporter.importFile(filePath);
    const substantial = convos.filter(c => !ConversationFilter.evaluate(c).isEphemeral);

    store.saveConversations(substantial);
    const projects = ProjectClusterer.cluster(substantial);
    store.saveProjects(projects);

    const extraction = MemoryExtractor.extract(projects, substantial);
    store.saveGraph(extraction.nodes, extraction.edges);
    store.saveInsights(extraction.insights);

    res.json({
      success: true,
      totalParsed: convos.length,
      substantial: substantial.length,
      projects: projects.length,
      nodes: extraction.nodes.length,
      edges: extraction.edges.length,
      insights: extraction.insights.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Stats endpoint
app.get("/api/stats", (req, res) => {
  res.json(store.getStats());
});

// 4. Projects endpoint
app.get("/api/projects", (req, res) => {
  res.json(store.listProjects());
});

// 5. Full Graph endpoint
app.get("/api/graph", (req, res) => {
  res.json(store.getFullGraph());
});

// 6. Insights endpoint
app.get("/api/insights", (req, res) => {
  res.json(store.getInsights());
});

// 7. Generate CLAUDE.md context for a project
app.get("/api/project/:id/claudemd", (req, res) => {
  const projects = store.listProjects();
  const proj = projects.find(p => p.id === req.params.id);
  if (!proj) return res.status(404).send("Project not found");

  const graph = store.getFullGraph();
  const md = ContextGenerator.generateClaudeMd(proj, graph.nodes, graph.edges);
  res.setHeader("Content-Type", "text/markdown");
  res.send(md);
});

// Start Server if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Universal AI Memory Daemon running at http://localhost:${PORT}`);
    console.log(`- Web Dashboard: http://localhost:${PORT}`);
    console.log(`- REST API: http://localhost:${PORT}/api/stats`);
  });
}

export { app, store };
