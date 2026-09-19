import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { CanonicalConversation } from "../core/types";
import { ChatGPTParser } from "./parsers/chatgpt_parser";
import { ClaudeParser } from "./parsers/claude_parser";
import { GeminiParser } from "./parsers/gemini_parser";
import { LocalIDEParser } from "./parsers/local_ide_parser";

export class UniversalImporter {
  /**
   * Automatically ingests from a Zip file, JSON file, or raw string/buffer.
   */
  public static async importFile(filePath: string): Promise<CanonicalConversation[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".zip") {
      return this.importZip(filePath);
    } else if (ext === ".json") {
      const raw = fs.readFileSync(filePath, "utf-8");
      return this.importJson(raw, path.basename(filePath));
    } else if (ext === ".jsonl") {
      const raw = fs.readFileSync(filePath, "utf-8");
      const conv = LocalIDEParser.parseJsonlTranscript(raw, path.basename(filePath, ".jsonl"));
      return conv ? [conv] : [];
    } else {
      throw new Error(`Unsupported file format: ${ext}. Expected .zip, .json, or .jsonl.`);
    }
  }

  /**
   * Imports an archive containing exports from Claude, ChatGPT, or Google Takeout.
   */
  public static importZip(zipPath: string): CanonicalConversation[] {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    const results: CanonicalConversation[] = [];

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName.toLowerCase();

      // ChatGPT or Claude conversations.json
      if (entryName.endsWith("conversations.json")) {
        const content = entry.getData().toString("utf-8");
        const convos = this.importJson(content, entry.name);
        results.push(...convos);
      }
      // Gemini activity JSON or Takeout
      else if (entryName.includes("gemini") && entryName.endsWith(".json")) {
        const content = entry.getData().toString("utf-8");
        const convos = GeminiParser.parse(content);
        results.push(...convos);
      }
    }

    return results;
  }

  /**
   * Auto-detects whether the JSON is ChatGPT, Claude, or Gemini format.
   */
  public static importJson(jsonString: string, filename: string = ""): CanonicalConversation[] {
    const parsed = JSON.parse(jsonString);

    if (parsed && Array.isArray(parsed.conversations)) {
      return this.importJson(JSON.stringify(parsed.conversations), filename);
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];

      // ChatGPT: has mapping property
      if (first.mapping) {
        return ChatGPTParser.parse(parsed);
      }

      // Claude: has chat_messages or Canonical messages
      if (first.chat_messages || (first.messages && (first.source === "claude" || !first.source))) {
        return ClaudeParser.parse(parsed);
      }

      // Gemini: has turns or activity structure
      if (first.turns || first.header?.toLowerCase().includes("gemini")) {
        return GeminiParser.parse(parsed);
      }
    }

    // Heuristic fallbacks
    try {
      const chatgptTry = ChatGPTParser.parse(parsed);
      if (chatgptTry.length > 0) return chatgptTry;
    } catch {}

    try {
      const claudeTry = ClaudeParser.parse(parsed);
      if (claudeTry.length > 0) return claudeTry;
    } catch {}

    try {
      const geminiTry = GeminiParser.parse(parsed);
      if (geminiTry.length > 0) return geminiTry;
    } catch {}

    return [];
  }
}
