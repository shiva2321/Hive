import { IngestionJobData, IngestionQueue } from "../queues/ingestion_queue";
import { UniversalImporter } from "../ingestion/importer";
import { ConversationFilter } from "../pipeline/filter";
import { ProjectClusterer } from "../pipeline/clustering";
import { MemoryExtractor } from "../pipeline/extractor";
import { DatabaseManager } from "../db/postgres_pool";
import { ZeroKnowledgeCrypto } from "../core/crypto";
import { CanonicalConversation } from "../core/types";

export class IngestionWorker {
  private queue: IngestionQueue;

  constructor() {
    this.queue = IngestionQueue.getInstance();
    this.setupListeners();
  }

  private setupListeners() {
    this.queue.on("process_job", async (jobData: IngestionJobData) => {
      await this.executeJob(jobData);
    });
  }

  public async executeJob(jobData: IngestionJobData) {
    const { jobId, tenantId, sourceType, payload, filePath, passphrase } = jobData;

    try {
      this.queue.updateJobProgress(jobId, 20, "processing");

      // Step 1: Ingest conversations
      let convos: CanonicalConversation[] = [];
      if (sourceType === "file_path" && filePath) {
        convos = await UniversalImporter.importFile(filePath);
      } else if (payload) {
        if (typeof payload === "string") {
          convos = UniversalImporter.importJson(payload);
        } else if (Array.isArray(payload)) {
          if (payload.length > 0 && payload[0].messages) {
            convos = payload;
          } else {
            convos = UniversalImporter.importJson(JSON.stringify(payload));
          }
        } else if (payload.messages) {
          convos = [payload];
        }
      }

      this.queue.updateJobProgress(jobId, 45);

      // Step 2: Ephemeral filtering
      const substantial = convos.filter(c => !ConversationFilter.evaluate(c).isEphemeral);
      if (substantial.length === 0) {
        this.queue.completeJob(jobId, {
          totalIngested: 0,
          message: "All conversations were flagged as ephemeral/noise."
        });
        return;
      }

      this.queue.updateJobProgress(jobId, 65);

      // Step 3: Zero-Knowledge Encryption
      const tenantKey = ZeroKnowledgeCrypto.deriveTenantKey(tenantId, passphrase);
      for (const c of substantial) {
        for (const m of c.messages) {
          // Encrypt in-memory payload attribute
          (m as any).encryptedPayload = ZeroKnowledgeCrypto.encrypt(m.content, tenantKey);
        }
      }

      // Step 4: Clustering & Knowledge Graph
      const projects = ProjectClusterer.cluster(substantial);
      this.queue.updateJobProgress(jobId, 80);

      const extraction = MemoryExtractor.extract(projects, substantial);
      this.queue.updateJobProgress(jobId, 90);

      // Step 5: Save to Database
      const store = DatabaseManager.getLocalStore();
      store.saveConversations(substantial);
      store.saveProjects(projects);
      store.saveGraph(extraction.nodes, extraction.edges);
      store.saveInsights(extraction.insights);

      // Complete
      this.queue.completeJob(jobId, {
        conversationsIngested: substantial.length,
        projectsDiscovered: projects.length,
        nodesExtracted: extraction.nodes.length,
        edgesExtracted: extraction.edges.length,
        insightsGenerated: extraction.insights.length,
        isZeroKnowledgeEncrypted: true
      });
    } catch (err: any) {
      console.error(`Worker error on job ${jobId}:`, err);
      this.queue.failJob(jobId, err.message || "Unknown error during processing.");
    }
  }
}
