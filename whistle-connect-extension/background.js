// ============================================
// Whistle Connect - Background Service Worker
// Forked from GTMBase LinkedIn → Clay Sync.
// All third-party analytics endpoints removed.
// Connections are POSTed to a Whistle API endpoint with a per-user API key.
// ============================================

// __WHISTLE_BASE__ is replaced server-side at zip-build time with this
// Whistle workspace's URL. The extension cannot be reconfigured by the user.
const WHISTLE_BASE_URL = "__WHISTLE_BASE__";

const CONFIG = {
  PAGE_SIZE: 100,
  DELAY_MS: 2000,
  BATCH_SIZE: 100, // Connections per Whistle ingestion request
};

// ============================================
// Sync State Management
// ============================================

let syncState = {
  isRunning: false,
  progress: 0,
  progressText: '',
  error: null,
  result: null
};

function updateSyncState(updates) {
  syncState = { ...syncState, ...updates };
  chrome.runtime.sendMessage({ type: 'SYNC_STATE_UPDATE', state: syncState }).catch(() => {});
}

// ============================================
// Message Handling from Popup
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SYNC') {
    handleStartSync(message.apiKey, message.deltaSync, message.lastSyncTime);
    sendResponse({ started: true });
  }
  if (message.type === 'GET_SYNC_STATE') {
    sendResponse(syncState);
  }
  return true;
});

// ============================================
// Sync Logic
// ============================================

