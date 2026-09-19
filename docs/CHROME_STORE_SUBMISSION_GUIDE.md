# 🚀 Chrome Web Store Global Submission & Publishing Guide

This guide provides the complete, step-by-step procedure for publishing the **Hive Universal Cross-AI Memory Browser Extension** to the **Google Chrome Web Store** for worldwide distribution.

---

## Phase 1: Prerequisites & Developer Account Setup

1. **Google Account:** Ensure you have a Google Account representing your organization or project (e.g., `developer@hivememory.ai` or personal).
2. **Chrome Developer Dashboard Registration:**
   - Navigate to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   - Sign in and pay the **one-time $5 USD registration fee** via Google Pay (this activates permanent publishing rights across all Google accounts).
   - Complete your Developer Profile (Developer Name, Website URL, Support Email).

---

## Phase 2: Generating the Production Package

Run the automated packaging script in the workspace root:

```bash
npm run package:extension
```

This verifies the `manifest.json` V3 schema, checks all required assets (scripts, HTML, and icons at 16x16, 48x48, and 128x128), and generates the production zip file:

```
dist/hive-ai-memory-extension-v2.1.0.zip
```

> **Important:** The zip file contains the files directly at the root of the archive (`manifest.json`, `background.js`, etc.) without a top-level parent folder, which is strictly required by the Chrome Web Store uploader.

---

## Phase 3: Uploading the Extension Bundle

1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click the **"+ New Item"** button in the top right.
3. Drag and drop `dist/hive-ai-memory-extension-v2.1.0.zip` or click "Browse files".
4. The dashboard will unpack and validate your `manifest.json`. You will see the draft item created with version `2.1.0`.

---

## Phase 4: Completing the Store Listing

### 1. Product Details
- **Title:** `Hive: Universal Cross-AI Memory Sync`
- **Short Description (max 132 chars):**  
  `Seamlessly capture, sanitize, and unify your AI chats from ChatGPT, Claude, Gemini, DeepSeek, and Perplexity into your private Hive graph.`
- **Detailed Description:**  
  *(Use the copy below)*

```markdown
🐝 Hive — Universal Cross-AI Memory & Intelligence Substrate

Never lose an architectural decision, code solution, or prompt insight again. Hive connects ChatGPT, Claude, Google Gemini, DeepSeek, Perplexity, Grok, and Mistral directly into your private, unified knowledge graph.

✨ KEY CAPABILITIES:
- 🌐 Universal AI Chat Ingestion: Works seamlessly across ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok, and Mistral.
- 🛡️ Zero-Leak Secret Sanitizer: Client-side engine automatically scrubs API keys (OpenAI, Anthropic, GitHub, AWS), bearer tokens, and private keys directly in your browser before any packet is transmitted.
- 💬 Prompt-First Consent: Hive respects your privacy. Every conversation turn displays an ambient consent prompt—sync once, auto-sync this thread, or dismiss.
- ⚡ Dual-Mode Synchronization: Ingests directly over local loopback (localhost:42424) into your local AES-256 encrypted database with 100% zero-cloud guarantees. If your desktop daemon is offline, chats are securely staged in local browser storage and auto-flush as soon as Hive starts.
- 🔌 Seamless MCP Serving: Access all your indexed conversations and engineering patterns across any IDE (Cursor, VS Code, Claude Code, JetBrains) via Model Context Protocol (MCP).

🔒 PRIVACY-FIRST GUARANTEE:
- 100% Local-First & Zero-Knowledge architecture.
- No third-party tracking, no advertising, and zero data selling.
- Open-source and fully auditable.
```

- **Category:** `Developer Tools` or `Productivity`
- **Language:** `English`

### 2. Graphic Assets
Prepare and upload the following visual assets:
- **Store Icon:** 128 x 128 PNG (automatically generated at `extension/icons/icon128.png`).
- **Screenshots (at least 1 required, up to 5 recommended):**
  - Dimensions: `1280 x 800` or `640 x 400` PNG.
  - You can use the verified screenshot from the repository:  
    `docs/screenshots/hive_browser_sync_hub.png`
  - Additional recommended screenshots:
    1. The in-page consent prompt on ChatGPT / Claude.
    2. The Knowledge Graph view showing clustered project constellations.
    3. The Executive Overview dashboard.
- **Small Promo Tile (Optional but recommended for featured placement):** `440 x 280` PNG.

---

## Phase 5: Privacy Tab & Permissions Justification (Critical for Review)

Google's review team requires explicit justification for each requested permission. Use the exact text below to ensure rapid approval:

### 1. Single Purpose Statement
```
Extracts and consolidates user-consented conversational engineering knowledge from supported web AI tools into the user's private local knowledge graph.
```

### 2. Permissions Justifications

#### `host_permissions` (`chatgpt.com`, `claude.ai`, `gemini.google.com`, `perplexity.ai`, `chat.deepseek.com`, `x.ai`, `chat.mistral.ai`):
```
Required to inspect the DOM of supported AI web interfaces to extract conversation turns and code snippets only when the user explicitly grants consent via the in-page sync prompt.
```

#### `host_permissions` (`http://localhost:42424/*`):
```
Required to transmit sanitized, user-approved conversation turns over local loopback directly to the user's running local desktop Hive daemon (zero-cloud privacy).
```

#### `storage`:
```
Used to persist user settings (such as thread auto-sync preferences) and temporarily stage offline chats in local browser storage when the local daemon is offline.
```

#### `alarms`:
```
Used to periodically check if the local desktop daemon has reconnected in order to automatically flush staged offline chats into the local database.
```

#### `activeTab`:
```
Used by the extension popup to identify which AI provider is currently open in the active tab.
```

### 3. Data Usage Disclosures
- **User Data Collection:** Check **"No, I do not collect or use user data for any purpose other than the core functionality."**
- **Data Sharing:** Check **"I do not transfer or sell user data to third parties."**
- **Data Security:** Confirm that data is transmitted securely (over local loopback or encrypted channels).
- **Privacy Policy Link:** Provide the public HTTPS URL to your hosted `PRIVACY_POLICY.md` (e.g., `https://your-domain.com/privacy` or GitHub Pages link).

---

## Phase 6: Submission & Review Timeline

1. Click **"Submit for Review"** at the top right.
2. Standard review time for Manifest V3 developer extensions with host permissions is **24 to 72 hours**.
3. Once approved, the extension will be live worldwide on the Chrome Web Store URL:  
   `https://chromewebstore.google.com/detail/<extension-id>`
4. You can then update the "Chrome Web Store" link in the Hive Web Dashboard (`ui/index.html`) with the permanent store URL.

---

## Phase 7: Edge Add-ons & Firefox Cross-Publishing

- **Microsoft Edge Add-ons Catalog:**
  - Visit the [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge).
  - Registration is **free**.
  - Edge offers a 1-click **"Import from Chrome Web Store"** feature that imports your approved Chrome listing, metadata, and bundle automatically.
- **Firefox Add-ons (AMO):**
  - Upload to [addons.mozilla.org](https://addons.mozilla.org) using the same Manifest V3 bundle.
