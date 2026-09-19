import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";

export interface DiscoveredSource {
  tool: string;
  sourceType: string;
  path: string;
  details: string;
  itemCount: number;
}

export function scanAllLocalAITools(): DiscoveredSource[] {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const discovered: DiscoveredSource[] = [];

  // 1. Antigravity & Antigravity IDE transcripts
  const antigravityDirs = [
    path.join(home, ".gemini", "antigravity", "brain"),
    path.join(home, ".gemini", "antigravity-ide", "brain")
  ];

  for (const bDir of antigravityDirs) {
    if (fs.existsSync(bDir)) {
      try {
        const sessions = fs.readdirSync(bDir);
        let transcriptsCount = 0;
        for (const s of sessions) {
          const tPath = path.join(bDir, s, ".system_generated", "logs", "transcript.jsonl");
          if (fs.existsSync(tPath)) {
            transcriptsCount++;
          }
        }
        if (transcriptsCount > 0) {
          discovered.push({
            tool: "Antigravity",
            sourceType: "agent_transcript",
            path: bDir,
            details: `Found ${transcriptsCount} session transcripts in ${path.basename(path.dirname(bDir))}`,
            itemCount: transcriptsCount
          });
        }
      } catch (err: any) {}
    }
  }

  // 2. Claude Code CLI History & Sessions
  const claudeHome = path.join(home, ".claude");
  if (fs.existsSync(claudeHome)) {
    const historyFile = path.join(claudeHome, "history.jsonl");
    if (fs.existsSync(historyFile)) {
      try {
        const content = fs.readFileSync(historyFile, "utf-8");
        const lines = content.split("\n").filter(l => l.trim().length > 0);
        discovered.push({
          tool: "Claude Code",
          sourceType: "cli_history",
          path: historyFile,
          details: `Found ${lines.length} command and prompt entries in history.jsonl`,
          itemCount: lines.length
        });
      } catch {}
    }

    const sessionsDir = path.join(claudeHome, "sessions");
    if (fs.existsSync(sessionsDir)) {
      try {
        const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
        if (sessionFiles.length > 0) {
          discovered.push({
            tool: "Claude Code",
            sourceType: "cli_sessions",
            path: sessionsDir,
            details: `Found ${sessionFiles.length} detailed session logs`,
            itemCount: sessionFiles.length
          });
        }
      } catch {}
    }
  }

  // 3. Gemini CLI / Temp Project Chats
  const geminiTmp = path.join(home, ".gemini", "tmp");
  if (fs.existsSync(geminiTmp)) {
    try {
      const subdirs = fs.readdirSync(geminiTmp);
      let totalChats = 0;
      for (const d of subdirs) {
        const chatDir = path.join(geminiTmp, d, "chats");
        if (fs.existsSync(chatDir)) {
          const chatFiles = fs.readdirSync(chatDir).filter(f => f.endsWith(".json") || f.endsWith(".jsonl"));
          totalChats += chatFiles.length;
        }
      }
      if (totalChats > 0) {
        discovered.push({
          tool: "Gemini CLI / Tools",
          sourceType: "named_project_chats",
          path: geminiTmp,
          details: `Found ${totalChats} project chat logs across ${subdirs.length} workspaces`,
          itemCount: totalChats
        });
      }
    } catch {}
  }

  // 4. Cursor IDE Workspace Storage & Global Storage
  const cursorGlobal = path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  if (fs.existsSync(cursorGlobal)) {
    try {
      const db = new Database(cursorGlobal, { readonly: true });
      const rows = db.prepare("SELECT key FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%chat%'").all() as any[];
      if (rows.length > 0) {
        discovered.push({
          tool: "Cursor IDE",
          sourceType: "global_composer_chats",
          path: cursorGlobal,
          details: `Found ${rows.length} global composer/chat records`,
          itemCount: rows.length
        });
      }
      db.close();
    } catch {}
  }

  const cursorWorkspaces = path.join(appData, "Cursor", "User", "workspaceStorage");
  if (fs.existsSync(cursorWorkspaces)) {
    try {
      const wsDirs = fs.readdirSync(cursorWorkspaces);
      let wsChatCount = 0;
      for (const ws of wsDirs) {
        const dbPath = path.join(cursorWorkspaces, ws, "state.vscdb");
        if (fs.existsSync(dbPath)) {
          try {
            const db = new Database(dbPath, { readonly: true });
            const rows = db.prepare("SELECT COUNT(*) as c FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%chat%'").get() as any;
            if (rows && rows.c > 0) {
              wsChatCount += rows.c;
            }
            db.close();
          } catch {}
        }
      }
      if (wsChatCount > 0) {
        discovered.push({
          tool: "Cursor IDE",
          sourceType: "workspace_chats",
          path: cursorWorkspaces,
          details: `Found ${wsChatCount} workspace chat records across ${wsDirs.length} workspaces`,
          itemCount: wsChatCount
        });
      }
    } catch {}
  }

  // 5. Windsurf Workspace Storage
  const windsurfWorkspaces = path.join(appData, "Windsurf", "User", "workspaceStorage");
  if (fs.existsSync(windsurfWorkspaces)) {
    try {
      const wsDirs = fs.readdirSync(windsurfWorkspaces);
      discovered.push({
        tool: "Windsurf",
        sourceType: "workspaces",
        path: windsurfWorkspaces,
        details: `Found ${wsDirs.length} workspace configurations`,
        itemCount: wsDirs.length
      });
    } catch {}
  }

  return discovered;
}

if (require.main === module) {
  console.log("==================================================");
  console.log("   Scanning Windows System for AI Tools & Chats   ");
  console.log("==================================================");
  const results = scanAllLocalAITools();
  results.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.tool} (${r.sourceType})`);
    console.log(`    Path:    ${r.path}`);
    console.log(`    Details: ${r.details}`);
  });
  console.log(`\nTotal AI Sources Discovered: ${results.length}`);
}
