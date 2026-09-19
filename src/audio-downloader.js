const path = require('path');
const fs = require('fs');

/**
 * Sanitize filename to ensure safe filesystem path on Windows and Unix.
 * Removes characters prohibited in Windows paths: <>:"/\|?* and control characters.
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
 * Extract all unique blob: URLs from a baseline snapshot.
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
 * Check if a candidate audio source is a genuinely fresh blob URL not in baseline.
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
 * Pure helper to detect a fresh audio element among current audios compared to baseline.
 * Prioritizes newest audio elements with a blob URL not present in baseline.
 * @param {Array} currentAudios
 * @param {Array} baselineSnapshot
 * @returns {Object|null}
 */
function findFreshBlobAudio(currentAudios, baselineSnapshot = []) {
  if (!Array.isArray(currentAudios) || currentAudios.length === 0) return null;
  const baselineUrls = extractBaselineBlobUrls(baselineSnapshot);

  // 1. Cari dari elemen audio terbaru ke terlama yang memiliki URL blob baru (tidak ada di baseline)
  for (let i = currentAudios.length - 1; i >= 0; i--) {
    const cur = currentAudios[i];
    const curSrc = cur?.currentSrc || cur?.src;
    if (isFreshBlob(curSrc, baselineUrls)) {
      return cur;
    }
  }

  // 2. Fallback: HANYA jika baseline tidak memiliki URL blob sama sekali
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
 * Capture baseline snapshot of all <audio> elements in DOM before triggering a generation.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ index: number, src: string|null, currentSrc: string|null, readyState: number, networkState: number, duration: number, paused: boolean }>>}
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
 * Detect the target audio element & blob URL corresponding to the CURRENT generation chunk.
 * Compares current audio elements against baseline snapshot taken before RUN.
 *
 * @param {import('playwright').Page} page
 * @param {Array} baselineSnapshot
 * @returns {Promise<{ index: number, src: string, currentSrc: string, readyState: number, duration: number }|null>}
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

      // 1. Cari dari elemen audio terbaru ke terlama yang memiliki URL blob baru
      for (let i = currentAudios.length - 1; i >= 0; i--) {
        const cur = currentAudios[i];
        const curSrc = cur.currentSrc || cur.src;
        if (curSrc && curSrc.startsWith('blob:') && !baselineUrls.includes(curSrc)) {
          return cur;
        }
      }

      // 2. Fallback: HANYA jika baseline snapshot kosong (tidak ada blob URL sama sekali)
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

/**
 * Extract audio Blob directly from browser context via fast Base64 DataURL.
 * Supports direct blob URL targeting or element index targeting.
 * 
 * @param {import('playwright').Page} page
 * @param {string|number|null} targetBlobSrcOrIndex - Direct blob URL (preferred) or audio element index
 * @param {string} destinationPath
 * @returns {Promise<{ success: boolean, path: string, contentType: string, byteLength: number, src: string }>}
 */
