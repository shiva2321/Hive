# Hive — Truth Audit Report

**Date:** 2026-09-19
**Scope:** Full pass across ingestion, security/encryption, the intelligence/HiveBrain layer, MCP serving, REST API, the browser extension, deployment configs, the test suite, and docs-vs-reality. Conducted by running the system locally against its real, existing 46MB SQLite graph and cross-checking every claim against actual code and this machine's real filesystem — not a read-through of source alone.

## Executive summary

Hive's plumbing is real and mostly well-built: the crypto *primitives*, the MCP protocol server, the SQLite storage layer, most parsers, the dashboard, and the Claude-specific browser capture are genuine, working engineering. But almost everything that would make this a *self-evolving intelligence layer* rather than a *storage layer* has the same shape of problem: **the claim is fabricated, frozen, discarded before it reaches disk, or simply never wired into the path that actually runs.**

- The flagship **HiveBrain "self-evolving" audit engine is 100% hardcoded fiction.**
- **Encryption is computed and then thrown away.** The one ingestion path that calls the (correctly-implemented) encryption function never persists its output — every message your real 483 conversations contain is stored as plain SQL text, on every ingestion path, encryption code notwithstanding.
- **The "BullMQ" async queue doesn't exist.** No Redis, no BullMQ, anywhere in the code — it's a plain in-memory array — despite the README, the threat model's own DoS mitigation, and the enterprise test suite's success message all asserting otherwise.
- **Two extraction pipelines exist; the live one is a blind regex,** and it's why decisions read as garbled fragments. The well-engineered LLM pipeline is dead code, reachable only from a manual API route nothing calls automatically.
- **Project clustering is a hardcoded lookup table** for your 22 known projects, not a learning algorithm.
- **Live capture only fully works for Claude.** Every other provider, Gemini included, captures only the screen's current conversation — which is why you've been exporting and re-importing by hand.
- **Windows local scanning misses most of your real Cursor history** (an 815MB `state.vscdb` nothing reads) and **effectively all of your Antigravity "brain" notes** (right folder, wrong internal file pattern).
- The entire authenticated, tenant-isolated API surface has an **unauthenticated shadow copy** at the legacy paths the real dashboard and extension actually call — so the JWT/API-key/tenant-isolation layer is opt-in, not enforced.
- The project's own test suite **currently fails outright** (`npm test` crashes) on a documented MCP tool with zero implementation anywhere.
- Secrets (`ENCRYPTION_MASTER_KEY`, `JWT_SECRET`, and a Postgres password) are hardcoded in source *and* in the versioned `docker-compose.prod.yml`.
- There was no git repository until this session (now initialized locally, not yet committed or pushed).

None of this needs a rebuild — it's overwhelmingly a wiring problem (good pipelines exist but aren't called, good crypto exists but its output is discarded) rather than missing engineering. But "no placeholders, fully working end-to-end" is not true of the current codebase, and we now know precisely where and why, file by file.

---

## Confirmed findings

### CRITICAL

**1. HiveBrain does not analyze anything.**
[`src/core/hive_brain.ts`](../src/core/hive_brain.ts) takes a `GraphStore`, calls `listProjects()`/`listInquiries()`, and then — regardless of what's actually in your graph — inserts three hardcoded inquiries about fictional projects ("Resonance-X" vector-quantization trade-offs, "NSCK" cognitive action leakage) full of invented technobabble. It never reads a node's content, never compares two projects, never detects an actual contradiction. The README's claims — "Detects contradictions," "Flags ambiguities," "Surfaces inquiries when it cannot determine the right answer autonomously" — describe a feature that does not exist yet.

