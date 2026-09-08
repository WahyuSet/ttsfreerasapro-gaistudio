// AuStudio Playwright Frontend Controller

let ws = null;
let currentSessionName = null;
let isRecording = false;
let isPaused = false;
let recordedSteps = [];
let generatedCode = '';

// DOM Elements
const chromeStatusText = document.getElementById('chrome-status-text');
const sessionNameInput = document.getElementById('session-name-input');
const startUrlInput = document.getElementById('start-url-input');
const headlessToggle = document.getElementById('headless-toggle');

const btnStartRecord = document.getElementById('btn-start-record');
const activeRecordControls = document.getElementById('active-record-controls');
const btnPauseRecord = document.getElementById('btn-pause-record');
const pauseBtnText = document.getElementById('pause-btn-text');
const btnStopRecord = document.getElementById('btn-stop-record');

const sessionHeadline = document.getElementById('session-headline');
const sessionSubline = document.getElementById('session-subline');
const statusPulse = document.getElementById('status-pulse');
const statStepCount = document.getElementById('stat-step-count');
const tabStepCount = document.getElementById('tab-step-count');

const stepsTbody = document.getElementById('steps-tbody');
const historyListContainer = document.getElementById('history-list-container');
const btnRefreshHistory = document.getElementById('btn-refresh-history');

const tabBtnSteps = document.getElementById('tab-btn-steps');
const tabBtnCode = document.getElementById('tab-btn-code');
const panelSteps = document.getElementById('panel-steps');
const panelCode = document.getElementById('panel-code');
const codeOutput = document.getElementById('code-output');
const codeFilePath = document.getElementById('code-file-path');
const btnCopyCode = document.getElementById('btn-copy-code');
const btnReplayCurrent = document.getElementById('btn-replay-current');

