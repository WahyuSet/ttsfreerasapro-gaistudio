const fs = require('fs');
const path = require('path');

/**
 * Memuat riwayat pekerjaan dari berkas disk JSON.
 * @param {string} storageFile
 * @param {Map<string, Object>} jobsMap
 */
function loadJobsFromDisk(storageFile, jobsMap) {
  try {
    if (fs.existsSync(storageFile)) {
      const raw = fs.readFileSync(storageFile, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item.status === 'processing' || item.status === 'queued') {
            item.status = 'failed';
            item.error = 'Server dimatikan atau direstart sebelum pekerjaan selesai.';
            item.completedAt = item.completedAt || new Date().toISOString();
          }
          jobsMap.set(item.id, item);
        }
      }
    }
  } catch (err) {
    console.warn('[JobStorage] Gagal memuat data pekerjaan:', err.message);
  }
}

/**
 * Menyimpan riwayat pekerjaan ke berkas disk JSON.
 * @param {string} storageFile
 * @param {Map<string, Object>} jobsMap
 * @param {number} maxHistory
 */
function saveJobsToDisk(storageFile, jobsMap, maxHistory = 200) {
  try {
    const dir = path.dirname(storageFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const list = Array.from(jobsMap.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, maxHistory);

    fs.writeFileSync(storageFile, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[JobStorage] Gagal menyimpan data pekerjaan:', err.message);
  }
}

/**
 * Format objek pekerjaan untuk respons API JSON bersih.
 * @param {Object} job
 * @param {string} baseUrl
 * @param {number} queuePosition
 * @returns {Object|null}
 */
function formatJobOutput(job, baseUrl = '', queuePosition = 0) {
  if (!job) return null;

  const statusUrl = baseUrl ? `${baseUrl}/api/tts/jobs/${job.id}` : `/api/tts/jobs/${job.id}`;

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

module.exports = {
  loadJobsFromDisk,
  saveJobsToDisk,
  formatJobOutput
};
