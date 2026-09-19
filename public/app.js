// AuStudio Playwright Frontend Controller

let ws = null;
let currentSessionName = null;
let isRecording = false;
let isPaused = false;
let recordedSteps = [];

const $ = id => document.getElementById(id);
const chromeStatusText = $('chrome-status-text'), sessionNameInput = $('session-name-input'), startUrlInput = $('start-url-input'), headlessToggle = $('headless-toggle');
const btnStartRecord = $('btn-start-record'), activeRecordControls = $('active-record-controls'), btnPauseRecord = $('btn-pause-record'), pauseBtnText = $('pause-btn-text'), btnStopRecord = $('btn-stop-record');
const sessionHeadline = $('session-headline'), sessionSubline = $('session-subline'), statusPulse = $('status-pulse'), statStepCount = $('stat-step-count'), tabStepCount = $('tab-step-count'), stepsTbody = $('steps-tbody');
const historyListContainer = $('history-list-container'), btnRefreshHistory = $('btn-refresh-history'), tabBtnSteps = $('tab-btn-steps'), tabBtnCode = $('tab-btn-code'), panelSteps = $('panel-steps'), panelCode = $('panel-code');
const codeOutput = $('code-output'), codeFilePath = $('code-file-path'), btnCopyCode = $('btn-copy-code'), btnReplayCurrent = $('btn-replay-current');
const replayProgressBox = $('replay-progress-box'), replaySessionName = $('replay-session-name'), replayProgressFill = $('replay-progress-fill'), replayStepInfo = $('replay-step-info'), btnStopReplay = $('btn-stop-replay');

