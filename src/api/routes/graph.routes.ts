import { Router } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { DatabaseManager } from "../../db/postgres_pool";

const router = Router();

// Full Graph for visualization
router.get("/", (req: AuthenticatedRequest, res) => {
  const store = DatabaseManager.getLocalStore();
  const graph = store.getFullGraph();
  res.json({
    tenantId: req.tenantId,
    nodesCount: graph.nodes.length,
    edgesCount: graph.edges.length,
    graph
  });
});

// Semantic & Relational Search in memory
router.get("/query", (req: AuthenticatedRequest, res) => {
  const term = (req.query.q as string) || "";
  if (!term.trim()) {
    return res.status(400).json({
      type: "https://api.universalmemory.ai/errors/bad-request",
      title: "Query Parameter Required",
      status: 400,
      detail: "Query parameter 'q' is required."
    });
  }

  const store = DatabaseManager.getLocalStore();
  const results = store.queryProjectMemory(term);
  res.json({
    query: term,
    tenantId: req.tenantId,
    results
  });
});

// Meta-insights
router.get("/insights", (req: AuthenticatedRequest, res) => {
  const store = DatabaseManager.getLocalStore();
  const insights = store.getInsights();
  res.json({
    tenantId: req.tenantId,
    totalInsights: insights.length,
    insights
  });
});

export default router;
