// ============================================
// Whistle Connect - Popup UI
// ============================================
//
// The Whistle workspace base URL is baked into the extension at zip-build time.
// Users cannot change it from the popup.

const apiKeyInput = document.getElementById('api-key');
const syncBtn = document.getElementById('sync-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const resultDiv = document.getElementById('result');
const deltaSyncToggle = document.getElementById('delta-sync');
const lastSyncInfo = document.getElementById('last-sync-info');
const linkedinStatusDot = document.getElementById('linkedin-status-dot');
const linkedinStatusText = document.getElementById('linkedin-status-text');
const syncedCountEl = document.getElementById('synced-count');

let lastSyncTime = null;

function fmtSyncStatus(time, count) {
  const pieces = [];
  if (count != null) pieces.push(`${count} connection${count === 1 ? '' : 's'} synced`);
  if (time) pieces.push(`last sync ${new Date(time).toLocaleString()}`);
  return pieces.length ? pieces.join(' · ') : 'Never synced — first run will sync everything.';
}

async function init() {
  const stored = await chrome.storage.local.get(['apiKey', 'lastSyncTime', 'deltaSync', 'totalSyncedCount']);
  if (stored.apiKey) apiKeyInput.value = stored.apiKey;
  if (stored.lastSyncTime) lastSyncTime = stored.lastSyncTime;
  if (stored.deltaSync !== undefined) deltaSyncToggle.checked = stored.deltaSync;

  syncedCountEl.textContent = stored.totalSyncedCount || 0;
  lastSyncInfo.textContent = fmtSyncStatus(stored.lastSyncTime, stored.totalSyncedCount || 0);

  await checkLinkedInStatus();

  const state = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATE' });
  if (state && state.isRunning) showSyncInProgress(state);
  else if (state && state.result) showResult(state.result.success ? 'success' : 'error', state.result.message);

  apiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ apiKey: apiKeyInput.value });
    updateSyncButton();
  });
  deltaSyncToggle.addEventListener('change', () => {
    chrome.storage.local.set({ deltaSync: deltaSyncToggle.checked });
  });
  syncBtn.addEventListener('click', startSync);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SYNC_STATE_UPDATE') handleSyncStateUpdate(message.state);
  });
}

async function checkLinkedInStatus() {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' });
    if (cookie && cookie.value) {
      linkedinStatusDot.classList.add('connected');
      linkedinStatusDot.classList.remove('disconnected');
      linkedinStatusText.textContent = 'Connected';
      updateSyncButton();
    } else {
      throw new Error('Not logged in');
    }
  } catch (e) {
    linkedinStatusDot.classList.add('disconnected');
    linkedinStatusDot.classList.remove('connected');
    linkedinStatusText.textContent = 'Not logged in';
    syncBtn.disabled = true;
  }
}

function updateSyncButton() {
  const hasKey = apiKeyInput.value.trim().length >= 10;
  const isConnected = linkedinStatusDot.classList.contains('connected');
  syncBtn.disabled = !(hasKey && isConnected);
}

function startSync() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showResult('error', 'API key is required.');
    return;
  }
  chrome.runtime.sendMessage({
    type: 'START_SYNC',
    apiKey,
    deltaSync: deltaSyncToggle.checked,
    lastSyncTime,
  });
  showSyncInProgress({ progress: 0, progressText: 'Starting sync...' });
}

function showSyncInProgress(state) {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  progressContainer.classList.add('active');
  resultDiv.className = 'result';
  resultDiv.style.display = 'none';
  updateProgress(state.progress, state.progressText);
}

function handleSyncStateUpdate(state) {
  if (state.isRunning) {
    updateProgress(state.progress, state.progressText);
  } else if (state.result) {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync Connections';
    progressContainer.classList.remove('active');
    showResult(state.result.success ? 'success' : 'error', state.result.message);
    if (state.result.success) {
      chrome.storage.local.get(['lastSyncTime', 'totalSyncedCount']).then(({ lastSyncTime: t, totalSyncedCount: n }) => {
        if (t) lastSyncTime = t;
        syncedCountEl.textContent = n || 0;
        lastSyncInfo.textContent = fmtSyncStatus(t, n || 0);
      });
    }
  }
}

function updateProgress(percent, text) {
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (text) progressText.textContent = text;
}

function showResult(kind, message) {
  resultDiv.className = `result ${kind}`;
  resultDiv.textContent = message;
  resultDiv.style.display = 'block';
}

init();