**2. Encrypted content is computed, then discarded before it ever reaches disk — on every ingestion path.**
[`src/core/crypto.ts`](../src/core/crypto.ts) itself is genuinely solid: real AES-256-GCM, PBKDF2 (100k iterations), per-tenant HMAC blind indexing — verified with passing unit tests. But trace where it's actually *used*:
- `cli.ts` (`import`, `scan-local`) and `ingest.routes.ts` (the routes the dashboard and browser extension actually call) call `store.saveConversations()` directly and **never import `ZeroKnowledgeCrypto` at all.**
- The *only* caller of `ZeroKnowledgeCrypto` anywhere is [`src/workers/ingestion_worker.ts:62-69`](../src/workers/ingestion_worker.ts), which computes `(m as any).encryptedPayload = ZeroKnowledgeCrypto.encrypt(m.content, tenantKey)` — and then calls the same `store.saveConversations()`.
- [`src/storage/graph_store.ts:147-156`](../src/storage/graph_store.ts) (`saveConversations`) inserts `content: m.content` — the **plaintext** field — into the `messages` table. It never reads `m.encryptedPayload`. The encrypted bytes are computed, attached to a duck-typed property, and vanish.
- Compounding this: on top of the pipeline never persisting ciphertext, the key it *would* use defaults to the literal hardcoded string `"0123456789abcdef0123456789abcdef"` ([`src/config/env.ts:21`](../src/config/env.ts)), shipped in source, and your real `.env` never overrides it.
- `test:enterprise`'s "AES-256-GCM ... verified" test (correctly) exercises `ZeroKnowledgeCrypto.encrypt/decrypt` as an isolated function. It never calls the actual ingestion path, so it can't catch that the ingestion path throws the result away. **Every one of your 483 real conversations is stored as plain text today**, independent of which key is configured.

**3. The "BullMQ async worker queue" is fictional — it's an in-memory array, with zero Redis usage anywhere in the code.**
Grepping all of `src/` for `ioredis`/`bullmq`/`Bull` returns nothing. [`src/queues/ingestion_queue.ts`](../src/queues/ingestion_queue.ts) is a `Map` + a plain array + `EventEmitter` — its own docstring claims it "support[s] both distributed Redis and in-memory execution," but there is no Redis branch in the file at all. This directly contradicts three separate claims:
- The README's source tree: `workers/ # BullMQ async ingestion workers`.
- [`docs/THREAT_MODEL.md:15`](../docs/THREAT_MODEL.md)'s own Denial-of-Service mitigation: *"Asynchronous BullMQ worker queues with concurrency caps."* There is no concurrency cap and no queue durability — an unbounded in-memory array is itself a DoS surface, not a mitigation for one, and every queued job is lost on process restart.
- `test:enterprise`'s literal success line: *"✓ Asynchronous BullMQ worker pipeline verified with 100% completion."* The test passes, and what it verifies isn't what it claims to verify.

**4. `get_developer_preferences` is a documented MCP tool with zero implementation, and it's why `npm test` fails right now.**
Advertised in the README, implemented structurally in [`src/serving/mcp_server.ts:230-247`](../src/serving/mcp_server.ts) and [`src/serving/context_generator.ts:21-23`](../src/serving/context_generator.ts), both reading graph nodes of type `"UserPreference"`. Grepping all of `src/` confirms **no code path anywhere ever creates a `UserPreference` node** — the type is defined ([`src/core/types.ts:64`](../src/core/types.ts)) and read in two places, never written. This is exactly why `npm test` crashes with an uncaught `AssertionError: Failed: User preferences not extracted` — the core test command is red right now, not gracefully failing, crashing.

### HIGH

**5. Two extraction pipelines exist; the good one is dead code, the live one is a blind regex.**
- [`src/pipeline/clustering.ts:460-479`](../src/pipeline/clustering.ts) (`extractDecisions`) is what actually populates every project's `keyDecisions` today, via two regexes grabbing `[^.\n]{10,90}` — 10 to 90 characters with **no word-boundary awareness** — after trigger phrases like "we decided to" or "decision:". This is precisely why `npm run cli projects` shows fragments cut off mid-word instead of coherent decisions.
- [`src/pipeline/llm_extractor.ts`](../src/pipeline/llm_extractor.ts) is a properly engineered alternative: a real Zod schema, a system prompt that explicitly instructs "ZERO HALLUCINATIONS... DO NOT make up generic corporate jargon," JSON parsing with fallback recovery. **Grepping its only caller confirms it is invoked exclusively from [`src/api/routes/openrouter.routes.ts`](../src/api/routes/openrouter.routes.ts)** — a manual, on-demand "re-analyze with AI" job endpoint — **and from nowhere else.** `cli.ts`, `server.ts`, `api/server.ts`, `ingestion_worker.ts`, and `ingest.routes.ts` all call `ProjectClusterer.cluster()` + `MemoryExtractor.extract()` (the regex path) exclusively.

