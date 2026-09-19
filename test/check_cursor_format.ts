import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const globalDb = path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");

if (fs.existsSync(globalDb)) {
  const db = new Database(globalDb, { readonly: true });
  const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%chat%' LIMIT 5").all() as any[];
  for (const r of rows) {
    console.log("Key:", r.key);
    try {
      const valStr = Buffer.isBuffer(r.value) ? r.value.toString("utf-8") : String(r.value);
      const parsed = JSON.parse(valStr);
      console.log("Parsed object keys:", Object.keys(parsed));
      if (parsed.allComposers) {
        console.log("Found allComposers count:", parsed.allComposers.length);
      }
    } catch {
      console.log("Raw string preview:", String(r.value).substring(0, 100));
    }
  }
  db.close();
}
