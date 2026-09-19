# 🌐 Worldwide Distribution & Cloud Sync Architecture Blueprint

This document outlines the end-to-end technical strategy for distributing Hive to users worldwide and scaling the synchronization substrate from local-native to a globally available cloud-assisted network.

---

## Part 1: Worldwide Distribution Channels

```
                            ┌─────────────────────────────────────────┐
                            │      Hive Universal Distribution        │
                            └────────────────────┬────────────────────┘
                                                 │
         ┌──────────────────────────────┬────────┴─────────────────────┬──────────────────────────────┐
         ▼                              ▼                              ▼                              ▼
┌───────────────────┐        ┌───────────────────┐          ┌───────────────────┐          ┌───────────────────┐
│ Chrome Web Store  │        │ Microsoft Edge    │          │ Firefox AMO       │          │ 1-Click Direct    │
│ (Chrome, Brave,   │        │ Add-ons Catalog   │          │ (Mozilla Firefox) │          │ Website Download  │
│  Opera, Vivaldi)  │        │                   │          │                   │          │ (.zip / .crx)     │
└───────────────────┘        └───────────────────┘          └───────────────────┘          └───────────────────┘
```

### Channel 1: Chrome Web Store (Reaches ~70% of Global Desktop Users)
- **Target Browsers:** Google Chrome, Brave, Opera, Vivaldi, Arc.
- **Process:** One-time developer registration ($5), upload `dist/hive-ai-memory-extension-v2.1.0.zip`, review turnaround 24-72 hours.
- **Automatic Updates:** Chrome automatically pushes new extension versions to all installed users within 24 hours of publishing an update.

### Channel 2: Microsoft Edge Add-ons Catalog (Reaches Enterprise & Windows Users)
- **Target Browser:** Microsoft Edge.
- **Process:** Free registration via Microsoft Partner Center. Direct 1-click import from your approved Chrome Web Store listing.

### Channel 3: Direct Website Download (Self-Hosted Zero-Friction Delivery)
- **Endpoint:** `https://your-hive-website.com/hive-ai-memory-extension.zip` (served directly by our daemon/web server).
- **Use Case:**
  - Instant access for early users without waiting for store reviews.
  - Development builds and custom team deployments.
  - Air-gapped enterprise environments where Chrome Web Store is blocked by corporate firewall.

---

## Part 2: Cloud Sync & Processing Architecture

While Hive's core design is **Local-First Native**, global availability requires a **Cloud Fallback Substrate** for times when a user's desktop computer is closed, or when chatting on mobile devices or secondary computers.

### The Problem It Solves
1. User is chatting with ChatGPT on a work laptop or phone.
2. Their home desktop running `localhost:42424` is asleep or inaccessible.
3. **Solution:** The extension stages the conversation in `chrome.storage.local` and dispatches it to the **Hive Cloud Relay**. When their primary desktop boots up, the desktop daemon auto-fetches and decrypts the new conversations.

```
 [AI Provider Tab]
 (ChatGPT, Claude, etc.)
         │
         ▼
 [Hive Content Script]
 (Client-Side Secret Sanitizer)
         │
         ▼
 [Background Service Worker]
  Checks: Is localhost:42424 reachable?
         ├── YES ──► Ingests directly into Local Native SQLite (0ms latency, zero-cloud)
         │
         └── NO  ──► Encrypts with User Master Key (E2EE)
                       │
                       ▼
                 [Hive Cloud Relay API]
                 (PostgreSQL + pgvector)
                       │
                       │ (When Desktop Daemon boots up)
                       ▼
                 [Desktop Native Daemon]
                 Auto-pulls delta, decrypts locally, 
                 merges into local Knowledge Graph!
```

---

## Part 3: End-to-End Encryption (E2EE) Cloud Security Model

To maintain Hive's zero-knowledge privacy guarantees in the cloud:

1. **Client-Side Envelope Encryption (E2EE):**
   - The browser extension derives an encryption key from the user's Hive Passphrase using PBKDF2 (100,000 iterations of SHA-256).
   - Before any payload leaves the browser for the cloud, the chat turns and code snippets are encrypted using AES-256-GCM.
   - The Cloud Server **never** sees plaintext conversations, API keys, or project names. It only stores ciphertext blobs.

2. **Blind Indexing for Cloud Search:**
   - To allow searching without decrypting on the cloud, the extension generates HMAC-SHA256 blind index tokens for key topics.
   - The cloud database can match search terms without ever having the plaintext or the decryption key.

---

## Part 4: Production Cloud Infrastructure Stack

When you are ready to deploy the Cloud Sync backend, it uses the existing enterprise modules already built in this codebase:

1. **API Server:**
   - Express/Node.js running `src/api/server.ts` containerized in Docker.
   - Hosted on **Google Cloud Run**, **AWS ECS**, or **Render/Fly.io**.
2. **Database:**
   - Managed PostgreSQL with `pgvector` (e.g., Supabase, Neon, or AWS Aurora PostgreSQL).
   - Uses the existing schema from `src/db/schema.sql`.
3. **Authentication:**
   - JWT-based auth or API keys via `authMiddleware` (already implemented in `src/api/middleware/auth.ts`).
4. **Local Daemon Synchronization Worker:**
   - Add a lightweight pull worker to `src/workers/cloud_sync_worker.ts` that polls the Cloud Relay for pending blobs, decrypts with the local master key, and triggers the `ProjectClusterer` and `MemoryExtractor`.

---

## Part 5: Deployment Action Checklist

- [x] Extension icons created (16x16, 48x48, 128x128).
- [x] Manifest V3 updated with icon mappings and proper permissions.
- [x] `npm run package:extension` script created and verified.
- [x] Download button bug fixed with explicit `Content-Disposition` and `download` attribute.
- [x] Privacy Policy drafted (`docs/PRIVACY_POLICY.md`).
- [x] Chrome Web Store submission guide drafted (`docs/CHROME_STORE_SUBMISSION_GUIDE.md`).
- [ ] Create Developer Account on Google Chrome Developer Dashboard ($5).
- [ ] Upload `dist/hive-ai-memory-extension-v2.1.0.zip` to Chrome Web Store.
- [ ] Paste store link into `ui/index.html` once published.
