<div align="center">

# 🐝 Hive — Universal AI Memory

**One local, searchable memory for your AI conversations. Chats from ChatGPT, Claude, Gemini, Cursor, Antigravity and Claude Code, grouped by project and served back to any MCP-capable AI tool.**

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-server-purple.svg)](https://modelcontextprotocol.io)
[![Privacy: Local-First](https://img.shields.io/badge/Privacy-Local--First-red.svg)](#security--privacy)

</div>

---

> **Hive** is a local-first memory layer for AI conversations. It collects your chat history from several tools, strips secrets, groups it by project, builds a knowledge graph of decisions, tech choices and rejected approaches, and serves it back to AI assistants through MCP. Everything is stored in a local SQLite database, with content encrypted at rest.

---

## 📸 Executive Command Center & Constellation Knowledge Studio

![Hive Executive Command Center](docs/screenshots/hive_overview_verified.png)

*The dashboard overview: KPI cards, active providers, a project card grid, HiveBrain inquiries, architecture guardrails and recent extractions.*

![Hive Constellation Knowledge Graph](docs/screenshots/hive_knowledge_graph_living.png)

*The knowledge graph view: one cluster per project, with satellite nodes around each project hub, hover tooltips and a bottom inspector drawer.*

---

## 🌟 What Is Hive?

Most developers use multiple AI assistants simultaneously — ChatGPT for ideation, Claude for code review, Gemini for research, Cursor for in-editor help, and local agents like Antigravity or Claude Code for deeper tasks. Every one of these sessions holds valuable decisions, rejected approaches, architecture choices, and hard-won lessons.

**The problem:** All of that knowledge is siloed, ephemeral, and lost the moment the chat window closes.

**Hive solves this** by:

- 🕸️ **Ingesting** your AI conversations from the supported chat sites and local coding tools (see the table below)
- 🧹 **Sanitizing** secrets, PII, and ephemeral noise before storage
- 🧠 **Grouping** scattered chats into project workstreams with rule-based matching
- 🗺️ **Building** a knowledge graph of your decisions, tech stacks, and rejected approaches
- 🔌 **Serving** this knowledge back to any AI tool via **MCP** — so your next chat already knows what you built before

---

## ✨ Feature Highlights

### 🌐 Universal Chat Ingestion

| Source | Method | Details |
|--------|---------|---------|
| **ChatGPT** | Export + live extension | `conversations.json` bulk import, or live capture of the conversation you have open |
| **Claude** | Export + live extension | `claude.ai` export, or live capture with full-history backfill |
| **Gemini** | Takeout + live extension | Takeout import, or live capture with sequential full-history backfill |
| **Cursor** | Local scanner | Reads `state.vscdb` (`cursorDiskKV` composer sessions and chat bubbles), `.plan.md` plans, and `agent-transcripts/*.jsonl` |
| **Antigravity** | Local scanner | Scans session `.md` brain notes and `.system_generated/logs/transcript.jsonl` |
| **Claude Code** | Local scanner | Reads `~/.claude/` JSONL session logs and project memory files |
| **DeepSeek, Perplexity, Grok, Mistral** | Live extension only | Captures the conversation you have open. No history backfill yet |

VS Code / Copilot, JetBrains AI, Zed and OpenCode do not have importers yet (see the roadmap).

### 🔒 Security Pipeline

Conversation text goes through these steps before it is stored:

1. **Secret Scrubbing** — A regex scrubber replaces API keys (OpenAI, Anthropic, GitHub, AWS), private keys, database connection strings, bearer tokens, JWTs and email addresses with placeholders
2. **AES-256-GCM Encryption** — Stored content is encrypted with a random 96-bit nonce per record
3. **HMAC Blind Indexing** — Exact-match lookups on encrypted fields use HMAC-SHA256 blind indexes
4. **Ephemeral Noise Filter** — A keyword-based filter drops trivial chats (grammar fixes, translations, jokes) and keeps conversations with engineering content

### 🧠 Project Knowledge Graph

![Knowledge Graph Canvas](docs/screenshots/hive_knowledge_graph_living.png)

The graph organises your knowledge into **five semantic tiers** using a force-directed constellation layout:

| Tier | Role | Contents |
|------|------|---------|
| **Architecture** | Project Hubs | Project clusters, major system boundaries |
| **Algorithms & Patterns** | Satellites | Design patterns, algorithmic approaches, code structures |
| **Decisions** | Synapses | Recorded architecture decisions (temporal, with supersession tracking) |
| **Guardrails** | Satellites | Rejected tools, anti-patterns, negative knowledge with reasons |
| **Tech Stack** | Satellites | Languages, frameworks, databases, libraries |

Click any node to inspect its connections, evidence messages, and confidence score:

![Node Inspector](docs/screenshots/hive_knowledge_graph_sidebar.png)

### 🔍 Project Grouping

![Projects Tab](docs/screenshots/hive_projects_portfolio_exporter.png)

Hive groups conversations from different AI providers into **project workstreams** without manual tagging. Grouping is rule-based, not a learned model. It uses the project folder when one exists (for example Claude Code sessions), then keyword and tech-stack matching on titles and early messages, so a Claude chat and a ChatGPT chat about the same project can land together.

> **Current limitation:** the rule list in [`src/pipeline/clustering.ts`](src/pipeline/clustering.ts) is tuned to the author's own projects. Other users' chats mostly fall into the general buckets until they add rules for their own projects.

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

### 🤖 HiveBrain: Contradiction Detector

![Telemetry and Inquiries](docs/screenshots/hive_brain_inquiries_telemetry.png)

`HiveBrain` (`src/core/hive_brain.ts`) audits the knowledge graph for conflicts between projects. It runs once each time the daemon starts, not as a continuous background process. It:

- **Detects contradictions** — for example, a technology rejected in one project and used in another
- **Flags ambiguities** — records them as open inquiries instead of picking a side
- **Surfaces inquiries** — lists them in the dashboard and over MCP so you can resolve them
- **Records resolutions** — saves your answers back into the knowledge graph

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

This starts the daemon on **port 42424**. Keep this terminal open. By default it binds to `0.0.0.0` with open CORS, so set `HOST=127.0.0.1` (and `ALLOWED_ORIGINS`) in your environment to keep it reachable from this machine only.

- **Dashboard**: http://localhost:42424
- **API Health**: http://localhost:42424/api/stats

### 3. Install the Browser Extension (v2.1.0)

![Browser Sync Hub](docs/screenshots/hive_browser_sync_hub.png)

The Hive Browser Extension bridges web-based AI platforms directly into your Universal Memory substrate with prompt-first user consent and client-side secret scrubbing.

#### Installation Methods:
- **1-Click Web Download:** Visit the Hive Dashboard at `http://localhost:42424` -> Click **📥 Browser Sync** -> Click **Download Extension (.zip)**. Unzip and click "Load unpacked".
- **Local Workspace:** In `chrome://extensions` or `edge://extensions`, enable **Developer Mode**, click **"Load unpacked"**, and select the `extension/` folder of this repo.
- **Chrome Web Store:** Not published yet. A submission guide is in [`docs/CHROME_STORE_SUBMISSION_GUIDE.md`](docs/CHROME_STORE_SUBMISSION_GUIDE.md).

#### Dual-Mode Sync Engine:
1. **Local daemon (primary):** Sends to `http://localhost:42424` on your machine.
2. **Offline queue / optional cloud endpoint:** If the daemon is not running, conversations are held in local browser storage and flushed when it comes back. If you configure a cloud endpoint in the extension, they go there instead.

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

Live capture takes the conversation you have open. Full-history backfill is implemented for Claude and Gemini only.

### 4. Import Your Chat History (Bulk)

Export your existing chats and drop them in:

```bash
# ChatGPT: Settings → Data Controls → Export → extract conversations.json
npm run cli import ~/Downloads/chatgpt-export/conversations.json

# Claude: Settings → Privacy → Export Data → extract conversations.jsonl
npm run cli import ~/Downloads/claude-export.zip

# Google Takeout (Gemini): takeout.google.com → Gemini Apps Activity
npm run cli import ~/Downloads/takeout-gemini.zip

# Scan local agents (Antigravity, Claude Code, Cursor)
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
      "args": ["/absolute/path/to/Hive/dist/serving/mcp_server.js"]
    }
  }
}
```

Other MCP clients (for example Cursor's `~/.cursor/mcp.json`) use the same `command`/`args` structure; check your client's docs for where the config file lives.

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
| `search_project_memory` | Keyword search across past conversations and projects (vector search is on the roadmap) |
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

Hive is local-first: data is stored in a local SQLite database on your machine, with content encrypted at rest. Two things can send data off the machine: the optional cloud endpoint in the browser extension, and the optional LLM enrichment pass (OpenRouter), which sends conversation text to the model you pick if you set `OPENROUTER_API_KEY`. Skip it with `--no-llm` or by leaving the key unset.

### Secret Scrubbing (Pre-Storage)

Before any content is indexed, the `SecretSanitizer` strips:

| Pattern | Replaced With |
|---------|--------------|
| `sk-[A-Za-z0-9]{32,}` (OpenAI) | `[REDACTED_OPENAI_KEY]` |
| `sk-ant-[A-Za-z0-9_-]{32,}` (Anthropic) | `[REDACTED_ANTHROPIC_KEY]` |
| `(?:AKIA|ASIA)[A-Z0-9]{16}` (AWS) | `[REDACTED_AWS_KEY]` |
| `(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,255}` (GitHub) | `[REDACTED_GITHUB_TOKEN]` |
| `postgres://user:pass@host/db` | `[REDACTED_DB_CONNECTION_STRING]` |
| `-----BEGIN PRIVATE KEY-----` | `[REDACTED_PRIVATE_KEY]` |
| `Bearer <token>` | `Bearer [REDACTED_BEARER_TOKEN]` |
| JWTs (`eyJ…`) | `[REDACTED_JWT_TOKEN]` |
| Email addresses | `[REDACTED_EMAIL]` |

### Cryptographic Specification

- **Algorithm**: AES-256-GCM (NIST SP 800-38D)
- **Key Derivation**: PBKDF2-SHA256, 100,000 iterations, salt derived from the tenant id
- **Nonce/IV**: 96-bit CSPRNG per record (never reused)
- **Authentication Tag**: 128-bit — tampered ciphertext aborts immediately
- **Search**: HMAC-SHA256 blind indexes for exact-match lookups

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
 gemini.google.com ─────────▶  claude_code

 Connected IDEs via MCP
 Any MCP client (stdio or SSE)
```

### Source Tree

```
Hive/
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
│   │   └── hive_brain.ts    # Contradiction / inquiry audit engine
│   ├── ingestion/
│   │   ├── parsers/         # Per-provider parsers
│   │   │   ├── chatgpt_parser.ts
│   │   │   ├── claude_parser.ts
│   │   │   ├── claude_code_parser.ts
│   │   │   ├── cursor_parser.ts
│   │   │   ├── gemini_parser.ts
│   │   │   └── local_ide_parser.ts  # Antigravity transcripts
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

- [ ] **More importers** — VS Code / Copilot, JetBrains AI, Zed, OpenCode
- [ ] **History backfill** for ChatGPT, DeepSeek, Perplexity, Grok and Mistral in the extension
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

[ISC](LICENSE) — © 2026 Shivam Prajapati

---

<div align="center">

**Built for developers who keep re-explaining the same project to every AI tool.**

*🐝 Hive — One brain, every AI.*

</div>
