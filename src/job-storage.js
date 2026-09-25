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
  const directAudioUrl = baseUrl ? `${baseUrl}/api/tts/jobs/${job.id}/audio` : `/api/tts/jobs/${job.id}/audio`;

  let formattedResult = null;
  let primaryAudioUrl = null;
  let formattedMergedFile = null;

  if (job.result) {
    const files = (job.result.files || []).map(f => {
      const downloadUrl = f.downloadUrl || `/api/tts/download/${f.filename}`;
      const fullUrl = baseUrl && !downloadUrl.startsWith('http') ? `${baseUrl}${downloadUrl}` : downloadUrl;
      return {
        ...f,
        downloadUrl,
        url: fullUrl,
        audio_url: fullUrl,
        audioUrl: fullUrl
      };
    });

    if (job.result.mergedFile) {
      const m = job.result.mergedFile;
      const downloadUrl = m.downloadUrl || `/api/tts/download/${m.filename}`;
      const fullUrl = baseUrl && !downloadUrl.startsWith('http') ? `${baseUrl}${downloadUrl}` : downloadUrl;
      formattedMergedFile = {
        ...m,
        downloadUrl,
        url: fullUrl,
        audio_url: fullUrl,
        audioUrl: fullUrl
      };
    }

    primaryAudioUrl = formattedMergedFile ? formattedMergedFile.url : (files[0] ? files[0].url : (job.result.url || null));
    const allUrls = files.map(f => f.url);

    formattedResult = {
      url: primaryAudioUrl,
      audio_url: primaryAudioUrl,
      audioUrl: primaryAudioUrl,
      audio_urls: allUrls.length > 0 ? allUrls : (job.result.audio_urls || []),
      totalChunks: job.result.totalChunks || files.length,
      voiceSettings: job.result.voiceSettings,
      mergedFile: formattedMergedFile,
      files: files
    };
  }

  const effectiveAudioUrl = primaryAudioUrl || directAudioUrl;

  return {
    id: job.id,
    jobId: job.id,
    ticket: job.id,
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
    audioUrl: job.status === 'completed' ? effectiveAudioUrl : null,
    audio_url: job.status === 'completed' ? effectiveAudioUrl : null,
    downloadUrl: job.status === 'completed' ? effectiveAudioUrl : null,
    url: job.status === 'completed' ? effectiveAudioUrl : null,
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
    mergedFile: formattedMergedFile,
    result: formattedResult,
    error: job.error,
    statusUrl
  };
}

module.exports = {
  loadJobsFromDisk,
  saveJobsToDisk,
  formatJobOutput
};
