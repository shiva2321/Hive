import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { 
  CanonicalConversation, 
  GraphEdge, 
  GraphNode, 
  ProjectCluster, 
  UserInsight,
  HiveInquiry
} from "../core/types";

export class GraphStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), "memory_graph.sqlite");
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        source TEXT,
        source_id TEXT,
        title TEXT,
        created_at TEXT,
        updated_at TEXT,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        role TEXT,
        timestamp TEXT,
        content TEXT,
        code_snippets_json TEXT,
        token_count INTEGER,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        confidence REAL,
        tech_stack_json TEXT,
        decisions_json TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS project_conversations (
        project_id TEXT,
        conversation_id TEXT,
        PRIMARY KEY (project_id, conversation_id)
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        type TEXT,
        name TEXT,
        summary TEXT,
        attributes_json TEXT,
        first_seen_at TEXT,
        last_seen_at TEXT,
        confidence REAL
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        source_node_id TEXT,
        target_node_id TEXT,
        relation TEXT,
        context TEXT,
        timestamp TEXT,
        valid_from TEXT,
        valid_to TEXT,
        status TEXT,
        evidence_json TEXT
      );

      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        category TEXT,
        title TEXT,
        detail TEXT,
        evidence_count INTEGER,
        evidence_json TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS hive_inquiries (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        project_name TEXT,
        category TEXT,
        question TEXT,
        options_json TEXT,
        context TEXT,
        status TEXT,
        created_at TEXT,
        resolved_at TEXT,
        resolution TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_node_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON graph_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_inquiries_status ON hive_inquiries(status);
    `);
  }

  public saveConversations(conversations: CanonicalConversation[]) {
    const insertConvo = this.db.prepare(`
      INSERT OR REPLACE INTO conversations (id, source, source_id, title, created_at, updated_at, metadata_json)
      VALUES (@id, @source, @source_id, @title, @created_at, @updated_at, @metadata_json)
    `);

    const insertMsg = this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, conversation_id, role, timestamp, content, code_snippets_json, token_count)
      VALUES (@id, @conversation_id, @role, @timestamp, @content, @code_snippets_json, @token_count)
    `);

    const tx = this.db.transaction(() => {
      for (const c of conversations) {
        insertConvo.run({
          id: c.id,
          source: c.source,
          source_id: c.sourceId,
          title: c.title,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
          metadata_json: JSON.stringify(c.metadata || {})
        });

        for (const m of c.messages) {
          insertMsg.run({
            id: m.id,
            conversation_id: c.id,
            role: m.role,
            timestamp: m.timestamp,
            content: m.content,
            code_snippets_json: JSON.stringify(m.codeSnippets),
            token_count: m.tokenCountEst
          });
        }
      }
    });

    tx();
  }

  public clearDerivedGraph() {
    this.db.exec(`
      DELETE FROM project_conversations;
      DELETE FROM projects;
      DELETE FROM graph_edges;
      DELETE FROM graph_nodes;
      DELETE FROM insights;
    `);
  }

  public saveProjects(projects: ProjectCluster[]) {
    const insertProj = this.db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, description, confidence, tech_stack_json, decisions_json, created_at, updated_at)
      VALUES (@id, @name, @description, @confidence, @tech_stack_json, @decisions_json, @created_at, @updated_at)
    `);

    const insertLink = this.db.prepare(`
      INSERT OR REPLACE INTO project_conversations (project_id, conversation_id)
      VALUES (?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const p of projects) {
        insertProj.run({
          id: p.id,
          name: p.name,
          description: p.description,
          confidence: p.confidence,
          tech_stack_json: JSON.stringify(p.primaryTechStack),
          decisions_json: JSON.stringify(p.keyDecisions),
          created_at: p.createdAt,
          updated_at: p.updatedAt
        });

        for (const cid of p.conversationIds) {
          insertLink.run(p.id, cid);
        }
      }
    });

    tx();
  }

  public saveGraph(nodes: GraphNode[], edges: GraphEdge[]) {
    const insertNode = this.db.prepare(`
      INSERT OR REPLACE INTO graph_nodes (id, type, name, summary, attributes_json, first_seen_at, last_seen_at, confidence)
      VALUES (@id, @type, @name, @summary, @attributes_json, @first_seen_at, @last_seen_at, @confidence)
    `);

    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO graph_edges (id, source_node_id, target_node_id, relation, context, timestamp, valid_from, valid_to, status, evidence_json)
      VALUES (@id, @source_node_id, @target_node_id, @relation, @context, @timestamp, @valid_from, @valid_to, @status, @evidence_json)
    `);

    const tx = this.db.transaction(() => {
      for (const n of nodes) {
        insertNode.run({
          id: n.id,
          type: n.type,
          name: n.name,
          summary: n.summary,
          attributes_json: JSON.stringify(n.attributes),
          first_seen_at: n.firstSeenAt,
          last_seen_at: n.lastSeenAt,
          confidence: n.confidence
        });
      }

      for (const e of edges) {
        insertEdge.run({
          id: e.id,
          source_node_id: e.sourceNodeId,
          target_node_id: e.targetNodeId,
          relation: e.relation,
          context: e.context,
          timestamp: e.timestamp,
          valid_from: e.validFrom,
          valid_to: e.validTo || null,
          status: e.status,
          evidence_json: JSON.stringify(e.evidenceMessageIds)
        });
      }
    });

    tx();
  }

  public saveInsights(insights: UserInsight[]) {
    const insertInsight = this.db.prepare(`
      INSERT OR REPLACE INTO insights (id, category, title, detail, evidence_count, evidence_json, created_at)
      VALUES (@id, @category, @title, @detail, @evidence_count, @evidence_json, @created_at)
    `);

    const tx = this.db.transaction(() => {
      for (const ins of insights) {
        insertInsight.run({
          id: ins.id,
          category: ins.category,
          title: ins.title,
          detail: ins.detail,
          evidence_count: ins.evidenceCount,
          evidence_json: JSON.stringify(ins.sampleEvidence),
          created_at: ins.createdAt
        });
      }
    });

    tx();
  }

  public listProjects(): ProjectCluster[] {
    const rows = this.db.prepare(`SELECT * FROM projects ORDER BY updated_at DESC`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      confidence: r.confidence,
      conversationIds: (this.db.prepare(`SELECT conversation_id FROM project_conversations WHERE project_id = ?`).all(r.id) as any[]).map(x => x.conversation_id),
      primaryTechStack: JSON.parse(r.tech_stack_json || "[]"),
      keyDecisions: JSON.parse(r.decisions_json || "[]"),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getFullGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const rawNodes = this.db.prepare(`SELECT * FROM graph_nodes`).all() as any[];
    const rawEdges = this.db.prepare(`SELECT * FROM graph_edges`).all() as any[];

    const nodes: GraphNode[] = rawNodes.map(r => ({
      id: r.id,
      type: r.type,
      name: r.name,
      summary: r.summary,
      attributes: JSON.parse(r.attributes_json || "{}"),
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      confidence: r.confidence
    }));

    const edges: GraphEdge[] = rawEdges.map(r => ({
      id: r.id,
      sourceNodeId: r.source_node_id,
      targetNodeId: r.target_node_id,
      relation: r.relation,
      context: r.context,
      timestamp: r.timestamp,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      status: r.status,
      evidenceMessageIds: JSON.parse(r.evidence_json || "[]")
    }));

    return { nodes, edges };
  }

  public getInsights(): UserInsight[] {
    const rows = this.db.prepare(`SELECT * FROM insights ORDER BY evidence_count DESC`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      category: r.category,
      title: r.title,
      detail: r.detail,
      evidenceCount: r.evidence_count,
      sampleEvidence: JSON.parse(r.evidence_json || "[]"),
      createdAt: r.created_at
    }));
  }

  public queryProjectMemory(query: string): any {
    const projects = this.db.prepare(`
      SELECT * FROM projects 
      WHERE name LIKE ? OR description LIKE ? OR tech_stack_json LIKE ? OR decisions_json LIKE ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`) as any[];

    const relatedNodes = this.db.prepare(`
      SELECT * FROM graph_nodes 
      WHERE name LIKE ? OR summary LIKE ?
    `).all(`%${query}%`, `%${query}%`) as any[];

    const activeEdges = this.db.prepare(`
      SELECT * FROM graph_edges 
      WHERE context LIKE ? AND status = 'active'
    `).all(`%${query}%`) as any[];

    return {
      matchedProjects: projects.map(p => ({
        id: p.id,
        name: p.name,
        techStack: JSON.parse(p.tech_stack_json),
        decisions: JSON.parse(p.decisions_json)
      })),
      entities: relatedNodes.map(n => ({
        type: n.type,
        name: n.name,
        summary: n.summary
      })),
      activeDecisionsAndTech: activeEdges.map(e => e.context)
    };
  }

  public getStats() {
    const convoCount = (this.db.prepare(`SELECT COUNT(*) as count FROM conversations`).get() as any).count;
    const msgCount = (this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as any).count;
    const projCount = (this.db.prepare(`SELECT COUNT(*) as count FROM projects`).get() as any).count;
    const nodeCount = (this.db.prepare(`SELECT COUNT(*) as count FROM graph_nodes`).get() as any).count;
    const edgeCount = (this.db.prepare(`SELECT COUNT(*) as count FROM graph_edges`).get() as any).count;

    return {
      conversations: convoCount,
      messages: msgCount,
      projects: projCount,
      graphNodes: nodeCount,
      graphEdges: edgeCount
    };
  }

  public recordDecision(
    projectName: string,
    decisionText: string,
    rejectedTech?: string,
    rejectionReason?: string
  ): { success: boolean; decisionRecorded: string; guardrailRecorded?: string } {
    const timestamp = new Date().toISOString();
    
    // Find or create project
    let projects = this.listProjects();
    let project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());

    if (!project) {
      project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        name: projectName,
        description: `Project registered via MCP live session.`,
        confidence: 1.0,
        conversationIds: [],
        primaryTechStack: [],
        keyDecisions: [decisionText],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.saveProjects([project]);
    } else {
      if (!project.keyDecisions.includes(decisionText)) {
        project.keyDecisions.push(decisionText);
        project.updatedAt = timestamp;
        this.saveProjects([project]);
      }
    }

    const projNodeId = `node_proj_${project.id}`;
    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];

    // Ensure project node exists
    newNodes.push({
      id: projNodeId,
      type: "Project",
      name: project.name,
      summary: project.description,
      attributes: { decisions: project.keyDecisions },
      firstSeenAt: project.createdAt,
      lastSeenAt: timestamp,
      confidence: 1.0
    });

    // Create decision node & edge
    const decisionNodeId = `node_dec_${Date.now()}`;
    newNodes.push({
      id: decisionNodeId,
      type: "Decision",
      name: decisionText.substring(0, 40),
      summary: decisionText,
      attributes: { recordedVia: "mcp_tool" },
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      confidence: 1.0
    });

    newEdges.push({
      id: `edge_${projNodeId}_decided_${decisionNodeId}`,
      sourceNodeId: projNodeId,
      targetNodeId: decisionNodeId,
      relation: "DECIDED_TO",
      context: decisionText,
      timestamp,
      validFrom: timestamp,
      validTo: null,
      status: "active",
      evidenceMessageIds: []
    });

    // Optional rejected tech / negative knowledge
    let guardrailRecorded: string | undefined;
    if (rejectedTech) {
      const rejectNodeId = `node_rejected_${rejectedTech.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const reason = rejectionReason || "Performance or architectural complexity concerns";
      guardrailRecorded = `Avoid ${rejectedTech}: ${reason}`;

      newNodes.push({
        id: rejectNodeId,
        type: "NegativeKnowledge",
        name: `Avoid ${rejectedTech}`,
        summary: guardrailRecorded,
        attributes: { rejectedTech, reason, recordedVia: "mcp_tool" },
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        confidence: 1.0
      });

      newEdges.push({
        id: `edge_${projNodeId}_rejected_${rejectNodeId}_${Date.now()}`,
        sourceNodeId: projNodeId,
        targetNodeId: rejectNodeId,
        relation: "REJECTED",
        context: guardrailRecorded,
        timestamp,
        validFrom: timestamp,
        validTo: null,
        status: "active",
        evidenceMessageIds: []
      });
    }

    this.saveGraph(newNodes, newEdges);

    return {
      success: true,
      decisionRecorded: decisionText,
      guardrailRecorded
    };
  }

  public listInquiries(status?: string): HiveInquiry[] {
    let query = `SELECT * FROM hive_inquiries`;
    const params: any[] = [];
    if (status) {
      query += ` WHERE status = ?`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id || undefined,
      projectName: r.project_name || undefined,
      category: r.category as any,
      question: r.question,
      options: JSON.parse(r.options_json || "[]"),
      context: r.context,
      status: r.status as any,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at || undefined,
      resolution: r.resolution || undefined
    }));
  }

  public createInquiry(inquiry: Omit<HiveInquiry, "createdAt" | "status">): HiveInquiry {
    const timestamp = new Date().toISOString();
    const id = inquiry.id || `inq_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    this.db.prepare(`
      INSERT OR REPLACE INTO hive_inquiries (id, project_id, project_name, category, question, options_json, context, status, created_at)
      VALUES (@id, @project_id, @project_name, @category, @question, @options_json, @context, 'pending', @created_at)
    `).run({
      id,
      project_id: inquiry.projectId || null,
      project_name: inquiry.projectName || null,
      category: inquiry.category,
      question: inquiry.question,
      options_json: JSON.stringify(inquiry.options || []),
      context: inquiry.context || "",
      created_at: timestamp
    });

    return {
      ...inquiry,
      id,
      status: "pending",
      createdAt: timestamp
    };
  }

  public resolveInquiry(id: string, resolution: string, chosenOptionId?: string): { success: boolean; inquiry?: HiveInquiry } {
    const existing = this.db.prepare(`SELECT * FROM hive_inquiries WHERE id = ?`).get(id) as any;
    if (!existing) {
      return { success: false };
    }

    const timestamp = new Date().toISOString();
    this.db.prepare(`
      UPDATE hive_inquiries 
      SET status = 'resolved', resolved_at = ?, resolution = ?
      WHERE id = ?
    `).run(timestamp, resolution, id);

    // If this inquiry belongs to a project, record the decision to sync the graph
    if (existing.project_name) {
      this.recordDecision(existing.project_name, resolution);
    }

    const updated = this.listInquiries().find(i => i.id === id);
    return { success: true, inquiry: updated };
  }

  public listConversations(page: number = 1, limit: number = 30, provider?: string, query?: string): { conversations: any[]; total: number; page: number; limit: number } {
    let whereClause = "1=1";
    const params: any[] = [];

    if (provider && provider !== "all") {
      whereClause += " AND source = ?";
      params.push(provider.toLowerCase());
    }

    if (query && query.trim()) {
      whereClause += " AND (title LIKE ? OR id LIKE ?)";
      params.push(`%${query}%`, `%${query}%`);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM conversations WHERE ${whereClause}`).get(...params) as any;
    const total = countRow?.count || 0;

    const offset = (Math.max(1, page) - 1) * limit;
    const rows = this.db.prepare(`
      SELECT c.id, c.source, c.source_id, c.title, c.created_at, c.updated_at, c.metadata_json,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE ${whereClause}
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    const conversations = rows.map(r => ({
      id: r.id,
      source: r.source,
      sourceId: r.source_id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: r.message_count,
      metadata: JSON.parse(r.metadata_json || "{}")
    }));

    return {
      conversations,
      total,
      page,
      limit
    };
  }

  public getConversation(id: string): any {
    const convo = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as any;
    if (!convo) return null;

    const messages = this.db.prepare(`
      SELECT * FROM messages 
      WHERE conversation_id = ? 
      ORDER BY timestamp ASC
    `).all(id) as any[];

    return {
      id: convo.id,
      source: convo.source,
      sourceId: convo.source_id,
      title: convo.title,
      createdAt: convo.created_at,
      updatedAt: convo.updated_at,
      metadata: JSON.parse(convo.metadata_json || "{}"),
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        timestamp: m.timestamp,
        content: m.content,
        codeSnippets: JSON.parse(m.code_snippets_json || "[]"),
        tokenCount: m.token_count
      }))
    };
  }

  public getAllSubstantialConversations(): CanonicalConversation[] {
    const convos = this.db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`).all() as any[];
    const result: CanonicalConversation[] = [];
    const getMsgs = this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC`);

    for (const c of convos) {
      const msgs = getMsgs.all(c.id) as any[];
      if (msgs.length > 0) {
        result.push({
          id: c.id,
          source: c.source,
          sourceId: c.source_id,
          title: c.title,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          metadata: JSON.parse(c.metadata_json || "{}"),
          messages: msgs.map(m => ({
            id: m.id,
            role: m.role,
            timestamp: m.timestamp,
            content: m.content,
            codeSnippets: JSON.parse(m.code_snippets_json || "[]"),
            tokenCountEst: m.token_count || Math.ceil((m.content || "").length / 4)
          }))
        });
      }
    }
    return result;
  }

  public getTelemetry() {
    const stats = this.getStats();
    const pendingInquiries = (this.db.prepare(`SELECT COUNT(*) as c FROM hive_inquiries WHERE status = 'pending'`).get() as any)?.c || 0;
    const resolvedInquiries = (this.db.prepare(`SELECT COUNT(*) as c FROM hive_inquiries WHERE status = 'resolved'`).get() as any)?.c || 0;
    
    // Group conversations by source
    const bySource = this.db.prepare(`
      SELECT source, COUNT(*) as count 
      FROM conversations 
      GROUP BY source
      ORDER BY count DESC
    `).all() as any[];

    return {
      stats,
      inquiries: {
        pending: pendingInquiries,
        resolved: resolvedInquiries
      },
      providers: bySource,
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        nodeVersion: process.version,
        platform: process.platform,
        privacyMode: "100% On-Device (Zero-Cloud)"
      }
    };
  }

  public close() {
    this.db.close();
  }
}