async function extractBlobDirectly(page, targetBlobSrcOrIndex, destinationPath) {
  if (!page || page.isClosed()) {
    throw new Error('Page sudah ditutup saat mencoba extractBlobDirectly');
  }

  const result = await page.evaluate(async (target) => {
    let blobUrl = null;

    if (typeof target === 'string' && target.startsWith('blob:')) {
      blobUrl = target;
    } else {
      const audios = Array.from(document.querySelectorAll('audio'));
      const audio = (typeof target === 'number' && audios[target])
        ? audios[target]
        : audios[audios.length - 1];

      if (!audio) {
        throw new Error('Audio element not found in DOM');
      }
      blobUrl = audio.currentSrc || audio.src;
    }

    if (!blobUrl || !blobUrl.startsWith('blob:')) {
      throw new Error(`Invalid or non-blob audio URL: ${blobUrl}`);
    }

    const response = await fetch(blobUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch Blob: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/wav';
    const blob = await response.blob();

    if (!blob || blob.size === 0) {
      throw new Error('Fetched Blob is empty (0 bytes)');
    }

    // Convert to Base64 via FileReader - lightweight, fast, no CDP serialization bottleneck
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === 'string') {
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        } else {
          reject(new Error('FileReader result is not a valid string'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader failed to read Blob as DataURL'));
      reader.readAsDataURL(blob);
    });

    return {
      type: 'blob',
      src: blobUrl,
      contentType,
      byteLength: blob.size,
      base64: base64Data
    };
  }, targetBlobSrcOrIndex);

  if (result && result.type === 'blob' && result.base64) {
    const buffer = Buffer.from(result.base64, 'base64');
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.promises.writeFile(destinationPath, buffer);
    return {
      success: true,
      path: destinationPath,
      contentType: result.contentType,
      byteLength: buffer.length,
      src: result.src
    };
  }

  return { success: false, src: result ? result.src : null };
}

/**
 * Modernized, resilient download handler prioritizing Direct DOM Blob Extraction.
 * Only falls back to Playwright native download event if no DOM Blob is available.
 *
 * @param {Object} options
 * @param {import('playwright').Page} options.page - Playwright Page object
 * @param {Function} [options.trigger] - Async callback that triggers native download action (if fallback needed)
 * @param {string} options.downloadDir - Destination directory
 * @param {string} [options.customFilename] - Custom filename
 * @param {number} [options.timeout=45000] - Download timeout in milliseconds
 * @param {Array} [options.baselineSnapshot] - Pre-generation audio snapshot for isolation
 * @param {string|null} [options.targetBlobSrc] - Explicit target blob URL if already detected
 * @returns {Promise<{ path: string, filename: string, url: string, sizeBytes: number, sizeKb: string, elapsedMs: number, strategy: string }>}
 */
async function downloadFile({
  page,
  trigger,
  downloadDir,
  customFilename = null,
  timeout = 45000,
  baselineSnapshot = [],
  targetBlobSrc = null
}) {
  if (!page || page.isClosed()) {
    throw new Error('Page sudah ditutup sebelum proses download/ekstraksi audio dimulai');
  }

  const startTime = Date.now();
  console.log('[DOWNLOAD] Started audio acquisition...');

  await fs.promises.mkdir(downloadDir, { recursive: true });

  const resolvedName = customFilename
    ? sanitizeFilename(customFilename)
    : sanitizeFilename(`gemini_tts_${Date.now()}.wav`);
  const finalPath = path.resolve(downloadDir, resolvedName);

  let strategyUsed = 'DOM_BLOB';
  let downloadUrl = 'blob:local';

  // =========================================================================
  // STRATEGY 1: DIRECT DOM BLOB EXTRACTION (PRIMARY)
  // =========================================================================
  let blobSuccess = false;
  let activeBlobSrc = targetBlobSrc;

  try {
    if (!activeBlobSrc) {
      const targetAudio = await findTargetAudioElement(page, baselineSnapshot);
      if (targetAudio) {
        activeBlobSrc = targetAudio.currentSrc || targetAudio.src;
      }
    }

    if (activeBlobSrc && activeBlobSrc.startsWith('blob:')) {
      console.log(`[DOWNLOAD] Fetching target Blob URL: ${activeBlobSrc}`);
      const blobResult = await extractBlobDirectly(page, activeBlobSrc, finalPath);
      if (blobResult.success) {
        downloadUrl = blobResult.src;
        blobSuccess = true;
        console.log(`[DOWNLOAD] Strategy: DOM_BLOB`);
        console.log(`[DOWNLOAD] Content-Type: ${blobResult.contentType}`);
        console.log(`[DOWNLOAD] Blob size: ${(blobResult.byteLength / 1024).toFixed(1)} KB (${blobResult.byteLength} bytes)`);
        console.log(`[DOWNLOAD] Output: ${finalPath}`);
      }
    }
  } catch (initialBlobErr) {
    console.warn(`[DOWNLOAD] Percobaan pertama ekstraksi Blob gagal: ${initialBlobErr.message}. Mencoba deteksi ulang audio...`);
    
    // Retry Blob extraction once with freshly detected audio element
    try {
      if (!page.isClosed()) {
        const retryAudio = await findTargetAudioElement(page, baselineSnapshot);
        if (retryAudio && (retryAudio.currentSrc || retryAudio.src)) {
          const retryBlobSrc = retryAudio.currentSrc || retryAudio.src;
          const retryResult = await extractBlobDirectly(page, retryBlobSrc, finalPath);
          if (retryResult.success) {
            downloadUrl = retryResult.src;
            blobSuccess = true;
            console.log(`[DOWNLOAD] Strategy: DOM_BLOB (Retry Success)`);
            console.log(`[DOWNLOAD] Blob size: ${(retryResult.byteLength / 1024).toFixed(1)} KB`);
          }
        }
      }
    } catch (retryBlobErr) {
      console.warn(`[DOWNLOAD] Retry ekstraksi Blob juga gagal: ${retryBlobErr.message}`);
    }
  }

  // =========================================================================
  // STRATEGY 2: NATIVE PLAYWRIGHT DOWNLOAD EVENT (FALLBACK)
  // =========================================================================
  if (!blobSuccess) {
    strategyUsed = 'PLAYWRIGHT_DOWNLOAD';

    if (page.isClosed()) {
      throw new Error('Page telah ditutup sebelum menjalankan fallback download.');
    }

    if (typeof trigger !== 'function') {
      throw new Error('Ekstraksi Blob tidak berhasil dan tidak ada fungsi trigger download.');
    }

    console.warn('[DOWNLOAD] Beralih ke fallback Native Playwright Download...');

    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: Math.min(timeout, 20000) }),
        (async () => {
          if (!page.isClosed()) {
            try {
              await trigger();
            } catch (trigErr) {
              console.warn(`[DOWNLOAD] Warning saat trigger download fallback: ${trigErr.message}`);
            }
          }
        })()
      ]);

      downloadUrl = download.url();
      const failure = await download.failure();
      if (failure !== null && failure !== undefined) {
        throw new Error(`Playwright download failed: ${failure}`);
      }

      await download.saveAs(finalPath);
      console.log(`[DOWNLOAD] Strategy: PLAYWRIGHT_DOWNLOAD`);
      console.log(`[DOWNLOAD] Output: ${finalPath}`);
    } catch (downloadErr) {
      if (downloadErr.message.includes('closed') || (page && page.isClosed())) {
        throw new Error(`Target page, context or browser has been closed saat native download: ${downloadErr.message}`);
      }
      console.warn(`[DOWNLOAD] Native download event gagal (${downloadErr.message}).`);
      throw new Error(`Seluruh strategi download gagal. Blob URL tidak valid & download event error: ${downloadErr.message}`);
    }
  }

  // =========================================================================
  // FILE VALIDATION
  // =========================================================================
  const stat = await fs.promises.stat(finalPath);
  if (!stat.isFile()) {
    throw new Error(`Downloaded target is not a file: ${finalPath}`);
  }
  if (stat.size === 0) {
    throw new Error(`Downloaded file is empty (0 bytes): ${finalPath}`);
  }

  const fileSize = stat.size;
  const elapsedMs = Date.now() - startTime;

  console.log('[DOWNLOAD] Validation: PASS');
  console.log(`[DOWNLOAD] File size: ${(fileSize / 1024).toFixed(1)} KB (${fileSize} bytes)`);
  console.log(`[DOWNLOAD] Elapsed: ${elapsedMs} ms`);

  return {
    path: finalPath,
    filename: path.basename(finalPath),
    url: downloadUrl,
    sizeBytes: fileSize,
    sizeKb: (fileSize / 1024).toFixed(1),
    elapsedMs,
    strategy: strategyUsed
  };
}

/**
 * Download with safe retry mechanism without re-clicking unless native download is explicitly active.
 */
async function downloadWithRetry(options, maxRetries = 1) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (options.page && options.page.isClosed()) {
        throw new Error('Page telah ditutup, membatalkan retry download.');
      }
      if (attempt > 1) {
        console.log(`[DOWNLOAD] Retrying audio acquisition (Attempt ${attempt}/${maxRetries + 1})...`);
      }
      return await downloadFile(options);
    } catch (error) {
      lastError = error;
      console.error(`[DOWNLOAD] Attempt ${attempt} failed: ${error.message}`);

      if (error.message.includes('ENOENT') || error.message.includes('permission denied') || error.message.includes('closed')) {
        break;
      }

      if (attempt <= maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError;
}

module.exports = {
  sanitizeFilename,
  extractBaselineBlobUrls,
  isFreshBlob,
  findFreshBlobAudio,
  captureAudioElementsSnapshot,
  findTargetAudioElement,
  extractBlobDirectly,
  downloadFile,
  downloadWithRetry
};
