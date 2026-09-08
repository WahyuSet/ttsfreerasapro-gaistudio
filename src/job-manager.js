const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Job Status Enum:
 * - 'queued': Menunggu giliran dalam antrian
 * - 'processing': Sedang diproses oleh engine / browser
 * - 'completed': Selesai dirender dan audio siap diunduh
 * - 'failed': Terjadi kendala / error saat proses
 * - 'cancelled': Dibatalkan sebelum diproses
 */
class JobManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storageFile = options.storageFile || path.resolve(__dirname, '..', 'downloads', 'jobs_data.json');
    this.maxHistory = options.maxHistory || 200;
    this.jobs = new Map(); // jobId -> Job
    this.queue = [];       // array of jobId
    this.currentJob = null;
    this.isProcessing = false;
    this.workerFn = null;  // function(job, onProgress) -> Promise<result>

    this._loadFromStorage();
  }

  /**
   * Daftarkan worker function dari TtsEngine
   */
  setWorker(fn) {
    this.workerFn = fn;
  }

  /**
   * Muat riwayat pekerjaan sebelumnya dari disk jika ada
   */
  _loadFromStorage() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            // Jika ada job yang tertinggal dalam status processing/queued saat server mati, tandai failed
            if (item.status === 'processing' || item.status === 'queued') {
              item.status = 'failed';
              item.error = 'Server dimatikan atau direstart sebelum pekerjaan selesai.';
              item.completedAt = item.completedAt || new Date().toISOString();
            }
            this.jobs.set(item.id, item);
          }
        }
      }
    } catch (err) {
      console.warn('[JobManager] Gagal memuat jobs_data.json:', err.message);
    }
  }

  /**
   * Simpan riwayat pekerjaan ke disk (maksimal maxHistory data terbaru)
   */
  _saveToStorage() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Ambil jobs terbaru
      const list = Array.from(this.jobs.values())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, this.maxHistory);

      fs.writeFileSync(this.storageFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.warn('[JobManager] Gagal menyimpan jobs_data.json:', err.message);
    }
  }

  /**
   * Generate unique job ID
   */
  _generateJobId() {
    const timestamp = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    return `job_${timestamp}_${rand}`;
  }

  /**
   * Buat job baru dan masukkan ke antrian
   */
  createJob(params) {
    if (!params || !params.text || typeof params.text !== 'string' || !params.text.trim()) {
      throw new Error('Parameter "text" wajib diisi berupa string tidak kosong.');
    }

    const id = this._generateJobId();
    const now = new Date().toISOString();

    const job = {
      id,
      status: 'queued',
      progress: 0,
      stage: 'queued',
      message: 'Pekerjaan berhasil dibuat dan berada dalam antrian.',
      currentPart: 0,
      totalParts: 0,
      params: {
        text: params.text.trim(),
        textLength: params.text.trim().length,
        wordCount: params.text.trim().split(/\s+/).length,
        voice: params.voice || 'Achernar',
        style: params.style || 'Vocal Smile',
        pace: params.pace || 'Natural',
        accent: params.accent || 'Neutral',
        scene: params.scene || 'A modern study room, explaining everyday science concepts to curious peers.',
        sampleContext: params.sampleContext || 'Warm, encouraging, speaking like an older sibling sharing cool trivia, upbeat yet gentle pacing.',
        persona: params.persona || 'A relaxed and engaging storyteller, talking like a close friend sharing cool trivia, upbeat and lighthearted.',
        autoChunk: params.autoChunk !== false,
        maxWordsPerChunk: Number(params.maxWordsPerChunk) || 300
      },
      result: null,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      durationSeconds: null
    };

    this.jobs.set(id, job);
    this.queue.push(id);

    this.emit('job:created', this._formatJobOutput(job));
    this._saveToStorage();

    // Trigger antrian
    setImmediate(() => this._processQueue());

    return this._formatJobOutput(job);
  }

  /**
   * Hitung posisi antrian saat ini
   */
  getQueuePosition(jobId) {
    const idx = this.queue.indexOf(jobId);
    return idx >= 0 ? idx + 1 : 0;
  }

  /**
   * Format job untuk dikirim ke API response
   */
  _formatJobOutput(job, baseUrl = '') {
    if (!job) return null;

    const queuePosition = job.status === 'queued' ? this.getQueuePosition(job.id) : 0;
    const statusUrl = baseUrl ? `${baseUrl}/api/tts/jobs/${job.id}` : `/api/tts/jobs/${job.id}`;

    // Format output bersih
    return {
      id: job.id,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      message: job.message,
      queuePosition: queuePosition,
      currentPart: job.currentPart || 0,
      totalParts: job.totalParts || 0,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      durationSeconds: job.durationSeconds,
      params: {
        textSnippet: job.params.text.slice(0, 100) + (job.params.text.length > 100 ? '...' : ''),
        wordCount: job.params.wordCount,
        voice: job.params.voice,
        style: job.params.style,
        pace: job.params.pace,
        accent: job.params.accent,
        autoChunk: job.params.autoChunk,
        maxWordsPerChunk: job.params.maxWordsPerChunk
      },
      result: job.result ? (() => {
        const files = (job.result.files || []).map(f => {
          const downloadUrl = f.downloadUrl || `/api/tts/download/${f.filename}`;
          const fullUrl = baseUrl && !downloadUrl.startsWith('http') ? `${baseUrl}${downloadUrl}` : downloadUrl;
          return {
            ...f,
            downloadUrl,
            url: fullUrl,
            audio_url: fullUrl
          };
        });

        const primaryUrl = files[0] ? files[0].url : (job.result.url || null);
        const allUrls = files.map(f => f.url);

        return {
          url: primaryUrl,
          audio_url: primaryUrl,
          audio_urls: allUrls.length > 0 ? allUrls : (job.result.audio_urls || []),
          totalChunks: job.result.totalChunks || files.length,
          voiceSettings: job.result.voiceSettings,
          files: files
        };
      })() : null,
      error: job.error,
      statusUrl
    };
  }

  /**
   * Ambil data job berdasarkan ID
   */
  getJob(jobId, baseUrl = '') {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return this._formatJobOutput(job, baseUrl);
  }

  /**
   * Ambil daftar riwayat job dengan filter & pagination
   */
  listJobs(options = {}, baseUrl = '') {
    const { status, limit = 50, offset = 0 } = options;
    let list = Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (status) {
      list = list.filter(j => j.status.toLowerCase() === status.toLowerCase());
    }

    const total = list.length;
    const paginated = list.slice(Number(offset), Number(offset) + Number(limit));

    const stats = this.getStats();

    return {
      total,
      limit: Number(limit),
      offset: Number(offset),
      stats,
      jobs: paginated.map(j => this._formatJobOutput(j, baseUrl))
    };
  }

  /**
   * Batalkan job yang masih berada di antrian
   */
  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { success: false, message: 'Pekerjaan tidak ditemukan.' };
    }

    if (job.status === 'completed') {
      return { success: false, message: 'Pekerjaan sudah selesai, tidak dapat dibatalkan.' };
    }

    if (job.status === 'cancelled') {
      return { success: false, message: 'Pekerjaan sudah dibatalkan sebelumnya.' };
    }

    if (job.status === 'processing') {
      return {
        success: false,
        message: 'Pekerjaan sedang diproses oleh browser dan tidak dapat dibatalkan di tengah jalan.'
      };
    }

    // Hapus dari antrian
    const queueIdx = this.queue.indexOf(jobId);
    if (queueIdx >= 0) {
      this.queue.splice(queueIdx, 1);
    }

    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.message = 'Pekerjaan dibatalkan oleh pengguna sebelum dieksekusi.';
    job.completedAt = new Date().toISOString();

    this.emit('job:cancelled', this._formatJobOutput(job));
    this._saveToStorage();

    return {
      success: true,
      message: `Pekerjaan ${jobId} berhasil dibatalkan.`,
      job: this._formatJobOutput(job)
    };
  }

  /**
   * Update progres pekerjaan saat worker sedang berjalan
   */
  updateProgress(jobId, update = {}) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'processing') return;

    if (typeof update.progress === 'number') {
      job.progress = Math.min(100, Math.max(0, Math.round(update.progress)));
    }
    if (update.stage) job.stage = update.stage;
    if (update.message) job.message = update.message;
    if (typeof update.currentPart === 'number') job.currentPart = update.currentPart;
    if (typeof update.totalParts === 'number') job.totalParts = update.totalParts;

    this.emit('job:progress', this._formatJobOutput(job));
  }

  /**
   * Ringkasan statistik antrian & status
   */
  getStats() {
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const job of this.jobs.values()) {
      if (job.status === 'queued') queued++;
      else if (job.status === 'processing') processing++;
      else if (job.status === 'completed') completed++;
      else if (job.status === 'failed') failed++;
      else if (job.status === 'cancelled') cancelled++;
    }

    return {
      total: this.jobs.size,
      queued,
      processing,
      completed,
      failed,
      cancelled,
      isBusy: this.isProcessing,
      currentJobId: this.currentJob ? this.currentJob.id : null
    };
  }

  /**
   * Eksekutor antrian pekerjaan berurutan
   */
  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    const nextJobId = this.queue.shift();
    const job = this.jobs.get(nextJobId);

    // Jika job sudah tidak ada atau sudah dibatalkan
    if (!job || job.status === 'cancelled') {
      return setImmediate(() => this._processQueue());
    }

    this.isProcessing = true;
    this.currentJob = job;

    const startTime = Date.now();
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.progress = 5;
    job.stage = 'initializing';
    job.message = 'Memulai proses browser automasi...';

    this.emit('job:started', this._formatJobOutput(job));
    this._saveToStorage();

    try {
      if (typeof this.workerFn !== 'function') {
        throw new Error('TTS Worker belum dikonfigurasi pada JobManager.');
      }

      console.log(`\n================================================================`);
      console.log(`[JobManager] 🚀 Menjalankan Pekerjaan: ${job.id}`);
      console.log(`[JobManager] Teks: "${job.params.text.slice(0, 70)}..." (${job.params.wordCount} kata)`);
      console.log(`[JobManager] Suara: ${job.params.voice} | Gaya: ${job.params.style}`);
      console.log(`================================================================`);

      const result = await this.workerFn(job.params, (progressUpdate) => {
        this.updateProgress(job.id, progressUpdate);
      });

      // Hitung durasi
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);

      job.status = 'completed';
      job.progress = 100;
      job.stage = 'completed';
      job.message = 'Pekerjaan selesai! Berkas audio siap diunduh.';
      job.completedAt = new Date().toISOString();
      job.durationSeconds = durationSeconds;
      job.result = result;

      console.log(`[JobManager] ✅ Pekerjaan ${job.id} SUKSES dalam ${durationSeconds} detik!`);
      this.emit('job:completed', this._formatJobOutput(job));

    } catch (err) {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      job.status = 'failed';
      job.stage = 'failed';
      job.message = `Gagal: ${err.message}`;
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      job.durationSeconds = durationSeconds;

      console.error(`[JobManager] ❌ Pekerjaan ${job.id} GAGAL:`, err.message);
      this.emit('job:failed', this._formatJobOutput(job));

    } finally {
      this.isProcessing = false;
      this.currentJob = null;
      this._saveToStorage();

      // Lanjutkan antrian berikutnya
      setImmediate(() => this._processQueue());
    }
  }

  /**
   * Menunggu suatu job hingga selesai (berguna untuk endpoint sync / generate?sync=true)
   */
  waitForJob(jobId, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
      const job = this.jobs.get(jobId);
      if (!job) {
        return reject(new Error('Pekerjaan tidak ditemukan.'));
      }

      if (job.status === 'completed') {
        return resolve(this._formatJobOutput(job));
      }
      if (job.status === 'failed') {
        return reject(new Error(job.error || 'Pekerjaan gagal diproses.'));
      }
      if (job.status === 'cancelled') {
        return reject(new Error('Pekerjaan telah dibatalkan.'));
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout menunggu penyelesaian pekerjaan (${Math.round(timeoutMs / 1000)} detik). Pekerjaan masih berjalan di latar belakang.`));
      }, timeoutMs);

      const onCompleted = (completedJob) => {
        if (completedJob.id === jobId) {
          cleanup();
          resolve(completedJob);
        }
      };

      const onFailed = (failedJob) => {
        if (failedJob.id === jobId) {
          cleanup();
          reject(new Error(failedJob.error || 'Pekerjaan gagal diproses.'));
        }
      };

      const onCancelled = (cancelledJob) => {
        if (cancelledJob.id === jobId) {
          cleanup();
          reject(new Error('Pekerjaan dibatalkan.'));
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('job:completed', onCompleted);
        this.removeListener('job:failed', onFailed);
        this.removeListener('job:cancelled', onCancelled);
      };

      this.on('job:completed', onCompleted);
      this.on('job:failed', onFailed);
      this.on('job:cancelled', onCancelled);
    });
  }
}

module.exports = {
  JobManager
};
