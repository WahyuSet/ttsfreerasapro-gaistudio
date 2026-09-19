const fs = require('fs');
const path = require('path');

/**
 * Ekstraksi audio Blob langsung dari konteks peramban melalui Base64 DataURL.
 * @param {import('playwright').Page} page
 * @param {string|number|null} targetBlobSrcOrIndex
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
      const audio = (typeof target === 'number' && audios[target]) ? audios[target] : audios[audios.length - 1];
      if (!audio) throw new Error('Elemen audio tidak ditemukan di DOM');
      blobUrl = audio.currentSrc || audio.src;
    }

    if (!blobUrl || !blobUrl.startsWith('blob:')) {
      throw new Error(`URL audio bukan blob: ${blobUrl}`);
    }

    const response = await fetch(blobUrl);
    if (!response.ok) {
      throw new Error(`Gagal fetch Blob: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/wav';
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      throw new Error('Blob audio kosong (0 bytes)');
    }

    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === 'string') {
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        } else {
          reject(new Error('Format FileReader bukan string'));
        }
      };
      reader.onerror = () => reject(new Error('Gagal membaca Blob'));
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

module.exports = {
  extractBlobDirectly
};
