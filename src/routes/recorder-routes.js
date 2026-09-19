const express = require('express');
const { RecorderEngine } = require('../recorder-engine');

/**
 * Membuat router untuk endpoint perekam dan runner sesi Playwright
 * @param {Object} deps
 * @param {RecorderEngine} deps.recorder
 * @param {import('../runner').ScriptRunner} deps.runner
 * @returns {express.Router}
 */
function createRecorderRouter({ recorder, runner }) {
  const router = express.Router();

  // Start recording
  router.post('/record/start', async (req, res) => {
    try {
      const { sessionName, startUrl, headless } = req.body;
      const result = await recorder.startSession({
        sessionName: sessionName || `record_${Date.now()}`,
        startUrl: startUrl || 'https://www.google.com',
        headless: Boolean(headless)
      });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[API] Gagal memulai rekaman:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Stop recording
  router.post('/record/stop', async (req, res) => {
    try {
      const result = await recorder.stopSession();
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[API] Gagal menghentikan rekaman:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Pause & Resume
  router.post('/record/pause', (req, res) => {
    recorder.pause();
    res.json({ success: true, isPaused: true });
  });

  router.post('/record/resume', (req, res) => {
    recorder.resume();
    res.json({ success: true, isPaused: false });
  });

  // Recordings list & details
  router.get('/recordings', (req, res) => {
    try {
      const list = RecorderEngine.getRecordingsList();
      res.json({ success: true, recordings: list });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/recordings/:name', (req, res) => {
    try {
      const details = RecorderEngine.getRecordingDetails(req.params.name);
      if (!details) {
        return res.status(404).json({ success: false, error: 'Recording tidak ditemukan.' });
      }
      res.json({ success: true, ...details });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Replay
  router.post('/run/:name', async (req, res) => {
    try {
      const { delayBetweenSteps = 600, headless = false } = req.body;
      runner.runSession(req.params.name, { delayBetweenSteps, headless }).catch(err => {
        console.error('[Runner] Background execution error:', err);
      });
      res.json({ success: true, message: `Memulai pemutaran ulang untuk ${req.params.name}` });
    } catch (err) {
      console.error('[API] Gagal memulai replay:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/run/stop', (req, res) => {
    runner.stop();
    res.json({ success: true, message: 'Permintaan penghentian replay terkirim' });
  });

  return router;
}

module.exports = {
  createRecorderRouter
};
