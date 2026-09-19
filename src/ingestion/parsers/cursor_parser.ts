import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import { CanonicalConversation, CanonicalMessage } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";
import { ChatGPTParser } from "./chatgpt_parser";

export class CursorParser {
  /**
   * Scans and parses Cursor plans and agent transcripts.
   */
  public static scanAndParse(): CanonicalConversation[] {
    const home = os.homedir();
    const cursorDir = path.join(home, ".cursor");
    const conversations: CanonicalConversation[] = [];

    if (fs.existsSync(cursorDir)) {
      // 1. Ingest Cursor Plans (~/.cursor/plans/*.plan.md)
      const plansDir = path.join(cursorDir, "plans");
      if (fs.existsSync(plansDir)) {
        try {
          const planFiles = fs.readdirSync(plansDir).filter(f => f.endsWith(".plan.md"));
          for (const file of planFiles) {
            const fullPath = path.join(plansDir, file);
            try {
              const rawContent = fs.readFileSync(fullPath, "utf-8");
              if (!rawContent.trim()) continue;

              const stat = fs.statSync(fullPath);
              const title = file
                .replace(/_[a-f0-9]{8}\.plan\.md$/, "")
                .replace(/\.plan\.md$/, "")
                .replace(/[-_]/g, " ");

              const sanitized = SecretSanitizer.sanitize(rawContent);
              const codeSnippets = ChatGPTParser.extractCodeSnippets(sanitized.cleanedText);
              const timestamp = stat.mtime.toISOString();

              const messages: CanonicalMessage[] = [
                {
                  id: `cursor_plan_${file}_req`,
                  role: "user",
                  timestamp,
                  content: `Cursor Architectural Implementation Plan: ${title}`,
                  codeSnippets: [],
                  tokenCountEst: 10
                },
                {
                  id: `cursor_plan_${file}_doc`,
                  role: "assistant",
                  timestamp,
                  content: sanitized.cleanedText,
                  codeSnippets,
                  tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
                }
              ];

              conversations.push({
                id: `cursor_plan_${file.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
                source: "cursor",
                sourceId: file,
                title: `Cursor Plan: ${title}`,
                createdAt: timestamp,
                updatedAt: timestamp,
                messages,
                metadata: {
                  tool: "cursor",
                  type: "plan",
                  fileName: file
                }
              });
            } catch {}
          }
        } catch (err: any) {
          console.error("Error scanning Cursor plans:", err.message);
        }
      }

      // 2. Ingest Cursor Agent Transcripts (~/.cursor/projects/*/agent-transcripts/*/*.jsonl)
      const projectsDir = path.join(cursorDir, "projects");
      if (fs.existsSync(projectsDir)) {
        try {
          const projectFolders = fs.readdirSync(projectsDir);
          for (const pFolder of projectFolders) {
            const transcriptsBase = path.join(projectsDir, pFolder, "agent-transcripts");
            if (!fs.existsSync(transcriptsBase)) continue;

            const sessionDirs = fs.readdirSync(transcriptsBase);
            const projectName = pFolder.replace(/^[a-z]-/, "").replace(/-/g, " ");

            for (const sDir of sessionDirs) {
              const sessionPath = path.join(transcriptsBase, sDir);
              if (!fs.statSync(sessionPath).isDirectory()) continue;

              const jsonlFile = path.join(sessionPath, `${sDir}.jsonl`);
              if (!fs.existsSync(jsonlFile)) continue;

              try {
                const lines = fs.readFileSync(jsonlFile, "utf-8").split("\n").filter(l => l.trim().length > 0);
                const messages: CanonicalMessage[] = [];
                let firstTime: string | null = null;
                let lastTime: string | null = null;
                let autoTitle = `Cursor Chat: ${projectName}`;

                lines.forEach((line, idx) => {
                  try {
                    const entry = JSON.parse(line);
                    const role = entry.role === "user" ? "user" : "assistant";
                    let text = "";

                    if (entry.message?.content && Array.isArray(entry.message.content)) {
                      text = entry.message.content
                        .filter((c: any) => c.type === "text" && c.text)
                        .map((c: any) => c.text)
                        .join("\n");
                    } else if (typeof entry.content === "string") {
                      text = entry.content;
                    }

                    if (text.trim()) {
                      const time = entry.timestamp || new Date().toISOString();
                      if (!firstTime) firstTime = time;
                      lastTime = time;

                      if (role === "user" && autoTitle === `Cursor Chat: ${projectName}` && text.length > 5) {
                        autoTitle = `${projectName}: ${text.substring(0, 40).replace(/\n/g, " ")}`;
                      }

                      const sanitized = SecretSanitizer.sanitize(text);
                      messages.push({
                        id: `cursor_${sDir}_${idx}`,
                        role,
                        timestamp: time,
                        content: sanitized.cleanedText,
                        codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
                        tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
                      });
                    }
                  } catch {}
                });

                if (messages.length >= 2) {
                  conversations.push({
                    id: `cursor_transcript_${sDir}`,
                    source: "cursor",
                    sourceId: sDir,
                    title: autoTitle,
                    createdAt: firstTime || new Date().toISOString(),
                    updatedAt: lastTime || firstTime || new Date().toISOString(),
                    messages,
                    metadata: {
                      tool: "cursor",
                      project: projectName,
                      sessionId: sDir
                    }
                  });
                }
              } catch {}
            }
          }
        } catch (err: any) {
          console.error("Error scanning Cursor transcripts:", err.message);
        }
      }
    }

    // 3. Ingest Cursor state.vscdb
    conversations.push(...this.scanStateDb());

    return conversations;
  }

  /**
   * Reads Cursor's composer/chat history directly from its SQLite state
   * store, where the bulk of real chat history actually lives — the
   * .plan.md and agent-transcripts/*.jsonl sources above only cover a
   * subset of what Cursor stores. The exact key and JSON shape are
   * undocumented and have changed across Cursor versions; see
   * scripts/inspect_cursor_state.js if this stops matching a future version.
   */
  public static scanStateDb(): CanonicalConversation[] {
    const stateDbPath = this.findStateDbPath();
    if (!stateDbPath || !fs.existsSync(stateDbPath)) return [];

    const conversations: CanonicalConversation[] = [];
    const seenIds = new Set<string>();
    const tmpCopy = path.join(os.tmpdir(), `cursor_state_scan_${Date.now()}.vscdb`);
    let db: Database.Database | undefined;

    try {
      fs.copyFileSync(stateDbPath, tmpCopy);
      db = new Database(tmpCopy, { readonly: true });

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t: any) => t.name as string);

      // Branch 1: Modern Cursor stores chat bubbles in cursorDiskKV
      if (tables.includes("cursorDiskKV")) {
        const composerRows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as Array<{ key: string; value: Buffer }>;
        const bubbleStmt = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");

        for (const cRow of composerRows) {
          try {
            const cData = JSON.parse(cRow.value.toString("utf-8"));
            const composerId = cData.composerId || cRow.key.replace("composerData:", "");
            const title = cData.name || (typeof cData.text === "string" && cData.text.trim() ? cData.text.trim().slice(0, 50) : "Cursor Composer Session");
            const createdAt = new Date(cData.createdAt || Date.now()).toISOString();
            const updatedAt = new Date(cData.lastUpdatedAt || cData.createdAt || Date.now()).toISOString();

            const messages: CanonicalMessage[] = [];

            // A: Extract bubbles referenced in fullConversationHeadersOnly
            if (Array.isArray(cData.fullConversationHeadersOnly) && cData.fullConversationHeadersOnly.length > 0) {
              for (let i = 0; i < cData.fullConversationHeadersOnly.length; i++) {
                const header = cData.fullConversationHeadersOnly[i];
                const bubbleKey = `bubbleId:${composerId}:${header.bubbleId}`;
                const bRow = bubbleStmt.get(bubbleKey) as { value: Buffer } | undefined;
                if (!bRow) continue;

                try {
                  const bData = JSON.parse(bRow.value.toString("utf-8"));
                  const role = (bData.type === 1 || bData.role === "user" || header.type === 1) ? "user" : "assistant";
                  let text = "";
                  if (typeof bData.text === "string" && bData.text.trim()) {
                    text = bData.text.trim();
                  } else if (bData.richText) {
                    text = this.extractTextFromRichText(bData.richText);
                  }

                  if (!text) continue;

                  const sanitized = SecretSanitizer.sanitize(text);
                  const ts = bData.createdAt ? new Date(bData.createdAt).toISOString() : createdAt;
                  messages.push({
                    id: `cursor_bubble_${composerId}_${header.bubbleId}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
                    role,
                    timestamp: ts,
                    content: sanitized.cleanedText,
                    codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
                    tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
                  });
                } catch {}
              }
            }

            // B: Fallback to inline conversation/messages if no bubbles found
            if (messages.length === 0) {
              const inlineTurns: any[] = Array.isArray(cData.conversation) ? cData.conversation
                : Array.isArray(cData.messages) ? cData.messages
                : [];

              for (let i = 0; i < inlineTurns.length; i++) {
                const turn = inlineTurns[i];
                const role = turn.role === "user" || turn.type === 1 ? "user" : "assistant";
                const text = typeof turn.text === "string" ? turn.text
                  : typeof turn.content === "string" ? turn.content
                  : typeof turn.richText === "string" ? turn.richText
                  : "";
                if (!text.trim()) continue;

                const sanitized = SecretSanitizer.sanitize(text);
                messages.push({
                  id: `cursor_inline_${composerId}_${i}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
                  role,
                  timestamp: new Date(turn.timestamp || createdAt).toISOString(),
                  content: sanitized.cleanedText,
                  codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
                  tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
                });
              }
            }

            if (messages.length >= 2) {
              const safeId = `cursor_state_composer_${composerId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
              if (!seenIds.has(safeId)) {
                seenIds.add(safeId);
                conversations.push({
                  id: safeId,
                  source: "cursor",
                  sourceId: composerId,
                  title: `Cursor: ${title}`,
                  createdAt: messages[0].timestamp || createdAt,
                  updatedAt: messages[messages.length - 1].timestamp || updatedAt,
                  messages,
                  metadata: { tool: "cursor", composerId, extractedFrom: "state.vscdb:cursorDiskKV" }
                });
              }
            }
          } catch {}
        }
      }

      // Branch 2: Older Cursor versions store conversation items in ItemTable
      if (tables.includes("ItemTable")) {
        const itemRows = db.prepare(`
          SELECT key, value FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%aichat%'
        `).all() as Array<{ key: string; value: Buffer }>;

        for (const row of itemRows) {
          try {
            const parsed = JSON.parse(row.value.toString("utf-8"));
            const extracted = this.extractConversationsFromComposerValue(parsed, row.key);
            for (const convo of extracted) {
              if (!seenIds.has(convo.id)) {
                seenIds.add(convo.id);
                conversations.push(convo);
              }
            }
          } catch {
            // This key's value wasn't JSON we recognize — skip rather than crash.
          }
        }
      }
    } catch (err: any) {
      console.error("Error scanning Cursor state.vscdb:", err.message);
    } finally {
      if (db) db.close();
      if (fs.existsSync(tmpCopy)) fs.unlinkSync(tmpCopy);
    }

    return conversations;
  }

  private static findStateDbPath(): string | null {
    const home = os.homedir();
    const candidates = [
      path.join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb"),
      path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
      path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb")
    ];
    return candidates.find(p => fs.existsSync(p)) || null;
  }

  private static extractTextFromRichText(richText: any): string {
    if (!richText) return "";
    try {
      const parsed = typeof richText === "string" ? JSON.parse(richText) : richText;
      const texts: string[] = [];
      const walk = (node: any) => {
        if (!node) return;
        if (node.text && typeof node.text === "string") texts.push(node.text);
        if (Array.isArray(node.children)) {
          for (const child of node.children) walk(child);
        }
      };
      walk(parsed.root || parsed);
      return texts.join(" ").trim();
    } catch {
      return typeof richText === "string" ? richText.trim() : "";
    }
  }

  private static extractConversationsFromComposerValue(parsed: any, sourceKey: string): CanonicalConversation[] {
    const rawTurns: any[] = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.conversation) ? parsed.conversation
      : Array.isArray(parsed?.messages) ? parsed.messages
      : [];

    if (rawTurns.length === 0) return [];

    const messages: CanonicalMessage[] = [];
    for (let i = 0; i < rawTurns.length; i++) {
      const turn = rawTurns[i];
      const role = turn.role === "user" || turn.type === 1 ? "user" : "assistant";
      const text = typeof turn.text === "string" ? turn.text
        : typeof turn.content === "string" ? turn.content
        : typeof turn.richText === "string" ? turn.richText
        : "";
      if (!text.trim()) continue;

      const sanitized = SecretSanitizer.sanitize(text);
      messages.push({
        id: `cursor_state_${sourceKey}_${i}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
        role,
        timestamp: new Date(turn.timestamp || Date.now()).toISOString(),
        content: sanitized.cleanedText,
        codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
        tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
      });
    }

    if (messages.length < 2) return [];

    const firstUser = messages.find(m => m.role === "user");
    const title = firstUser ? `Cursor: ${firstUser.content.slice(0, 50)}` : "Cursor Composer Session";

    return [{
      id: `cursor_state_${sourceKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      source: "cursor",
      sourceId: sourceKey,
      title,
      createdAt: messages[0].timestamp,
      updatedAt: messages[messages.length - 1].timestamp,
      messages,
      metadata: { tool: "cursor", sourceKey, extractedFrom: "state.vscdb" }
    }];
  }
}
