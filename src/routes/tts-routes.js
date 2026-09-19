const express = require('express');
const path = require('path');
const fs = require('fs');
const { apiKeyAuth } = require('../auth');

/**
 * Membuat router untuk endpoint REST API TTS Gemini
 * @param {Object} deps
 * @param {import('../job-manager').JobManager} deps.jobManager
 * @param {import('../tts-engine').TtsEngine} deps.ttsEngine
 * @param {Function} deps.getBaseUrl
 * @returns {express.Router}
 */
function createTtsRouter({ jobManager, ttsEngine, getBaseUrl }) {
  const router = express.Router();

  // 1. Submit TTS Job (Asynchronous)
  router.post('/jobs', apiKeyAuth, (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const job = jobManager.createJob(req.body);
      const formatted = jobManager.getJob(job.id, baseUrl);

      const directAudioUrl = baseUrl ? `${baseUrl}/api/tts/jobs/${formatted.id}/audio` : `/api/tts/jobs/${formatted.id}/audio`;

      res.status(202).json({
        success: true,
        message: 'Pekerjaan TTS berhasil dibuat dan dimasukkan ke dalam antrian.',
        ticket: formatted.id,
        jobId: formatted.id,
        status: formatted.status,
        queuePosition: formatted.queuePosition,
        statusUrl: formatted.statusUrl,
        audioUrl: directAudioUrl,
        audio_url: directAudioUrl,
        downloadUrl: directAudioUrl,
        job: formatted
      });
    } catch (err) {
      console.error('[API] Gagal membuat pekerjaan TTS:', err.message);
      res.status(400).json({
        success: false,
        error: err.message || 'Bad Request saat membuat pekerjaan TTS.'
      });
    }
  });

  // 2. Get Job Status by ID
  router.get('/jobs/:id', apiKeyAuth, (req, res) => {
    const baseUrl = getBaseUrl(req);
    const job = jobManager.getJob(req.params.id, baseUrl);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: `Pekerjaan dengan ID "${req.params.id}" tidak ditemukan.`
      });
    }

    res.json({ success: true, job });
  });

  // 3. List All Jobs
  router.get('/jobs', apiKeyAuth, (req, res) => {
    const baseUrl = getBaseUrl(req);
    const { status, limit, offset } = req.query;
    const list = jobManager.listJobs({ status, limit, offset }, baseUrl);
    res.json({ success: true, ...list });
  });

  // 4. Cancel Job
  router.delete('/jobs/:id', apiKeyAuth, (req, res) => {
    const result = jobManager.cancelJob(req.params.id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  router.post('/jobs/:id/cancel', apiKeyAuth, (req, res) => {
    const result = jobManager.cancelJob(req.params.id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  // 5. Generate Speech (fleksibel sync / async)
  router.post('/generate', apiKeyAuth, async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const isSync = req.query.sync === 'true' || req.query.sync === '1' || req.body.sync === true;
      const job = jobManager.createJob(req.body);

      if (isSync) {
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

      const formatted = jobManager.getJob(job.id, baseUrl);
      const directAudioUrl = baseUrl ? `${baseUrl}/api/tts/jobs/${formatted.id}/audio` : `/api/tts/jobs/${formatted.id}/audio`;

      res.status(202).json({
        success: true,
        message: 'Pekerjaan TTS berhasil dibuat. Gunakan statusUrl atau jobId untuk memantau progres.',
        ticket: formatted.id,
        jobId: formatted.id,
        status: formatted.status,
        queuePosition: formatted.queuePosition,
        statusUrl: formatted.statusUrl,
        audioUrl: directAudioUrl,
        audio_url: directAudioUrl,
        downloadUrl: directAudioUrl,
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

  // 6. Endpoint unduh audio berbasis Ticket / Job ID (Kompatibel dengan ElevenLabs / Standard API)
  router.get('/jobs/:id/audio', (req, res) => {
    const rawId = req.params.id || '';
    const cleanId = rawId.replace(/\.wav$/i, '');
    const job = jobManager.jobs.get(cleanId) || jobManager.jobs.get(rawId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: `Pekerjaan dengan ID "${req.params.id}" tidak ditemukan.`
      });
    }

    if (job.status !== 'completed' || !job.result || !Array.isArray(job.result.files) || job.result.files.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'Berkas audio belum siap atau pekerjaan belum selesai.',
        status: job.status,
        progress: job.progress
      });
    }

    const fileObj = job.result.files[0];
    let filePath = fileObj.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      filePath = path.join(ttsEngine.downloadsDir, fileObj.filename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File audio tidak ditemukan di server.' });
    }

    const isMp3 = (fileObj.filename || filePath).toLowerCase().endsWith('.mp3');
    const contentType = isMp3 ? 'audio/mpeg' : 'audio/wav';

    if (req.query.download === 'true' || req.query.download === '1') {
      return res.download(filePath, fileObj.filename);
    }

    res.sendFile(filePath, {
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      }
    });
  });

  // 7. Stream / Download berkas audio berdasarkan nama berkas atau ID pekerjaan
  router.get('/download/:filename', (req, res) => {
    let filename = path.basename(req.params.filename);
    let filePath = path.join(ttsEngine.downloadsDir, filename);

    // 1. Cek langsung nama file
    if (!fs.existsSync(filePath)) {
      // Coba jika nama file tanpa ekstensi, prioritaskan .mp3 lalu .wav
      if (!path.extname(filename)) {
        if (fs.existsSync(`${filePath}.mp3`)) {
          filePath = `${filePath}.mp3`;
          filename = `${filename}.mp3`;
        } else if (fs.existsSync(`${filePath}.wav`)) {
          filePath = `${filePath}.wav`;
          filename = `${filename}.wav`;
        }
      }
    }

    // 2. Jika belum ditemukan, periksa apakah parameter adalah jobId
    if (!fs.existsSync(filePath)) {
      const cleanId = filename.replace(/\.(mp3|wav)$/i, '');
      const job = jobManager.jobs.get(cleanId) || jobManager.jobs.get(filename);
      if (job && job.result && Array.isArray(job.result.files) && job.result.files.length > 0) {
        const fileObj = job.result.files[0];
        const possiblePath = fileObj.filePath || path.join(ttsEngine.downloadsDir, fileObj.filename);
        if (fs.existsSync(possiblePath)) {
          filePath = possiblePath;
          filename = fileObj.filename;
        } else {
          // Coba cari berkas dengan nama yang sama berektensi .mp3 jika ada
          const altMp3 = path.join(ttsEngine.downloadsDir, `${path.parse(fileObj.filename).name}.mp3`);
          if (fs.existsSync(altMp3)) {
            filePath = altMp3;
            filename = path.basename(altMp3);
          }
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      console.warn(`[Download] File audio tidak ditemukan untuk parameter: "${req.params.filename}"`);
      return res.status(404).json({ success: false, error: 'File audio tidak ditemukan.' });
    }

    const isMp3 = filename.toLowerCase().endsWith('.mp3');
    const contentType = isMp3 ? 'audio/mpeg' : 'audio/wav';

    if (req.query.download === 'true' || req.query.download === '1') {
      return res.download(filePath, filename);
    }

    res.sendFile(filePath, {
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      }
    });
  });

  // 7. Status TTS Engine & Antrian
  router.get('/status', (req, res) => {
    res.json({
      success: true,
      engine: 'Gemini 2.5 Pro TTS (Google AI Studio)',
      jobs: jobManager.getStats(),
      ...ttsEngine.getStatus()
    });
  });

  // 8. Daftar Suara, Preset, dan Gaya
  router.get('/voices', (req, res) => {
    res.json({
      success: true,
      defaultVoice: 'Zephyr',
      voices: [
        { name: 'Zephyr', gender: 'Dynamic', isDefault: true, description: 'Calm, smooth, versatile, and balanced (Default)' },
        { name: 'Charon', gender: 'Male', isDefault: false, description: 'Deep, authoritative, and steady' },
        { name: 'Achird', gender: 'Female', isDefault: false, description: 'Gentle, thoughtful, and clear' },
        { name: 'Fenrir', gender: 'Male', isDefault: false, description: 'Energetic, bold, and powerful' },
        { name: 'Iapetus', gender: 'Male', isDefault: false, description: 'Warm, conversational, and approachable' },
        { name: 'Orus', gender: 'Male', isDefault: false, description: 'Resonant, crisp, and confident' },
        { name: 'Rasalgethi', gender: 'Male', isDefault: false, description: 'Informative, rich storyteller' },
        { name: 'Achernar', gender: 'Female', isDefault: false, description: 'Warm, clear, natural, and relatable' }
      ],
      styles: ['Vocal Smile', 'Natural', 'Whisper', 'Cheer', 'Serious', 'Empathetic'],
      paces: ['Very Slow', 'Slow', 'Natural', 'Fast', 'Very Fast'],
      accents: ['Neutral', 'American', 'British', 'Australian', 'Indian']
    });
  });

  return router;
}

module.exports = {
  createTtsRouter
};
