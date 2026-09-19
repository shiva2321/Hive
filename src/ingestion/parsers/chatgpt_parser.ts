import { CanonicalConversation, CanonicalMessage, CodeSnippet, MessageRole } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";

export class ChatGPTParser {
  /**
   * Parses the raw JSON array from ChatGPT's conversations.json
   */
  public static parse(rawData: string | any[]): CanonicalConversation[] {
    const rawConversations: any[] = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    if (!Array.isArray(rawConversations)) {
      throw new Error("Invalid ChatGPT export: Expected an array of conversations.");
    }

    const conversations: CanonicalConversation[] = [];

    for (const raw of rawConversations) {
      if (!raw || !raw.mapping) continue;

      const title = raw.title || "Untitled Conversation";
      const sourceId = raw.id || raw.conversation_id || `chatgpt_${Date.now()}`;
      const createdAt = raw.create_time 
        ? new Date(raw.create_time * 1000).toISOString() 
        : new Date().toISOString();
      const updatedAt = raw.update_time 
        ? new Date(raw.update_time * 1000).toISOString() 
        : createdAt;

      const messages: CanonicalMessage[] = [];
      const mapping = raw.mapping;

      // Extract all valid messages from mapping
      for (const nodeId of Object.keys(mapping)) {
        const node = mapping[nodeId];
        if (!node || !node.message) continue;

        const msgObj = node.message;
        const authorRole = msgObj.author?.role as MessageRole;
        if (!authorRole || authorRole === "system") continue; // skip pure system instructions

        // Extract content parts
        let rawText = "";
        if (msgObj.content && Array.isArray(msgObj.content.parts)) {
          rawText = msgObj.content.parts
            .filter((p: any) => typeof p === "string")
            .join("\n");
        } else if (typeof msgObj.content?.text === "string") {
          rawText = msgObj.content.text;
        }

        if (!rawText.trim()) continue;

        // Sanitize
        const sanitized = SecretSanitizer.sanitize(rawText);

        // Extract code snippets
        const codeSnippets = this.extractCodeSnippets(sanitized.cleanedText);

        const msgTimestamp = msgObj.create_time 
          ? new Date(msgObj.create_time * 1000).toISOString() 
          : createdAt;

        messages.push({
          id: msgObj.id || nodeId,
          role: authorRole === "user" ? "user" : "assistant",
          timestamp: msgTimestamp,
          content: sanitized.cleanedText,
          codeSnippets,
          tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
        });
      }

      // Sort messages chronologically
      messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (messages.length > 0) {
        conversations.push({
          id: `chatgpt_${sourceId}`,
          source: "chatgpt",
          sourceId,
          title,
          createdAt,
          updatedAt,
          messages
        });
      }
    }

    return conversations;
  }

  public static extractCodeSnippets(text: string): CodeSnippet[] {
    const snippets: CodeSnippet[] = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const language = (match[1] || "text").toLowerCase().trim();
      const code = match[2].trim();
      if (code) {
        snippets.push({ language, code });
      }
    }

    return snippets;
  }
}
