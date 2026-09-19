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
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log(`Inspected: ${original}`);
console.log(`Tables present: ${tables.join(", ")}\n`);

if (tables.includes("ItemTable")) {
  const rows = db.prepare(`SELECT key, length(value) as value_len FROM ItemTable ORDER BY value_len DESC`).all();
  console.log(`ItemTable total keys: ${rows.length}`);
  const interesting = rows.filter(r => /chat|composer|aichat|conversation/i.test(r.key));
  console.log(`Keys matching chat/composer/aichat/conversation (${interesting.length}):`);
  for (const r of interesting.slice(0, 10)) {
    console.log(`  ${r.key}  (${r.value_len} bytes)`);
  }
}

if (tables.includes("cursorDiskKV")) {
  const composerCount = db.prepare("SELECT count(*) as c FROM cursorDiskKV WHERE key LIKE 'composerData:%'").get().c;
  const bubbleCount = db.prepare("SELECT count(*) as c FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").get().c;
  console.log(`\ncursorDiskKV entries: ${composerCount} composer sessions, ${bubbleCount} chat bubbles`);
  
  const sample = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' LIMIT 5").all();
  console.log("Sample composer sessions from cursorDiskKV:");
  for (const s of sample) {
    try {
      const data = JSON.parse(s.value.toString("utf-8"));
      console.log(`  ${s.key}: "${data.name || 'Untitled'}" (bubbles: ${data.fullConversationHeadersOnly?.length || 0})`);
    } catch {}
  }
}

if (tables.includes("composerHeaders")) {
  const count = db.prepare("SELECT count(*) as c FROM composerHeaders").get().c;
  console.log(`\ncomposerHeaders count: ${count}`);
}

db.close();
fs.unlinkSync(tmpCopy);
