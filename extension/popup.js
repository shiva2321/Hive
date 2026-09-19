// ==============================================================================
// Hive Universal Cross-AI Memory Sync — Popup Script
// Dual-Mode Sync Management, Offline Queue Flush, and Provider Telemetry
// ==============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const statusBadge = document.getElementById("statusBadge");
  const projCount = document.getElementById("projCount");
  const nodeCount = document.getElementById("nodeCount");
  const connModeLabel = document.getElementById("connModeLabel");
  const activeProvider = document.getElementById("activeProvider");
  const activeTabUrl = document.getElementById("activeTabUrl");
  const activeTabBadge = document.getElementById("activeTabBadge");

  const syncTabBtn = document.getElementById("syncTabBtn");
  const openPromptBtn = document.getElementById("openPromptBtn");
  const bulkSyncBtn = document.getElementById("bulkSyncBtn");
  const openDashBtn = document.getElementById("openDashBtn");
  const statusMsg = document.getElementById("statusMsg");

  const queueBanner = document.getElementById("queueBanner");
  const queueCount = document.getElementById("queueCount");
  const flushQueueBtn = document.getElementById("flushQueueBtn");

  const toggleSettingsLink = document.getElementById("toggleSettingsLink");
  const settingsPanel = document.getElementById("settingsPanel");
  const cloudEndpointInput = document.getElementById("cloudEndpointInput");
  const cloudTokenInput = document.getElementById("cloudTokenInput");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");

  // 1. Detect Active Tab Provider
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      const url = tabs[0].url;
      activeTabUrl.textContent = url;

      if (url.includes("gemini.google.com")) {
        activeProvider.textContent = "✨ Target: Google Gemini";
        activeProvider.style.color = "#10b981";
      } else if (url.includes("chatgpt.com") || url.includes("openai.com")) {
        activeProvider.textContent = "🤖 Target: ChatGPT";
        activeProvider.style.color = "#10b981";
      } else if (url.includes("claude.ai")) {
        activeProvider.textContent = "🧠 Target: Claude";
        activeProvider.style.color = "#10b981";
      } else if (url.includes("perplexity.ai")) {
        activeProvider.textContent = "🔍 Target: Perplexity AI";
        activeProvider.style.color = "#10b981";
      } else if (url.includes("deepseek.com")) {
        activeProvider.textContent = "⚡ Target: DeepSeek";
        activeProvider.style.color = "#10b981";
      } else if (url.includes("x.ai")) {
        activeProvider.textContent = "🚀 Target: Grok (xAI)";
        activeProvider.style.color = "#10b981";
      } else if (url.includes("mistral.ai")) {
        activeProvider.textContent = "🌊 Target: Mistral AI";
        activeProvider.style.color = "#10b981";
      } else {
        activeProvider.textContent = "⚠️ Tab: " + (new URL(url).hostname || "Not an AI chat");
        activeProvider.style.color = "#f59e0b";
        activeTabBadge.textContent = "Page Ready";
      }
    }
  });

  // 2. Query Daemon Status & Dual-Mode Telemetry
  function refreshConnectionStatus() {
    chrome.runtime.sendMessage({ type: "CHECK_DAEMON_STATUS" }, (res) => {
      if (!res) return;

      if (res.online) {
        statusBadge.textContent = "Native 🟢";
        statusBadge.className = "status-badge online";
        connModeLabel.textContent = "Local Native (Zero-Cloud)";
        connModeLabel.style.color = "#34d399";

        if (res.stats) {
          projCount.textContent = res.stats.projects || "0";
          nodeCount.textContent = res.stats.graphNodes || "0";
        }
      } else if (res.mode === "CLOUD_PROCESSING") {
        statusBadge.textContent = "Cloud ☁️";
        statusBadge.className = "status-badge cloud";
        connModeLabel.textContent = "Cloud Processing Substrate";
        connModeLabel.style.color = "#38bdf8";
      } else {
        statusBadge.textContent = "Offline 🔴";
        statusBadge.className = "status-badge";
        connModeLabel.textContent = "Native Daemon Offline";
        connModeLabel.style.color = "#f87171";
      }

      // Check Offline Staged Queue
      if (res.queuedCount && res.queuedCount > 0) {
        queueBanner.style.display = "block";
        queueCount.textContent = res.queuedCount;
        flushQueueBtn.disabled = !res.online;
        flushQueueBtn.textContent = res.online ? `⚡ Flush ${res.queuedCount} Chats to Hive Native` : `Local Daemon Offline (${res.queuedCount} staged)`;
      } else {
        queueBanner.style.display = "none";
      }

      // Populate cloud settings inputs if present
      if (res.cloudConfig) {
        cloudEndpointInput.value = res.cloudConfig.cloudEndpoint || "";
        cloudTokenInput.value = res.cloudConfig.cloudToken || "";
      }
    });
  }

  refreshConnectionStatus();

  // 3. Flush Offline Queue Button
  flushQueueBtn.addEventListener("click", () => {
    flushQueueBtn.disabled = true;
    flushQueueBtn.textContent = "Flushing chats to local native...";
    statusMsg.textContent = "Transmitting staged chats to local database...";

    chrome.runtime.sendMessage({ type: "FLUSH_OFFLINE_QUEUE" }, (res) => {
      if (res && res.success) {
        statusMsg.textContent = res.message;
        setTimeout(() => refreshConnectionStatus(), 1200);
      } else {
        statusMsg.textContent = res?.error || "Failed to flush queue.";
        flushQueueBtn.disabled = false;
      }
    });
  });

  // 4. Sync Current Tab
  syncTabBtn.addEventListener("click", () => {
    statusMsg.textContent = "Extracting and sanitizing active chat...";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        statusMsg.textContent = "No active tab found.";
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { type: "EXTRACT_PAGE_CHAT" }, (response) => {
        if (chrome.runtime.lastError) {
          statusMsg.textContent = "Please refresh the AI chat tab and try again.";
          return;
        }

        if (response && response.success) {
          const modeLabel = response.daemonResponse?.mode === "LOCAL_NATIVE" ? "Local Native" : "Staged / Cloud";
          statusMsg.textContent = `✓ Synced via ${modeLabel}: "${response.conversation.title.substring(0, 22)}..."`;
          setTimeout(() => refreshConnectionStatus(), 1500);
        } else {
          statusMsg.textContent = response?.reason || "Failed to extract messages.";
        }
      });
    });
  });

  // 5. Trigger In-Page Consent Prompt on the Active Page
  openPromptBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "OPEN_IN_PAGE_PROMPT" }, () => {
        window.close(); // close popup so user sees prompt on page
      });
    });
  });

  // 6. Bulk Crawl & Organized ZIP Export
  const exportZipBtn = document.getElementById("exportZipBtn");
  const progressContainer = document.getElementById("progressContainer");
  const progressLabel = document.getElementById("progressLabel");
  const progressFraction = document.getElementById("progressFraction");
  const progressBar = document.getElementById("progressBar");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_SIDEBAR_COUNT" }, (res) => {
        if (res && res.count) {
          bulkSyncBtn.textContent = `🚀 Deep Sync All (${res.count} Sidebar Chats)`;
          exportZipBtn.textContent = `📦 Export All (${res.count} Chats) as Archive (.zip)`;
        }
      });
    }
  });

  // Export All as ZIP
  exportZipBtn.addEventListener("click", () => {
    progressContainer.style.display = "block";
    progressLabel.textContent = "Scanning & packaging all chats into .zip...";
    progressBar.style.width = "5%";
    exportZipBtn.disabled = true;
    bulkSyncBtn.disabled = true;
    syncTabBtn.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "EXPORT_ARCHIVE_ZIP" }, (res) => {
        if (chrome.runtime.lastError) {
          progressLabel.textContent = "Please refresh the AI chat page and try again.";
          exportZipBtn.disabled = false;
          bulkSyncBtn.disabled = false;
          syncTabBtn.disabled = false;
        }
      });
    });
  });

  // Deep Sync to Local Daemon
  bulkSyncBtn.addEventListener("click", () => {
    progressContainer.style.display = "block";
    progressLabel.textContent = "Initiating full chat extraction...";
    progressBar.style.width = "5%";
    exportZipBtn.disabled = true;
    bulkSyncBtn.disabled = true;
    syncTabBtn.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "START_BULK_CRAWL" }, (res) => {
        if (chrome.runtime.lastError) {
          progressLabel.textContent = "Error: Please refresh AI chat page.";
          exportZipBtn.disabled = false;
          bulkSyncBtn.disabled = false;
          syncTabBtn.disabled = false;
        }
      });
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CRAWL_PROGRESS") {
      progressContainer.style.display = "block";
      if (msg.status === "started") {
        progressLabel.textContent = msg.label || `Starting sync for ${msg.total} chats...`;
        progressFraction.textContent = `0/${msg.total || 0}`;
        progressBar.style.width = "5%";
      } else if (msg.status === "crawling") {
        const total = msg.total || 1;
        const pct = Math.min(100, Math.round((msg.current / total) * 100));
        progressLabel.textContent = msg.label || (msg.title ? `Extracting: "${msg.title.substring(0, 18)}..."` : "Processing...");
        progressFraction.textContent = `${msg.current}/${total}`;
        progressBar.style.width = `${Math.max(5, pct)}%`;
      } else if (msg.status === "finished") {
        const zipNote = msg.zipName ? ` Downloaded ${msg.zipName}!` : "";
        progressLabel.textContent = `✓ Completed! Synced ${msg.syncedCount || msg.total} chats.${zipNote}`;
        progressFraction.textContent = `${msg.total}/${msg.total}`;
        progressBar.style.width = "100%";
        exportZipBtn.disabled = false;
        bulkSyncBtn.disabled = false;
        syncTabBtn.disabled = false;
        setTimeout(() => refreshConnectionStatus(), 1800);
      } else if (msg.status === "error") {
        progressLabel.textContent = msg.reason || "Error during extraction.";
        exportZipBtn.disabled = false;
        bulkSyncBtn.disabled = false;
        syncTabBtn.disabled = false;
      }
    }
  });

  // 7. Settings Accordion
  toggleSettingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    settingsPanel.style.display = settingsPanel.style.display === "block" ? "none" : "block";
  });

  saveSettingsBtn.addEventListener("click", () => {
    const config = {
      cloudEndpoint: cloudEndpointInput.value.trim(),
      cloudToken: cloudTokenInput.value.trim()
    };
    chrome.runtime.sendMessage({ type: "SET_CLOUD_CONFIG", config }, (res) => {
      statusMsg.textContent = "Cloud configuration saved!";
      setTimeout(() => {
        settingsPanel.style.display = "none";
        refreshConnectionStatus();
      }, 1000);
    });
  });

  // 8. Open Dashboard
  openDashBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:42424" });
  });
});
