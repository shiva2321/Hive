// ==============================================================================
// Hive Universal Cross-AI Memory Sync — Content Script
// Supports: ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Grok, Mistral, Generic
// Features: In-Page Consent Prompt, Client-Side Secret Sanitization, Auto-Sync
// ==============================================================================

(function() {
  console.log("[Hive] Universal Memory content script initialized on:", window.location.hostname);

  // ----------------------------------------------------------------------------
  // 1. Provider Detection
  // ----------------------------------------------------------------------------
  function detectProvider() {
    const host = window.location.hostname;
    if (host.includes("openai.com") || host.includes("chatgpt.com")) return "chatgpt";
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("gemini.google.com")) return "gemini";
    if (host.includes("perplexity.ai")) return "perplexity";
    if (host.includes("deepseek.com")) return "deepseek";
    if (host.includes("x.ai")) return "grok";
    if (host.includes("mistral.ai")) return "mistral";
    return "generic";
  }

  function getProviderDisplayName(provider) {
    const map = {
      chatgpt: "ChatGPT",
      claude: "Claude",
      gemini: "Google Gemini",
      deepseek: "DeepSeek",
      perplexity: "Perplexity AI",
      grok: "Grok (xAI)",
      mistral: "Mistral AI",
      generic: "AI Assistant"
    };
    return map[provider] || "AI Chat";
  }

  // ----------------------------------------------------------------------------
  // 2. Client-Side Secret Sanitizer (Zero-Leak Privacy Guarantee)
  // ----------------------------------------------------------------------------
  function sanitizeSecrets(text) {
    if (!text || typeof text !== "string") return text;
    return text
      // OpenAI API Keys
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_OPENAI_KEY]")
      // Anthropic API Keys
      .replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_ANTHROPIC_KEY]")
      // GitHub Tokens
      .replace(/gh[pousr]_[A-Za-z0-9_]{36,}/g, "[REDACTED_GITHUB_TOKEN]")
      // AWS Access Key ID
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
      // Generic Private Keys
      .replace(/-----BEGIN[ A-Z0-9_-]+KEY-----[\s\S]*?-----END[ A-Z0-9_-]+KEY-----/g, "[REDACTED_PRIVATE_KEY]")
      // Bearer Tokens
      .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, "Bearer [REDACTED_BEARER_TOKEN]")
      // Common config secrets (password, api_key, auth_token, secret)
      .replace(/((?:api[_-]?key|secret|password|auth[_-]?token)\s*[:=]\s*["'])([^"'\s]{8,})(["'])/gi, "$1[REDACTED_SECRET]$3");
  }

  // ----------------------------------------------------------------------------
  // 3. Robust Multi-Provider Conversation Extractors
  // ----------------------------------------------------------------------------
  function extractCodeSnippetsFromElement(el) {
    const snippets = [];
    const codeBlocks = el.querySelectorAll("pre code, pre");
    codeBlocks.forEach(cb => {
      const rawCode = cb.textContent?.trim() || "";
      const code = sanitizeSecrets(rawCode);
      const langClass = Array.from(cb.classList).find(c => c.startsWith("language-") || c.startsWith("lang-"));
      const language = langClass ? langClass.replace(/^(language-|lang-)/, "") : "text";
      if (code && code.length > 5) {
        snippets.push({ language, code });
      }
    });
    return snippets;
  }

  function extractCurrentConversation() {
    const provider = detectProvider();
    const rawTitle = document.title
      .replace(/ - (ChatGPT|Claude|Gemini|Perplexity|DeepSeek|Mistral)$/, "")
      .replace(/\s*\|\s*(ChatGPT|Claude|Gemini|Perplexity|DeepSeek|Mistral)$/, "")
      .trim() || "Web Conversation";
    const title = sanitizeSecrets(rawTitle);
    const messages = [];
    const timestamp = new Date().toISOString();

    // 1. ChatGPT
    if (provider === "chatgpt") {
      const turns = document.querySelectorAll("[data-message-author-role]");
      turns.forEach((turn, idx) => {
        const role = turn.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
        const content = sanitizeSecrets(turn.textContent || "");
        if (content.trim()) {
          messages.push({
            id: `cg_${Date.now()}_${idx}`,
            role,
            timestamp,
            content,
            codeSnippets: extractCodeSnippetsFromElement(turn),
            tokenCountEst: Math.ceil(content.length / 4)
          });
        }
      });
    }
    // 2. Claude
    else if (provider === "claude") {
      const turns = document.querySelectorAll(".group\\/conversation-turn, .chat-turn, [data-is-streaming], div[data-message-author-role]");
      turns.forEach((turn, idx) => {
        const isUser = turn.querySelector(".font-user-message, [data-testid='user-message']") !== null;
        const text = sanitizeSecrets(turn.textContent || "");
        if (text.trim()) {
          messages.push({
            id: `cl_${Date.now()}_${idx}`,
            role: isUser ? "user" : "assistant",
            timestamp,
            content: text,
            codeSnippets: extractCodeSnippetsFromElement(turn),
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
      });
    }
    // 3. Google Gemini
    else if (provider === "gemini") {
      const querySelectors = "user-query, .user-query-container, [data-test-id='user-query'], .query-text, div.user-query";
      const modelSelectors = "model-response, .model-response-text, [data-test-id='model-response'], message-content, .response-container-content, div.model-response";
      const turns = document.querySelectorAll(`${querySelectors}, ${modelSelectors}`);
      if (turns.length > 0) {
        turns.forEach((turn, idx) => {
          const isUser = turn.matches(querySelectors) || turn.closest("user-query") !== null;
          const text = sanitizeSecrets(turn.textContent || "");
          if (text.trim()) {
            messages.push({
              id: `gm_${Date.now()}_${idx}`,
              role: isUser ? "user" : "assistant",
              timestamp,
              content: text,
              codeSnippets: extractCodeSnippetsFromElement(turn),
              tokenCountEst: Math.ceil(text.length / 4)
            });
          }
        });
      }
    }
    // 4. DeepSeek
    else if (provider === "deepseek") {
      const turns = document.querySelectorAll(".chat-message, div.ds-markdown, [class*='message-item'], div[class*='chatItem']");
      turns.forEach((turn, idx) => {
        const isUser = turn.matches("[class*='user'], [class*='right']") || turn.closest("[class*='user']") !== null;
        const text = sanitizeSecrets(turn.textContent || "");
        if (text.trim()) {
          messages.push({
            id: `ds_${Date.now()}_${idx}`,
            role: isUser ? "user" : "assistant",
            timestamp,
            content: text,
            codeSnippets: extractCodeSnippetsFromElement(turn),
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
      });
    }
    // 5. Perplexity
    else if (provider === "perplexity") {
      const turns = document.querySelectorAll("div.prose, div[dir='auto']");
      turns.forEach((turn, idx) => {
        const isUser = idx % 2 === 0;
        const text = sanitizeSecrets(turn.textContent || "");
        if (text.trim()) {
          messages.push({
            id: `px_${Date.now()}_${idx}`,
            role: isUser ? "user" : "assistant",
            timestamp,
            content: text,
            codeSnippets: extractCodeSnippetsFromElement(turn),
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
      });
    }
    // 6. Grok / xAI
    else if (provider === "grok") {
      const turns = document.querySelectorAll("div[class*='message'], div[class*='bubble'], div[data-testid*='message']");
      turns.forEach((turn, idx) => {
        const isUser = idx % 2 === 0;
        const text = sanitizeSecrets(turn.textContent || "");
        if (text.trim()) {
          messages.push({
            id: `gr_${Date.now()}_${idx}`,
            role: isUser ? "user" : "assistant",
            timestamp,
            content: text,
            codeSnippets: extractCodeSnippetsFromElement(turn),
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
      });
    }
    // 7. Mistral AI
    else if (provider === "mistral") {
      const turns = document.querySelectorAll("div[data-testid='message'], div[class*='message-container'], div[class*='chat-turn']");
      turns.forEach((turn, idx) => {
        const isUser = turn.matches("[data-author='user'], [class*='user']") || (idx % 2 === 0);
        const text = sanitizeSecrets(turn.textContent || "");
        if (text.trim()) {
          messages.push({
            id: `ms_${Date.now()}_${idx}`,
            role: isUser ? "user" : "assistant",
            timestamp,
            content: text,
            codeSnippets: extractCodeSnippetsFromElement(turn),
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
      });
    }
    // 8. Generic Fallback
    else {
      const fallbackTurns = document.querySelectorAll(".conversation-container > *, .chat-history > *, .turn, [role='article']");
      fallbackTurns.forEach((el, idx) => {
        const text = sanitizeSecrets(el.textContent?.trim() || "");
        if (text && text.length > 2) {
          messages.push({
            id: `gen_${Date.now()}_${idx}`,
            role: idx % 2 === 0 ? "user" : "assistant",
            timestamp,
            content: text,
            codeSnippets: extractCodeSnippetsFromElement(el),
            tokenCountEst: Math.ceil(text.length / 4)
          });
        }
      });
    }

    if (messages.length === 0) return null;

    // Use current URL pathname or hash as persistent source thread ID
    const threadKey = (window.location.pathname + window.location.hash).replace(/[^a-zA-Z0-9_-]/g, "_") || `web_${Date.now()}`;

    return {
      id: `${provider}_web_${threadKey}`,
      source: provider,
      sourceId: threadKey,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages
    };
  }

  // ----------------------------------------------------------------------------
  // 4. Interactive In-Page Prompt & Ambient Sync UI
  // ----------------------------------------------------------------------------
  let lastPromptedMsgCount = 0;
  let isPromptOpen = false;

  function getAutoSyncThreadKey() {
    return "hive_autosync_" + (window.location.hostname + window.location.pathname).replace(/[^a-zA-Z0-9_]/g, "_");
  }

  async function checkIsThreadAutoSync() {
    return new Promise((resolve) => {
      const key = getAutoSyncThreadKey();
      chrome.storage.local.get([key], (res) => {
        resolve(Boolean(res[key]));
      });
    });
  }

  async function setThreadAutoSync(enable) {
    const key = getAutoSyncThreadKey();
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: enable }, resolve);
    });
  }

  // Floating Ambient Status Badge
  function ensureAmbientWidget() {
    let widget = document.getElementById("hive-ambient-container");
    if (widget) return widget;

    widget = document.createElement("div");
    widget.id = "hive-ambient-container";
    widget.innerHTML = `
      <div id="hive-ambient-pill" style="
        display: flex;
        align-items: center;
        gap: 7px;
        background: rgba(10, 14, 26, 0.94);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(99, 102, 241, 0.45);
        color: #f8fafc;
        border-radius: 9999px;
        padding: 7px 14px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 16px rgba(99, 102, 241, 0.25);
        cursor: pointer;
        user-select: none;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        font-weight: 600;
      ">
        <span style="font-size: 14px; filter: drop-shadow(0 0 4px rgba(245, 158, 11, 0.6));">🐝</span>
        <span id="hive-ambient-text" style="color: #e2e8f0; letter-spacing: 0.2px;">Hive Memory</span>
        <span id="hive-ambient-mode" style="font-size: 9px; padding: 1px 6px; border-radius: 9999px; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">Native</span>
      </div>

      <!-- Consent Prompt Dialog -->
      <div id="hive-consent-modal" style="
        display: none;
        position: absolute;
        bottom: 44px;
        right: 0;
        width: 330px;
        background: #090d1a;
        border: 1px solid rgba(99, 102, 241, 0.4);
        border-radius: 12px;
        box-shadow: 0 14px 40px rgba(0,0,0,0.65), 0 0 20px rgba(99, 102, 241, 0.2);
        padding: 16px;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #f8fafc;
        animation: hiveFadeSlide 0.2s ease-out;
        z-index: 1000000;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #1e293b; padding-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: #f59e0b;">
            <span>🐝</span>
            <span>Hive Memory Sync</span>
          </div>
          <button id="hivePromptCloseBtn" style="background: none; border: none; color: #94a3b8; font-size: 14px; cursor: pointer; padding: 2px;">✕</button>
        </div>

        <p id="hivePromptTitle" style="font-size: 12px; line-height: 1.45; color: #cbd5e1; margin: 0 0 12px 0;">
          Sync this <strong id="hivePromptProvider" style="color: #60a5fa;">AI</strong> conversation into your Universal Memory substrate?
        </p>

        <div id="hivePromptStats" style="background: rgba(15, 23, 42, 0.8); border: 1px solid #1e293b; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between;">
          <span>Messages: <strong id="hivePromptMsgCount" style="color: #fff;">0</strong></span>
          <span>Security: <strong style="color: #34d399;">Sanitized</strong></span>
          <span id="hivePromptModeStatus" style="color: #818cf8;">Local First</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px;">
          <button id="hivePromptSyncNowBtn" style="
            background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
            border: 1px solid rgba(255,255,255,0.15);
            color: #fff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.15s;
          ">⚡ Sync to Hive Now</button>

          <button id="hivePromptAutoSyncBtn" style="
            background: #1e293b;
            border: 1px solid #334155;
            color: #cbd5e1;
            padding: 7px 12px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.15s;
          ">🔄 Always Auto-Sync This Thread</button>
        </div>

        <div id="hivePromptFeedback" style="display: none; font-size: 11px; text-align: center; margin-top: 8px; color: #34d399;"></div>
      </div>
    `;

    Object.assign(widget.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "999999",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end"
    });

    document.body.appendChild(widget);

    // Pill click toggles prompt dialog
    const pill = document.getElementById("hive-ambient-pill");
    const modal = document.getElementById("hive-consent-modal");
    const closeBtn = document.getElementById("hivePromptCloseBtn");
    const syncNowBtn = document.getElementById("hivePromptSyncNowBtn");
    const autoSyncBtn = document.getElementById("hivePromptAutoSyncBtn");

    pill.addEventListener("mouseenter", () => {
      pill.style.transform = "scale(1.04)";
      pill.style.borderColor = "rgba(99, 102, 241, 0.8)";
    });
    pill.addEventListener("mouseleave", () => {
      pill.style.transform = "scale(1.0)";
      pill.style.borderColor = "rgba(99, 102, 241, 0.45)";
    });

    pill.addEventListener("click", () => {
      toggleConsentModal();
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      modal.style.display = "none";
      isPromptOpen = false;
    });

    syncNowBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = "Processing & Syncing...";
      await performSync(false);
      setTimeout(() => {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = "⚡ Sync to Hive Now";
        modal.style.display = "none";
        isPromptOpen = false;
      }, 1400);
    });

    autoSyncBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      autoSyncBtn.disabled = true;
      await setThreadAutoSync(true);
      autoSyncBtn.textContent = "✓ Auto-Sync Enabled";
      await performSync(true);
      setTimeout(() => {
        modal.style.display = "none";
        isPromptOpen = false;
      }, 1400);
    });

    // Check daemon status to update pill badge
    chrome.runtime.sendMessage({ type: "CHECK_DAEMON_STATUS" }, (res) => {
      const modeEl = document.getElementById("hive-ambient-mode");
      if (modeEl && res) {
        if (res.online) {
          modeEl.textContent = "Native 🟢";
          modeEl.style.background = "rgba(16, 185, 129, 0.2)";
          modeEl.style.color = "#34d399";
        } else if (res.mode === "CLOUD_PROCESSING") {
          modeEl.textContent = "Cloud ☁️";
          modeEl.style.background = "rgba(56, 189, 248, 0.2)";
          modeEl.style.color = "#38bdf8";
        } else {
          modeEl.textContent = `Queue (${res.queuedCount || 0}) 📦`;
          modeEl.style.background = "rgba(245, 158, 11, 0.2)";
          modeEl.style.color = "#fbbf24";
        }
      }
    });

    return widget;
  }

  function toggleConsentModal(forceOpen = null) {
    ensureAmbientWidget();
    const modal = document.getElementById("hive-consent-modal");
    if (!modal) return;

    const shouldOpen = forceOpen !== null ? forceOpen : modal.style.display === "none";
    if (shouldOpen) {
      const convo = extractCurrentConversation();
      const provider = detectProvider();
      document.getElementById("hivePromptProvider").textContent = getProviderDisplayName(provider);
      document.getElementById("hivePromptMsgCount").textContent = convo ? convo.messages.length : "0";
      modal.style.display = "block";
      isPromptOpen = true;
    } else {
      modal.style.display = "none";
      isPromptOpen = false;
    }
  }

  // Performs extraction, client-side sanitization, and dispatches to background service worker
  async function performSync(silent = false) {
    const convo = extractCurrentConversation();
    const pillText = document.getElementById("hive-ambient-text");
    const feedback = document.getElementById("hivePromptFeedback");

    if (!convo || convo.messages.length === 0) {
      if (pillText) {
        pillText.textContent = "No messages found";
        setTimeout(() => { pillText.textContent = "Hive Memory"; }, 2000);
      }
      return;
    }

    if (pillText) pillText.textContent = "Syncing...";

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SYNC_CONVERSATION", payload: convo }, (res) => {
        lastPromptedMsgCount = convo.messages.length;

        if (res && res.success) {
          const modeLabel = res.mode === "LOCAL_NATIVE" ? "Native ✓" : (res.mode === "CLOUD_PROCESSING" ? "Cloud ✓" : "Staged 📦");
          if (pillText) {
            pillText.textContent = `Synced (${modeLabel})`;
            pillText.style.color = "#34d399";
            setTimeout(() => {
              pillText.textContent = "Hive Memory";
              pillText.style.color = "#e2e8f0";
            }, 2500);
          }
          if (feedback) {
            feedback.style.display = "block";
            feedback.textContent = res.message || "✓ Successfully synced to Hive!";
          }
        } else {
          if (pillText) {
            pillText.textContent = "Sync failed";
            pillText.style.color = "#f43f5e";
            setTimeout(() => {
              pillText.textContent = "Hive Memory";
              pillText.style.color = "#e2e8f0";
            }, 2500);
          }
        }
        resolve(res);
      });
    });
  }

  // ----------------------------------------------------------------------------
  // 5. Intelligent Mutation Observer & Auto-Prompt Engine
  // ----------------------------------------------------------------------------
  let debounceTimeout = null;

  async function onDomUpdated() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
      // Check if conversation has completed streaming
      const isStreaming = document.querySelector("[data-is-streaming='true'], .result-streaming, .streaming, button[aria-label*='Stop']") !== null;
      if (isStreaming) return;

      const convo = extractCurrentConversation();
      if (!convo || convo.messages.length < 2) return;

      // Only prompt if new messages arrived since last prompt
      if (convo.messages.length <= lastPromptedMsgCount) return;

      const isAuto = await checkIsThreadAutoSync();
      if (isAuto) {
        // Auto-sync this thread seamlessly
        console.log(`[Hive] Auto-syncing thread with ${convo.messages.length} messages...`);
        await performSync(true);
      } else if (!isPromptOpen) {
        // Prompt user for consent
        console.log(`[Hive] New AI turns detected (${convo.messages.length} messages). Prompting user...`);
        lastPromptedMsgCount = convo.messages.length;
        toggleConsentModal(true);
      }
    }, 1500);
  }

  // Setup DOM observer on page
  const observer = new MutationObserver(onDomUpdated);
  observer.observe(document.body, { childList: true, subtree: true });

  // Initialize widget
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureAmbientWidget);
  } else {
    setTimeout(ensureAmbientWidget, 1000);
  }

  // ----------------------------------------------------------------------------
  // 6. Sidebar Conversation Discovery & Bulk Crawl
  // ----------------------------------------------------------------------------
  // ----------------------------------------------------------------------------
  // 6. Sidebar Conversation Discovery & Deep Extraction
  // ----------------------------------------------------------------------------
  function findSidebarScrollContainer() {
    const candidates = [
      document.querySelector("nav[aria-label*='Chat']"),
      document.querySelector("nav"),
      document.querySelector("aside"),
      document.querySelector("[data-testid*='chat-history']"),
      document.querySelector("[data-testid*='conversation-list']"),
      document.querySelector("div[class*='overflow-y-auto']"),
      document.querySelector("div[class*='scrollbar']")
    ];
    for (const el of candidates) {
      if (el && (el.scrollHeight > el.clientHeight || el.querySelector("a[href*='/chat/'], a[href*='/c/'], a[href*='/app/']"))) {
        return el;
      }
    }
    return document.querySelector("nav") || document.body;
  }

  async function deepAutoScrollSidebar(progressCb) {
    const provider = detectProvider();
    const scrollEl = findSidebarScrollContainer();
    const discovered = new Map();

    function collectCurrentLinks() {
      let selector = 'a[href^="/c/"], a[href^="/chat/"], a[href^="/app/"]';
      if (provider === "claude") selector = 'a[href*="/chat/"]';
      else if (provider === "chatgpt") selector = 'a[href*="/c/"]';
      else if (provider === "gemini") selector = 'a[href*="/app/"]';

      const links = document.querySelectorAll(selector);
      links.forEach(a => {
        const href = a.getAttribute("href") || "";
        const title = sanitizeSecrets(a.textContent?.trim() || "AI Conversation");
        if (href && href.length > 4 && !discovered.has(href)) {
          discovered.set(href, { id: href, title, element: a });
        }
      });
    }

    collectCurrentLinks();
    if (!scrollEl || scrollEl === document.body) {
      return Array.from(discovered.values());
    }

    // Progressively scroll down to defeat virtual-dom lazy loading
    let lastHeight = 0;
    let noChangeCount = 0;
    const originalScrollTop = scrollEl.scrollTop;

    for (let step = 0; step < 40; step++) {
      scrollEl.scrollTop += 450;
      await new Promise(r => setTimeout(r, 90));
      collectCurrentLinks();

      if (progressCb) {
        progressCb(discovered.size);
      }

      const currentScroll = scrollEl.scrollTop + scrollEl.clientHeight;
      if (currentScroll >= scrollEl.scrollHeight - 10) {
        noChangeCount++;
        if (noChangeCount >= 3) break;
      } else {
        noChangeCount = 0;
      }
    }

    scrollEl.scrollTop = originalScrollTop;
    return Array.from(discovered.values());
  }

  // ----------------------------------------------------------------------------
  // 6. Organization ID Resolver & Claude Tree Extractor (Zero Page Navigation)
  // ----------------------------------------------------------------------------
  async function resolveClaudeOrgId() {
    // 1. From document.cookie (lastActiveOrg is always present when logged into claude.ai)
    const cookieMatch = document.cookie.match(/lastActiveOrg=([^;]+)/);
    if (cookieMatch && cookieMatch[1]) {
      const val = decodeURIComponent(cookieMatch[1].trim());
      if (val.length >= 20 && val.includes("-")) return val;
    }

    // 2. From localStorage
    try {
      const localOrg = localStorage.getItem("lastActiveOrg") || localStorage.getItem("currentOrg");
      if (localOrg && localOrg.length >= 20 && localOrg.includes("-")) {
        return localOrg.replace(/["']/g, "").trim();
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val && typeof val === "string" && val.includes("-")) {
          const m = val.match(/"(?:uuid|organizationId|orgId)"\s*:\s*"([a-f0-9-]{36})"/i);
          if (m && m[1]) return m[1];
        }
      }
    } catch (e) {}

    // 3. From /api/organizations
    try {
      const res = await fetch("/api/organizations", { credentials: "include" });
      if (res.ok) {
        const orgs = await res.json();
        if (Array.isArray(orgs) && orgs[0]?.uuid) return orgs[0].uuid;
      }
    } catch (e) {}

    return null;
  }

  function parseClaudeMessageTree(detail) {
    const all = detail.chat_messages || [];
    if (!all.length) return [];

    const byUuid = new Map(all.map(m => [m.uuid, m]));
    let ordered = null;

    const leaf = detail.current_leaf_message_uuid;
    if (leaf && byUuid.has(leaf)) {
      const path = [];
      const seen = new Set();
      let cur = byUuid.get(leaf);
      while (cur && !seen.has(cur.uuid)) {
        seen.add(cur.uuid);
        path.push(cur);
        cur = cur.parent_message_uuid ? byUuid.get(cur.parent_message_uuid) : null;
      }
      if (path.length) ordered = path.reverse();
    }

    if (!ordered || ordered.length === 0) {
      ordered = [...all].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    const messages = [];
    for (let mIdx = 0; mIdx < ordered.length; mIdx++) {
      const m = ordered[mIdx];
      const role = (m.sender === "human" || m.sender === "user") ? "user" : "assistant";

      const parts = [];
      if (m.content && Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === "text" && typeof block.text === "string") {
            parts.push(block.text.trim());
          } else if (block.type === "tool_use") {
            if (block.input && typeof block.input === "object") {
              const code = block.input.content || block.input.code || block.input.command;
              if (code) parts.push(typeof code === "string" ? code : JSON.stringify(code, null, 2));
            }
          }
        }
      } else if (typeof m.text === "string") {
        parts.push(m.text.trim());
      }

      if (m.files && Array.isArray(m.files)) {
        m.files.forEach(f => {
          if (f.file_name) parts.unshift(`[Attachment: ${f.file_name}]`);
        });
      }

      const text = sanitizeSecrets(parts.filter(Boolean).join("\n\n").trim());
      if (text) {
        messages.push({
          id: m.uuid || `cl_msg_${mIdx}`,
          role,
          timestamp: m.created_at || detail.created_at || new Date().toISOString(),
          content: text,
          codeSnippets: [],
          tokenCountEst: Math.ceil(text.length / 4)
        });
      }
    }

    return messages;
  }

  // Scan all conversation links from active DOM (works on main page and on 'View more' full list page)
  async function scanAllChatLinksFromPage() {
    const discovered = new Map();

    function scan() {
      const links = document.querySelectorAll('a[href*="/chat/"]');
      links.forEach(a => {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/chat\/([a-f0-9-]{36})/i);
        if (m && m[1]) {
          const uuid = m[1];
          if (!discovered.has(uuid)) {
            const title = sanitizeSecrets(a.textContent?.trim() || "Claude Conversation");
            discovered.set(uuid, { uuid, title, href });
          }
        }
      });
    }

    scan();

    // 1. Auto-scroll window / documentElement if document body is scrollable (e.g. on View More page)
    if (document.documentElement.scrollHeight > window.innerHeight + 100) {
      const origY = window.scrollY;
      for (let s = 0; s < 35; s++) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 45));
        scan();
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 20) break;
      }
      window.scrollTo(0, origY);
    }

    // 2. Auto-scroll internal scrollable list containers if present
    const scrollContainers = [
      document.querySelector("main"),
      document.querySelector("[role='main']"),
      document.querySelector("div[class*='overflow-y-auto']"),
      document.querySelector("div[class*='chats']"),
      findSidebarScrollContainer()
    ];

    for (const sc of scrollContainers) {
      if (!sc) continue;
      if (sc.scrollHeight > sc.clientHeight + 100) {
        const initial = sc.scrollTop;
        for (let s = 0; s < 30; s++) {
          sc.scrollTop += 600;
          await new Promise(r => setTimeout(r, 45));
          scan();
          if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 20) break;
        }
        sc.scrollTop = initial;
      }
    }

    return Array.from(discovered.values());
  }

  // Unified Claude Multi-Chat Extractor: Zero Navigation, 100% Complete
  async function extractAllClaudeConversations(progressCb) {
    const orgId = await resolveClaudeOrgId();
    console.log("[Hive] Active Claude Organization ID:", orgId);

    const conversationMap = new Map();

    // 1. Query API for all conversations in organization (paginated to retrieve all 210+)
    if (orgId) {
      try {
        if (progressCb) progressCb("crawling", "Querying Claude conversation index...", 0, 0);

        let offset = 0;
        const limit = 50;
        let keepGoing = true;
        let fetchedAny = false;

        while (keepGoing && offset < 1000) {
          const listRes = await fetch(`/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`, {
            credentials: "include",
            headers: { "Content-Type": "application/json" }
          });

          if (!listRes.ok) {
            // If paginated query is rejected, fallback to unpaginated query
            if (offset === 0) {
              const rawRes = await fetch(`/api/organizations/${orgId}/chat_conversations`, {
                credentials: "include",
                headers: { "Content-Type": "application/json" }
              });
              if (rawRes.ok) {
                const rawList = await rawRes.json();
                if (Array.isArray(rawList)) {
                  rawList.forEach(item => {
                    if (item && item.uuid) {
                      conversationMap.set(item.uuid, {
                        uuid: item.uuid,
                        title: sanitizeSecrets(item.name || "Claude Conversation"),
                        created_at: item.created_at,
                        updated_at: item.updated_at
                      });
                    }
                  });
                }
              }
            }
            break;
          }

          const pageList = await listRes.json();
          if (!Array.isArray(pageList) || pageList.length === 0) {
            break;
          }

          fetchedAny = true;
          pageList.forEach(item => {
            if (item && item.uuid) {
              conversationMap.set(item.uuid, {
                uuid: item.uuid,
                title: sanitizeSecrets(item.name || "Claude Conversation"),
                created_at: item.created_at,
                updated_at: item.updated_at
              });
            }
          });

          if (pageList.length < limit) {
            keepGoing = false;
          } else {
            offset += limit;
            await new Promise(r => setTimeout(r, 50));
          }
        }

        // If pagination loop found nothing, try direct unpaginated as fallback
        if (!fetchedAny) {
          const rawRes = await fetch(`/api/organizations/${orgId}/chat_conversations`, {
            credentials: "include",
            headers: { "Content-Type": "application/json" }
          });
          if (rawRes.ok) {
            const rawList = await rawRes.json();
            if (Array.isArray(rawList)) {
              rawList.forEach(item => {
                if (item && item.uuid) {
                  conversationMap.set(item.uuid, {
                    uuid: item.uuid,
                    title: sanitizeSecrets(item.name || "Claude Conversation"),
                    created_at: item.created_at,
                    updated_at: item.updated_at
                  });
                }
              });
            }
          }
        }
      } catch (e) {
        console.warn("[Hive] Could not list chat_conversations via API:", e.message);
      }
    }

    // 2. Also scan active DOM links (especially when on 'View more' full list page)
    const domLinks = await scanAllChatLinksFromPage();
    domLinks.forEach(d => {
      if (!conversationMap.has(d.uuid)) {
        conversationMap.set(d.uuid, {
          uuid: d.uuid,
          title: d.title,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    });

    const itemsToFetch = Array.from(conversationMap.values());
    console.log(`[Hive] Total unique conversations identified: ${itemsToFetch.length}`);

    if (itemsToFetch.length === 0) {
      const active = extractCurrentConversation();
      return active ? [active] : [];
    }

    const fullConversations = [];

    for (let i = 0; i < itemsToFetch.length; i++) {
      const item = itemsToFetch[i];
      if (progressCb) {
        progressCb(
          "crawling",
          `Fetching ${i + 1}/${itemsToFetch.length}: "${item.title.substring(0, 24)}..."`,
          i + 1,
          itemsToFetch.length
        );
      }

      if (orgId) {
        try {
          const detailUrl = `/api/organizations/${orgId}/chat_conversations/${item.uuid}?tree=true&rendering_mode=messages&render_all_tools=true`;
          const detailRes = await fetch(detailUrl, {
            credentials: "include",
            headers: { "Content-Type": "application/json" }
          });

          if (detailRes.ok) {
            const detail = await detailRes.json();
            const messages = parseClaudeMessageTree(detail);

            if (messages.length > 0) {
              fullConversations.push({
                id: `claude_web_${item.uuid}`,
                source: "claude",
                sourceId: item.uuid,
                title: sanitizeSecrets(detail.name || item.title || "Claude Conversation"),
                createdAt: detail.created_at || item.created_at || new Date().toISOString(),
                updatedAt: detail.updated_at || item.updated_at || new Date().toISOString(),
                messages,
                metadata: {
                  model: detail.model || "claude-3-5",
                  rawTurnCount: messages.length,
                  organizationId: orgId
                }
              });
              await new Promise(r => setTimeout(r, 45)); // gentle throttle
              continue;
            }
          }
        } catch (err) {
          console.warn(`[Hive] Error fetching conversation ${item.uuid}:`, err.message);
        }
      }

      // If API fetch was not possible for this item, check if it's the currently open chat
      const currentUuid = window.location.pathname.match(/\/chat\/([a-f0-9-]{36})/i)?.[1];
      if (currentUuid === item.uuid) {
        const active = extractCurrentConversation();
        if (active) fullConversations.push(active);
      }
    }

    return fullConversations;
  }

  // ----------------------------------------------------------------------------
  // 7. Organized ZIP Archive Builder (.txt files + conversations.json + manifest)
  // ----------------------------------------------------------------------------
  async function generateAndDownloadZipArchive(conversations, progressCb) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip library not available in content script.");
    }

    const zip = new JSZip();
    const provider = detectProvider();
    const txtFolder = zip.folder("chats_txt");

    if (progressCb) progressCb("packaging", "Formatting individual .txt chat files...");

    conversations.forEach((convo, idx) => {
      const padIndex = String(idx + 1).padStart(3, "0");
      const cleanTitle = (convo.title || "chat")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .substring(0, 50)
        .replace(/_+/g, "_");
      const filename = `${padIndex}_${cleanTitle}.txt`;

      let txtContent = "================================================================================\n";
      txtContent += `TITLE: ${convo.title}\n`;
      txtContent += `PROVIDER: ${convo.source || provider}\n`;
      txtContent += `ID: ${convo.id}\n`;
      txtContent += `DATE: ${convo.createdAt}\n`;
      txtContent += `TOTAL MESSAGES: ${convo.messages.length}\n`;
      txtContent += "================================================================================\n\n";

      convo.messages.forEach(msg => {
        const roleHeader = msg.role === "user" ? "[USER]" : `[AI ASSISTANT - ${(convo.source || provider).toUpperCase()}]`;
        txtContent += "--------------------------------------------------------------------------------\n";
        txtContent += `${roleHeader} (${msg.timestamp || ""})\n`;
        txtContent += "--------------------------------------------------------------------------------\n";
        txtContent += `${msg.content}\n\n`;
      });

      txtFolder.file(filename, txtContent);
    });

    // Add canonical JSON
    zip.file("conversations.json", JSON.stringify(conversations, null, 2));

    // Add manifest
    const manifest = {
      archiveVersion: "2.1.0",
      generator: "Hive Universal AI Memory Extension",
      provider: provider,
      exportedAt: new Date().toISOString(),
      totalConversations: conversations.length,
      totalMessages: conversations.reduce((acc, c) => acc + (c.messages ? c.messages.length : 0), 0)
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    if (progressCb) progressCb("compressing", "Compressing ZIP archive...");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

    // Trigger browser download cleanly with stopPropagation so single page app does not intercept
    const zipName = `hive_${provider}_${conversations.length}_chats_archive.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    a.style.display = "none";
    a.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000);

    return { zipName, sizeBytes: blob.size };
  }

  // Stream conversations in batches directly to local daemon or queue
  async function streamConversationsToNative(conversations, progressCb) {
    const BATCH_SIZE = 25;
    let synced = 0;

    for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
      const batch = conversations.slice(i, i + BATCH_SIZE);
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "SYNC_CONVERSATION", payload: batch }, (res) => {
          synced += batch.length;
          if (progressCb) progressCb(synced, conversations.length);
          resolve(res);
        });
      });
    }

    // Broadcast sync event to any open Hive Dashboard tabs
    try {
      const bc = new BroadcastChannel("hive_memory_sync");
      bc.postMessage({ type: "SYNC_COMPLETED", count: conversations.length, timestamp: Date.now() });
      bc.close();
    } catch (e) {}

    return synced;
  }

  // ----------------------------------------------------------------------------
  // 8. Unified Extraction Coordinator (Zero Navigation)
  // ----------------------------------------------------------------------------
  let isBulkProcessing = false;

  async function executeFullExtraction(options = { exportZip: true, syncNative: true }) {
    if (isBulkProcessing) return;
    isBulkProcessing = true;

    chrome.runtime.sendMessage({
      type: "CRAWL_PROGRESS",
      status: "started",
      total: 0,
      current: 0,
      label: "Identifying all conversations..."
    });

    const provider = detectProvider();
    let conversations = [];

    if (provider === "claude") {
      conversations = await extractAllClaudeConversations((status, label, current, total) => {
        chrome.runtime.sendMessage({
          type: "CRAWL_PROGRESS",
          status: status,
          total: total || 0,
          current: current || 0,
          label: label
        });
      });
    } else {
      // For other providers, extract active conversation
      const active = extractCurrentConversation();
      if (active) conversations.push(active);
    }

    if (conversations.length === 0) {
      isBulkProcessing = false;
      chrome.runtime.sendMessage({
        type: "CRAWL_PROGRESS",
        status: "error",
        reason: "No conversations found. Please ensure you are logged in to Claude."
      });
      return;
    }

    // Package as ZIP Archive if requested
    let zipResult = null;
    if (options.exportZip) {
      chrome.runtime.sendMessage({
        type: "CRAWL_PROGRESS",
        status: "crawling",
        total: conversations.length,
        current: conversations.length,
        label: `Packaging ${conversations.length} chats into organized .zip archive...`
      });
      zipResult = await generateAndDownloadZipArchive(conversations);
    }

    // Stream into Hive Native / Local Queue
    if (options.syncNative) {
      chrome.runtime.sendMessage({
        type: "CRAWL_PROGRESS",
        status: "crawling",
        total: conversations.length,
        current: 0,
        label: "Securing unique chats in Hive Native Memory..."
      });
      await streamConversationsToNative(conversations, (synced, total) => {
        chrome.runtime.sendMessage({
          type: "CRAWL_PROGRESS",
          status: "crawling",
          total,
          current: synced,
          label: `Secured ${synced}/${total} chats in local Knowledge Graph...`
        });
      });
    }

    isBulkProcessing = false;
    chrome.runtime.sendMessage({
      type: "CRAWL_PROGRESS",
      status: "finished",
      total: conversations.length,
      syncedCount: conversations.length,
      zipName: zipResult?.zipName
    });
  }

  // ----------------------------------------------------------------------------
  // 9. Chrome Runtime Message Listener
  // ----------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "EXTRACT_PAGE_CHAT") {
      const convo = extractCurrentConversation();
      if (convo) {
        chrome.runtime.sendMessage({ type: "SYNC_CONVERSATION", payload: convo }, (res) => {
          sendResponse({ success: true, conversation: convo, daemonResponse: res });
        });
      } else {
        sendResponse({ success: false, reason: "No messages found on active page." });
      }
      return true;
    }

    if (request.type === "START_BULK_CRAWL") {
      executeFullExtraction({ exportZip: false, syncNative: true });
      sendResponse({ success: true, message: "Bulk crawl started." });
      return true;
    }

    if (request.type === "EXPORT_ARCHIVE_ZIP") {
      executeFullExtraction({ exportZip: true, syncNative: true });
      sendResponse({ success: true, message: "Export and sync started." });
      return true;
    }

    if (request.type === "GET_SIDEBAR_COUNT") {
      const provider = detectProvider();
      if (provider === "claude") {
        resolveClaudeOrgId().then(async (orgId) => {
          let count = 0;
          if (orgId) {
            try {
              const res = await fetch(`/api/organizations/${orgId}/chat_conversations?limit=1000`, { credentials: "include" });
              if (res.ok) {
                const list = await res.json();
                if (Array.isArray(list) && list.length > 0) {
                  count = list.length;
                }
              }
            } catch (e) {}

            if (count === 0) {
              try {
                const res = await fetch(`/api/organizations/${orgId}/chat_conversations`, { credentials: "include" });
                if (res.ok) {
                  const list = await res.json();
                  if (Array.isArray(list) && list.length > 0) {
                    count = list.length;
                  }
                }
              } catch (e) {}
            }
          }

          const domCount = document.querySelectorAll('a[href*="/chat/"]').length;
          sendResponse({ count: Math.max(count, domCount) });
        });
        return true;
      }

      // Default
      const count = document.querySelectorAll('a[href^="/c/"], a[href^="/chat/"], a[href^="/app/"]').length;
      sendResponse({ count });
      return true;
    }

    if (request.type === "OPEN_IN_PAGE_PROMPT") {
      toggleConsentModal(true);
      sendResponse({ success: true });
      return true;
    }
  });
})();
