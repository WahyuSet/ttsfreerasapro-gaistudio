const EventEmitter = require('events');
const path = require('path');
const crypto = require('crypto');
const { loadJobsFromDisk, saveJobsToDisk, formatJobOutput } = require('./job-storage');

class JobManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storageFile = options.storageFile || path.resolve(__dirname, '..', 'downloads', 'jobs_data.json');
    this.maxHistory = options.maxHistory || 200;
    this.jobs = new Map();
    this.queue = [];
    this.currentJob = null;
    this.isProcessing = false;
    this.workerFn = null;

    loadJobsFromDisk(this.storageFile, this.jobs);
  }

  setWorker(fn) {
    this.workerFn = fn;
  }

  _saveToStorage() {
    saveJobsToDisk(this.storageFile, this.jobs, this.maxHistory);
  }

  _generateJobId() {
    const timestamp = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    return `job_${timestamp}_${rand}`;
  }

  getQueuePosition(jobId) {
    const idx = this.queue.indexOf(jobId);
    return idx >= 0 ? idx + 1 : 0;
  }

  _formatJobOutput(job, baseUrl = '') {
    const queuePos = job.status === 'queued' ? this.getQueuePosition(job.id) : 0;
    return formatJobOutput(job, baseUrl, queuePos);
  }

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
        maxWordsPerChunk: Number(params.maxWordsPerChunk) || 300,
        keepOpen: params.keepOpen === true,
        headless: params.headless === true
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

    setImmediate(() => this._processQueue());
    return this._formatJobOutput(job);
  }

  getJob(jobId, baseUrl = '') {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return this._formatJobOutput(job, baseUrl);
  }

  listJobs(options = {}, baseUrl = '') {
    const { status, limit = 50, offset = 0 } = options;
    let list = Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (status) {
      list = list.filter(j => j.status.toLowerCase() === status.toLowerCase());
    }

    const total = list.length;
    const paginated = list.slice(Number(offset), Number(offset) + Number(limit));

    return {
      total,
      limit: Number(limit),
      offset: Number(offset),
      stats: this.getStats(),
      jobs: paginated.map(j => this._formatJobOutput(j, baseUrl))
    };
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return { success: false, message: 'Pekerjaan tidak ditemukan.', job: null };
    if (job.status === 'completed') return { success: false, message: 'Pekerjaan sudah selesai dan tidak dapat dibatalkan.', job: this._formatJobOutput(job) };
    if (job.status === 'cancelled') return { success: true, message: 'Pekerjaan sudah berstatus dibatalkan sebelumnya.', job: this._formatJobOutput(job) };

    const qIdx = this.queue.indexOf(jobId);
    if (qIdx >= 0) this.queue.splice(qIdx, 1);

    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.message = 'Pekerjaan dibatalkan oleh pengguna.';
    job.completedAt = new Date().toISOString();

    this.emit('job:cancelled', this._formatJobOutput(job));
    this._saveToStorage();
    return { success: true, message: `Pekerjaan ${jobId} berhasil dibatalkan.`, job: this._formatJobOutput(job) };
  }

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

  getStats() {
    let queued = 0, processing = 0, completed = 0, failed = 0, cancelled = 0;
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

  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    const nextJobId = this.queue.shift();
    const job = this.jobs.get(nextJobId);
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
      console.log(`[JobManager] Menjalankan Pekerjaan: ${job.id}`);
      console.log(`[JobManager] Teks: "${job.params.text.slice(0, 70)}..." (${job.params.wordCount} kata)`);
      console.log(`[JobManager] Suara: ${job.params.voice} | Gaya: ${job.params.style}`);
      console.log('================================================================');

      const result = await this.workerFn(job.params, (progressUpdate) => {
        this.updateProgress(job.id, progressUpdate);
      });

      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      job.status = 'completed';
      job.progress = 100;
      job.stage = 'completed';
      job.message = 'Pekerjaan selesai! Berkas audio siap diunduh.';
      job.completedAt = new Date().toISOString();
      job.durationSeconds = durationSeconds;
      job.result = result;

      console.log(`[JobManager] Pekerjaan ${job.id} SUKSES dalam ${durationSeconds} detik!`);
      this.emit('job:completed', this._formatJobOutput(job));

    } catch (err) {
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      job.status = 'failed';
      job.stage = 'failed';
      job.message = `Gagal: ${err.message}`;
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      job.durationSeconds = durationSeconds;

      console.error(`[JobManager] Pekerjaan ${job.id} GAGAL:`, err.message);
      this.emit('job:failed', this._formatJobOutput(job));

    } finally {
      this.isProcessing = false;
      this.currentJob = null;
      this._saveToStorage();
      setImmediate(() => this._processQueue());
    }
  }

  waitForJob(jobId, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
      const job = this.jobs.get(jobId);
      if (!job) return reject(new Error('Pekerjaan tidak ditemukan.'));
      if (job.status === 'completed') return resolve(this._formatJobOutput(job));
      if (job.status === 'failed') return reject(new Error(job.error || 'Pekerjaan gagal diproses.'));
      if (job.status === 'cancelled') return reject(new Error('Pekerjaan telah dibatalkan.'));

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout menunggu penyelesaian pekerjaan (${Math.round(timeoutMs / 1000)} detik).`));
      }, timeoutMs);

      const onCompleted = (completedJob) => {
        if (completedJob.id === jobId) { cleanup(); resolve(completedJob); }
      };
      const onFailed = (failedJob) => {
        if (failedJob.id === jobId) { cleanup(); reject(new Error(failedJob.error || 'Pekerjaan gagal diproses.')); }
      };
      const onCancelled = (cancelledJob) => {
        if (cancelledJob.id === jobId) { cleanup(); reject(new Error('Pekerjaan dibatalkan.')); }
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
