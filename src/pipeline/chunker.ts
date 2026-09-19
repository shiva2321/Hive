import { CanonicalConversation, CanonicalMessage } from "../core/types";

export interface ConversationChunk {
  chunkIndex: number;
  totalChunks: number;
  isChunked: boolean;
  conversationId: string;
  conversationTitle: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; timestamp: string }>;
  estimatedTokens: number;
  summaryHeader: string;
}

export class ConversationChunker {
  /**
   * Approximate token count calculation based on technical character density
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.6);
  }

  /**
   * Sanitizes message content to remove high-volume noise like base64 payloads
   * while strictly preserving authentic human prompts and assistant technical outputs.
   */
  public static cleanMessageContent(raw: string): string {
    if (!raw) return "";
    let text = raw;

    // 1. Strip base64 image blobs
    text = text.replace(/data:image\/[a-zA-Z0-9.+]+;base64,[A-Za-z0-9+/=]{50,}/g, "[Embedded Image Data]");

    // 2. Strip system-reminder tags
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "");

    // 3. Truncate excessively long single message blobs (e.g. huge minified outputs or core dumps > 6000 chars)
    if (text.length > 8000) {
      const head = text.slice(0, 4000);
      const tail = text.slice(-2000);
      text = `${head}\n\n[... ${text.length - 6000} characters of verbose execution logs truncated for LLM memory synthesis ...]\n\n${tail}`;
    }

    return text.trim();
  }

  /**
   * Evaluates conversation size and chunks large conversations with overlapping message windows.
   * Small or manageable conversations remain unchunked (1 single chunk) for complete conversational coherence.
   */
  public static chunkConversation(
    convo: CanonicalConversation,
    maxTokensPerChunk: number = 8000,
    overlapTurnCount: number = 1
  ): ConversationChunk[] {
    if (!convo.messages || convo.messages.length === 0) {
      return [];
    }

    // Clean messages
    const cleanedMessages: Array<{ role: "user" | "assistant" | "system"; content: string; timestamp: string }> = [];
    let totalTokens = 0;

    for (const msg of convo.messages) {
      const cleaned = this.cleanMessageContent(msg.content);
      if (!cleaned || cleaned.length < 5) continue;

      const role = (msg.role === "assistant" || msg.role === "user" || msg.role === "system")
        ? msg.role
        : "user";

      const tokens = this.estimateTokens(cleaned);
      totalTokens += tokens;

      cleanedMessages.push({
        role,
        content: cleaned,
        timestamp: msg.timestamp || convo.createdAt || new Date().toISOString()
      });
    }

    if (cleanedMessages.length === 0) {
      return [];
    }

    // Case 1: Manageable conversation -> Send whole (No chunks needed)
    if (totalTokens <= maxTokensPerChunk || cleanedMessages.length <= 6) {
      return [{
        chunkIndex: 1,
        totalChunks: 1,
        isChunked: false,
        conversationId: convo.id,
        conversationTitle: convo.title || "Untitled Conversation",
        messages: cleanedMessages,
        estimatedTokens: totalTokens,
        summaryHeader: `[Full Conversation: "${convo.title}"] [Total Turns: ${cleanedMessages.length}]`
      }];
    }

    // Case 2: Very big conversation -> Intelligently partition into overlapping windows
    const rawChunks: Array<typeof cleanedMessages> = [];
    let currentChunk: typeof cleanedMessages = [];
    let currentTokens = 0;

    for (let i = 0; i < cleanedMessages.length; i++) {
      const msg = cleanedMessages[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (currentTokens + msgTokens > maxTokensPerChunk && currentChunk.length >= 2) {
        rawChunks.push(currentChunk);

        // Include overlap from previous turn(s) for continuity
        const overlap: typeof cleanedMessages = [];
        const startIdx = Math.max(0, currentChunk.length - (overlapTurnCount * 2));
        for (let j = startIdx; j < currentChunk.length; j++) {
          overlap.push({
            role: currentChunk[j].role,
            content: `[Prior Context Overlap] ${currentChunk[j].content}`,
            timestamp: currentChunk[j].timestamp
          });
        }

        currentChunk = [...overlap, msg];
        currentTokens = overlap.reduce((acc, m) => acc + this.estimateTokens(m.content), 0) + msgTokens;
      } else {
        currentChunk.push(msg);
        currentTokens += msgTokens;
      }
    }

    if (currentChunk.length > 0) {
      rawChunks.push(currentChunk);
    }

    const totalChunks = rawChunks.length;
    return rawChunks.map((msgs, idx) => {
      const chunkTokens = msgs.reduce((acc, m) => acc + this.estimateTokens(m.content), 0);
      return {
        chunkIndex: idx + 1,
        totalChunks,
        isChunked: true,
        conversationId: convo.id,
        conversationTitle: convo.title || "Untitled Conversation",
        messages: msgs,
        estimatedTokens: chunkTokens,
        summaryHeader: `[Conversation: "${convo.title}"] [Chunk ${idx + 1} of ${totalChunks}] [Timeline: ${msgs[0]?.timestamp || "N/A"}]`
      };
    });
  }
}