// Replay Elements
const replayProgressBox = document.getElementById('replay-progress-box');
const replaySessionName = document.getElementById('replay-session-name');
const replayProgressFill = document.getElementById('replay-progress-fill');
const replayStepInfo = document.getElementById('replay-step-info');
const btnStopReplay = document.getElementById('btn-stop-replay');

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  checkStatus();
  fetchRecordings();
  setupEventListeners();

  // Suggest a default session name
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  sessionNameInput.value = `flow_${pad(now.getHours())}${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
});

// Setup UI Events
function setupEventListeners() {
  btnStartRecord.addEventListener('click', startRecording);
  btnStopRecord.addEventListener('click', stopRecording);
  btnPauseRecord.addEventListener('click', togglePause);
  btnRefreshHistory.addEventListener('click', fetchRecordings);

  tabBtnSteps.addEventListener('click', () => switchTab('steps'));
  tabBtnCode.addEventListener('click', () => switchTab('code'));

  btnCopyCode.addEventListener('click', copyCodeToClipboard);
  btnReplayCurrent.addEventListener('click', () => {
    if (currentSessionName) runReplay(currentSessionName);
  });
  btnStopReplay.addEventListener('click', stopReplay);
}

// Switch between Steps and Code tab
function switchTab(tab) {
  if (tab === 'steps') {
    tabBtnSteps.classList.add('active');
    tabBtnCode.classList.remove('active');
    panelSteps.classList.add('active');
    panelCode.classList.remove('active');
  } else {
    tabBtnCode.classList.add('active');
    tabBtnSteps.classList.remove('active');
    panelCode.classList.add('active');
    panelSteps.classList.remove('active');
  }
}

// WebSocket Connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to AuStudio server');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleSocketMessage(msg.type, msg.data);
    } catch (e) {
      console.error('[WS] Error processing message:', e);
    }
  };

  ws.onclose = () => {
    console.warn('[WS] Connection closed, retrying in 2s...');
    setTimeout(connectWebSocket, 2000);
  };
}

// Handle WebSocket Events
function handleSocketMessage(type, data) {
  console.log(`[WS Event] ${type}`, data);

  switch (type) {
    case 'recorder_started':
      setRecordingState(true);
      currentSessionName = data.sessionName;
      sessionHeadline.innerText = `🔴 Merekam: ${data.sessionName}`;
      sessionSubline.innerText = `Lakukan interaksi manual di jendela Google Chrome Windows. Setiap aksi otomatis disimpan ke disk.`;
      statusPulse.className = 'pulse-indicator recording';
      codeFilePath.innerText = `recordings/${data.sessionName}/script.js`;
      break;

    case 'recorder_step_added':
      appendStepToTable(data.step);
      updateStepCounters(data.totalSteps);
      fetchCurrentSessionCode();
      break;

    case 'recorder_paused':
      isPaused = true;
      pauseBtnText.innerText = 'Resume';
      sessionHeadline.innerText = `⏸️ Perekaman Dijeda`;
      statusPulse.className = 'pulse-indicator';
      break;

    case 'recorder_resumed':
      isPaused = false;
      pauseBtnText.innerText = 'Pause';
      sessionHeadline.innerText = `🔴 Merekam: ${currentSessionName}`;
      statusPulse.className = 'pulse-indicator recording';
      break;

    case 'recorder_stopped':
      setRecordingState(false);
      sessionHeadline.innerText = `✅ Perekaman Selesai (${data.totalSteps} langkah)`;
      sessionSubline.innerText = `File otomatis tersimpan di folder recordings/${data.sessionName}/`;
      statusPulse.className = 'pulse-indicator';
      btnReplayCurrent.style.display = 'inline-flex';
      btnCopyCode.style.display = 'inline-flex';
      fetchRecordings();
      fetchCurrentSessionCode();
      break;

    // Runner / Replay Events
    case 'runner_started':
      showReplayProgress(data.sessionName, data.totalSteps);
      break;

    case 'runner_step':
      updateReplayStep(data);
      break;

    case 'runner_finished':
      finishReplay(data);
      break;

    case 'runner_error':
      alert(`Replay Error: ${data.error}`);
      hideReplayProgress();
      break;
  }
}

// Check initial status
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.chromePath) {
      chromeStatusText.innerText = `Chrome Windows Terdeteksi`;
      chromeStatusText.title = data.chromePath;
    } else {
      chromeStatusText.innerText = `Chrome Channel (Default)`;
    }

    if (data.recorder && data.recorder.isRecording) {
      setRecordingState(true);
      currentSessionName = data.recorder.sessionName;
      sessionHeadline.innerText = `🔴 Merekam: ${currentSessionName}`;
      renderSteps(data.recorder.steps);
      updateStepCounters(data.recorder.totalSteps);
    }
  } catch (err) {
    console.error('Failed to check status:', err);
  }
}

// Start Recording
async function startRecording() {
  const sessionName = sessionNameInput.value.trim() || `session_${Date.now()}`;
  const startUrl = startUrlInput.value.trim() || 'https://bot.sannysoft.com';
  const headless = headlessToggle.checked;

  try {
    btnStartRecord.disabled = true;
    btnStartRecord.innerText = 'Membuka Chrome Windows...';

    const res = await fetch('/api/record/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionName, startUrl, headless })
    });

    const data = await res.json();
    if (!data.success) {
      alert(`Gagal memulai: ${data.error}`);
      btnStartRecord.disabled = false;
      btnStartRecord.innerHTML = `<span class="rec-dot"></span> Mulai Rekam Manual`;
      return;
    }

    recordedSteps = [];
    clearStepsTable();
    currentSessionName = data.sessionName;
    setRecordingState(true);
  } catch (err) {
    alert(`Error: ${err.message}`);
    btnStartRecord.disabled = false;
    btnStartRecord.innerHTML = `<span class="rec-dot"></span> Mulai Rekam Manual`;
  }
}

// Stop Recording
async function stopRecording() {
  try {
    btnStopRecord.disabled = true;
    btnStopRecord.innerText = 'Menyimpan...';

    const res = await fetch('/api/record/stop', { method: 'POST' });
    const data = await res.json();

    btnStopRecord.disabled = false;
    btnStopRecord.innerText = 'Stop & Selesai';
    setRecordingState(false);
  } catch (err) {
    console.error('Failed to stop recording:', err);
  }
}

// Toggle Pause / Resume
async function togglePause() {
  try {
    const endpoint = isPaused ? '/api/record/resume' : '/api/record/pause';
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();
    isPaused = data.isPaused;
    pauseBtnText.innerText = isPaused ? 'Resume' : 'Pause';
  } catch (err) {
    console.error('Failed to toggle pause:', err);
  }
}

// Update UI Recording State
function setRecordingState(recording) {
  isRecording = recording;
  if (recording) {
    btnStartRecord.style.display = 'none';
    activeRecordControls.style.display = 'grid';
    sessionNameInput.disabled = true;
    startUrlInput.disabled = true;
    headlessToggle.disabled = true;
    btnCopyCode.style.display = 'inline-flex';
    btnReplayCurrent.style.display = 'none';
  } else {
    btnStartRecord.style.display = 'inline-flex';
    btnStartRecord.disabled = false;
    btnStartRecord.innerHTML = `<span class="rec-dot"></span> Mulai Rekam Manual`;
    activeRecordControls.style.display = 'none';
    sessionNameInput.disabled = false;
    startUrlInput.disabled = false;
    headlessToggle.disabled = false;
  }
}

// Clear table
function clearStepsTable() {
  stepsTbody.innerHTML = '';
}

// Render all steps
function renderSteps(steps) {
  clearStepsTable();
  if (!steps || steps.length === 0) {
    stepsTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5" class="empty-cell">
          <div class="empty-prompt">
            <div class="empty-icon">🖱️</div>
            <div class="empty-title">Belum ada langkah yang direkam</div>
          </div>
        </td>
      </tr>`;
    return;
  }
  steps.forEach(s => appendStepToTable(s));
}

