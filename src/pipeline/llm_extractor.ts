import { z } from "zod";
import { CanonicalConversation, GraphEdge, GraphNode, RelationType, EntityType } from "../core/types";
import { ConversationChunk, ConversationChunker } from "./chunker";
import { OpenRouterClient } from "./openrouter_client";
import { DatabaseManager } from "../db/postgres_pool";

// Robust coerce helpers for LLM output tolerance
const safeStr = (fallback = "") =>
  z.preprocess((val) => (val === null || val === undefined ? fallback : String(val).trim()), z.string().default(fallback));

const safeNum = (fallback = 0.9) =>
  z.preprocess((val) => {
    if (typeof val === "number" && !isNaN(val)) return Math.max(0, Math.min(1, val));
    const parsed = parseFloat(String(val));
    return isNaN(parsed) ? fallback : Math.max(0, Math.min(1, parsed));
  }, z.number().default(fallback));

const safeStrArray = () =>
  z.preprocess(
    (val) => (Array.isArray(val) ? val.filter((x) => x !== null && x !== undefined).map(String) : []),
    z.array(z.string()).default([])
  );

// Zod Validation Schema for LLM Response
export const LlmExtractionSchema = z.object({
  decisions: z.array(z.object({
    title: safeStr("Untitled Decision"),
    inquiry: safeStr(""),
    rationale: safeStr(""),
    chosenSolution: safeStr(""),
    alternativesConsidered: safeStrArray(),
    confidence: safeNum(0.95)
  })).default([]),

  patternsAndComponents: z.array(z.object({
    name: safeStr("Unnamed Component"),
    type: safeStr("ArchitecturePattern"),
    summary: safeStr(""),
    techStack: safeStrArray(),
    confidence: safeNum(0.9)
  })).default([]),

  negativeKnowledge: z.array(z.object({
    subject: safeStr("Avoidance"),
    reason: safeStr("No reason recorded"),
    alternativeRecommended: safeStr(""),
    confidence: safeNum(0.9)
  })).default([]),

  entities: z.array(z.object({
    name: safeStr("Concept"),
    type: safeStr("Concept"),
    description: safeStr("")
  })).default([]),

  relationships: z.array(z.object({
    source: safeStr(""),
    target: safeStr(""),
    relation: safeStr("USES_TECH"),
    explanation: safeStr("")
  })).default([])
});

export type LlmExtractionPayload = z.infer<typeof LlmExtractionSchema>;

export interface ExtractionProgressUpdate {
  conversationId: string;
  conversationTitle: string;
  chunkIndex: number;
  totalChunks: number;
  tokensProcessed: number;
  nodesCreated: number;
  edgesCreated: number;
  summary: string;
  isComplete: boolean;
}

export class LlmExtractor {
  private static readonly SYSTEM_PROMPT = `You are an expert AI Memory & Knowledge Architect.
Your task is to analyze real human-AI technical conversations and development sessions and extract high-value, authentic, factual knowledge into a structured Knowledge Graph.

STRICT ACCURACY RULES:
1. ZERO HALLUCINATIONS: Extract ONLY facts, decisions, inquiries, code patterns, hardware specs, and rejections that were ACTUALLY discussed or implemented in the provided transcript.
2. DO NOT make up generic corporate jargon, fake architectural modules, or hypothetical systems.
3. If a conversation is casual, trivial, or contains no actionable technical decisions or components, return empty arrays.
4. Capture SPECIFIC details (e.g. specific model names like "RTX 3060 12GB", specific libraries like "NautilusTrader", specific prices, specific benchmark results).
5. For Negative Knowledge: capture things the user or assistant explicitly warned against, rejected, or found to fail (and the exact reason).

OUTPUT FORMAT:
Respond with a single valid JSON object adhering to this structure:
{
  "decisions": [
    {
      "title": "Concise decision title",
      "inquiry": "What problem or question prompted this",
      "rationale": "Why this specific path was chosen",
      "chosenSolution": "What was chosen",
      "alternativesConsidered": ["Alternative 1", "Alternative 2"],
      "confidence": 0.95
    }
  ],
  "patternsAndComponents": [
    {
      "name": "Component/Pattern Name",
      "type": "ArchitecturePattern" | "Component",
      "summary": "Technical function and implementation details",
      "techStack": ["Tool1", "Tool2"],
      "confidence": 0.9
    }
  ],
  "negativeKnowledge": [
    {
      "subject": "What to avoid or what failed",
      "reason": "Technical reason or observed failure",
      "alternativeRecommended": "What was recommended instead"
    }
  ],
  "entities": [
    {
      "name": "Entity Name",
      "type": "Framework" | "Library" | "Database" | "Language" | "Hardware" | "Product" | "Concept",
      "description": "How it is used or discussed"
    }
  ],
  "relationships": [
    {
      "source": "Entity/Decision Name",
      "target": "Entity/Project Name",
      "relation": "USES_TECH" | "PART_OF_PROJECT" | "SUPERSEDES" | "REJECTED" | "DEPENDS_ON" | "COMPARED_TO",
      "explanation": "Context of connection"
    }
  ]
}`;

