import fs from "fs";
import path from "path";
import os from "os";
import { CanonicalConversation, CanonicalMessage } from "../core/types";
import { LocalIDEParser } from "./parsers/local_ide_parser";
import { ClaudeCodeParser } from "./parsers/claude_code_parser";
import { CursorParser } from "./parsers/cursor_parser";
import { SecretSanitizer } from "./sanitizer";
import { ChatGPTParser } from "./parsers/chatgpt_parser";

export interface OmniScanResult {
  totalFound: number;
  byTool: {
    antigravity: number;
    claudeCode: number;
    cursor: number;
    gemini: number;
  };
  conversations: CanonicalConversation[];
}

export class OmniScanner {
  /**
   * Scans all local AI coding tools, agents, IDEs, and transcripts on the Windows system.
   */
  public static scanAll(): OmniScanResult {
    const userHome = os.homedir();
    const conversations: CanonicalConversation[] = [];
    const counts = {
      antigravity: 0,
      claudeCode: 0,
      cursor: 0,
      gemini: 0
    };

    // 1. Antigravity & Antigravity IDE Transcripts + Brain Notes
    const antigravityRoots = [
      path.join(userHome, ".gemini", "antigravity", "brain"),
      path.join(userHome, ".gemini", "antigravity-ide", "brain")
    ];

    for (const bDir of antigravityRoots) {
      if (fs.existsSync(bDir)) {
        try {
          const dirs = fs.readdirSync(bDir);
          for (const dir of dirs) {
            const sessionDir = path.join(bDir, dir);
            if (!fs.statSync(sessionDir).isDirectory()) continue;

            // Format A: transcript.jsonl under .system_generated/logs/
            const transcriptPath = path.join(sessionDir, ".system_generated", "logs", "transcript.jsonl");
            if (fs.existsSync(transcriptPath)) {
              try {
                const content = fs.readFileSync(transcriptPath, "utf-8");
                const parsed = LocalIDEParser.parseJsonlTranscript(content, dir);
                if (parsed && parsed.messages.length >= 2) {
                  conversations.push(parsed);
                  counts.antigravity++;
                }
              } catch {}
            }

            // Format B: standalone .md brain notes directly in the session folder
            try {
              const mdFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith(".md"));
              for (const mdFile of mdFiles) {
                try {
                  const mdPath = path.join(sessionDir, mdFile);
                  const rawText = fs.readFileSync(mdPath, "utf-8");
                  if (!rawText.trim()) continue;

                  const stat = fs.statSync(mdPath);
                  const fileTitle = mdFile.replace(/\.md$/, "").replace(/[-_]/g, " ");
                  const timestamp = stat.mtime.toISOString();
                  const sanitized = SecretSanitizer.sanitize(rawText);
                  const safeId = `antigravity_brain_${dir}_${mdFile}`.replace(/[^a-zA-Z0-9_-]/g, "_");

                  const noteConvo: CanonicalConversation = {
                    id: safeId,
                    source: "antigravity",
                    sourceId: `${dir}/${mdFile}`,
                    title: `Antigravity Brain Note: ${fileTitle}`,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    messages: [
                      {
                        id: `${safeId}_req`,
                        role: "user",
                        timestamp,
                        content: `Antigravity Brain Note: ${fileTitle}`,
                        codeSnippets: [],
                        tokenCountEst: 10
                      },
                      {
                        id: `${safeId}_doc`,
                        role: "assistant",
                        timestamp,
                        content: sanitized.cleanedText,
                        codeSnippets: ChatGPTParser.extractCodeSnippets(sanitized.cleanedText),
                        tokenCountEst: Math.ceil(sanitized.cleanedText.length / 4)
                      }
                    ],
                    metadata: { tool: "antigravity", type: "brain_note", sessionId: dir, fileName: mdFile }
                  };

                  conversations.push(noteConvo);
                  counts.antigravity++;
                } catch {}
              }
            } catch {}
          }
        } catch {}
      }
    }

    // 2. Claude Code (Memory Files + Command History)
    try {
      const claudeConvos = ClaudeCodeParser.scanAndParse();
      conversations.push(...claudeConvos);
      counts.claudeCode += claudeConvos.length;
    } catch (err: any) {
      console.error("Error running Claude Code scanner:", err.message);
    }

    // 3. Cursor IDE (Implementation Plans + Agent Transcripts)
    try {
      const cursorConvos = CursorParser.scanAndParse();
      conversations.push(...cursorConvos);
      counts.cursor += cursorConvos.length;
    } catch (err: any) {
      console.error("Error running Cursor scanner:", err.message);
    }

    // 4. Downloaded Claude / Hive Chat Archives in ~/Downloads
    try {
      const downloadsDir = path.join(userHome, "Downloads");
      if (fs.existsSync(downloadsDir)) {
        const downloadFiles = fs.readdirSync(downloadsDir);
        for (const f of downloadFiles) {
          if (f.startsWith("hive_claude_") || f.includes("claude_archive") || f.includes("claude_chats")) {
            const fullPath = path.join(downloadsDir, f);
            try {
              if (f.endsWith(".zip")) {
                const { UniversalImporter } = require("./importer");
                const zipConvos = UniversalImporter.importZip(fullPath);
                conversations.push(...zipConvos);
              } else if (fs.statSync(fullPath).isDirectory()) {
                const convJson = path.join(fullPath, "conversations.json");
                if (fs.existsSync(convJson)) {
                  const { UniversalImporter } = require("./importer");
                  const raw = fs.readFileSync(convJson, "utf-8");
                  const jsonConvos = UniversalImporter.importJson(raw);
                  conversations.push(...jsonConvos);
                }
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.error("Error scanning Downloads archives:", err.message);
    }

    // Deduplicate by conversation ID
    const uniqueMap = new Map<string, CanonicalConversation>();
    for (const c of conversations) {
      if (!uniqueMap.has(c.id)) {
        uniqueMap.set(c.id, c);
      }
    }

    const uniqueList = Array.from(uniqueMap.values());

    return {
      totalFound: uniqueList.length,
      byTool: counts,
      conversations: uniqueList
    };
  }
}