// Append single step to table
function appendStepToTable(step) {
  const emptyRow = stepsTbody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  tr.id = `step-row-${step.id}`;

  const timeStr = new Date(step.timestamp || Date.now()).toLocaleTimeString();
  const actionBadge = `<span class="badge-action ${step.type}">${step.type}</span>`;
  const selectorDisplay = step.selector
    ? `<code class="selector-code" title="${escapeHtml(step.selector)}">${escapeHtml(step.selector)}</code>`
    : (step.url ? `<code class="selector-code" title="${escapeHtml(step.url)}">${escapeHtml(step.url)}</code>` : '-');

  let valueDisplay = '-';
  if (step.value !== undefined && step.value !== '') {
    valueDisplay = `<span class="value-preview">"${escapeHtml(step.value)}"</span>`;
  } else if (step.key) {
    valueDisplay = `<span class="value-preview">[Key: ${escapeHtml(step.key)}]</span>`;
  } else if (step.text) {
    valueDisplay = `<span class="text-sub">"${escapeHtml(step.text)}"</span>`;
  }

  tr.innerHTML = `
    <td class="step-num">#${step.id}</td>
    <td>${actionBadge}</td>
    <td>${selectorDisplay}</td>
    <td>${valueDisplay}</td>
    <td class="time-stamp">${timeStr}</td>
  `;

  stepsTbody.appendChild(tr);
  tr.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Update step counters
function updateStepCounters(count) {
  statStepCount.innerText = count;
  tabStepCount.innerText = count;
}

// Fetch generated script for current session
async function fetchCurrentSessionCode() {
  if (!currentSessionName) return;
  try {
    const res = await fetch(`/api/recordings/${currentSessionName}`);
    const data = await res.json();
    if (data.success && data.script) {
      generatedCode = data.script;
      codeOutput.innerText = data.script;
      btnCopyCode.style.display = 'inline-flex';
      btnReplayCurrent.style.display = 'inline-flex';
    }
  } catch (err) {
    console.error('Failed to fetch code:', err);
  }
}

// Fetch list of recordings
async function fetchRecordings() {
  try {
    const res = await fetch('/api/recordings');
    const data = await res.json();
    if (data.success) {
      renderRecordingsList(data.recordings);
    }
  } catch (err) {
    console.error('Failed to load recordings:', err);
  }
}

// Render recordings in sidebar
function renderRecordingsList(list) {
  if (!list || list.length === 0) {
    historyListContainer.innerHTML = `<div class="empty-state" style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">Belum ada rekaman tersimpan.</div>`;
    return;
  }

  historyListContainer.innerHTML = '';
  list.forEach(rec => {
    const item = document.createElement('div');
    item.className = 'history-item';
    if (rec.name === currentSessionName) item.classList.add('active');

    const dateStr = rec.updatedAt ? new Date(rec.updatedAt).toLocaleDateString() : '';

    item.innerHTML = `
      <div>
        <div class="history-name" title="${rec.name}">${rec.name}</div>
        <div class="history-meta">${rec.stepCount} langkah • ${dateStr}</div>
      </div>
      <div class="history-actions">
        <button class="btn btn-sm btn-outline" data-action="view" title="Lihat">Buka</button>
        <button class="btn btn-sm btn-success" data-action="run" title="Replay">▶</button>
      </div>
    `;

    // Click item to view
    item.querySelector('[data-action="view"]').addEventListener('click', (e) => {
      e.stopPropagation();
      loadSavedRecording(rec.name);
    });

    // Click run to replay
    item.querySelector('[data-action="run"]').addEventListener('click', (e) => {
      e.stopPropagation();
      runReplay(rec.name);
    });

    item.addEventListener('click', () => loadSavedRecording(rec.name));

    historyListContainer.appendChild(item);
  });
}

// Load a saved recording details
async function loadSavedRecording(name) {
  try {
    const res = await fetch(`/api/recordings/${name}`);
    const data = await res.json();
    if (data.success) {
      currentSessionName = name;
      sessionHeadline.innerText = `📁 Melihat Rekaman: ${name}`;
      sessionSubline.innerText = `Menampilkan ${data.steps.length} langkah tersimpan dari disk.`;
      codeFilePath.innerText = `recordings/${name}/script.js`;

      renderSteps(data.steps);
      updateStepCounters(data.steps.length);

      generatedCode = data.script;
      codeOutput.innerText = data.script;

      btnCopyCode.style.display = 'inline-flex';
      btnReplayCurrent.style.display = 'inline-flex';

      // Highlight active in sidebar
      document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    }
  } catch (err) {
    alert(`Gagal memuat rekaman: ${err.message}`);
  }
}

// Replay Execution
async function runReplay(name) {
  try {
    showReplayProgress(name, 0);
    const res = await fetch(`/api/run/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delayBetweenSteps: 600, headless: false })
    });
    const data = await res.json();
    if (!data.success) {
      alert(`Gagal memutar script: ${data.error}`);
      hideReplayProgress();
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
    hideReplayProgress();
  }
}

async function stopReplay() {
  await fetch('/api/run/stop', { method: 'POST' });
  hideReplayProgress();
}

function showReplayProgress(sessionName, totalSteps) {
  replayProgressBox.style.display = 'block';
  replaySessionName.innerText = sessionName;
  replayProgressFill.style.width = '0%';
  replayStepInfo.innerText = `Menyiapkan Chrome Bawaan Windows...`;
  statusPulse.className = 'pulse-indicator replaying';
}

function updateReplayStep(data) {
  const percent = Math.round((data.current / data.total) * 100);
  replayProgressFill.style.width = `${percent}%`;
  replayStepInfo.innerText = `Langkah ${data.current}/${data.total}: [${data.step.type.toUpperCase()}] ${data.step.selector || data.step.url || ''}`;

  // Highlight row in table
  document.querySelectorAll('.steps-table tbody tr').forEach(r => r.style.backgroundColor = '');
  const targetRow = document.getElementById(`step-row-${data.current}`);
  if (targetRow) {
    targetRow.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function finishReplay(data) {
  replayProgressFill.style.width = '100%';
  replayStepInfo.innerText = `✅ Selesai! Semua langkah berhasil diputar ulang.`;
  statusPulse.className = 'pulse-indicator';
  setTimeout(hideReplayProgress, 3500);
}

function hideReplayProgress() {
  replayProgressBox.style.display = 'none';
  document.querySelectorAll('.steps-table tbody tr').forEach(r => r.style.backgroundColor = '');
}

// Copy Code
function copyCodeToClipboard() {
  if (!generatedCode) return;
  navigator.clipboard.writeText(generatedCode).then(() => {
    const originalText = btnCopyCode.innerText;
    btnCopyCode.innerText = 'Tersalin! ✓';
    btnCopyCode.classList.add('text-green');
    setTimeout(() => {
      btnCopyCode.innerText = originalText;
      btnCopyCode.classList.remove('text-green');
    }, 2000);
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
