const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { RecorderEngine } = require('./recorder-engine');
const { ScriptRunner } = require('./runner');
const { findWindowsChromePath } = require('./stealth-browser');
const { apiKeyAuth, DEFAULT_API_KEY } = require('./auth');
const { TtsEngine } = require('./tts-engine');
const { JobManager } = require('./job-manager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// Global process error resilience: prevent unhandled promise rejections from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Server uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Server unhandledRejection:', reason?.message || reason);
});

app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..', 'public')));

const recorder = new RecorderEngine();
const runner = new ScriptRunner();
const ttsEngine = new TtsEngine();
const jobManager = new JobManager();

// Configure JobManager worker with TtsEngine
jobManager.setWorker(async (params, onProgress) => {
  return await ttsEngine.execute(params, onProgress);
});

// Helper untuk membangun full base URL dari request
function getBaseUrl(req) {
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}`;
}

// Broadcast WebSocket message to all connected clients
function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  }
}

// Forward events from Recorder, Runner, and JobManager to WebSocket
recorder.onEvent((type, payload) => {
  broadcast(`recorder_${type}`, payload);
});

runner.onEvent((type, payload) => {
  broadcast(type, payload);
});

jobManager.on('job:created', (job) => broadcast('job_created', job));
jobManager.on('job:started', (job) => broadcast('job_started', job));
jobManager.on('job:progress', (job) => broadcast('job_progress', job));
jobManager.on('job:completed', (job) => broadcast('job_completed', job));
jobManager.on('job:failed', (job) => broadcast('job_failed', job));
jobManager.on('job:cancelled', (job) => broadcast('job_cancelled', job));

// Health Check Endpoint (Standard /health & /api/health)
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'healthy',
    service: 'AuStudio Gemini TTS API',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    jobs: jobManager.getStats(),
    ttsEngine: {
      isBusy: ttsEngine.isBusy || jobManager.isProcessing,
      queueLength: jobManager.queue.length
    }
  });
});

// Get current system and engine status
app.get('/api/status', (req, res) => {
  res.json({
    chromePath: findWindowsChromePath(),
    recorder: recorder.getStatus(),
    runner: {
      isRunning: runner.isRunning,
      currentStep: runner.currentStep,
      totalSteps: runner.totalSteps
    }
  });
});

// Start recording session
app.post('/api/record/start', async (req, res) => {
  try {
    const { sessionName, startUrl, headless } = req.body;
    const result = await recorder.startSession({
      sessionName: sessionName || `record_${Date.now()}`,
      startUrl: startUrl || 'https://www.google.com',
      headless: Boolean(headless)
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to start recording:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop recording session
app.post('/api/record/stop', async (req, res) => {
  try {
    const result = await recorder.stopSession();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to stop recording:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pause recording
app.post('/api/record/pause', (req, res) => {
  recorder.pause();
  res.json({ success: true, isPaused: true });
});

// Resume recording
app.post('/api/record/resume', (req, res) => {
  recorder.resume();
  res.json({ success: true, isPaused: false });
});

// List all recordings
app.get('/api/recordings', (req, res) => {
  try {
    const list = RecorderEngine.getRecordingsList();
    res.json({ success: true, recordings: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single recording details
app.get('/api/recordings/:name', (req, res) => {
  try {
    const details = RecorderEngine.getRecordingDetails(req.params.name);
    if (!details) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }
    res.json({ success: true, ...details });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run / Replay a recording session
app.post('/api/run/:name', async (req, res) => {
  try {
    const { delayBetweenSteps = 600, headless = false } = req.body;
    // Launch runner asynchronously
    runner.runSession(req.params.name, {
      delayBetweenSteps,
      headless
    }).catch(err => {
      console.error('[Runner] Background execution error:', err);
    });

    res.json({ success: true, message: `Started replay for ${req.params.name}` });
  } catch (err) {
    console.error('[API] Failed to start replay:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop replay
app.post('/api/run/stop', (req, res) => {
  runner.stop();
  res.json({ success: true, message: 'Replay stop requested' });
});

// --- Gemini 2.5 Pro TTS API Endpoints ---

// --- Gemini 2.5 Pro TTS API Endpoints (Jobs & Streaming) ---

// 1. Submit TTS Job (Asynchronous - Rekomendasi Utama)
app.post('/api/tts/jobs', apiKeyAuth, (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const job = jobManager.createJob(req.body);
    const formatted = jobManager.getJob(job.id, baseUrl);

    res.status(202).json({
      success: true,
      message: 'Pekerjaan TTS berhasil dibuat dan dimasukkan ke dalam antrian.',
      jobId: formatted.id,
      status: formatted.status,
      queuePosition: formatted.queuePosition,
      statusUrl: formatted.statusUrl,
      job: formatted
    });
  } catch (err) {
    console.error('[API] Failed to create TTS job:', err.message);
    res.status(400).json({
      success: false,
      error: err.message || 'Bad Request saat membuat pekerjaan TTS.'
    });
  }
});

// 2. Get Job Status & Details by ID
app.get('/api/tts/jobs/:id', apiKeyAuth, (req, res) => {
  const baseUrl = getBaseUrl(req);
  const job = jobManager.getJob(req.params.id, baseUrl);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: `Pekerjaan dengan ID "${req.params.id}" tidak ditemukan.`
    });
  }

  res.json({
    success: true,
    job
  });
});

// 3. List All Jobs (Support filter ?status=... & ?limit=...)
app.get('/api/tts/jobs', apiKeyAuth, (req, res) => {
  const baseUrl = getBaseUrl(req);
  const { status, limit, offset } = req.query;
  const list = jobManager.listJobs({ status, limit, offset }, baseUrl);

  res.json({
    success: true,
    ...list
  });
});

// 4. Cancel a Queued Job
app.delete('/api/tts/jobs/:id', apiKeyAuth, (req, res) => {
  const result = jobManager.cancelJob(req.params.id);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post('/api/tts/jobs/:id/cancel', apiKeyAuth, (req, res) => {
  const result = jobManager.cancelJob(req.params.id);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// 5. Generate speech (Fleksibel: default Async Job, atau ?sync=true untuk sinkron langsung)
app.post('/api/tts/generate', apiKeyAuth, async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const isSync = req.query.sync === 'true' || req.query.sync === '1' || req.body.sync === true;

    // Buat job via JobManager
    const job = jobManager.createJob(req.body);

    if (isSync) {
      // Mode sinkron: Tunggu sampai job selesai sebelum mengirim respons HTTP
      console.log(`[API] Client meminta generate synchronous untuk job ${job.id}...`);
      const completedJob = await jobManager.waitForJob(job.id);
      const formatted = jobManager.getJob(completedJob.id, baseUrl);

      return res.json({
        success: true,
        jobId: formatted.id,
        url: formatted.result ? formatted.result.url : null,
        audio_url: formatted.result ? formatted.result.audio_url : null,
        audio_urls: formatted.result ? formatted.result.audio_urls : [],
        totalChunks: formatted.result ? formatted.result.totalChunks : 1,
        voiceSettings: formatted.result ? formatted.result.voiceSettings : {},
        files: formatted.result ? formatted.result.files : [],
        durationSeconds: formatted.durationSeconds
      });
    }

    // Mode default asynchronous (Teknik Jobs): Langsung kembalikan 202 Accepted
    const formatted = jobManager.getJob(job.id, baseUrl);
    res.status(202).json({
      success: true,
      message: 'Pekerjaan TTS berhasil dibuat. Gunakan statusUrl atau jobId untuk memantau progres.',
      jobId: formatted.id,
      status: formatted.status,
      queuePosition: formatted.queuePosition,
      statusUrl: formatted.statusUrl,
      job: formatted
    });
  } catch (err) {
    console.error('[API] TTS Generation error:', err);
    res.status(400).json({
      success: false,
      error: err.message || 'Error saat memproses pembuatan TTS.'
    });
  }
});

// 6. Stream / Download audio file langsung via URL
app.get('/api/tts/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(ttsEngine.downloadsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File audio tidak ditemukan.' });
  }

  // Jika parameter ?download=1, paksa browser unduh berkas
  if (req.query.download === 'true' || req.query.download === '1') {
    return res.download(filePath, filename);
  }

  // Standar: Stream langsung agar audio tag atau aplikasi client bisa langsung memutar suara
  res.sendFile(filePath, {
    headers: {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes'
    }
  });
});

// 7. Status TTS Engine, Antrian & Statistik Jobs
app.get('/api/tts/status', (req, res) => {
  res.json({
    success: true,
    engine: 'Gemini 2.5 Pro TTS (Google AI Studio)',
    jobs: jobManager.getStats(),
    ...ttsEngine.getStatus()
  });
});

// 4. Daftar Pilihan Suara, Gaya & Preset
app.get('/api/tts/voices', (req, res) => {
  res.json({
    success: true,
    defaultVoice: 'Achernar',
    voices: [
      { name: 'Achernar', gender: 'Female', description: 'Warm, clear, natural, relatable' },
      { name: 'Algenib', gender: 'Male', description: 'Calm, authoritative, professional' },
      { name: 'Aoede', gender: 'Female', description: 'Energetic, cheerful, bright' },
      { name: 'Capella', gender: 'Female', description: 'Articulate, presenter, informative' },
      { name: 'Enif', gender: 'Male', description: 'Deep, resonant, dramatic' },
      { name: 'Kore', gender: 'Female', description: 'Friendly, gentle, conversational' },
      { name: 'Puck', gender: 'Male', description: 'Playful, dynamic, expressive' },
      { name: 'Schedar', gender: 'Male', description: 'Narrative, engaging storyteller' }
    ],
    styles: ['Vocal Smile', 'Natural', 'Whisper', 'Cheer', 'Serious', 'Empathetic'],
    paces: ['Very Slow', 'Slow', 'Natural', 'Fast', 'Very Fast'],
    accents: ['Neutral', 'American', 'British', 'Australian', 'Indian']
  });
});

// Start server with automatic port retry if port is busy
function startServer(port) {
  const srv = server.listen(port, () => {
    console.log(`====================================================`);
    console.log(`🚀 AuStudio Playwright - Stealth TTS & Recorder Server`);
    console.log(`📡 URL: http://localhost:${port}`);
    console.log(`🔑 API Key Auth: Active (${process.env.AUSTUDIO_API_KEY ? 'Custom Key' : 'Default Key: ' + DEFAULT_API_KEY})`);
    console.log(`🎙️  TTS Jobs Endpoint: POST http://localhost:${port}/api/tts/jobs`);
    console.log(`📋 TTS Jobs Status:   GET  http://localhost:${port}/api/tts/jobs/:id`);
    console.log(`🛡️  Stealth Engine: Active (Anti-bot detection bypass)`);
    console.log(`💻 Windows Chrome: ${findWindowsChromePath() || 'channel: chrome'}`);
    console.log(`====================================================`);
  });

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Server] Port ${port} sedang digunakan atau terblokir sistem, mencoba port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[Server] Fatal listen error:', err);
    }
  });
}

if (require.main === module) {
  startServer(Number(PORT) || 3000);
}

module.exports = { app, server, startServer, jobManager, ttsEngine };

