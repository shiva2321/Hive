import fs from "fs";
import path from "path";
import os from "os";
import { CanonicalConversation, CanonicalMessage, CodeSnippet } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";
import { ChatGPTParser } from "./chatgpt_parser";

export class ClaudeCodeParser {
  /**
   * Ingests Claude Code session transcripts (.jsonl), project memory directories, and history.jsonl.
   */
  public static scanAndParse(): CanonicalConversation[] {
    const home = os.homedir();
    const claudeDir = path.join(home, ".claude");
    if (!fs.existsSync(claudeDir)) return [];

    const conversations: CanonicalConversation[] = [];
    const projectsDir = path.join(claudeDir, "projects");

    if (fs.existsSync(projectsDir)) {
      try {
        const projectFolders = fs.readdirSync(projectsDir);

        for (const folder of projectFolders) {
          const folderPath = path.join(projectsDir, folder);
          const projectName = folder
            .replace(/^[A-Z]--/, "")
            .replace(/--/g, "/")
            .replace(/-/g, " ");

          // 1. Parse Full Interactive Session Files (<uuid>.jsonl)
          try {
            const files = fs.readdirSync(folderPath).filter(f => f.endsWith(".jsonl"));
            for (const f of files) {
              const fullPath = path.join(folderPath, f);
              try {
                const sessionConvo = this.parseSessionFile(fullPath, folder, projectName);
                if (sessionConvo && sessionConvo.messages.length >= 2) {
                  conversations.push(sessionConvo);
                }
              } catch (err: any) {
                // Ignore corrupt individual session
              }
            }
          } catch {}

          // 2. Parse Project Memory Markdown Files (~/.claude/projects/*/memory/*.md)
          const memoryDir = path.join(folderPath, "memory");
          if (fs.existsSync(memoryDir)) {
            try {
              const mdFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith(".md"));
              if (mdFiles.length > 0) {
                const messages: CanonicalMessage[] = [];

                for (const mdFile of mdFiles) {
                  const fullPath = path.join(memoryDir, mdFile);
                  try {
                    const stat = fs.statSync(fullPath);
                    const rawText = fs.readFileSync(fullPath, "utf-8");
                    if (!rawText.trim()) continue;

                    const fileTitle = mdFile.replace(/\.md$/, "").replace(/[-_]/g, " ");
                    const sanitized = SecretSanitizer.sanitize(rawText);
                    const codeSnippets = ChatGPTParser.extractCodeSnippets(sanitized.cleanedText);
                    const fileTime = stat.mtime.toISOString();

                    // User query context
                    messages.push({
                      id: `cc_mem_${folder}_${mdFile}_req`,
                      role: "user",
                      timestamp: fileTime,
                      content: `Claude Code Project Memory Document: ${fileTitle}`,
                      codeSnippets: [],
                      tokenCountEst: 10
                    });

                    // Assistant decision context
                    messages.push({
                      id: `cc_mem_${folder}_${mdFile}_doc`,
                      role: "assistant",
                      timestamp: fileTime,
                      content: sanitized.cleanedText,
                      codeSnippets,
                      tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
                    });
                  } catch {}
                }

                if (messages.length > 0) {
                  conversations.push({
                    id: `claude_code_proj_mem_${folder}`,
                    source: "claude",
                    sourceId: folder,
                    title: `Claude Code Memory: ${projectName}`,
                    createdAt: messages[0].timestamp,
                    updatedAt: messages[messages.length - 1].timestamp,
                    messages,
                    metadata: {
                      tool: "claude-code",
                      projectFolder: folder,
                      type: "project_memory"
                    }
                  });
                }
              }
            } catch {}
          }
        }
      } catch (err: any) {
        console.error("Error scanning Claude Code projects:", err.message);
      }
    }

    // 3. Parse history.jsonl grouped by project for supplementary context
    const historyPath = path.join(claudeDir, "history.jsonl");
    if (fs.existsSync(historyPath)) {
      try {
        const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(l => l.trim().length > 0);
        const groupedByProject = new Map<string, Array<{ text: string; time: number; sessionId: string }>>();

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const prompt = entry.display || "";
            if (!prompt || prompt.length < 5) continue;

            const proj = entry.project || "General CLI";
            const time = entry.timestamp || Date.now();
            const sid = entry.sessionId || "default_session";

            if (!groupedByProject.has(proj)) {
              groupedByProject.set(proj, []);
            }
            groupedByProject.get(proj)!.push({ text: prompt, time, sessionId: sid });
          } catch {}
        }

