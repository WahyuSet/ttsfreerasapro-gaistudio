/**
 * Deteksi dan snapshot elemen audio serta URL Blob pada DOM
 */
const fs = require('fs');
const path = require('path');

/**
 * Sanitasi nama berkas agar aman untuk sistem berkas Windows dan Unix.
 * @param {string} filename
 * @returns {string}
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return `download_${Date.now()}.wav`;
  }
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validasi header berkas RIFF WAVE
 */
function isWavFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
  } catch (e) {
    return false;
  }
}

/**
 * Mencari berkas WAV yang baru diunduh di daftar direktori (termasuk .tmp Playwright/Chrome)
 */
function findRecentDownloadedWav(directories = [], maxAgeMs = 60000) {
  for (const dir of directories) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      const candidates = files
        .filter(f => !f.startsWith('.'))
        .map(f => {
          const full = path.join(dir, f);
          try {
            const stat = fs.statSync(full);
            return { full, stat };
          } catch (e) {
            return null;
          }
        })
        .filter(item => item && (Date.now() - item.stat.mtimeMs < maxAgeMs) && item.stat.size > 1000)
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

      for (const cand of candidates) {
        if (cand.full.endsWith('.wav') || isWavFile(cand.full)) {
          return cand.full;
        }
      }
    } catch (err) {}
  }
  return null;
}

/**
 * Ekstraksi seluruh URL blob: unik dari snapshot baseline.
 * @param {Array} baselineSnapshot
 * @returns {Set<string>}
 */
function extractBaselineBlobUrls(baselineSnapshot) {
  const set = new Set();
  if (!Array.isArray(baselineSnapshot)) return set;
  for (const item of baselineSnapshot) {
    const src = item?.currentSrc || item?.src;
    if (typeof src === 'string' && src.startsWith('blob:')) {
      set.add(src);
    }
  }
  return set;
}

/**
 * Memeriksa apakah kandidat sumber audio merupakan URL blob baru yang belum ada di baseline.
 * @param {string|null} candidateSrc
 * @param {Set<string>|Array<string>} baselineBlobUrls
 * @returns {boolean}
 */
function isFreshBlob(candidateSrc, baselineBlobUrls) {
  if (!candidateSrc || typeof candidateSrc !== 'string' || !candidateSrc.startsWith('blob:')) {
    return false;
  }
  if (baselineBlobUrls instanceof Set) {
    return !baselineBlobUrls.has(candidateSrc);
  }
  if (Array.isArray(baselineBlobUrls)) {
    return !baselineBlobUrls.includes(candidateSrc);
  }
  return true;
}

/**
 * Mencari elemen audio baru di antara daftar audio saat ini dibandingkan dengan baseline.
 * @param {Array} currentAudios
 * @param {Array} baselineSnapshot
 * @returns {Object|null}
 */
function findFreshBlobAudio(currentAudios, baselineSnapshot = []) {
  if (!Array.isArray(currentAudios) || currentAudios.length === 0) return null;
  const baselineUrls = extractBaselineBlobUrls(baselineSnapshot);

  for (let i = currentAudios.length - 1; i >= 0; i--) {
    const cur = currentAudios[i];
    const curSrc = cur?.currentSrc || cur?.src;
    if (isFreshBlob(curSrc, baselineUrls)) {
      return cur;
    }
  }

  if (baselineUrls.size === 0) {
    for (let i = currentAudios.length - 1; i >= 0; i--) {
      const cur = currentAudios[i];
      const curSrc = cur?.currentSrc || cur?.src;
      if (typeof curSrc === 'string' && curSrc.startsWith('blob:')) {
        return cur;
      }
    }
  }

  return null;
}

/**
 * Mengambil snapshot baseline seluruh elemen <audio> di DOM sebelum generasi dimulai.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ index: number, src: string|null, currentSrc: string|null, readyState: number, duration: number }>>}
 */
async function captureAudioElementsSnapshot(page) {
  if (!page || page.isClosed()) return [];
  try {
    return await page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll('audio'));
      return audios.map((audio, index) => ({
        index,
        src: audio.src || null,
        currentSrc: audio.currentSrc || null,
        readyState: audio.readyState,
        networkState: audio.networkState,
        duration: audio.duration,
        paused: audio.paused
      }));
    });
  } catch (err) {
    return [];
  }
}

/**
 * Mendeteksi elemen audio target & blob URL untuk chunk generasi saat ini.
 * @param {import('playwright').Page} page
 * @param {Array} baselineSnapshot
 * @returns {Promise<Object|null>}
 */
async function findTargetAudioElement(page, baselineSnapshot = []) {
  if (!page || page.isClosed()) return null;
  try {
    const baselineUrlsArray = Array.from(extractBaselineBlobUrls(baselineSnapshot));
    return await page.evaluate((baselineUrls) => {
      const currentAudios = Array.from(document.querySelectorAll('audio')).map((audio, index) => ({
        index,
        src: audio.src || null,
        currentSrc: audio.currentSrc || null,
        readyState: audio.readyState,
        networkState: audio.networkState,
        duration: audio.duration,
        paused: audio.paused
      }));

      if (currentAudios.length === 0) return null;

      for (let i = currentAudios.length - 1; i >= 0; i--) {
        const cur = currentAudios[i];
        const curSrc = cur.currentSrc || cur.src;
        if (curSrc && curSrc.startsWith('blob:') && !baselineUrls.includes(curSrc)) {
          return cur;
        }
      }

      if (!baselineUrls || baselineUrls.length === 0) {
        const blobAudios = currentAudios.filter(a => {
          const src = a.currentSrc || a.src;
          return src && src.startsWith('blob:');
        });
        if (blobAudios.length > 0) {
          return blobAudios[blobAudios.length - 1];
        }
      }

      return null;
    }, baselineUrlsArray);
  } catch (err) {
    console.warn('[DOWNLOAD] Peringatan saat mencari elemen audio:', err.message);
    return null;
  }
}

module.exports = {
  sanitizeFilename,
  isWavFile,
  findRecentDownloadedWav,
  extractBaselineBlobUrls,
  isFreshBlob,
  findFreshBlobAudio,
  captureAudioElementsSnapshot,
  findTargetAudioElement
};