**6. "Automatic" project clustering is a hardcoded lookup table for your 22 known projects.**
[`src/pipeline/clustering.ts:60-436`](../src/pipeline/clustering.ts) (`identifyProjectKey`) is a 22-branch if/else keyed to specific strings — `"nsck"`, `"saptarshi"`, `"winterm"`, `"tiretrack"`, `"aegisquant"`, `"ray-ban"`, etc. — reverse-engineered from your existing history rather than computed. A genuinely new project tomorrow, with none of these keywords, falls into the generic catch-all. Four of the five "Generated Insights" in [`src/pipeline/extractor.ts:403-457`](../src/pipeline/extractor.ts) and all four "cross-project evolutionary links" ([lines 322-382](../src/pipeline/extractor.ts)) are likewise literal hardcoded strings, not computed from current data — true today, frozen forever, and will not update as you ingest more.

**7. Live capture only does full-history backfill for Claude — this is your "manual download" workaround.**
[`extension/content_script.js:824-1003`](../extension/content_script.js) resolves your Claude org ID and calls Claude's own internal API to page through and fetch every conversation. **No other provider has this.** Gemini, ChatGPT, DeepSeek, Perplexity, Grok, and Mistral all go through `extractCurrentConversation()` ([lines 79-251](../extension/content_script.js)), which only reads whatever conversation is currently on screen via CSS selectors — no backfill, which is exactly why the extension ships a manual "export as ZIP of .txt files" fallback ([lines 1008-1079](../extension/content_script.js)) you've been using by hand.

