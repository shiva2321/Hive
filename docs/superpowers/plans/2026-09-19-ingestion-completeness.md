# Ingestion Completeness Implementation Plan

> **For agentic workers:** Execute task-by-task, in order. Commit after each. Task 1 involves an undocumented external file format (Cursor's internal SQLite schema) that this plan cannot verify without running on a real machine with Cursor installed — its first step is an investigation you must actually run and read the output of before writing the parser, not a step to skip. Task 3 requires a real logged-in Gemini session in a real Chrome browser to verify — do that verification for real, don't mark it done on code review alone. Report back: what Step 1 of Task 1 actually found on the machine you ran it on, and the real output of Task 3's manual verification.

**Goal:** Close the two concrete, filesystem-verified ingestion gaps this audit found — Cursor's real chat history lives almost entirely in a SQLite file nothing reads, and Antigravity's real "brain" notes are plain `.md` files that the scanner's hardcoded assumption about a `.system_generated/logs/transcript.jsonl` structure never matches — plus extend the browser extension's full-history backfill (currently Claude-only) to Gemini, the second platform actually in daily use.

**Architecture:** All three tasks are additive to existing scanners/parsers — nothing that currently works stops working. Task 1 and 2 add a second data source inside the existing `CursorParser`/`omni_scanner.ts` scan functions. Task 3 adds a new code path inside the extension's existing `executeFullExtraction` dispatcher, reusing the sidebar-discovery function that already exists for a different purpose.

**Tech Stack:** TypeScript, better-sqlite3 (already a dependency), vanilla JS in the extension (no new dependencies).

---

## Before you start

```bash
npx tsc --noEmit
```
Expected: no output, exit code 0.

---

### Task 1: Read Cursor's real chat history from `state.vscdb`

**Files:**
- Create: `scripts/inspect_cursor_state.js`
- Modify: `src/ingestion/parsers/cursor_parser.ts`

Cursor stores the vast majority of its chat/composer history in a SQLite key-value store (`state.vscdb`, an `ItemTable(key, value)` table — this is standard VS Code fork behavior, since Cursor is a VS Code fork) — not in the `.plan.md` / `agent-transcripts/*.jsonl` files `cursor_parser.ts` currently reads. The exact key name and JSON shape for chat data is undocumented and has changed across Cursor versions, so **this task starts with an investigation script you run for real and read the output of** — do not skip to Step 3 and guess.

- [ ] **Step 1: Create the investigation script**

Create `scripts/inspect_cursor_state.js`:

```javascript
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

function findCursorStateDb() {
  const home = os.homedir();
  const candidates = [
    path.join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb"), // Windows
    path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"), // macOS
    path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb") // Linux
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

const original = findCursorStateDb();
if (!original) {
  console.error("Could not find Cursor's state.vscdb in any known location. Cursor may not be installed, or uses a custom profile path — search manually with: find ~ -iname 'state.vscdb' 2>/dev/null | grep -i cursor");
  process.exit(1);
}

// Never open Cursor's live file directly — it may be locked by a running
// Cursor process, and this is read-only inspection, not something that
// should ever risk corrupting the user's real IDE state.
const tmpCopy = path.join(os.tmpdir(), `cursor_state_inspect_${Date.now()}.vscdb`);
fs.copyFileSync(original, tmpCopy);

const db = new Database(tmpCopy, { readonly: true });
const rows = db.prepare(`SELECT key, length(value) as value_len FROM ItemTable ORDER BY value_len DESC`).all();
db.close();
fs.unlinkSync(tmpCopy);

console.log(`Inspected: ${original}`);
console.log(`Total keys: ${rows.length}\n`);

const interesting = rows.filter(r => /chat|composer|aichat|conversation/i.test(r.key));
console.log(`Keys matching chat/composer/aichat/conversation (${interesting.length}):`);
for (const r of interesting) {
  console.log(`  ${r.key}  (${r.value_len} bytes)`);
}

if (interesting.length === 0) {
  console.log("\nNo obviously chat-related keys found by name. Printing the 20 largest keys instead — one of these is likely it:");
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.key}  (${r.value_len} bytes)`);
  }
}
```

- [ ] **Step 2: Run it and read the actual output**

Run: `node scripts/inspect_cursor_state.js`

Expected: a list of keys. As of when this plan was written, the most likely candidates are keys containing `composer.composerData` (an index of composer sessions) and/or keys prefixed `composerData:`. **Your actual output may differ — this is exactly why Step 1 exists.** For whichever key(s) look most promising (largest size, most obviously chat-shaped name), dump a sample of the actual value shape before writing Step 3's parsing code:

```bash
node -e "
const Database = require('better-sqlite3');
const fs = require('fs'); const os = require('os'); const path = require('path');
const original = '<paste the real state.vscdb path Step 2 printed>';
const tmp = path.join(os.tmpdir(), 'cursor_sample_' + Date.now() + '.vscdb');
fs.copyFileSync(original, tmp);
const db = new Database(tmp, { readonly: true });
const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('<paste the most promising key from Step 2>');
console.log(row.value.toString('utf-8').slice(0, 2000));
db.close(); fs.unlinkSync(tmp);
"
```

Read the printed JSON shape. Confirm: is it an array of turns? Does each turn have a `role`/`type` field distinguishing user from assistant? What field holds the actual text (`text`, `content`, `richText`)? **Adjust Step 3's `extractConversationsFromComposerValue` field names to match what you actually see** — the code below is a best-effort based on publicly known Cursor internals as of when this plan was written, not a verified spec.

- [ ] **Step 3: Add the state.vscdb scanner to `CursorParser`**

In `src/ingestion/parsers/cursor_parser.ts`, update the imports at the top:

```typescript
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import { CanonicalConversation, CanonicalMessage } from "../../core/types";
import { SecretSanitizer } from "../sanitizer";
import { ChatGPTParser } from "./chatgpt_parser";
```

Find the closing of `scanAndParse` (the `return conversations;` right before the final `}` of the method):

```typescript
    return conversations;
  }
}
```

Replace it with:

```typescript
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
    const tmpCopy = path.join(os.tmpdir(), `cursor_state_scan_${Date.now()}.vscdb`);
    let db: Database.Database | undefined;

    try {
      fs.copyFileSync(stateDbPath, tmpCopy);
      db = new Database(tmpCopy, { readonly: true });

      const rows = db.prepare(`
        SELECT key, value FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%aichat%'
      `).all() as Array<{ key: string; value: Buffer }>;

      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value.toString("utf-8"));
          conversations.push(...this.extractConversationsFromComposerValue(parsed, row.key));
        } catch {
          // This key's value wasn't JSON we recognize — skip rather than crash.
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

  private static extractConversationsFromComposerValue(parsed: any, sourceKey: string): CanonicalConversation[] {
    const rawTurns: any[] = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.conversation) ? parsed.conversation
      : Array.isArray(parsed?.messages) ? parsed.messages
      : [];

    if (rawTurns.length === 0) return [];

    const messages: CanonicalMessage[] = [];
    for (let i = 0; i < rawTurns.length; i++) {
      const turn = rawTurns[i];
      // NOTE: role discrimination below is a best guess — verify against
      // Step 2's real sample output and adjust if it doesn't match.
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
```

- [ ] **Step 4: Verify against your real Cursor data**

Run: `npx tsx -e "const { CursorParser } = require('./src/ingestion/parsers/cursor_parser'); const r = CursorParser.scanStateDb(); console.log('Found', r.length, 'conversations from state.vscdb'); if (r[0]) console.log(JSON.stringify(r[0], null, 2).slice(0, 1000));"`

Expected: `Found N conversations from state.vscdb` where N > 0 (assuming you have real Cursor chat history — you confirmed 815MB of `state.vscdb` exists, so it should not be zero). If N is 0, go back to Step 2 — either the key pattern in Step 3's SQL `LIKE` filter doesn't match what's really there, or `extractConversationsFromComposerValue`'s field names don't match the real shape. Do not consider this task done with N = 0 unless you've confirmed via Step 2 that there is genuinely no chat data in this Cursor installation.

- [ ] **Step 5: Confirm the existing full scan still works and includes the new source**

Run: `npx tsx src/cli.ts scan-local`
Expected: the `Cursor IDE (Plans & Transcripts)` count in the output is now higher than it was before this task (compare against the audit's earlier finding, or just confirm it's nonzero and sensible relative to Step 4's count).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add scripts/inspect_cursor_state.js src/ingestion/parsers/cursor_parser.ts
git commit -m "feat: read Cursor's real chat history from state.vscdb

The .plan.md and agent-transcripts/*.jsonl sources only covered a
subset of Cursor's actual data — the bulk of real chat history lives
in Cursor's SQLite state store, which nothing read before this. Field
names for the undocumented composer data shape were verified against
this machine's real Cursor installation before implementing (see
scripts/inspect_cursor_state.js)."
```

---

### Task 2: Read Antigravity's real `.md` brain notes

**Files:**
- Modify: `src/ingestion/omni_scanner.ts`

Verified directly against a real Antigravity installation: session folders under `~/.gemini/antigravity{,-ide}/brain/<uuid>/` hold `.md` notes and screenshot images directly — not the `.system_generated/logs/transcript.jsonl` structure the scanner currently looks for exclusively. This task adds a second check per session folder without removing the first (some sessions may still use the jsonl format).

- [ ] **Step 1: Update the imports**

In `src/ingestion/omni_scanner.ts`, update the top imports:

```typescript
import fs from "fs";
import path from "path";
import os from "os";
import { CanonicalConversation, CanonicalMessage } from "../core/types";
import { LocalIDEParser } from "./parsers/local_ide_parser";
import { ClaudeCodeParser } from "./parsers/claude_code_parser";
import { CursorParser } from "./parsers/cursor_parser";
import { SecretSanitizer } from "./sanitizer";
import { ChatGPTParser } from "./parsers/chatgpt_parser";
```

- [ ] **Step 2: Add the `.md` scan alongside the existing transcript scan**

Find this block (the Antigravity scanning loop):

```typescript
    // 1. Antigravity & Antigravity IDE Transcripts
    const antigravityRoots = [
      path.join(userHome, ".gemini", "antigravity", "brain"),
      path.join(userHome, ".gemini", "antigravity-ide", "brain")
    ];

    for (const bDir of antigravityRoots) {
      if (fs.existsSync(bDir)) {
        try {
          const dirs = fs.readdirSync(bDir);
          for (const dir of dirs) {
            const logDir = path.join(bDir, dir, ".system_generated", "logs");
            const transcriptPath = path.join(logDir, "transcript.jsonl");
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
          }
        } catch {}
      }
    }
```

Replace it with:

```typescript
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
```

- [ ] **Step 3: Verify against your real Antigravity data**

Run: `npx tsx -e "const { OmniScanner } = require('./src/ingestion/omni_scanner'); const r = OmniScanner.scanAll(); console.log('Antigravity count:', r.byTool.antigravity); console.log('Total found:', r.totalFound);"`

Expected: `Antigravity count:` is now greater than 0 (this audit directly confirmed real `.md` files exist at `~/.gemini/antigravity-ide/brain/9eb024d1-8b04-478c-9484-7b10d8bc96bc/hyper_space_brainstorm.md` and similar paths on this machine — if your count is still 0, confirm those exact paths still exist with `ls ~/.gemini/antigravity-ide/brain/`).

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

```bash
git add src/ingestion/omni_scanner.ts
git commit -m "fix: scan Antigravity's real .md brain notes, not just transcript.jsonl

The scanner's only Antigravity format assumption (.system_generated/
logs/transcript.jsonl) didn't match this machine's real brain folders,
which hold .md notes directly. Both formats are now checked; verified
against real files found during the audit."
```

---

### Task 3: Extension full-history backfill for Gemini

**Files:**
- Modify: `extension/content_script.js`

The extension's deep-crawl only does full-history backfill for Claude, via Claude's internal API. For every other provider — including Gemini, the second platform actually in daily use — "Deep Sync All" silently falls back to extracting just the single conversation on screen. This task extends real backfill to Gemini specifically (not every provider — Gemini is the one actually reported as in use besides Claude), using sequential same-tab navigation through the already-existing sidebar-discovery function (`deepAutoScrollSidebar`, which already has Gemini-specific link selectors) rather than an unverified private API. **Trade-off, stated plainly:** the tab will visibly navigate through each conversation during the crawl — this is a deliberate choice to only use verifiable, public DOM extraction rather than guessing at an internal API this plan cannot check without a live Gemini session.

- [ ] **Step 1: Add the sequential-navigation crawler**

In `extension/content_script.js`, find the end of `deepAutoScrollSidebar` (the function ends with `return Array.from(discovered.values());` followed by the section-6 comment header). Immediately after that function, before the `// 6. Organization ID Resolver...` comment, insert:

```javascript
  // ----------------------------------------------------------------------------
  // 6b. Generic Sequential Backfill (providers without a private API, e.g. Gemini)
  // ----------------------------------------------------------------------------
  // Trade-off: this navigates the current tab through each discovered
  // conversation in sequence. That's visibly disruptive, but it only relies
  // on public DOM extraction (extractCurrentConversation), not an
  // undocumented internal API we haven't verified.
  async function extractAllConversationsBySequentialNavigation(progressCb) {
    const discovered = await deepAutoScrollSidebar((count) => {
      if (progressCb) progressCb("discovering", `Found ${count} conversations in sidebar...`, 0, count);
    });

    if (discovered.length === 0) {
      const active = extractCurrentConversation();
      return active ? [active] : [];
    }

    const results = [];
    const originalUrl = window.location.href;

    for (let i = 0; i < discovered.length; i++) {
      const item = discovered[i];
      if (progressCb) {
        progressCb("crawling", `Opening ${i + 1}/${discovered.length}: "${item.title.slice(0, 30)}..."`, i, discovered.length);
      }

      try {
        const targetUrl = new URL(item.id, window.location.origin).href;

        if (targetUrl !== window.location.href) {
          if (item.element && typeof item.element.click === "function" && document.body.contains(item.element)) {
            item.element.click();
          } else {
            window.location.href = targetUrl;
          }
          await new Promise(r => setTimeout(r, 1800));
        }

        // Wait for streaming to settle before extracting.
        for (let wait = 0; wait < 10; wait++) {
          const stillStreaming = document.querySelector("[data-is-streaming='true'], .result-streaming, .streaming") !== null;
          if (!stillStreaming) break;
          await new Promise(r => setTimeout(r, 500));
        }

        const convo = extractCurrentConversation();
        if (convo) results.push(convo);
      } catch (err) {
        console.warn(`[Hive] Failed to extract conversation "${item.title}":`, err.message);
      }
    }

    // Best-effort return to where the crawl started.
    try {
      if (window.location.href !== originalUrl) {
        window.location.href = originalUrl;
      }
    } catch {}

    return results;
  }

```

- [ ] **Step 2: Call it from `executeFullExtraction` for Gemini**

Find:

```javascript
    if (provider === "claude") {
      conversations = await extractAllClaudeConversations((status, label, current, total) => {
        chrome.runtime.sendMessage({
          type: "CRAWL_PROGRESS",
          status: status,
          total: total || 0,
          current: current || 0,
          label: label
        });
      });
    } else {
      // For other providers, extract active conversation
      const active = extractCurrentConversation();
      if (active) conversations.push(active);
    }
```

Replace it with:

```javascript
    if (provider === "claude") {
      conversations = await extractAllClaudeConversations((status, label, current, total) => {
        chrome.runtime.sendMessage({
          type: "CRAWL_PROGRESS",
          status: status,
          total: total || 0,
          current: current || 0,
          label: label
        });
      });
    } else if (provider === "gemini") {
      conversations = await extractAllConversationsBySequentialNavigation((status, label, current, total) => {
        chrome.runtime.sendMessage({
          type: "CRAWL_PROGRESS",
          status: status,
          total: total || 0,
          current: current || 0,
          label: label
        });
      });
    } else {
      // For providers without a backfill implementation yet, extract active conversation only.
      const active = extractCurrentConversation();
      if (active) conversations.push(active);
    }
```

- [ ] **Step 3: Load the updated extension and verify manually — this requires a real Gemini session**

```bash
npm run package:extension
```
Expected: produces `dist/hive-ai-memory-extension-v2.1.0.zip` (or similar) with no errors.

Then, in Chrome:
1. Go to `chrome://extensions`, enable Developer Mode, "Load unpacked", select the `extension/` folder (or reload it if already loaded).
2. Start the Hive daemon: `npm run start:server`.
3. Open `gemini.google.com` in a logged-in session with at least 3 conversations in your history.
4. Click the Hive extension icon, click "Deep Sync All".
5. **Watch the tab.** It should visibly navigate through sidebar conversations one at a time, with the popup's progress bar advancing.
6. When it finishes, run: `curl -s http://localhost:42424/api/stats`

Expected: the `conversations` count in the stats response is higher than it was before step 3, and running `npx tsx src/cli.ts query gemini` (or checking the dashboard's Chats tab filtered to Gemini) shows more than one Gemini conversation with real content, not just whatever was on screen when you clicked.

**This step cannot be verified by code review alone — it requires an actual logged-in Gemini session in an actual browser. If you don't have one available, say so explicitly in your report instead of marking this task done.**

- [ ] **Step 4: Commit**

```bash
git add extension/content_script.js
git commit -m "feat: extend extension full-history backfill to Gemini

Deep Sync All previously only backfilled full history for Claude (via
its internal API); every other provider silently fell back to the
single active conversation. Gemini now gets real backfill via
sequential same-tab navigation through the existing sidebar-discovery
function, trading a visibly disruptive crawl for not depending on an
unverified private API."
```

(No `npx tsc --noEmit` step here — `extension/*.js` is plain JS, not part of the TypeScript project.)

---

## Explicitly out of scope for this plan

- **Extending backfill to ChatGPT, DeepSeek, Perplexity, Grok, or Mistral.** Gemini is the platform actually confirmed in daily use besides Claude. The same `extractAllConversationsBySequentialNavigation` function works for any provider with sidebar links matching `deepAutoScrollSidebar`'s existing selectors — adding more `else if` branches in Task 3, Step 2 is straightforward if/when needed.
- **A hidden-tab version of the Gemini crawl that doesn't disrupt the visible tab.** Real UX improvement, meaningfully more complex (background tab lifecycle management via `chrome.tabs`), and not required to make backfill correct — just less annoying. Worth a follow-up if the visible navigation proves too disruptive in practice.
- **VS Code / JetBrains AI local scanning**, claimed in the README's ingestion table but not audited or touched here — out of scope for this plan; audit them the same way Cursor/Antigravity were audited here before assuming the existing `local_ide_parser.ts` handles them correctly.
- **The weaker client-side secret scrubber on live-captured chats** (audit finding 10): `content_script.js`'s `sanitizeSecrets()` covers fewer patterns than server-side `sanitizer.ts`, and `ingest.routes.ts`'s `processAndIngestConversations` never runs the server-side pass on incoming extension payloads at all. Real fix, not done here: call `SecretSanitizer.sanitize()` on every message in `processAndIngestConversations` before saving, regardless of source. Left out of this plan because it's a security/sanitization fix, not an ingestion-completeness one — bundle it with the security-persistence-truth plan's next iteration.
- **Docs still pointing at placeholder identity** (`your-org`, `hivememory.local`, `api.universalmemory.ai` — audit finding 15). Pure find-and-replace, zero risk, just didn't fit naturally into any of the three plans' scopes — worth a five-minute pass whenever.
