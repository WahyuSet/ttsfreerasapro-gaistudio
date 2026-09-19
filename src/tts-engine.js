const path = require('path');
const fs = require('fs');
const { launchStealthChrome } = require('./stealth-browser');
const { humanDelay } = require('./human-behavior');
const { formatSpeakerPrompt, splitTextIntoChunks } = require('./tts-text-utils');
const { normalizePillValue, isPillValueMatching, selectVoicePill, dismissPopups } = require('./tts-ui-helpers');
const { setupTtsStudio } = require('./tts-studio-config');
const { renderChunkAudio } = require('./tts-render-chunk');

class TtsEngine {
  constructor(options = {}) {
    this.downloadsDir = options.downloadsDir || path.resolve(__dirname, '..', 'downloads');
    this.profilesDir = options.profilesDir || path.resolve(__dirname, '..', 'profiles', 'default');
    this.isBusy = false;

    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
  }

  getStatus() {
    return {
      isBusy: this.isBusy,
      downloadsDirectory: this.downloadsDir
    };
  }

  async execute(params, onProgress = () => {}) {
    if (this.isBusy) {
      throw new Error('TtsEngine sedang sibuk memproses pekerjaan lain.');
    }
    this.isBusy = true;
    try {
      return await this._executeJob(params, onProgress);
    } finally {
      this.isBusy = false;
    }
  }

  async _executeJob(params, onProgress = () => {}) {
    const {
      text,
      voice = 'Achernar',
      style = 'Vocal Smile',
      pace = 'Natural',
      accent = 'Neutral',
      autoChunk = true,
      maxWordsPerChunk = 300
    } = params;

    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error('Parameter "text" wajib diisi dan tidak boleh kosong.');
    }

    const chunks = autoChunk ? splitTextIntoChunks(text, maxWordsPerChunk) : [{
      index: 1,
      total: 1,
      text: text.trim(),
      promptText: formatSpeakerPrompt(text),
      wordCount: text.trim().split(/\s+/).length
    }];

    console.log('\n================================================================');
    console.log(`[TtsEngine] Memulai proses TTS (${chunks.length} bagian naskah)...`);
    console.log(`[TtsEngine] Voice: ${voice} | Style: ${style} | Pace: ${pace} | Accent: ${accent}`);
    console.log('================================================================');

    onProgress({
      stage: 'initializing',
      progress: 5,
      currentPart: 0,
      totalParts: chunks.length,
      message: `Menyiapkan peramban Chrome untuk ${chunks.length} bagian naskah...`
    });

    const { context } = await launchStealthChrome({
      userDataDir: this.profilesDir,
      headless: false,
      extraArgs: ['--start-maximized']
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(40000);

    const generatedFiles = [];

    try {
      // 1. Konfigurasi Studio AI
      await setupTtsStudio(page, params, onProgress, chunks.length);

      // 2. Loop Eksekusi per Chunk
      const totalChunks = chunks.length;
      const progressChunkSlice = 65 / totalChunks;

      for (const chunk of chunks) {
        const chunkBase = 32 + (chunk.index - 1) * progressChunkSlice;
        const fileData = await renderChunkAudio(page, chunk, {
          downloadsDir: this.downloadsDir,
          totalChunks,
          chunkBase,
          progressChunkSlice,
          onProgress
        });

        generatedFiles.push(fileData);

        onProgress({
          stage: 'downloading',
          progress: Math.round(chunkBase + progressChunkSlice),
          currentPart: chunk.index,
          totalParts: totalChunks,
          message: `Berkas audio bagian ${chunk.index}/${totalChunks} berhasil disimpan (${fileData.sizeKb} KB).`
        });

        if (chunk.index < chunk.total) {
          console.log('[TtsEngine] Jeda natural sebelum bagian berikutnya...');
          await humanDelay(2500, 4000);
        }
      }

      console.log('\n================================================================');
      console.log(`[TtsEngine] Semua ${generatedFiles.length} bagian berhasil dibuat!`);
      console.log('================================================================\n');

      onProgress({
        stage: 'completed',
        progress: 100,
        currentPart: totalChunks,
        totalParts: totalChunks,
        message: `Semua ${generatedFiles.length} bagian audio berhasil dibuat dan siap diunduh.`
      });

      // Selesai: Beri jeda 30 detik sebelum menutup browser sesuai permintaan
      const shouldKeepOpen = process.env.KEEP_BROWSER_OPEN === 'true' || params.keepOpen === true;
      if (!shouldKeepOpen) {
        console.log('[TtsEngine] Menunggu 30 detik sebelum menutup browser Chrome...');
        await new Promise(r => setTimeout(r, 30000));
        await context.close().catch(() => {});
        console.log('[TtsEngine] Browser Chrome berhasil ditutup.');
      } else {
        console.log('[TtsEngine] Browser Chrome dibiarkan terbuka (KEEP_BROWSER_OPEN aktif).');
      }

      return {
        success: true,
        message: 'Audio berhasil di-generate dan diunduh.',
        totalChunks: chunks.length,
        voiceSettings: { voice, style, pace, accent },
        files: generatedFiles
      };

    } catch (error) {
      console.error('[TtsEngine] Terjadi kesalahan:', error.message);
      try {
        const errorScreenshot = path.join(this.downloadsDir, `error_screenshot_${Date.now()}.png`);
        await page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});
        console.log(`[TtsEngine] Screenshot kesalahan telah disimpan ke: ${errorScreenshot}`);
      } catch (sErr) {}

      const shouldKeepOpen = params.keepOpen || process.env.KEEP_BROWSER_OPEN === 'true';
      if (!shouldKeepOpen) {
        await humanDelay(3000, 4000);
        await context.close().catch(() => {});
      }
      throw error;
    }
  }
}

module.exports = {
  TtsEngine,
  splitTextIntoChunks,
  formatSpeakerPrompt,
  normalizePillValue,
  isPillValueMatching,
  selectVoicePill,
  dismissPopups
};
