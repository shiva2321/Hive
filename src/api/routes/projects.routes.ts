import { Router } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { DatabaseManager } from "../../db/postgres_pool";
import { ContextGenerator } from "../../serving/context_generator";

const router = Router();

// List all projects
router.get("/", (req: AuthenticatedRequest, res) => {
  const store = DatabaseManager.getLocalStore();
  const projects = store.listProjects();
  res.json({
    tenantId: req.tenantId,
    totalProjects: projects.length,
    projects
  });
});

// Get specific project
router.get("/:id", (req: AuthenticatedRequest, res) => {
  const projId = String(req.params.id);
  const store = DatabaseManager.getLocalStore();
  const projects = store.listProjects();
  const project = projects.find(p => p.id === projId);

  if (!project) {
    return res.status(404).json({
      type: "urn:hive:error:not-found",
      title: "Project Not Found",
      status: 404,
      detail: `Project '${projId}' was not found.`
    });
  }

  res.json(project);
});

// Generate CLAUDE.md / .cursorrules context
router.get("/:id/rules", (req: AuthenticatedRequest, res) => {
  const projId = String(req.params.id);
  const store = DatabaseManager.getLocalStore();
  const projects = store.listProjects();
  const project = projects.find(p => p.id === projId);

  if (!project) {
    return res.status(404).json({
      type: "urn:hive:error:not-found",
      title: "Project Not Found",
      status: 404,
      detail: `Project '${projId}' was not found.`
    });
  }

  const format = (req.query.format as string) || "claude";
  const graph = store.getFullGraph();

  if (format === "cursor") {
    res.setHeader("Content-Type", "text/plain");
    return res.send(ContextGenerator.generateCursorRules(project));
  }

  res.setHeader("Content-Type", "text/markdown");
  res.send(ContextGenerator.generateClaudeMd(project, graph.nodes, graph.edges));
});

export default router;