**8. Windows local scanning misses most of your real Cursor and Antigravity history.**
Verified directly against this machine's real filesystem:
- **Cursor:** [`src/ingestion/parsers/cursor_parser.ts`](../src/ingestion/parsers/cursor_parser.ts) reads `~/.cursor/plans/*.plan.md` (works — 7 real files found) and `~/.cursor/projects/<letter>-<name>/agent-transcripts/*.jsonl` (only matches your *older* projects, e.g. `d-Node-network`). Most current `~/.cursor/projects/` entries are numeric-ID folders with `canvases/`/`terminals/`, not `agent-transcripts/` — unparsed. The actual bulk of your Cursor history lives in an **815MB `state.vscdb` SQLite database** at `%APPDATA%\Cursor\User\globalStorage\`, plus per-workspace `state.vscdb` files — none of which any parser touches.
- **Antigravity:** [`src/ingestion/omni_scanner.ts:34-60`](../src/ingestion/omni_scanner.ts) has the right root paths but only looks for `<session>/.system_generated/logs/transcript.jsonl`. Real brain folders on this machine hold `.md` notes and screenshots directly under `brain/<uuid>/` — no `.system_generated` structure exists. Right root, wrong file pattern: ingests approximately zero of your real Antigravity notes, plus four more real Antigravity data directories the scanner never looks at at all.
- Every scanner method wraps its work in an empty `catch {}` — a wrong path produces zero rows and zero errors, invisible without checking real data volume against expected volume, which is what this audit did.

**9. The entire authenticated API surface has an unauthenticated shadow copy that the real clients actually use.**
[`src/api/server.ts:204-266`](../src/api/server.ts) mounts `ingestRoutes`, `projectRoutes`, and `graphRoutes` at `/api/v1/*` behind `authMiddleware` — real JWT/API-key checking. Then, lower in the same file, it mounts the *exact same routers* again at the unversioned legacy paths (`/api/ingest`, `/api/projects`, `/api/graph`, `/api/stats`, `/api/inquiries`, `/api/conversations`, `/api/telemetry`) with **no auth middleware at all**, commented "Backward compatibility alias for local dashboard & extension." Confirmed via `ui/index.html`'s and `extension/background.js`'s actual `fetch()` calls: **the dashboard and the browser extension both call the unauthenticated legacy paths, not the authenticated `/v1/` ones.** So in the one deployment mode that's actually exercised end-to-end, the JWT/tenant-isolation layer the enterprise tests validate is simply not on the path real traffic takes.

### MEDIUM

**10. The browser extension's client-side secret scrubber is weaker than the server-side one, and live-captured data never gets a second pass.**
`extension/content_script.js`'s `sanitizeSecrets()` covers 7 patterns (OpenAI/Anthropic/GitHub/AWS/private-key/bearer/generic-config). Server-side [`src/ingestion/sanitizer.ts`](../src/ingestion/sanitizer.ts) covers 9, adding database connection strings, JWT tokens, and email addresses. Bulk-imported files get the stronger server-side pass (called from inside each parser). Live-captured conversations — everything coming through the extension — only ever get the weaker client-side pass: `ingest.routes.ts`'s `processAndIngestConversations()` saves `item.messages` as-is and never calls `SecretSanitizer`. A `postgres://user:pass@host/db` string or raw JWT typed into a live chat will not be redacted before it lands in your graph.

**11. Tenant isolation (Row-Level Security) is real, well-designed, and Postgres-only — the SQLite mode you actually run has none.**
[`src/db/migrations/001_initial_schema.sql:123-148`](../src/db/migrations/001_initial_schema.sql) has genuine `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` statements per table, keyed to `current_setting('app.current_tenant_id')` — this is correctly implemented, not fabricated. But it only exists in the Postgres schema. `GraphStore` (SQLite, what's actually running via `STORAGE_MODE=sqlite`, the default) issues plain `SELECT * FROM projects` with no tenant filtering anywhere. Moot for a single local user; would not hold up if this were ever self-hosted for more than one.

**12. `audit_logs` exists as a schema, but nothing in the application ever writes to it.**
The Postgres migration creates the table [`src/db/migrations/001_initial_schema.sql:103`](../src/db/migrations/001_initial_schema.sql) that `THREAT_MODEL.md` cites as the Repudiation mitigation. Grepping all of `src/` for any insert into it returns nothing — same "schema exists, application never uses it" pattern as the BullMQ queue and RLS.

**13. Hardcoded secrets aren't just defaults — they're checked into the deployment configs too.**
[`docker/docker-compose.prod.yml:52-53`](../docker/docker-compose.prod.yml) hardcodes `ENCRYPTION_MASTER_KEY` and `JWT_SECRET` directly (plus a plaintext `POSTGRES_PASSWORD`) in a file meant to represent the *production* deployment. [`k8s/deployment-api.yaml`](../k8s/deployment-api.yaml) does this correctly instead — `DATABASE_URL` and `ENCRYPTION_MASTER_KEY` come from a `secretKeyRef` — but it never injects `JWT_SECRET` at all, so a k8s deployment would silently fall back to the hardcoded default even though the author clearly knew the right pattern for the other two secrets.

**14. `sanitizer.ts`'s OpenAI-key pattern is malformed.**
[`src/ingestion/sanitizer.ts:8`](../src/ingestion/sanitizer.ts): `/sk-[a-zA-Z0-9]{20,T3BlbkFJ[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{32,}/g` — the first alternative has literal text (`T3BlbkFJ[a-zA-Z0-9]{20`) where a quantifier number should be, almost certainly a botched attempt to also match the legacy OpenAI key format. It compiles without error (JS's lenient `{...}` handling) but won't match as intended; the second alternative still catches modern-format keys, so this is low severity, not a live exposure — just a bug worth a clean rewrite.

**15. Docs still carry unfilled placeholder identity.**
`README.md` and `PRIVACY_POLICY.md` both point at `https://github.com/your-org/universal-ai-memory` (the real repo is `github.com/shiva2321/Hive`); the privacy contact is `security@hivememory.local` (not a real, owned domain); `openapi.yaml` lists `https://api.universalmemory.ai` as a "Production Multi-Tenant Cloud" server that doesn't exist anywhere in this codebase or its deployment configs. Not a functional bug, but exactly the kind of "placeholder" the brief asked to eliminate.

**16. Tests validate mechanics, not quality or truthfulness of their own claims — so "all green" would not have caught most of the above.**
`npm run test:mcp` (4/4) and `npm run test:enterprise` (5/5) both pass and are individually reasonable tests of round-trip correctness — but none assert anything about extraction quality, and the one that names "BullMQ" is testing code that was never BullMQ. `npm test` itself fails outright (Finding 4).

**17. No version control existed before this session.**
Initialized `git init` and `git remote add origin https://github.com/shiva2321/Hive.git` locally (confirmed empty, no conflicting history). Nothing committed or pushed yet.

---

## What's genuinely solid (worth preserving as-is)

- **Crypto primitives** ([`src/core/crypto.ts`](../src/core/crypto.ts)) — real AES-256-GCM, correct IV/tag handling, PBKDF2, HMAC blind indexing. The functions are correct; nothing calls them on the path that matters.
- **MCP server** ([`src/serving/mcp_server.ts`](../src/serving/mcp_server.ts)) — all 9 tools are structurally real and backed by actual `GraphStore` queries, not fabricated like HiveBrain.
- **Claude web capture** — the internal-API-based full-history crawler in `content_script.js` is a legitimately clever, high-fidelity approach.
- **Most parsers** (`chatgpt_parser.ts`, `claude_code_parser.ts` — correctly finds `~/.claude/projects/*/*.jsonl` and `history.jsonl` on this Windows machine, real data confirmed flowing through) and the **bulk-import auto-detection** in `importer.ts`.
- **Dashboard UI** (`ui/index.html`) — every `fetch()` call hits a real, live backend endpoint; no mock or hardcoded data found. Its output quality is only as good as the pipelines feeding it (Findings 5-6), which is a data problem, not a UI problem.
- **Postgres RLS schema design** — genuinely correct multi-tenant isolation pattern, just unused by the SQLite mode you actually run.
- **The project typechecks cleanly** — `tsc --noEmit` passes with zero errors.
- **483 real conversations, 26,234 real messages, 22 real projects, 972 graph nodes, 1,063 edges** are already sitting in the local graph, structurally intact and queryable — just unencrypted and imperfectly extracted.

---

## Recommended remediation priority (for discussion, not yet actioned)

1. Decide the encryption story: either wire `saveConversations`/`GraphStore` to actually persist ciphertext with a real provisioned key, or consciously drop the "zero-knowledge" claim for local mode until it's real. Re-encrypt or accept-as-plaintext the existing 483 conversations either way.
2. Fix `UserPreference` extraction (currently breaks `npm test`).
3. Replace the fake in-memory "BullMQ" queue with a real one, or stop calling it BullMQ and remove the false DoS-mitigation claim from the threat model.
4. Close the unauthenticated shadow API surface, or explicitly document that auth is opt-in for local single-user mode and scope the "enterprise" framing accordingly.
5. Rewire ingestion to call `LlmExtractor` (the good pipeline) instead of, or as a correction pass over, `ProjectClusterer`'s regex extraction.
6. Fix Cursor (`state.vscdb` + numeric-folder projects) and Antigravity (`.md`-based brain notes) scanning.
7. Build real full-history backfill for non-Claude web providers, or be explicit that manual export/import is the supported path for those.
8. Replace `HiveBrain` with something that actually reads the graph.
9. Re-scope clustering from a hardcoded lookup table toward something that generalizes to new projects.
10. Sweep docs for placeholder identity (`your-org`, `hivememory.local`, `api.universalmemory.ai`) and remove claims (BullMQ, audit log, RLS-for-SQLite) that don't match what's actually deployed.

This is not a plan yet — just the priority order the evidence points to. Next step is to agree on scope and turn the first item(s) into an actual design.
