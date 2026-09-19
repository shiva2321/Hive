import { CanonicalConversation, CanonicalMessage } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";
import { ChatGPTParser } from "./chatgpt_parser";

export class GeminiParser {
  /**
   * Parses Google Takeout Gemini exports or Gemini web activity JSON.
   */
  public static parse(rawData: string | any[]): CanonicalConversation[] {
    const data: any = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    const conversations: CanonicalConversation[] = [];

    // Format A: Standard multi-turn conversation list
    if (Array.isArray(data) && data.length > 0 && (data[0].turns || data[0].messages)) {
      for (const item of data) {
        const sourceId = item.id || `gemini_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const title = item.title || "Gemini Conversation";
        const createdAt = item.createdAt || item.created_time || new Date().toISOString();
        const messages: CanonicalMessage[] = [];

        const turns = item.turns || item.messages || [];
        for (const turn of turns) {
          if (turn.query || turn.user) {
            const userText = turn.query || turn.user;
            const sanitized = SecretSanitizer.sanitize(userText);
            messages.push({
              id: `${sourceId}_u_${messages.length}`,
              role: "user",
              timestamp: turn.timestamp || createdAt,
              content: sanitized.cleanedText,
              codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
              tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
            });
          }
          if (turn.response || turn.model || turn.assistant) {
            const respText = turn.response || turn.model || turn.assistant;
            const sanitized = SecretSanitizer.sanitize(respText);
            messages.push({
              id: `${sourceId}_a_${messages.length}`,
              role: "assistant",
              timestamp: turn.timestamp || createdAt,
              content: sanitized.cleanedText,
              codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
              tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
            });
          }
        }

        if (messages.length > 0) {
          conversations.push({
            id: `gemini_${sourceId}`,
            source: "gemini",
            sourceId,
            title,
            createdAt,
            updatedAt: createdAt,
            messages
          });
        }
      }
      return conversations;
    }

    // Format B: Google Takeout MyActivity.json format (activity array)
    if (Array.isArray(data)) {
      // Group takeout items by date / hour to form cohesive conversations
      let currentConvo: CanonicalConversation | null = null;
      let lastTime = 0;

      for (const entry of data) {
        const entryTimeStr = entry.time || new Date().toISOString();
        const entryTime = new Date(entryTimeStr).getTime();
        const text = entry.title || entry.description || "";
        if (!text) continue;

        // Group into a new conversation if gap > 2 hours
        if (!currentConvo || Math.abs(entryTime - lastTime) > 2 * 60 * 60 * 1000) {
          if (currentConvo && currentConvo.messages.length > 0) {
            conversations.push(currentConvo);
          }
          const sourceId = `gemini_takeout_${entryTime}`;
          currentConvo = {
            id: sourceId,
            source: "gemini",
            sourceId,
            title: text.length > 40 ? text.substring(0, 40) + "..." : text,
            createdAt: entryTimeStr,
            updatedAt: entryTimeStr,
            messages: []
          };
        }

        lastTime = entryTime;
        const sanitized = SecretSanitizer.sanitize(text);

        currentConvo.messages.push({
          id: `gemini_msg_${entryTime}_${currentConvo.messages.length}`,
          role: "user",
          timestamp: entryTimeStr,
          content: sanitized.cleanedText,
          codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
          tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
        });
      }

      if (currentConvo && currentConvo.messages.length > 0) {
        conversations.push(currentConvo);
      }
    }

    return conversations;
  }
}
