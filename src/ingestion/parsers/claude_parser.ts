import { CanonicalConversation, CanonicalMessage, MessageRole } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";
import { ChatGPTParser } from "./chatgpt_parser";

export class ClaudeParser {
  /**
   * Parses the raw JSON array from Claude's conversations.json or Hive Extension archives.
   */
  public static parse(rawData: string | any[]): CanonicalConversation[] {
    const rawConversations: any[] = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    if (!Array.isArray(rawConversations)) {
      throw new Error("Invalid Claude export: Expected an array of conversations.");
    }

    const conversations: CanonicalConversation[] = [];

    for (const raw of rawConversations) {
      if (!raw) continue;

      const sourceId = raw.sourceId || raw.uuid || raw.id || `claude_${Date.now()}`;
      const title = raw.title || raw.name || "Untitled Claude Chat";
      const createdAt = raw.createdAt || raw.created_at || new Date().toISOString();
      const updatedAt = raw.updatedAt || raw.updated_at || createdAt;

      const rawMessages: any[] = raw.messages || raw.chat_messages || [];
      const messages: CanonicalMessage[] = [];

      for (const msg of rawMessages) {
        let role: MessageRole = "user";
        if (msg.role === "assistant" || msg.sender === "assistant") {
          role = "assistant";
        } else if (msg.role === "system" || msg.sender === "system") {
          role = "system";
        }

        const rawText = msg.content || msg.text || "";
        if (!rawText.trim()) continue;

        // Sanitize credentials & PII
        const sanitized = SecretSanitizer.sanitize(rawText);
        const codeSnippets = Array.isArray(msg.codeSnippets) && msg.codeSnippets.length > 0
          ? msg.codeSnippets
          : ChatGPTParser.extractCodeSnippets(sanitized.cleanedText);
        
        const timestamp = msg.timestamp || msg.created_at || createdAt;

        messages.push({
          id: msg.id || msg.uuid || `msg_${messages.length}`,
          role,
          timestamp,
          content: sanitized.cleanedText,
          codeSnippets,
          tokenCountEst: msg.tokenCountEst || Math.ceil(sanitized.cleanedText.length / 4)
        });
      }

      // Sort messages chronologically
      messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (messages.length > 0) {
        const id = raw.id 
          ? (raw.id.startsWith("claude_") ? raw.id : `claude_${raw.id}`) 
          : `claude_${sourceId}`;

        conversations.push({
          id,
          source: "claude",
          sourceId,
          title,
          createdAt,
          updatedAt,
          messages,
          metadata: raw.metadata || { sourceFormat: "claude_export" }
        });
      }
    }

    return conversations;
  }
}