async function handleStartSync(apiKey, deltaSync, lastSyncTime) {
  if (syncState.isRunning) return;

  updateSyncState({
    isRunning: true,
    progress: 0,
    progressText: 'Starting sync...',
    error: null,
    result: null,
  });

  const syncStartTime = new Date().toISOString();

  try {
    const liAtCookie = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' });
    const jsessionCookie = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' });

    if (!liAtCookie?.value) {
      throw new Error('Not logged into LinkedIn');
    }
    const csrfToken = jsessionCookie?.value?.replace(/"/g, '') || '';

    // Honour a server-side "Resync all" request — overrides delta for one run.
    let effectiveDelta = deltaSync;
    try {
      const r = await fetch(WHISTLE_BASE_URL + '/api/v1/linkedin/resync-status', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (r.ok) {
        const j = await r.json();
        if (j.forceFullSync) effectiveDelta = false;
      }
    } catch (_) { /* ignore — fall back to user toggle */ }

    let connections = await fetchAllConnections(csrfToken);

    let filteredConnections = connections;
    if (effectiveDelta && lastSyncTime) {
      const lastSync = new Date(lastSyncTime);
      filteredConnections = connections.filter(c => {
        if (!c.connectedAt) return false;
        return new Date(c.connectedAt) > lastSync;
      });
      updateSyncState({ progress: 90, progressText: `Found ${filteredConnections.length} new connections...` });
    }

    if (filteredConnections.length === 0) {
      updateSyncState({
        isRunning: false,
        progress: 100,
        progressText: 'Complete!',
        result: { success: true, message: 'No new connections to sync.', count: 0 },
      });
    } else {
      const totalSent = await sendToWhistle(filteredConnections, apiKey);
      updateSyncState({
        isRunning: false,
        progress: 100,
        progressText: 'Complete!',
        result: {
          success: true,
          message: `Synced ${totalSent.received} connection${totalSent.received === 1 ? '' : 's'}. ${totalSent.newMatches} new in-network match${totalSent.newMatches === 1 ? '' : 'es'}.`,
          count: totalSent.received,
          newMatches: totalSent.newMatches,
        },
      });
    }

    // Persist last sync time + server-reported total connection count.
    // Falls back to the prior stored value if the server didn't return a count.
    const prev = await chrome.storage.local.get(['totalSyncedCount']);
    const totalForDisplay =
      lastReportedTotal != null ? lastReportedTotal : (prev.totalSyncedCount || 0);
    await chrome.storage.local.set({
      lastSyncTime: syncStartTime,
      totalSyncedCount: totalForDisplay,
      lastSyncedConnectionCount: filteredConnections.length || 0,
    });

    // Ack a successful full-resync ONLY after ingest succeeded so a failed
    // run doesn't consume the server-side resync request.
    if (effectiveDelta === false) {
      try {
        await fetch(WHISTLE_BASE_URL + '/api/v1/linkedin/resync-ack', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
      } catch (_) { /* non-fatal — server keeps the flag for next run */ }
    }
  } catch (error) {
    updateSyncState({
      isRunning: false,
      progress: 0,
      error: error.message,
      result: { success: false, message: `Error: ${error.message}` },
    });
  }
}

async function fetchAllConnections(csrfToken) {
  let allConnections = [];
  let start = 0;
  let hasMore = true;
  let totalEstimate = null;

  while (hasMore) {
    updateSyncState({ progressText: `Fetching connections (${allConnections.length} so far)...` });
    const data = await fetchConnectionsPage(start, csrfToken);
    if (totalEstimate === null && data.paging) totalEstimate = data.paging.total || 1000;
    const elements = data.elements || [];
    const parsed = elements.map(parseConnection).filter(c => c !== null);
    allConnections = allConnections.concat(parsed);
    const percent = Math.min((allConnections.length / (totalEstimate || 1000)) * 80, 80);
    updateSyncState({ progress: percent, progressText: `Fetched ${allConnections.length} connections...` });
    hasMore = elements.length === CONFIG.PAGE_SIZE;
    start += CONFIG.PAGE_SIZE;
    if (hasMore) await sleep(CONFIG.DELAY_MS);
  }
  return allConnections;
}

async function fetchConnectionsPage(start, csrfToken) {
  const url = `https://www.linkedin.com/voyager/api/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16&count=${CONFIG.PAGE_SIZE}&q=search&start=${start}`;
  const liAtCookie = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' });
  const response = await fetch(url, {
    headers: {
      'cookie': `li_at=${liAtCookie.value}; JSESSIONID="${csrfToken}"`,
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
    },
  });
  if (!response.ok) throw new Error(`LinkedIn API error: ${response.status}`);
  return response.json();
}

function parseConnection(element) {
  try {
    const profile = element.connectedMemberResolutionResult || {};
    return {
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      fullName: `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
      headline: profile.headline || '',
      profileUrl: profile.publicIdentifier ? `https://www.linkedin.com/in/${profile.publicIdentifier}` : '',
      publicIdentifier: profile.publicIdentifier || '',
      connectedAt: element.createdAt ? new Date(element.createdAt).toISOString() : '',
      entityUrn: profile.entityUrn || '',
    };
  } catch (e) {
    return null;
  }
}

let lastReportedTotal = null;

async function sendToWhistle(connections, apiKey) {
  updateSyncState({ progress: 85, progressText: 'Sending to Whistle...' });

  let received = 0;
  let newMatches = 0;
  lastReportedTotal = null;
  const url = WHISTLE_BASE_URL + '/api/v1/linkedin/connections';

  for (let i = 0; i < connections.length; i += CONFIG.BATCH_SIZE) {
    const batch = connections.slice(i, i + CONFIG.BATCH_SIZE).filter(c => c.entityUrn);
    if (batch.length === 0) continue;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ connections: batch, syncMode: 'delta' }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Whistle API error ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json().catch(() => ({}));
    received += json.received || batch.length;
    newMatches += json.newMatches || 0;
    // Server reports current per-user total — overwrite local count rather than accumulating.
    if (typeof json.totalConnections === 'number') {
      lastReportedTotal = json.totalConnections;
    }

    const percent = 85 + ((i / connections.length) * 15);
    updateSyncState({ progress: percent, progressText: `Sent ${i + batch.length}/${connections.length} to Whistle...` });
    await sleep(150);
  }
  return { received, newMatches };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