  /**
   * Processes a single conversation chunk through the OpenRouter LLM
   */
  public static async extractFromChunk(
    chunk: ConversationChunk,
    options: {
      apiKey?: string;
      model: string;
      projectId?: string;
      projectName?: string;
    }
  ): Promise<LlmExtractionPayload> {
    const formattedTranscript = chunk.messages.map(m => {
      const roleLabel = m.role === "user" ? "Human User" : m.role === "assistant" ? "AI Assistant" : "System";
      return `[${roleLabel} - ${m.timestamp}]:\n${m.content}\n`;
    }).join("\n---\n\n");

    const userPrompt = `ANALYZE THIS CONVERSATION TRANSCRIPT:
${chunk.summaryHeader}
${options.projectName ? `[Project Domain: "${options.projectName}"]` : ""}

TRANSCRIPT CONTENT:
${formattedTranscript}

Extract all real decisions, components, negative knowledge (things rejected/avoided), key technical entities, and relationships according to the system instructions.`;

    const rawReply = await OpenRouterClient.chatCompletion({
      apiKey: options.apiKey,
      model: options.model,
      temperature: 0.1,
      jsonMode: true,
      maxTokens: 4096,
      messages: [
        { role: "system", content: this.SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    });

    return this.parseAndValidate(rawReply);
  }

  /**
   * Cleans, parses, and validates LLM output JSON
   */
  public static parseAndValidate(raw: string): LlmExtractionPayload {
    try {
      let cleaned = raw.trim();
      // Strip markdown code block wrappers if present
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

      const parsed = JSON.parse(cleaned);
      const validated = LlmExtractionSchema.parse(parsed);
      return validated;
    } catch (err: any) {
      console.warn("Error validating LLM extraction output:", err.message);
      // Attempt fallback extraction if JSON was slightly malformed
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const fallback = JSON.parse(jsonMatch[0]);
          return LlmExtractionSchema.parse(fallback);
        } catch {
          // ignore
        }
      }
      return {
        decisions: [],
        patternsAndComponents: [],
        negativeKnowledge: [],
        entities: [],
        relationships: []
      };
    }
  }

