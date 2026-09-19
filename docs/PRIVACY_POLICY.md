# Hive Privacy Policy

**Effective Date:** September 17, 2026  
**Last Updated:** September 17, 2026  

---

## 1. Introduction & Core Principle: Zero-Knowledge & Local-First

Hive ("we", "our", or "the Extension") is designed from the ground up as a **local-first, privacy-preserving knowledge substrate**. Our foundational philosophy is that your AI conversations, engineering workflows, code snippets, and intellectual property belong exclusively to you. 

The Hive Browser Extension operates under a **Prompt-First Consent** and **Zero-Knowledge** model. We do not sell, rent, monetize, or harvest user data.

---

## 2. Information Collected & How It Is Handled

### 2.1 AI Conversation Transcripts
- **Trigger & Consent:** The Extension only reads AI conversations when you explicitly click **"Sync Now"** or activate **"Always Auto-Sync This Thread"** via the in-page consent prompt. It never passively records web pages in the background without user consent.
- **Client-Side Sanitization:** Prior to storage or transmission, sensitive credentials—including OpenAI API keys (`sk-...`), Anthropic keys (`sk-ant-...`), GitHub PATs (`ghp_...`), AWS credentials (`AKIA...`), Bearer tokens, and private keys—are automatically scrubbed and redacted directly within your browser sandbox.
- **System Native Storage (Default):** By default, conversations are transmitted exclusively over local loopback (`http://localhost:42424`) directly into your local AES-256 encrypted SQLite database. Zero bytes are transmitted to external servers.
- **Offline Staging:** If the local Hive daemon is offline, sanitized conversations are temporarily staged in your browser's encrypted local storage (`chrome.storage.local`) until the local daemon reconnects.

### 2.2 Telemetry & Analytics
- The Extension collects **zero third-party tracking, profiling cookies, or behavioral analytics**.
- No telemetry or tracking scripts (such as Google Analytics or Mixpanel) are embedded in the extension package.

---

## 3. Chrome Web Store Permissions & Justifications

| Permission | Justification |
| :--- | :--- |
| `host_permissions` (`chatgpt.com`, `claude.ai`, `gemini.google.com`, `deepseek.com`, `perplexity.ai`, `x.ai`, `mistral.ai`) | Necessary to inspect the DOM of supported AI web interfaces to extract user-consented conversation turns and code snippets. |
| `host_permissions` (`http://localhost:42424/*`) | Required to securely transmit sanitized conversations over local loopback to your local desktop Hive daemon. |
| `storage` | Used to store user preferences (such as thread auto-sync consent) and temporary offline sync queues locally in the browser. |
| `alarms` | Used to run periodic checks to automatically flush staged offline chats to your local Hive daemon once it starts. |
| `activeTab` | Used to identify the active AI provider when you open the extension popup. |

---

## 4. Data Sharing & Third Parties

- **No Sale of Data:** We do not sell, trade, or transfer your personal data or conversation history to any third parties.
- **No Model Training:** Your data is never used to train machine learning models.
- **Optional Cloud Sync:** If you explicitly configure a remote Hive Cloud endpoint in advanced settings, your conversations are transmitted only to your designated server.

---

## 5. Security Practices

- **Envelope Encryption:** Local data stored by Hive is encrypted using AES-256-GCM.
- **Client-Side Secret Shield:** Credentials and keys are scrubbed before leaving the DOM.
- **Strict Content Security Policy:** The extension restricts external script execution.

---

## 6. Contact & Open Source Verification

Hive is fully open-source and auditable. You can inspect all extension source code in the repository:  
https://github.com/shiva2321/Hive

For security questions or issue disclosures, please open an issue or security advisory on:  
https://github.com/shiva2321/Hive/issues
