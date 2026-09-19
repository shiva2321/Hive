<div align="center">

# 🐝 Hive — Universal AI Memory

**Your collective intelligence substrate. Every AI conversation you have ever had, unified into one living, self-evolving knowledge graph.**

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-2.0-purple.svg)](https://modelcontextprotocol.io)
[![Privacy: Local-First](https://img.shields.io/badge/Privacy-Local--First-red.svg)](#security--privacy)

</div>

---

> **Hive** is a local-first, zero-knowledge, self-evolving memory network that captures your AI conversation history across every platform and IDE you use — and makes it universally accessible, searchable, and actionable anywhere you work.

---

## 📸 Executive Command Center & Constellation Knowledge Studio

![Hive Executive Command Center](docs/screenshots/hive_overview_verified.png)

*The Hive Executive Command Center provides an instant operational picture of your collective AI memory substrate: high-level KPI metric cards, active provider breakdown, an interactive 13-project card grid with 1-click exploration, self-evolving HiveBrain inquiries, critical architecture guardrails, and real-time synaptic extractions.*

![Hive Constellation Knowledge Graph](docs/screenshots/hive_knowledge_graph_living.png)

*The Constellation Knowledge Graph replaces chaotic hairball layouts with 13 spacious, dedicated project galaxies. Satellite nodes orbit cleanly around their respective project hubs, with interactive hover tooltips and a sleek bottom inspector drawer.*

---

## 🌟 What Is Hive?

Most developers use multiple AI assistants simultaneously — ChatGPT for ideation, Claude for code review, Gemini for research, Cursor for in-editor help, and local agents like Antigravity or Claude Code for deeper tasks. Every one of these sessions holds valuable decisions, rejected approaches, architecture choices, and hard-won lessons.

**The problem:** All of that knowledge is siloed, ephemeral, and lost the moment the chat window closes.

**Hive solves this** by:

- 🕸️ **Ingesting** all your AI conversations across every platform and IDE
- 🧹 **Sanitizing** secrets, PII, and ephemeral noise before storage
- 🧠 **Clustering** scattered chats into coherent project workstreams automatically
- 🗺️ **Building** a temporal knowledge graph of your decisions, tech stacks, and anti-patterns
- 🔌 **Serving** this knowledge back to any AI tool via **MCP** — so your next chat already knows what you built before

---

## ✨ Feature Highlights

### 🌐 Universal Chat Ingestion

| Source | Method | Details |
|--------|---------|---------|
| **ChatGPT** | Export ZIP + Live Extension | `conversations.json` bulk import or real-time Chrome sync |
| **Claude** | Export ZIP + Live Extension | `claude.ai` conversation export or live tree extraction |
| **Gemini** | Takeout + Live Extension | `gemini.google.com` live capture + sequential full-history backfill |
| **Cursor** | SQLite State + Plan Scanner | Reads `state.vscdb` (`cursorDiskKV` composer sessions & chat bubbles), `.plan.md` plans, and `agent-transcripts/*.jsonl` |
| **Antigravity** | Local file scanner | Scans session `.md` brain notes and `.system_generated/logs/transcript.jsonl` |
| **Claude Code** | Local file scanner | Reads `~/.claude/` JSONL session logs & project memory files |
| **VS Code / Copilot** | Local file scanner | Extension activity logs |
| **JetBrains AI** | Local file scanner | AI Assistant conversation exports |
| **DeepSeek, Grok, Perplexity, OpenCode, Zed** | Bulk import | Generic JSONL/JSON parser |

### 🔒 Zero-Knowledge Security Pipeline

Every byte passes through a multi-stage security pipeline **before** it touches storage:

1. **Secret Scrubbing** — Regex + Shannon entropy scanner strips API keys, tokens, connection strings, and private keys
2. **AES-256-GCM Envelope Encryption** — All stored content is encrypted with per-record CSPRNG nonces
3. **HMAC Blind Indexing** — Searchable without ever decrypting plaintext (HMAC-SHA256 over search terms)
4. **Ephemeral Noise Filter** — Strips trivial chats (grammar fixes, one-off queries) — only engineering signal is retained

### 🧠 Self-Evolving Knowledge Graph

![Knowledge Graph Canvas](docs/screenshots/hive_knowledge_graph_living.png)

The graph organises your knowledge into **five semantic tiers** using a living Force-Directed Constellation layout:

| Tier | Role | Contents |
|------|------|---------|
| **Architecture** | Project Hubs | Project clusters, major system boundaries |
| **Algorithms & Patterns** | Satellites | Design patterns, algorithmic approaches, code structures |
| **Decisions** | Synapses | Recorded architecture decisions (temporal, with supersession tracking) |
| **Guardrails** | Satellites | Rejected tools, anti-patterns, negative knowledge with reasons |
| **Tech Stack** | Satellites | Languages, frameworks, databases, libraries |

Click any node to inspect its connections, evidence messages, and confidence score:

![Node Inspector](docs/screenshots/hive_knowledge_graph_sidebar.png)

### 🔍 Intelligent Project Clustering

![Projects Tab](docs/screenshots/hive_projects_portfolio_exporter.png)

Hive automatically groups conversations across different AI providers into coherent **project workstreams**. It does not require you to manually tag anything — the clustering engine detects shared tech stacks, overlapping terminology, and decision patterns to learn that "the auth thing I was building in Claude" and "the JWT middleware question in ChatGPT" belong to the same project.

### 💬 All Chats — Unified Reader

![Chats Tab](docs/screenshots/hive_all_chats_reader_verified.png)

Browse all your historical conversations across every platform in one unified, searchable interface. Filter by provider, project, date range, or keyword. Full conversation content is viewable locally with styled message bubbles, timestamps, and syntax-highlighted code.

### 🔌 IDE & MCP Integration

![IDE Connectors Hub](docs/screenshots/hive_connectors_mcp_hub.png)

Connect Hive to your IDEs and AI tools as an MCP server. Once connected, any AI assistant can query your entire knowledge history:

```
User: "Set up authentication for this project."
AI (with Hive MCP): "Based on your previous projects, you use JWT +
  refresh token rotation (decided 3 months ago in Project X). You
  previously rejected Auth0 due to vendor lock-in. Shall I scaffold
  the same pattern?"
```

### 🤖 Self-Overseeing HiveBrain

![Telemetry and Inquiries](docs/screenshots/hive_brain_inquiries_telemetry.png)

The `HiveBrain` autonomous audit engine runs continuously in the background. It:

- **Detects contradictions** — e.g., two projects using conflicting database strategies
- **Flags ambiguities** — e.g., a tech choice adopted in one project but rejected in another
- **Surfaces inquiries** — prompts you to resolve architectural discrepancies when it cannot determine the right answer autonomously
- **Records resolutions** — permanently commits your answers back into the knowledge graph

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 22+** and **npm**
- **Windows / macOS / Linux**
- A Chromium-based browser (Chrome, Edge, Brave, Opera) for the live extension

### 1. Install

```bash
git clone https://github.com/shiva2321/Hive
cd Hive
npm install
npm run build
```

### 2. Start the Hive Daemon

```bash
npm run start:server
```

This starts the local daemon on **port 42424**. Keep this terminal open.

- **Dashboard**: http://localhost:42424
- **API Health**: http://localhost:42424/api/stats

### 3. Install the Browser Extension (v2.1.0)

![Browser Sync Hub](docs/screenshots/hive_browser_sync_hub.png)

The Hive Browser Extension bridges web-based AI platforms directly into your Universal Memory substrate with prompt-first user consent and client-side secret scrubbing.

#### Installation Methods:
- **1-Click Web Download:** Visit the Hive Dashboard at `http://localhost:42424` -> Click **📥 Browser Sync** -> Click **Download Extension (.zip)**. Unzip and click "Load unpacked".
- **Local Workspace:** In `chrome://extensions` or `edge://extensions`, enable **Developer Mode**, click **"Load unpacked"**, and select `e:\universal-ai-memory\extension`.
- **Chrome Web Store:** Direct install available via Web Store package.

#### Dual-Mode Sync Engine:
1. **System Native (Primary):** Connects to `http://localhost:42424` via loopback with zero cloud exposure.
2. **Cloud Processing Fallback:** If the local daemon is offline or you are away from your workstation, conversations are securely staged in local browser storage or routed to your cloud processing endpoint, then automatically flushed to Hive Native upon daemon connection.

#### Prompt-First Privacy & Secret Redaction:
- When you chat on an AI provider, Hive displays a non-intrusive in-page consent prompt asking if you'd like to sync the thread.
- Options: **⚡ Sync Now**, **🔄 Always Auto-Sync This Thread**, or **✕ Dismiss**.
- Client-side pre-sanitizer automatically strips API keys (OpenAI, Anthropic, GitHub, AWS) and private tokens before transmission.

**Supported AI Web Platforms (Live Ingestion):**
- 🤖 **ChatGPT** (`chatgpt.com`, `openai.com`)
- 🧠 **Claude** (`claude.ai`)
- ✨ **Google Gemini** (`gemini.google.com`)
- ⚡ **DeepSeek** (`chat.deepseek.com`)
- 🔍 **Perplexity AI** (`perplexity.ai`)
- 🚀 **Grok / xAI** (`x.ai`)
- 🌊 **Mistral AI** (`chat.mistral.ai`)
- 🌐 **Generic AI Fallback** (any DOM conversation interface)

### 4. Import Your Chat History (Bulk)

Export your existing chats and drop them in:

```bash
# ChatGPT: Settings → Data Controls → Export → extract conversations.json
npm run cli import ~/Downloads/chatgpt-export/conversations.json

# Claude: Settings → Privacy → Export Data → extract conversations.jsonl
npm run cli import ~/Downloads/claude-export.zip

# Google Takeout (Gemini): takeout.google.com → Gemini Apps Activity
npm run cli import ~/Downloads/takeout-gemini.zip

# Auto-scan all local IDE agents (Antigravity, Claude Code, Cursor)
npm run cli scan-local
```

### 5. Connect to Your AI Tools (MCP)

Add Hive to your AI client MCP configuration. For Claude Desktop:

**`claude_desktop_config.json`**:
```json
{
  "mcpServers": {
    "hive": {
      "command": "node",
      "args": ["/absolute/path/to/universal-ai-memory/dist/serving/mcp_server.js"]
    }
  }
}
```

For **Cursor** (`~/.cursor/mcp.json`), **Antigravity**, or **VS Code** (Copilot MCP), use the same `command`/`args` structure.

---

## 🛠️ CLI Reference

```bash
# ── Ingestion ────────────────────────────────────────────────────────────────
npm run cli import <path>        # Import a zip, json, or jsonl export file
npm run cli scan-local           # Scan all local IDE/agent transcript paths
npm run cli scan-local --no-llm  # Fast scan with regex extraction (skips LLM pass)

# ── Inspection ───────────────────────────────────────────────────────────────
npm run cli projects             # List all auto-detected project clusters
npm run cli query <term>         # Full-text query across graph (e.g. "Next.js")
npm run cli stats                # Print graph size, node counts, and insights

# ── Output Generation ────────────────────────────────────────────────────────
npm run cli generate-rules <id>  # Generate CLAUDE.md / .cursorrules for project
```

---

## 🤖 MCP Tool Reference

Once connected, your AI tools can call these tools against your Hive knowledge:

| Tool | Description |
|------|-------------|
| `search_project_memory` | Keyword/semantic search across all past conversations and projects |
| `get_project_context` | Full LLM-ready markdown context pack for a specific project |
| `get_guardrails_and_negative_knowledge` | All rejected tools/patterns and the reasons why |
| `get_developer_preferences` | Your coding style, preferred libraries, and workflow habits |
| `record_decision` | Proactively write a new architecture decision into the graph |
| `list_all_projects` | Enumerate every identified project workstream |
| `query_memory` | Cross-provider query with optional provider filter |
| `get_hive_inquiries` | Retrieve open architectural ambiguities flagged by HiveBrain |
| `resolve_hive_inquiry` | Record your resolution to a HiveBrain ambiguity |

---

## 🔐 Security & Privacy

Hive is built on a **zero-trust, local-first** architecture. Your conversation content **never leaves your machine** unencrypted.

### Secret Scrubbing (Pre-Storage)

Before any content is indexed, the `SecretSanitizer` strips:

| Pattern | Replaced With |
|---------|--------------|
| `sk-[A-Za-z0-9]{32,}` (OpenAI) | `[REDACTED_OPENAI_KEY]` |
| `sk-ant-[A-Za-z0-9_-]{32,}` (Anthropic) | `[REDACTED_ANTHROPIC_KEY]` |
| `(?:AKIA|ASIA)[A-Z0-9]{16}` (AWS) | `[REDACTED_AWS_KEY]` |
| `(?:ghp|gho)_[A-Za-z0-9_]{20,}` (GitHub) | `[REDACTED_GITHUB_TOKEN]` |
| `postgres://user:pass@host/db` | `[REDACTED_DB_CONNECTION_STRING]` |
| `-----BEGIN PRIVATE KEY-----` | `[REDACTED_PRIVATE_KEY]` |
| High-entropy strings (>4.5 bits/char) | `[REDACTED_HIGH_ENTROPY]` |

### Cryptographic Specification

- **Algorithm**: AES-256-GCM (NIST SP 800-38D)
- **Key Derivation**: PBKDF2-SHA256, 100,000 iterations, per-tenant salt
- **Nonce/IV**: 96-bit CSPRNG per record (never reused)
- **Authentication Tag**: 128-bit — tampered ciphertext aborts immediately
- **Search**: HMAC-SHA256 blind indexing — search without decryption

### STRIDE Threat Model

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the full threat matrix covering Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, and Elevation of Privilege — including all implemented mitigations.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Hive Daemon :42424                        │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  REST API   │  │  MCP Server  │  │  Web Dashboard UI   │   │
│  │  /api/*     │  │  stdio/SSE   │  │  /index.html        │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         └────────────────┴──────────────────────┘             │
│                           │                                     │
│              ┌────────────▼────────────┐                       │
│              │       GraphStore        │                        │
│              │  (SQLite + HMAC Index)  │                        │
│              └────────────┬────────────┘                       │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                  │
│         ▼                 ▼                 ▼                  │
│   ┌───────────┐   ┌──────────────┐   ┌──────────────┐         │
│   │ HiveBrain │   │  Ingestion   │   │  Sanitizer   │         │
│   │ Audit &   │   │  Pipeline    │   │  Pre-store   │         │
│   │ Inquiries │   │  + Parsers   │   │  Scrubbing   │         │
│   └───────────┘   └──────────────┘   └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘

 Browser Ext (Manifest V3)     Source Parsers
 chatgpt.com  ──────────────▶  chatgpt · claude · gemini
 claude.ai    ──────────────▶  cursor · antigravity
 gemini.google.com ─────────▶  claude_code · vscode · zed · jetbrains

 Connected IDEs via MCP
 Claude Desktop · Cursor · Antigravity · VS Code · Zed
```

### Source Tree

```
universal-ai-memory/
├── extension/               # Browser extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── content_script.js    # Extracts chats from AI web UIs
│   └── background.js
├── src/
│   ├── api/                 # Express REST API & routes
│   ├── core/
│   │   ├── types.ts         # Canonical data types
│   │   ├── crypto.ts        # AES-256-GCM + HMAC blind indexing
│   │   └── hive_brain.ts    # Self-overseeing audit engine
│   ├── ingestion/
│   │   ├── parsers/         # Per-provider parsers
│   │   │   ├── chatgpt_parser.ts
│   │   │   ├── claude_parser.ts
│   │   │   ├── claude_code_parser.ts
│   │   │   ├── cursor_parser.ts
│   │   │   ├── gemini_parser.ts
│   │   │   └── local_ide_parser.ts
│   │   ├── omni_scanner.ts  # Local IDE path auto-detection
│   │   ├── importer.ts      # Zip/JSON bulk importer
│   │   └── sanitizer.ts     # Pre-storage secret scrubber
│   ├── pipeline/            # Ephemeral filter + project clustering
│   ├── serving/
│   │   ├── mcp_server.ts    # MCP server — 9 intelligence tools
│   │   └── context_generator.ts
│   ├── storage/
│   │   └── graph_store.ts   # SQLite graph persistence
│   └── workers/             # Durable local ingestion queue + worker
├── ui/
│   └── index.html           # Interactive knowledge graph dashboard
├── docs/
│   ├── THREAT_MODEL.md
│   ├── ADR-001-hybrid-graph-pg.md
│   ├── openapi.yaml
│   └── screenshots/
└── test/
```

---

## 🧪 Testing

```bash
npm test                    # Core unit + integration tests
npm run test:enterprise     # Enterprise security & multi-tenant tests
npm run test:mcp            # MCP tool invocation tests
npm run test:encryption     # AES-256-GCM record-level persistence & roundtrip tests
npm run test:all            # Full test suite (all suites combined)
npx tsc --noEmit            # TypeScript type checking
```

Coverage: sanitization, per-provider parsing, ephemeral noise filtering, project clustering, graph storage, AES-256-GCM encryption roundtrips, rule generation, and MCP tool responses.

---

## 🗺️ Roadmap

- [ ] **Vector Embeddings** — Local sentence-transformer embeddings for semantic search
- [ ] **Multi-Device Sync** — Optional E2E encrypted cloud sync for cross-machine access
- [ ] **Firefox / Safari Extensions** — Expand beyond Chromium
- [ ] **Workspace Rules Auto-Push** — Automatically update `.cursorrules` / `CLAUDE.md` on project switch
- [ ] **HiveBrain v2** — LLM-assisted conflict resolution with structured reasoning traces
- [ ] **Hive Lens** — Per-session "what did I learn today?" weekly digest

---

## 📄 Additional Documentation

| Document | Description |
|----------|-------------|
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Full STRIDE security threat model and mitigations |
| [`docs/ADR-001-hybrid-graph-pg.md`](docs/ADR-001-hybrid-graph-pg.md) | Architecture Decision Record: local vs. hybrid graph storage |
| [`docs/openapi.yaml`](docs/openapi.yaml) | REST API OpenAPI 3.0 specification |
| [`SECURITY.md`](SECURITY.md) | Vulnerability disclosure policy |

---

## 📜 License

[ISC](LICENSE) — © 2026 Hive Contributors

---

<div align="center">

**Built for developers who refuse to forget what they have already learned.**

*🐝 Hive — One brain, every AI.*

</div>
