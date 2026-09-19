import { CanonicalConversation, FilterResult } from "../core/types";

export class ConversationFilter {
  // Common ephemeral indicators
  private static EPHEMERAL_KEYWORDS = [
    "translate to",
    "fix this typo",
    "proofread this",
    "check my grammar",
    "convert this currency",
    "joke",
    "riddle",
    "weather today"
  ];

  // High substance indicators
  private static SUBSTANCE_KEYWORDS = [
    "architecture", "refactor", "bug", "error", "stack trace",
    "database", "schema", "api", "docker", "deploy", "migration",
    "auth", "jwt", "test", "benchmark", "design pattern", "framework",
    "library", "react", "node", "python", "sql", "performance", "decision"
  ];

  /**
   * Assesses whether a conversation represents persistent, valuable knowledge or ephemeral noise.
   */
  public static evaluate(conversation: CanonicalConversation): FilterResult {
    const reasons: string[] = [];
    let score = 0.5; // neutral starting point

    const totalMessages = conversation.messages.length;
    const totalCodeBlocks = conversation.messages.reduce((acc, m) => acc + m.codeSnippets.length, 0);
    const fullText = conversation.messages.map(m => m.content).join(" ").toLowerCase();

    // Factor 1: Message count / Turn depth
    if (totalMessages <= 1) {
      score -= 0.35;
      reasons.push("Only 1 message in thread");
    } else if (totalMessages >= 4) {
      score += 0.2;
      reasons.push("Deep multi-turn conversation");
    }

    // Factor 2: Code content presence
    if (totalCodeBlocks > 0) {
      score += Math.min(0.3, totalCodeBlocks * 0.1);
      reasons.push(`Contains ${totalCodeBlocks} code blocks`);
    }

    // Factor 3: High value technical keywords
    let techHits = 0;
    for (const kw of this.SUBSTANCE_KEYWORDS) {
      if (fullText.includes(kw)) {
        techHits++;
      }
    }
    if (techHits >= 3) {
      score += 0.25;
      reasons.push(`High density of engineering topics (${techHits} topics detected)`);
    }

    // Factor 4: Ephemeral keywords
    for (const kw of this.EPHEMERAL_KEYWORDS) {
      if (fullText.includes(kw) && totalMessages <= 2) {
        score -= 0.3;
        reasons.push(`Matched ephemeral pattern: "${kw}"`);
        break;
      }
    }

    // Clamp score to [0, 1]
    const finalScore = Math.max(0, Math.min(1, score));
    const isEphemeral = finalScore < 0.35;

    return {
      isEphemeral,
      score: finalScore,
      reasons
    };
  }
}
