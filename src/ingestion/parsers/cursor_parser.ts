import fs from "fs";
import path from "path";
import os from "os";
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
    if (!fs.existsSync(cursorDir)) return [];

    const conversations: CanonicalConversation[] = [];

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

    return conversations;
  }
}
