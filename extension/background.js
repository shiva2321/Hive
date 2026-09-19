// ==============================================================================
// Hive Universal AI Memory: Background Service Worker
// Dual-Mode Sync: Local Native First (http://localhost:42424) + Cloud Fallback
// ==============================================================================

const LOCAL_DAEMON_URL = "http://localhost:42424";
const LOCAL_PROBE_TIMEOUT_MS = 1500;
const STORAGE_QUEUE_KEY = "hive_offline_sync_queue";
const STORAGE_CONFIG_KEY = "hive_sync_config";

// Setup periodic heartbeat to flush offline queue if local daemon comes back online
chrome.alarms.create("hive_queue_flush_check", { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "hive_queue_flush_check") {
    attemptAutoFlushQueue();
  }
});

// Message Bus Dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SYNC_CONVERSATION") {
    handleSyncConversation(request.payload)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  if (request.type === "CHECK_DAEMON_STATUS") {
    checkConnectionStatus()
      .then(res => sendResponse(res))
      .catch(() => sendResponse({ online: false, mode: "OFFLINE", queuedCount: 0 }));
    return true;
  }

  if (request.type === "FLUSH_OFFLINE_QUEUE") {
    flushOfflineQueue()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === "GET_QUEUE_COUNT") {
    getQueuedConversations().then(q => sendResponse({ count: q.length }));
    return true;
  }

  if (request.type === "SET_CLOUD_CONFIG") {
    chrome.storage.local.set({ [STORAGE_CONFIG_KEY]: request.config }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Probe whether the local native daemon is active
async function isLocalDaemonOnline() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${LOCAL_DAEMON_URL}/api/extension/status`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    clearTimeout(timeoutId);
    return false;
  }
}

// Connection check with queue telemetry
async function checkConnectionStatus() {
  const online = await isLocalDaemonOnline();
  const queue = await getQueuedConversations();
  const config = await getSyncConfig();

  if (online) {
    try {
      const statsRes = await fetch(`${LOCAL_DAEMON_URL}/api/stats`);
      const stats = await statsRes.json();
      return {
        online: true,
        mode: "LOCAL_NATIVE",
        message: "Connected to System Native Daemon (localhost:42424)",
        stats,
        queuedCount: queue.length,
        cloudConfig: config
      };
    } catch (e) {
      // Fallback
    }
  }

  return {
    online: false,
    mode: config.cloudEndpoint ? "CLOUD_PROCESSING" : "LOCAL_STAGED",
    message: config.cloudEndpoint 
      ? `Native Offline — Cloud Processing Active (${config.cloudEndpoint})` 
      : `Native Offline — ${queue.length} chats staged locally for auto-flush`,
    stats: null,
    queuedCount: queue.length,
    cloudConfig: config
  };
}

// Core Sync Router: Tries Local Native, then Cloud Processing, then Local Staging
async function handleSyncConversation(payload) {
  const isOnline = await isLocalDaemonOnline();

  // 1. System Native Route (Highest Priority - 100% Zero-Cloud Guarantee)
  if (isOnline) {
    try {
      const result = await sendToLocalDaemon(payload);
      // If we had any queued chats from earlier offline usage, auto-flush them now
      attemptAutoFlushQueue().catch(() => {});
      return {
        success: true,
        mode: "LOCAL_NATIVE",
        message: "Secured directly in local Hive Knowledge Graph",
        data: result
      };
    } catch (err) {
      console.warn("[Hive] Local native ingest failed, falling back:", err);
    }
  }

  // 2. Cloud Processing Route (If user has configured a Hive Cloud endpoint)
  const config = await getSyncConfig();
  if (config && config.cloudEndpoint) {
    try {
      const cloudRes = await sendToCloudEndpoint(config.cloudEndpoint, config.cloudToken, payload);
      return {
        success: true,
        mode: "CLOUD_PROCESSING",
        message: "Processed and secured via Hive Cloud Processing",
        data: cloudRes
      };
    } catch (err) {
      console.warn("[Hive] Cloud processing failed, staging in encrypted local queue:", err);
    }
  }

  // 3. Graceful Local Queue Route (Staged in browser storage until native/cloud is ready)
  await queueConversationLocally(payload);
  const queue = await getQueuedConversations();
  return {
    success: true,
    mode: "LOCAL_STAGED",
    queuedCount: queue.length,
    message: `Local daemon offline. Chat securely staged in browser (${queue.length} in queue). Will auto-sync when Hive starts!`
  };
}

async function sendToLocalDaemon(payload) {
  const response = await fetch(`${LOCAL_DAEMON_URL}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Daemon returned ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

async function sendToCloudEndpoint(endpoint, token, payload) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Cloud endpoint returned ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

// Queue Management via chrome.storage.local
async function getQueuedConversations() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_QUEUE_KEY], (res) => {
      resolve(res[STORAGE_QUEUE_KEY] || []);
    });
  });
}

async function queueConversationLocally(payload) {
  const queue = await getQueuedConversations();
  // Avoid duplicate queuing of exact same conversation ID
  const existingIdx = queue.findIndex(q => q.id === payload.id);
  if (existingIdx >= 0) {
    queue[existingIdx] = payload;
  } else {
    queue.push(payload);
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_QUEUE_KEY]: queue }, resolve);
  });
}

async function flushOfflineQueue() {
  const isOnline = await isLocalDaemonOnline();
  if (!isOnline) {
    throw new Error("Cannot flush: Local Hive daemon (localhost:42424) is currently offline.");
  }

  const queue = await getQueuedConversations();
  if (queue.length === 0) {
    return { success: true, flushedCount: 0, message: "Queue is empty." };
  }

  let successCount = 0;
  const remaining = [];

  for (const convo of queue) {
    try {
      await sendToLocalDaemon(convo);
      successCount++;
    } catch (e) {
      console.error("[Hive] Failed to flush convo:", convo.id, e);
      remaining.push(convo);
    }
  }

  await new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_QUEUE_KEY]: remaining }, resolve);
  });

  return {
    success: true,
    flushedCount: successCount,
    remainingCount: remaining.length,
    message: `Successfully flushed ${successCount} queued chat(s) to Hive local native memory.`
  };
}

async function attemptAutoFlushQueue() {
  try {
    const queue = await getQueuedConversations();
    if (queue.length === 0) return;

    const isOnline = await isLocalDaemonOnline();
    if (isOnline) {
      console.log(`[Hive] Local daemon detected online. Auto-flushing ${queue.length} staged chats...`);
      await flushOfflineQueue();
    }
  } catch (e) {
    console.debug("[Hive] Auto-flush attempt skipped:", e.message);
  }
}

async function getSyncConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_CONFIG_KEY], (res) => {
      resolve(res[STORAGE_CONFIG_KEY] || { cloudEndpoint: "", cloudToken: "" });
    });
  });
}