        for (const [projPath, entries] of groupedByProject.entries()) {
          const baseProjName = path.basename(projPath) || "Claude Code Workstream";
          const messages: CanonicalMessage[] = [];

          entries.forEach((e, idx) => {
            const sanitized = SecretSanitizer.sanitize(e.text);
            const timeStr = new Date(e.time).toISOString();
            messages.push({
              id: `cc_hist_${idx}_${e.sessionId}`,
              role: "user",
              timestamp: timeStr,
              content: sanitized.cleanedText,
              codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
              tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
            });
          });

          if (messages.length >= 2) {
            conversations.push({
              id: `claude_code_hist_${baseProjName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
              source: "claude",
              sourceId: projPath,
              title: `Claude Code Prompts: ${baseProjName}`,
              createdAt: messages[0].timestamp,
              updatedAt: messages[messages.length - 1].timestamp,
              messages,
              metadata: {
                tool: "claude-code",
                sourcePath: projPath,
                type: "cli_history"
              }
            });
          }
        }
      } catch (err: any) {
        console.error("Error scanning Claude Code history:", err.message);
      }
    }

    return conversations;
  }

  /**
   * Parses an individual session JSONL file into a structured CanonicalConversation.
   */
  public static parseSessionFile(filePath: string, folder: string, projectName: string): CanonicalConversation | null {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const lines = rawContent.split("\n");
    const sessionId = path.basename(filePath, ".jsonl");
    const messages: CanonicalMessage[] = [];

    let currentRole: "user" | "assistant" | null = null;
    let currentTimestamp = new Date().toISOString();
    let textParts: string[] = [];
    let toolActions: Array<{ tool: string; detail: string }> = [];
    let codeSnippets: CodeSnippet[] = [];
    const modifiedFiles = new Set<string>();

    const flushCurrentTurn = () => {
      if (!currentRole) return;
      const combinedText = textParts.join("\n\n").trim();
      if (combinedText || toolActions.length > 0) {
        let finalContent = combinedText;
        if (toolActions.length > 0) {
          const actionSummary = toolActions.map(a => `• **${a.tool}**: \`${a.detail}\``).join("\n");
          finalContent = finalContent
            ? `${finalContent}\n\n**Actions Executed:**\n${actionSummary}`
            : `**Actions Executed:**\n${actionSummary}`;
        }

        const sanitized = SecretSanitizer.sanitize(finalContent);
        const extractedCodes = ChatGPTParser.extractCodeSnippets(sanitized.cleanedText);
        const allSnippets = [...codeSnippets, ...extractedCodes];

        messages.push({
          id: `cc_${sessionId}_msg_${messages.length}`,
          role: currentRole,
          timestamp: currentTimestamp,
          content: sanitized.cleanedText,
          codeSnippets: allSnippets,
          tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
        });
      }

      currentRole = null;
      textParts = [];
      toolActions = [];
      codeSnippets = [];
    };

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const ts = entry.timestamp || (entry.message && entry.message.timestamp) || currentTimestamp;

        // User Message
        if (entry.type === "user" && entry.message && typeof entry.message.content === "string") {
          const prompt = entry.message.content.trim();
          if (!prompt) continue;

          flushCurrentTurn();
          currentRole = "user";
          currentTimestamp = ts;
          textParts.push(prompt);
          flushCurrentTurn();
        }
        // Assistant Message
        else if (entry.type === "assistant" && entry.message && Array.isArray(entry.message.content)) {
          if (currentRole !== "assistant") {
            flushCurrentTurn();
            currentRole = "assistant";
            currentTimestamp = ts;
          }

          for (const blk of entry.message.content) {
            if (blk.type === "text" && blk.text && blk.text.trim()) {
              textParts.push(blk.text.trim());
            } else if (blk.type === "tool_use") {
              const inp = blk.input || {};
              let detail = "";
              if (inp.command) {
                detail = inp.command.length > 120 ? inp.command.slice(0, 120) + "..." : inp.command;
              } else if (inp.file_path || inp.path || inp.targetFile) {
                const target = inp.file_path || inp.path || inp.targetFile;
                detail = target;
                modifiedFiles.add(target);
              } else if (inp.query) {
                detail = inp.query;
              } else if (inp.pattern) {
                detail = inp.pattern;
              } else {
                detail = Object.keys(inp).slice(0, 3).join(", ");
              }

              toolActions.push({ tool: blk.name, detail });

              if (blk.name === "Write" && inp.content) {
                const lang = path.extname(inp.file_path || "").replace(/^\./, "") || "text";
                codeSnippets.push({ language: lang, code: inp.content.slice(0, 1000) });
              }
            }
          }
        }
      } catch (e) {}
    }

    flushCurrentTurn();

    if (messages.length < 2) return null;

    const firstUserMsg = messages.find(m => m.role === "user");
    let titleDetail = firstUserMsg 
      ? firstUserMsg.content.slice(0, 65).replace(/\n/g, " ").trim() 
      : "Interactive Engineering Session";
    if (titleDetail.length === 65) titleDetail += "...";

    return {
      id: `claude_code_session_${sessionId}`,
      source: "claude",
      sourceId: sessionId,
      title: `Claude Code: ${projectName} — ${titleDetail}`,
      createdAt: messages[0].timestamp,
      updatedAt: messages[messages.length - 1].timestamp,
      messages,
      metadata: {
        tool: "claude-code",
        projectFolder: folder,
        sessionId,
        modifiedFiles: Array.from(modifiedFiles),
        toolActionCount: toolActions.length
      }
    };
  }
}
