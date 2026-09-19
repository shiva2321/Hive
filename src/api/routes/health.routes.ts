import { Router } from "express";
import { DatabaseManager } from "../../db/postgres_pool";

const router = Router();

// Liveness probe (Kubernetes / Cloud Run)
router.get("/liveness", (req, res) => {
  res.status(200).json({ status: "alive", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Readiness probe (checks database connectivity)
router.get("/readiness", async (req, res) => {
  const dbHealth = await DatabaseManager.healthCheck();
  const isReady = dbHealth.postgres || dbHealth.sqlite;

  if (isReady) {
    res.status(200).json({ status: "ready", databases: dbHealth });
  } else {
    res.status(503).json({ status: "not_ready", databases: dbHealth });
  }
});

// Prometheus RED Metrics endpoint
router.get("/metrics", (req, res) => {
  const memory = process.memoryUsage();
  const metrics = `
# HELP node_uptime_seconds Process uptime in seconds.
# TYPE node_uptime_seconds gauge
node_uptime_seconds ${process.uptime()}

# HELP node_memory_rss_bytes Resident set size in bytes.
# TYPE node_memory_rss_bytes gauge
node_memory_rss_bytes ${memory.rss}

# HELP node_memory_heap_used_bytes Memory heap used in bytes.
# TYPE node_memory_heap_used_bytes gauge
node_memory_heap_used_bytes ${memory.heapUsed}
  `.trim();

  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(metrics);
});

export default router;
