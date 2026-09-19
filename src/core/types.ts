export type AIProvider = 
  | "chatgpt" 
  | "claude" 
  | "gemini" 
  | "cursor" 
  | "antigravity" 
  | "perplexity"
  | "deepseek"
  | "grok"
  | "zed"
  | "opencode"
  | "jetbrains"
  | "vscode"
  | "generic";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface CodeSnippet {
  language: string;
  code: string;
}

export interface CanonicalMessage {
  id: string;
  role: MessageRole;
  timestamp: string; // ISO 8601
  content: string;
  codeSnippets: CodeSnippet[];
  tokenCountEst: number;
}

export interface CanonicalConversation {
  id: string;
  source: AIProvider;
  sourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: CanonicalMessage[];
  metadata?: Record<string, any>;
}

export interface SanitizationResult {
  cleanedText: string;
  redactedCount: number;
  redactedTypes: string[];
}

export interface FilterResult {
  isEphemeral: boolean;
  score: number; // 0.0 to 1.0 (substance score)
  reasons: string[];
}

// Knowledge Graph Types

export type EntityType = 
  | "Project"
  | "Language"
  | "Framework"
  | "Library"
  | "Database"
  | "ArchitecturePattern"
  | "UserPreference"
  | "Decision"
  | "NegativeKnowledge" // Rejected tool/pattern & reason
  | "RecurringBug";

export interface GraphNode {
  id: string;
  type: EntityType;
  name: string;
  summary: string;
  attributes: Record<string, any>;
  firstSeenAt: string;
  lastSeenAt: string;
  confidence: number; // 0.0 - 1.0
}

export type RelationType = 
  | "USES_TECH"
  | "DECIDED_TO"
  | "REJECTED"
  | "SOLVED_BY"
  | "PREFERS"
  | "PART_OF_PROJECT"
  | "SUPERSEDES"
  | "FAILED_WITH";

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: RelationType;
  context: string;
  timestamp: string;
  validFrom: string;
  validTo?: string | null;
  status: "active" | "superseded" | "deprecated";
  evidenceMessageIds: string[];
}

export interface ProjectCluster {
  id: string;
  name: string;
  description: string;
  confidence: number;
  conversationIds: string[];
  primaryTechStack: string[];
  keyDecisions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserInsight {
  id: string;
  category: "coding_style" | "tech_preference" | "blind_spot" | "workflow_habit";
  title: string;
  detail: string;
  evidenceCount: number;
  sampleEvidence: string[];
  createdAt: string;
}

export interface HiveInquiryOption {
  id: string;
  label: string;
  details?: string;
}

export interface HiveInquiry {
  id: string;
  projectId?: string;
  projectName?: string;
  category: "architecture_conflict" | "stack_ambiguity" | "deprecated_library" | "unclear_requirement";
  question: string;
  options: HiveInquiryOption[];
  context: string;
  status: "pending" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

