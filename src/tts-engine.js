const path = require('path');
const fs = require('fs');
const { launchStealthChrome } = require('./stealth-browser');
const { humanDelay } = require('./human-behavior');
const { formatSpeakerPrompt, splitTextIntoChunks } = require('./tts-text-utils');
const { normalizePillValue, isPillValueMatching, selectVoicePill, dismissPopups } = require('./tts-ui-helpers');
const { setupTtsStudio } = require('./tts-studio-config');
const { renderChunkAudio } = require('./tts-render-chunk');
const { mergeAudioFiles } = require('./audio-converter');

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
      voice = 'Zephyr',
      style = 'Vocal Smile',
      pace = 'Natural',
      accent = 'Neutral',
      autoChunk = true,
      maxWordsPerChunk = 300,
      offscreen = true
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

    let context = null;
    let page = null;
    let needsSetup = true;

    const launchBrowser = async () => {
      // Tutup context lama jika masih ada
      if (context) {
        await context.close().catch(() => {});
      }
      const result = await launchStealthChrome({
        userDataDir: this.profilesDir,
        headless: false,
        offscreen: Boolean(offscreen)
      });
      context = result.context;
      page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
      page.setDefaultTimeout(40000);
      needsSetup = true;
      return { context, page };
    };

    await launchBrowser();

    const generatedFiles = [];

    try {
      // 1. Konfigurasi Studio AI
      await setupTtsStudio(page, params, onProgress, chunks.length);
      needsSetup = false;

      // 2. Loop Eksekusi per Chunk
      const totalChunks = chunks.length;
      const progressChunkSlice = 65 / totalChunks;

      for (const chunk of chunks) {
        const chunkBase = 32 + (chunk.index - 1) * progressChunkSlice;

        // Cek apakah browser masih hidup sebelum memproses chunk
        if (page.isClosed()) {
          console.log(`[TtsEngine] Browser crash terdeteksi sebelum bagian ${chunk.index}. Meluncurkan ulang browser...`);
          onProgress({
            stage: 'rendering',
            progress: Math.round(chunkBase),
            currentPart: chunk.index,
            totalParts: totalChunks,
            message: `Meluncurkan ulang browser untuk bagian ${chunk.index}/${totalChunks}...`
          });
          await launchBrowser();
        }

        // Setup ulang jika browser baru diluncurkan
        if (needsSetup) {
          console.log('[TtsEngine] Mengonfigurasi ulang Google AI Studio...');
          await setupTtsStudio(page, params, onProgress, totalChunks);
          needsSetup = false;
        }

        let fileData;
        try {
          fileData = await renderChunkAudio(page, chunk, {
            downloadsDir: this.downloadsDir,
            totalChunks,
            chunkBase,
            progressChunkSlice,
            onProgress
          });
        } catch (chunkErr) {
          // Jika browser crash saat rendering/download chunk, coba ulang 1x dengan browser baru
          const isBrowserCrash = chunkErr.message && (
            chunkErr.message.includes('has been closed') ||
            chunkErr.message.includes('Target closed') ||
            chunkErr.message.includes('crashed')
          );
          if (isBrowserCrash) {
            console.warn(`[TtsEngine] Browser crash saat proses bagian ${chunk.index}. Mencoba ulang dengan browser baru...`);
            onProgress({
              stage: 'rendering',
              progress: Math.round(chunkBase + progressChunkSlice * 0.05),
              currentPart: chunk.index,
              totalParts: totalChunks,
              message: `Browser crash saat bagian ${chunk.index}/${totalChunks}, mencoba ulang...`
            });
            await launchBrowser();
            await setupTtsStudio(page, params, onProgress, totalChunks);
            needsSetup = false;
            fileData = await renderChunkAudio(page, chunk, {
              downloadsDir: this.downloadsDir,
              totalChunks,
              chunkBase,
              progressChunkSlice,
              onProgress
            });
          } else {
            throw chunkErr;
          }
        }

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

      let mergedFile = null;
      if (generatedFiles.length > 1) {
        try {
          const firstBase = path.parse(generatedFiles[0].filename).name.replace(/_part\d+$/i, '');
          const mergedFilename = `${firstBase}_merged.mp3`;
          const mergedPath = path.join(this.downloadsDir, mergedFilename);

          onProgress({
            stage: 'merging',
            progress: 96,
            currentPart: totalChunks,
            totalParts: totalChunks,
            message: `Menggabungkan ${generatedFiles.length} bagian audio menjadi 1 berkas MP3...`
          });
          console.log(`[TtsEngine] Menggabungkan ${generatedFiles.length} bagian audio menjadi 1 berkas MP3: ${mergedFilename}...`);

          await mergeAudioFiles(generatedFiles.map(f => f.filePath), mergedPath);

          if (fs.existsSync(mergedPath)) {
            const mergedStats = fs.statSync(mergedPath);
            mergedFile = {
              filename: mergedFilename,
              filePath: mergedPath,
              downloadUrl: `/api/tts/download/${mergedFilename}`,
              sizeBytes: mergedStats.size,
              sizeKb: (mergedStats.size / 1024).toFixed(1),
              isMerged: true,
              totalParts: generatedFiles.length
            };
            console.log(`[TtsEngine] Penggabungan berhasil: ${mergedFilename} (${mergedFile.sizeKb} KB)`);
          }
        } catch (mergeErr) {
          console.warn(`[TtsEngine] Penggabungan audio otomatis gagal: ${mergeErr.message}`);
        }
      } else if (generatedFiles.length === 1) {
        mergedFile = {
          ...generatedFiles[0],
          isMerged: false
        };
      }

      onProgress({
        stage: 'completed',
        progress: 100,
        currentPart: totalChunks,
        totalParts: totalChunks,
        message: generatedFiles.length > 1
          ? `Semua ${generatedFiles.length} bagian audio berhasil dibuat dan digabungkan menjadi 1 file MP3 utuh.`
          : `Berkas audio berhasil dibuat dan siap diunduh.`
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
        message: generatedFiles.length > 1
          ? `Audio berhasil di-generate (${generatedFiles.length} bagian) dan digabungkan menjadi 1 berkas MP3 utuh.`
          : 'Audio berhasil di-generate dan diunduh.',
        totalChunks: chunks.length,
        voiceSettings: { voice, style, pace, accent },
        mergedFile,
        files: generatedFiles
      };

    } catch (error) {
      console.error('[TtsEngine] Terjadi kesalahan:', error.message);
      try {
        if (page && !page.isClosed()) {
          const errorScreenshot = path.join(this.downloadsDir, `error_screenshot_${Date.now()}.png`);
          await page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});
          console.log(`[TtsEngine] Screenshot kesalahan telah disimpan ke: ${errorScreenshot}`);
        }
      } catch (sErr) {}

      const shouldKeepOpen = params.keepOpen || process.env.KEEP_BROWSER_OPEN === 'true';
      if (!shouldKeepOpen) {
        await humanDelay(3000, 4000);
        if (context) await context.close().catch(() => {});
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