window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  checkStatus();
  fetchRecordings();
  setupEventListeners();

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  sessionNameInput.value = `flow_${pad(now.getHours())}${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
});

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

function switchTab(tab) {
  const isSteps = tab === 'steps';
  tabBtnSteps.classList.toggle('active', isSteps);
  panelSteps.classList.toggle('active', isSteps);
  tabBtnCode.classList.toggle('active', !isSteps);
  panelCode.classList.toggle('active', !isSteps);
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleSocketMessage(msg.type, msg.data);
    } catch (e) {
      console.error('[WS] Error processing message:', e);
    }
  };
  ws.onclose = () => setTimeout(connectWebSocket, 2000);
}

function handleSocketMessage(type, data) {
  switch (type) {
    case 'recorder_started':
      setRecordingState(true);
      currentSessionName = data.sessionName;
      sessionHeadline.innerText = `Merekam: ${data.sessionName}`;
      sessionSubline.innerText = 'Lakukan interaksi manual di jendela Google Chrome Windows.';
      statusPulse.className = 'pulse-indicator recording';
      codeFilePath.innerText = `recordings/${data.sessionName}/script.js`;
      break;
    case 'recorder_step_added':
      appendStepToTable(data.step, stepsTbody);
      updateStepCounters(data.totalSteps);
      fetchCurrentSessionCode();
      break;
    case 'recorder_paused':
      isPaused = true;
      pauseBtnText.innerText = 'Resume';
      sessionHeadline.innerText = 'Perekaman Dijeda';
      statusPulse.className = 'pulse-indicator';
      break;
    case 'recorder_resumed':
      isPaused = false;
      pauseBtnText.innerText = 'Pause';
      sessionHeadline.innerText = `Merekam: ${currentSessionName}`;
      statusPulse.className = 'pulse-indicator recording';
      break;
    case 'recorder_stopped':
      setRecordingState(false);
      sessionHeadline.innerText = `Perekaman Selesai (${data.totalSteps} langkah)`;
      sessionSubline.innerText = `File otomatis tersimpan di folder recordings/${data.sessionName}/`;
      statusPulse.className = 'pulse-indicator';
      btnReplayCurrent.style.display = 'inline-flex';
      btnCopyCode.style.display = 'inline-flex';
      fetchRecordings();
      fetchCurrentSessionCode();
      break;
    case 'runner_started':
      showReplayBox(replayProgressBox, replaySessionName, replayStepInfo, replayProgressFill, data.sessionName, data.totalSteps);
      break;
    case 'runner_step':
      updateReplayStepUi(replayProgressFill, replayStepInfo, data);
      break;
    case 'runner_finished':
      finishReplayUi(replayProgressFill, replayStepInfo, replayProgressBox, data.totalSteps);
      break;
    case 'runner_error':
      alert(`Replay Error: ${data.error}`);
      replayProgressBox.style.display = 'none';
      break;
  }
}

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    chromeStatusText.innerText = data.chromePath ? 'Chrome Windows Terdeteksi' : 'Chrome Channel (Default)';
    if (data.chromePath) chromeStatusText.title = data.chromePath;

    if (data.recorder && data.recorder.isRecording) {
      setRecordingState(true);
      currentSessionName = data.recorder.sessionName;
      sessionHeadline.innerText = `Merekam: ${currentSessionName}`;
      renderSteps(data.recorder.steps, stepsTbody);
      updateStepCounters(data.recorder.totalSteps);
    }
  } catch (err) {
    console.error('Failed to check status:', err);
  }
}

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
      btnStartRecord.innerHTML = '<span class="rec-dot"></span> Mulai Rekam Manual';
      return;
    }
    recordedSteps = [];
    clearStepsTable(stepsTbody);
    currentSessionName = data.sessionName;
    setRecordingState(true);
  } catch (err) {
    alert(`Error: ${err.message}`);
    btnStartRecord.disabled = false;
    btnStartRecord.innerHTML = '<span class="rec-dot"></span> Mulai Rekam Manual';
  }
}

async function stopRecording() {
  try {
    btnStopRecord.disabled = true;
    btnStopRecord.innerText = 'Menyimpan...';
    await fetch('/api/record/stop', { method: 'POST' });
    btnStopRecord.disabled = false;
    btnStopRecord.innerText = 'Stop & Selesai';
    setRecordingState(false);
  } catch (err) {
    console.error('Failed to stop recording:', err);
  }
}

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

function setRecordingState(recording) {
  isRecording = recording;
  btnStartRecord.style.display = recording ? 'none' : 'inline-flex';
  activeRecordControls.style.display = recording ? 'grid' : 'none';
  sessionNameInput.disabled = recording;
  startUrlInput.disabled = recording;
  headlessToggle.disabled = recording;
  btnCopyCode.style.display = recording ? 'inline-flex' : 'none';
  btnReplayCurrent.style.display = 'none';
  if (!recording) {
    btnStartRecord.disabled = false;
    btnStartRecord.innerHTML = '<span class="rec-dot"></span> Mulai Rekam Manual';
  }
}

function updateStepCounters(count) {
  statStepCount.innerText = count || 0;
  tabStepCount.innerText = count || 0;
}

async function fetchRecordings() {
  try {
    const res = await fetch('/api/recordings');
    const data = await res.json();
    if (data.success) {
      renderRecordingsList(data.recordings, historyListContainer, viewRecordingSession, runReplay);
    }
  } catch (err) {
    console.error('Failed to fetch recordings:', err);
  }
}

async function viewRecordingSession(sessionName) {
  try {
    const res = await fetch(`/api/recordings/${sessionName}`);
    const data = await res.json();
    if (!data.success) return;
    currentSessionName = data.name;
    sessionHeadline.innerText = `Sesi: ${data.name}`;
    sessionSubline.innerText = `Total ${data.steps.length} langkah terekam.`;
    renderSteps(data.steps, stepsTbody);
    updateStepCounters(data.steps.length);
    codeOutput.textContent = data.script || '// Tidak ada skrip.';
    codeFilePath.innerText = `recordings/${data.name}/script.js`;
    btnReplayCurrent.style.display = 'inline-flex';
    btnCopyCode.style.display = 'inline-flex';
  } catch (err) {
    console.error('Failed to view recording:', err);
  }
}

async function fetchCurrentSessionCode() {
  if (!currentSessionName) return;
  try {
    const res = await fetch(`/api/recordings/${currentSessionName}`);
    const data = await res.json();
    if (data.success && data.script) {
      codeOutput.textContent = data.script;
    }
  } catch (e) {}
}

function copyCodeToClipboard() {
  const code = codeOutput.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    const orig = btnCopyCode.innerHTML;
    btnCopyCode.innerText = 'Tersalin!';
    setTimeout(() => { btnCopyCode.innerHTML = orig; }, 1500);
  });
}

async function runReplay(sessionName) {
  try {
    const res = await fetch(`/api/run/${sessionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delayBetweenSteps: 600, headless: false })
    });
    const data = await res.json();
    if (!data.success) alert(`Gagal replay: ${data.error}`);
  } catch (err) {
    alert(`Error replay: ${err.message}`);
  }
}

async function stopReplay() {
  try { await fetch('/api/run/stop', { method: 'POST' }); } catch (e) {}
}
