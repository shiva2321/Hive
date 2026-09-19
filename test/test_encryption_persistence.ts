import assert from "assert";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { GraphStore } from "../src/storage/graph_store";
import { CanonicalConversation } from "../src/core/types";

console.log("=========================================");
console.log(" Testing Encryption-at-Rest Persistence  ");
console.log("=========================================\n");

const testDbPath = path.join(__dirname, "test_encryption.sqlite");
for (const suffix of ["", "-shm", "-wal"]) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const SECRET_PLAINTEXT = "The launch codes are hidden in the AegisQuant config, do not repeat this anywhere.";

const testConvo: CanonicalConversation = {
  id: "convo_encryption_test",
  source: "claude",
  sourceId: "convo_encryption_test",
  title: "Encryption Persistence Test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [
    {
      id: "msg_encryption_test_1",
      role: "user",
      timestamp: new Date().toISOString(),
      content: SECRET_PLAINTEXT,
      codeSnippets: [],
      tokenCountEst: 20
    }
  ]
};

const store = new GraphStore(testDbPath);
store.saveConversations([testConvo]);

// Test 1: the raw bytes on disk must NOT contain the plaintext.
console.log("[Test 1] Raw SQLite row does not contain plaintext");
const rawDb = new Database(testDbPath, { readonly: true });
const rawRow = rawDb.prepare(`SELECT content FROM messages WHERE id = ?`).get("msg_encryption_test_1") as any;
rawDb.close();

assert.ok(rawRow, "Failed: message row not found at all.");
assert.ok(
  !rawRow.content.includes(SECRET_PLAINTEXT),
  `Failed: raw stored content contains the plaintext secret! Stored value: ${rawRow.content}`
);
const storedShape = JSON.parse(rawRow.content);
assert.ok(storedShape.iv && storedShape.ciphertext && storedShape.tag, "Failed: stored content is not in the expected EncryptedPayload shape.");
console.log("  ✓ Raw stored content is ciphertext, not plaintext.\n");

// Test 2: reading it back through GraphStore returns the original plaintext.
console.log("[Test 2] GraphStore.getConversation decrypts transparently");
const readBack = store.getConversation("convo_encryption_test");
assert.ok(readBack, "Failed: could not read conversation back.");
assert.strictEqual(readBack.messages[0].content, SECRET_PLAINTEXT, "Failed: decrypted content does not match original plaintext.");
console.log("  ✓ getConversation() returns the original plaintext.\n");

console.log("[Test 3] GraphStore.getAllSubstantialConversations decrypts transparently");
const allConvos = store.getAllSubstantialConversations();
const found = allConvos.find(c => c.id === "convo_encryption_test");
assert.ok(found, "Failed: conversation not found via getAllSubstantialConversations.");
assert.strictEqual(found!.messages[0].content, SECRET_PLAINTEXT, "Failed: decrypted content mismatch via getAllSubstantialConversations.");
console.log("  ✓ getAllSubstantialConversations() returns the original plaintext.\n");

// Test 4: pre-existing plaintext rows (from before this fix existed) must
// still read back correctly — no forced migration, no crash on old data.
console.log("[Test 4] Pre-existing plaintext rows (old data) still read correctly");
const rawDbWrite = new Database(testDbPath);
rawDbWrite.prepare(`
  INSERT INTO conversations (id, source, source_id, title, created_at, updated_at, metadata_json)
  VALUES ('convo_legacy_plaintext', 'claude', 'convo_legacy_plaintext', 'Legacy Plaintext Conversation', ?, ?, '{}')
`).run(new Date().toISOString(), new Date().toISOString());
rawDbWrite.prepare(`
  INSERT INTO messages (id, conversation_id, role, timestamp, content, code_snippets_json, token_count)
  VALUES ('msg_legacy_1', 'convo_legacy_plaintext', 'user', ?, 'This was saved before encryption existed.', '[]', 10)
`).run(new Date().toISOString());
rawDbWrite.close();

const legacy = store.getConversation("convo_legacy_plaintext");
assert.ok(legacy, "Failed: could not read legacy plaintext conversation.");
assert.strictEqual(legacy.messages[0].content, "This was saved before encryption existed.", "Failed: legacy plaintext row was mangled by decryptContent.");
console.log("  ✓ Legacy plaintext row read back unchanged, no crash.\n");

store.close();
for (const suffix of ["", "-shm", "-wal"]) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log("=========================================");
console.log(" ALL ENCRYPTION PERSISTENCE TESTS PASSED! ");
console.log("=========================================");