  /**
   * Ingests validated extraction payload directly into SQLite Knowledge Graph
   */
  public static ingestPayload(
    payload: LlmExtractionPayload,
    context: {
      conversationId: string;
      conversationTitle: string;
      projectId?: string;
      projectName?: string;
      timestamp?: string;
    }
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const store = DatabaseManager.getLocalStore();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const now = context.timestamp || new Date().toISOString();
    const projId = context.projectId || "proj_general";
    const projNodeId = `node_proj_${projId}`;

    const entityIdMap = new Map<string, string>();
    const makeId = (prefix: string, name: string) =>
      `${prefix}_${name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40)}`;

    // 1. Decisions
    for (const d of payload.decisions) {
      if (!d.title || d.title.trim().length < 4) continue;
      const decNodeId = makeId("node_dec", d.title);
      entityIdMap.set(d.title.toLowerCase().trim(), decNodeId);

      const node: GraphNode = {
        id: decNodeId,
        type: "Decision",
        name: d.title,
        summary: `Decision: ${d.chosenSolution}. Rationale: ${d.rationale}`,
        attributes: {
          inquiry: d.inquiry || context.conversationTitle,
          chosenSolution: d.chosenSolution,
          rationale: d.rationale,
          alternativesConsidered: d.alternativesConsidered,
          sourceConversationId: context.conversationId,
          extractedVia: "OpenRouter-LLM"
        },
        firstSeenAt: now,
        lastSeenAt: now,
        confidence: d.confidence
      };
      nodes.push(node);

      edges.push({
        id: `edge_${projNodeId}_contains_${decNodeId}`,
        sourceNodeId: projNodeId,
        targetNodeId: decNodeId,
        relation: "PART_OF_PROJECT",
        context: `${context.projectName || "Project"} authentic decision: ${d.title}`,
        timestamp: now,
        validFrom: now,
        validTo: null,
        status: "active",
        evidenceMessageIds: []
      });
    }

    // 2. Patterns & Components
    for (const p of payload.patternsAndComponents) {
      if (!p.name || p.name.trim().length < 3) continue;
      const compNodeId = makeId("node_comp", p.name);
      entityIdMap.set(p.name.toLowerCase().trim(), compNodeId);

      const node: GraphNode = {
        id: compNodeId,
        type: p.type as EntityType,
        name: p.name,
        summary: p.summary,
        attributes: {
          techStack: p.techStack,
          sourceConversationId: context.conversationId,
          extractedVia: "OpenRouter-LLM"
        },
        firstSeenAt: now,
        lastSeenAt: now,
        confidence: p.confidence
      };
      nodes.push(node);

      edges.push({
        id: `edge_${projNodeId}_implements_${compNodeId}`,
        sourceNodeId: projNodeId,
        targetNodeId: compNodeId,
        relation: "PART_OF_PROJECT",
        context: `${context.projectName || "Project"} component: ${p.name}`,
        timestamp: now,
        validFrom: now,
        validTo: null,
        status: "active",
        evidenceMessageIds: []
      });
    }

    // 3. Negative Knowledge / Rejections
    for (const neg of payload.negativeKnowledge) {
      if (!neg.subject || neg.subject.trim().length < 3) continue;
      const negNodeId = makeId("node_neg", neg.subject);
      entityIdMap.set(neg.subject.toLowerCase().trim(), negNodeId);

      const node: GraphNode = {
        id: negNodeId,
        type: "NegativeKnowledge",
        name: `Avoid ${neg.subject.slice(0, 35)}`,
        summary: `Rejected / Anti-Pattern: ${neg.subject}. Reason: ${neg.reason}${neg.alternativeRecommended ? ` | Better Path: ${neg.alternativeRecommended}` : ""}`,
        attributes: {
          subject: neg.subject,
          reason: neg.reason,
          alternativeRecommended: neg.alternativeRecommended || null,
          sourceConversationId: context.conversationId,
          extractedVia: "OpenRouter-LLM"
        },
        firstSeenAt: now,
        lastSeenAt: now,
        confidence: neg.confidence
      };
      nodes.push(node);

      edges.push({
        id: `edge_${projNodeId}_rejects_${negNodeId}`,
        sourceNodeId: projNodeId,
        targetNodeId: negNodeId,
        relation: "REJECTED",
        context: `Rejected: ${neg.subject} (${neg.reason})`,
        timestamp: now,
        validFrom: now,
        validTo: null,
        status: "active",
        evidenceMessageIds: []
      });
    }

    // 4. Entities
    for (const ent of payload.entities) {
      if (!ent.name || ent.name.trim().length < 2) continue;
      const entNodeId = makeId("node_ent", ent.name);
      entityIdMap.set(ent.name.toLowerCase().trim(), entNodeId);

      let entityType: EntityType = "Library";
      if (ent.type === "Framework" || ent.type === "Database" || ent.type === "Language") {
        entityType = ent.type;
      } else if (ent.type === "Hardware" || ent.type === "Product") {
        entityType = "ArchitecturePattern";
      }

      const node: GraphNode = {
        id: entNodeId,
        type: entityType,
        name: ent.name,
        summary: ent.description,
        attributes: {
          classifiedType: ent.type,
          sourceConversationId: context.conversationId,
          extractedVia: "OpenRouter-LLM"
        },
        firstSeenAt: now,
        lastSeenAt: now,
        confidence: 0.95
      };
      nodes.push(node);

      edges.push({
        id: `edge_${projNodeId}_uses_${entNodeId}`,
        sourceNodeId: projNodeId,
        targetNodeId: entNodeId,
        relation: "USES_TECH",
        context: `${context.projectName || "Project"} references ${ent.name}`,
        timestamp: now,
        validFrom: now,
        validTo: null,
        status: "active",
        evidenceMessageIds: []
      });
    }

    // 5. Cross-Entity Relationships
    for (const rel of payload.relationships) {
      const srcKey = rel.source.toLowerCase().trim();
      const tgtKey = rel.target.toLowerCase().trim();

      const srcId = entityIdMap.get(srcKey) || (srcKey.includes(projId) ? projNodeId : null);
      const tgtId = entityIdMap.get(tgtKey) || (tgtKey.includes(projId) ? projNodeId : null);

      if (srcId && tgtId && srcId !== tgtId) {
        const relationType = this.normalizeRelation(rel.relation);
        edges.push({
          id: `edge_${srcId}_to_${tgtId}_${relationType}`,
          sourceNodeId: srcId,
          targetNodeId: tgtId,
          relation: relationType,
          context: rel.explanation || `${rel.source} connects to ${rel.target}`,
          timestamp: now,
          validFrom: now,
          validTo: null,
          status: "active",
          evidenceMessageIds: []
        });
      }
    }

    // Persist incrementally to Knowledge Graph
    if (nodes.length > 0 || edges.length > 0) {
      store.saveGraph(nodes, edges);
    }

    return { nodes, edges };
  }

  private static normalizeRelation(raw: string): RelationType {
    const upper = (raw || "").toUpperCase().replace(/[^A-Z_]/g, "_");
    if (["USES_TECH", "DECIDED_TO", "REJECTED", "SOLVED_BY", "PREFERS", "PART_OF_PROJECT", "SUPERSEDES", "FAILED_WITH"].includes(upper)) {
      return upper as RelationType;
    }
    if (upper.includes("REJECT") || upper.includes("AVOID") || upper.includes("FAIL")) return "REJECTED";
    if (upper.includes("SUPERSEDE") || upper.includes("REPLACE")) return "SUPERSEDES";
    if (upper.includes("SOLVE") || upper.includes("FIX")) return "SOLVED_BY";
    if (upper.includes("PART") || upper.includes("MEMBER") || upper.includes("HAS")) return "PART_OF_PROJECT";
    return "USES_TECH";
  }
}
