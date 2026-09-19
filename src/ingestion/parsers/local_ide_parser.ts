import path from "path";
import { CanonicalConversation, CanonicalMessage, MessageRole } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";
import { ChatGPTParser } from "./chatgpt_parser";

export class LocalIDEParser {
  /**
   * Parses JSONL transcript files produced by agents (Claude Code, Antigravity, etc.)
   */
  public static parseJsonlTranscript(fileContent: string, conversationId: string): CanonicalConversation | null {
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return null;

    const messages: CanonicalMessage[] = [];
    let firstTime: string | null = null;
    let lastTime: string | null = null;
    let autoTitle = "Local Agent Session";
    let detectedWorkspace: string | null = null;
    let detectedProject: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        const time = entry.created_at || entry.timestamp || new Date().toISOString();
        if (!firstTime) firstTime = time;
        lastTime = time;

        let role: MessageRole | null = null;
        let text = "";

        if (entry.type === "USER_INPUT" || entry.role === "user") {
          role = "user";
          const rawText = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content || "");

          // Detect active workspace or open documents
          if (!detectedWorkspace) {
            const wsMatch = rawText.match(/active workspaces[^:]*:\s*\[([^\]]+)\]/i);
            const docMatch = rawText.match(/Active Document:\s*([^\r\n]+)/i);
            if (wsMatch) {
              detectedWorkspace = wsMatch[1].trim();
            } else if (docMatch) {
              const docPath = docMatch[1].trim();
              detectedWorkspace = path.dirname(docPath);
            }

            if (detectedWorkspace) {
              detectedProject = this.resolveProjectFromPath(detectedWorkspace);
            }
          }

          // Extract human prompt without system XML envelopes
          let userPrompt = rawText;
          const reqMatch = rawText.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
          if (reqMatch) {
            userPrompt = reqMatch[1].trim();
          } else {
            userPrompt = userPrompt.split(/<ADDITIONAL_METADATA>/i)[0].trim();
          }

          if (autoTitle === "Local Agent Session" && userPrompt.trim()) {
            const cleanedPrompt = userPrompt
              .replace(/^#+\s*/g, "")
              .replace(/^[*\-+]\s*/g, "")
              .replace(/["'`]/g, "")
              .replace(/\s+/g, " ")
              .trim();
            if (cleanedPrompt.length > 5) {
              autoTitle = cleanedPrompt.substring(0, 60);
            }
          }

          text = userPrompt;
        } else if (entry.type === "PLANNER_RESPONSE" || entry.role === "assistant") {
          role = "assistant";
          text = typeof entry.content === "string" ? entry.content : (entry.thinking || "");
        }

        if (role && text.trim()) {
          const sanitized = SecretSanitizer.sanitize(text);
          messages.push({
            id: `ide_${conversationId}_${i}`,
            role,
            timestamp: time,
            content: sanitized.cleanedText,
            codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
            tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
          });
        }
      } catch (err) {
        // skip malformed line
      }
    }

    if (messages.length === 0) return null;

    if (detectedProject && autoTitle !== "Local Agent Session") {
      autoTitle = `${detectedProject}: ${autoTitle}`;
    }

    return {
      id: `ide_${conversationId}`,
      source: "antigravity",
      sourceId: conversationId,
      title: autoTitle,
      createdAt: firstTime || new Date().toISOString(),
      updatedAt: lastTime || firstTime || new Date().toISOString(),
      messages,
      metadata: {
        tool: "antigravity",
        workspace: detectedWorkspace || undefined,
        project: detectedProject || undefined
      }
    };
  }

  public static resolveProjectFromPath(fullPath: string): string {
    const normalized = fullPath.replace(/\\/g, "/").toLowerCase();
    if (normalized.includes("nsck")) return "NSCK Neuro-Symbolic Cognitive Engine";
    if (normalized.includes("financial_data") || normalized.includes("financial-data")) return "Financial Data Analysis System";
    if (normalized.includes("wavelearn") || normalized.includes("phasor") || normalized.includes("cvnn")) return "Phasor & Wave AI Research";
    if (normalized.includes("universal-ai-memory")) return "Universal AI Memory System";
    if (normalized.includes("omnipdf")) return "OmniPDF Document Studio";
    if (normalized.includes("winterm") || normalized.includes("agent_toolkit")) return "WinTerm Agent Desktop Toolkit";
    if (normalized.includes("saptarshi")) return "Project Saptarshi Resonance Engine";
    if (normalized.includes("prime_research")) return "Prime Hyperspace Research";
    if (normalized.includes("resonance")) return "Resonance-X Architecture";
    if (normalized.includes("assembly_toolkit")) return "x86_64 Assembly Toolkit";
    if (normalized.includes("tiretrack")) return "TireTrack System Engine";
    if (normalized.includes("anime-shorts")) return "Anime Shorts Generator";

    // Fallback to base directory name
    const base = path.basename(fullPath.replace(/\\/g, "/"));
    return base ? base.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Software Engineering Workspace";
  }
}
