const path = require('path');
const fs = require('fs');
const os = require('os');
const { launchStealthChrome } = require('./stealth-browser');
const { humanClick, humanPaste, humanDelay } = require('./human-behavior');
const {
  downloadFile,
  downloadWithRetry,
  sanitizeFilename,
  captureGeneratedAudio,
  captureAudioElementsSnapshot,
  findTargetAudioElement,
  extractBlobDirectly
} = require('./audio-downloader');

/**
 * Ensures prompt begins with "Speaker 1 : " or user-defined speaker prefix.
 * Automatically prepends "Speaker 1 : " if not already present.
 */
function formatSpeakerPrompt(text, defaultSpeaker = 'Speaker 1') {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (/^speaker\s*\d+\s*:/i.test(trimmed)) {
    return trimmed;
  }
  return `${defaultSpeaker} : ${trimmed}`;
}

/**
 * Split long text into smart, natural chunks based on sentences and paragraphs
 * Ensures no chunk exceeds maxWords and sentences are never cut in half.
 */
function splitTextIntoChunks(text, maxWords = 300) {
  if (!text || typeof text !== 'string') return [];
  let cleanText = text.trim();
  if (!cleanText) return [];

  // If text already has a speaker label, extract it (e.g. "Speaker 1 :")
  let speakerPrefix = 'Speaker 1';
  const match = cleanText.match(/^(speaker\s*\d+)\s*:\s*/i);
  if (match) {
    speakerPrefix = match[1];
    cleanText = cleanText.slice(match[0].length).trim();
  }

  const words = cleanText.split(/\s+/);
  if (words.length <= maxWords) {
    return [{
      index: 1,
      total: 1,
      text: cleanText,
      promptText: `${speakerPrefix} : ${cleanText}`,
      wordCount: words.length
    }];
  }

  // Split into sentences (preserving punctuation)
  const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const rawSentences = cleanText.match(sentenceRegex) || [cleanText];

  const chunks = [];
  let currentChunk = [];
  let currentWordCount = 0;

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const sentWords = trimmed.split(/\s+/).length;

    if (currentWordCount + sentWords > maxWords && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [trimmed];
      currentWordCount = sentWords;
    } else {
      currentChunk.push(trimmed);
      currentWordCount += sentWords;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks.map((chunkText, idx) => ({
    index: idx + 1,
    total: chunks.length,
    text: chunkText,
    promptText: `${speakerPrefix} : ${chunkText}`,
    wordCount: chunkText.split(/\s+/).length
  }));
}

/**
 * Automatically dismiss modals, onboarding prompts, or terms of service dialogs from Google AI Studio.
 */
async function dismissPopups(page) {
  if (!page || page.isClosed()) return;
  try {
    const dialogBtnSelectors = [
      'mat-dialog-container button:has-text("Continue")',
      'mat-dialog-container button:has-text("Get started")',
      'mat-dialog-container button:has-text("I agree")',
      'mat-dialog-container button:has-text("Accept")',
      'mat-dialog-container button:has-text("Got it")',
      'mat-dialog-container button:has-text("Dismiss")',
      'mat-dialog-container button:has-text("Close")',
      'button:has-text("Continue")',
      'button:has-text("Get started")',
      'button:has-text("I agree")',
      'button:has-text("Accept")',
      'button:has-text("Got it")',
      'button:has-text("Dismiss")',
      'div[role="dialog"] button:has-text("Continue")',
      'div[role="dialog"] button:has-text("Get started")',
      'div[role="dialog"] button:has-text("Accept")',
      'div[role="dialog"] button:has-text("I agree")',
      'div[role="dialog"] button:has-text("Got it")',
      'button[aria-label="Close"]',
      'button[aria-label="Dismiss"]'
    ];

    for (const selector of dialogBtnSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`[TtsEngine] 🛡️ Menutup dialog modal popup Google AI Studio (${selector})...`);
        await btn.click({ force: true }).catch(() => {});
        await humanDelay(500, 800);
      }
    }
  } catch (e) {}
}

class TtsEngine {
  constructor(options = {}) {
    this.downloadsDir = options.downloadsDir || path.resolve(__dirname, '..', 'downloads');
    this.profilesDir = options.profilesDir || path.resolve(__dirname, '..', 'profiles', 'default');
    this.isBusy = false;
    this.queue = [];

    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
  }

  /**
   * Get current engine status
   */
  getStatus() {
    return {
      isBusy: this.isBusy,
      queueLength: this.queue.length,
      downloadsDirectory: this.downloadsDir
    };
  }

  /**
   * Enqueue a generation job to prevent concurrent browser conflicts
   */
  generate(params, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ params, onProgress, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Direct execution for external queue managers (like JobManager)
   */
  execute(params, onProgress = () => {}) {
    return this._executeJob(params, onProgress);
  }

  async _processQueue() {
    if (this.isBusy || this.queue.length === 0) return;
    this.isBusy = true;
    const job = this.queue.shift();

    try {
      const result = await this._executeJob(job.params, job.onProgress);
      job.resolve(result);
    } catch (err) {
      console.error('[TtsEngine] Generation error:', err);
      job.reject(err);
    } finally {
      this.isBusy = false;
      this._processQueue();
    }
  }

  /**
   * Execute TTS generation in Windows Chrome via Playwright
   */
  async _executeJob(params, onProgress = () => {}) {
    const {
      text,
      voice = 'Achernar',
      style = 'Vocal Smile',
      pace = 'Natural',
      accent = 'Neutral',
      scene = 'A modern study room, explaining everyday science concepts to curious peers.',
      sampleContext = 'Warm, encouraging, speaking like an older sibling sharing cool trivia, upbeat yet gentle pacing.',
      persona = 'A relaxed and engaging storyteller, talking like a close friend sharing cool trivia, upbeat and lighthearted.',
      autoChunk = true,
      maxWordsPerChunk = 300
    } = params;

    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error('Parameter "text" wajib diisi dan tidak boleh kosong.');
    }

    // Determine chunks (Speaker 1 : is automatically handled)
    const chunks = autoChunk ? splitTextIntoChunks(text, maxWordsPerChunk) : [{
      index: 1,
      total: 1,
      text: text.trim(),
      promptText: formatSpeakerPrompt(text),
      wordCount: text.trim().split(/\s+/).length
    }];

    console.log(`\n================================================================`);
    console.log(`[TtsEngine] Memulai proses TTS (${chunks.length} bagian naskah)...`);
    console.log(`[TtsEngine] Voice: ${voice} | Style: ${style} | Pace: ${pace} | Accent: ${accent}`);
    console.log(`================================================================`);

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
      // 1. Buka AI Studio TTS
      onProgress({
        stage: 'initializing',
        progress: 15,
        currentPart: 0,
        totalParts: chunks.length,
        message: 'Membuka Google AI Studio Gemini TTS...'
      });
      console.log('[TtsEngine] Membuka Google AI Studio...');
      await page.goto('https://aistudio.google.com/generate-speech?model=gemini-2.5-pro-preview-tts', {
        waitUntil: 'domcontentloaded'
      });
      await humanDelay(2000, 3000);

      // Tangani kemungkinan modal popup sambutan / promo Google AI Studio
      await dismissPopups(page);
      await humanDelay(500, 1000);
      await dismissPopups(page);

      // 2. Pilih template
      onProgress({
        stage: 'configuring',
        progress: 22,
        currentPart: 0,
        totalParts: chunks.length,
        message: 'Memilih template suara...'
      });
      await dismissPopups(page);
      console.log('[TtsEngine] Memilih template "The Patient Teacher"...');
      const templateSelector = 'mat-card[aria-label*="The Patient Teacher"], mat-card:has-text("The Patient Teacher")';
      await humanClick(page, templateSelector).catch(() => {});
      await humanDelay(1000, 1600);

      // 3. Switch ke Text Mode
      onProgress({
        stage: 'configuring',
        progress: 25,
        currentPart: 0,
        totalParts: chunks.length,
        message: 'Beralih ke Text Mode & mengatur konteks adegan...'
      });
      await dismissPopups(page);
      console.log('[TtsEngine] Beralih ke Text Mode...');
      const textTab = page.locator('button:has-text("Text"), [aria-label*="Text"]').first();
      await textTab.click({ force: true }).catch(() => {});
      await humanDelay(800, 1400);

      // 4. Paste Contexts
      await dismissPopups(page);
      await humanPaste(page, 'textarea[aria-label="Scene"]', scene);
      await humanDelay(500, 900);
      await humanPaste(page, 'textarea[aria-label="Sample Context"]', sampleContext);
      await humanDelay(600, 1000);

      // 5. Atur Voice Settings
      onProgress({
        stage: 'configuring',
        progress: 30,
        currentPart: 0,
        totalParts: chunks.length,
        message: `Mengatur karakter suara (${voice}, ${style}, ${pace}, ${accent})...`
      });
      console.log('[TtsEngine] Mengatur karakter suara...');
      const voiceTrigger = page.locator('button:has-text("Achernar"), button:has-text("Speaker 1"), .speaker-voice-trigger, [aria-label*="Voice" i]').first();
      if (await voiceTrigger.isVisible({ timeout: 4000 }).catch(() => false)) {
        await voiceTrigger.click({ force: true });
        await humanDelay(800, 1200);

        // Sub-helper pilih pill
        const choosePill = async (pillName, targetVal) => {
          if (!targetVal) return;
          try {
            console.log(`[TtsEngine] 🎛️ Memilih ${pillName}: "${targetVal}"...`);
            const searchKeywords = [
              targetVal,
              targetVal.replace(/\s+/g, '-'),
              targetVal.toLowerCase(),
              targetVal.split(' ')[0]
            ];

            const pillBtn = page.locator(`button[aria-label*="${pillName}" i], button:has-text("${pillName}"), mat-chip:has-text("${pillName}"), .mat-mdc-chip:has-text("${pillName}")`).first();
            await pillBtn.scrollIntoViewIfNeeded().catch(() => {});
            await pillBtn.click({ force: true });
            await humanDelay(400, 700);

            // Cari opsi di dalam overlay container
            let matchedOption = null;
            for (const kw of searchKeywords) {
              const opt = page.locator(`.cdk-overlay-container [role="menuitem"], .cdk-overlay-container .mat-mdc-menu-item, .cdk-overlay-container button, .cdk-overlay-container [role="option"]`)
                .filter({ hasText: new RegExp(kw, 'i') }).first();
              if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
                matchedOption = opt;
                break;
              }
            }

            // Fallback selector jika tidak tertangkap filter di atas
            if (!matchedOption) {
              matchedOption = page.locator(`.cdk-overlay-container [role="menuitem"]:has-text("${targetVal}" i), .cdk-overlay-container button:has-text("${targetVal}" i)`).first();
            }

            if (await matchedOption.isVisible({ timeout: 3000 }).catch(() => false)) {
              await matchedOption.click({ force: true });
              console.log(`[TtsEngine] ✓ Berhasil memilih "${targetVal}" pada ${pillName}.`);
            } else {
              console.warn(`[TtsEngine] ⚠️ Opsi "${targetVal}" tidak ditemukan dalam menu ${pillName}.`);
              await page.keyboard.press('Escape').catch(() => {});
            }

            await page.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 4000 }).catch(() => {});
            await humanDelay(300, 600);
          } catch (err) {
            console.warn(`[TtsEngine] Kendala saat mengatur pill ${pillName}:`, err.message);
            await page.keyboard.press('Escape').catch(() => {});
          }
        };

        if (style) await choosePill('Style', style);
        if (pace) await choosePill('Pace', pace);
        if (accent) await choosePill('Accent', accent);

        // Pilih Voice
        if (voice) {
          console.log(`[TtsEngine] 👤 Memilih karakter suara: ${voice}...`);
          const voiceCard = page.locator(`button[aria-label*="${voice}" i], button:has-text("${voice}"), div.voice-card:has-text("${voice}")`).first();
          if (await voiceCard.isVisible({ timeout: 3000 }).catch(() => false)) {
            await voiceCard.scrollIntoViewIfNeeded().catch(() => {});
            await voiceCard.click({ force: true });
            await humanDelay(500, 800);
            console.log(`[TtsEngine] ✓ Suara ${voice} dipilih.`);
          }
        }

        // Tutup panel
        const closeBtn = page.locator('button[aria-label="Close panel"], button:has(span:has-text("close"))').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
        } else {
          await page.keyboard.press('Escape').catch(() => {});
        }
        await humanDelay(800, 1200);
      }

      // 6. Loop Eksekusi per Chunk
      const totalChunks = chunks.length;
      const progressChunkSlice = 65 / totalChunks;

      for (const chunk of chunks) {
        const chunkBase = 32 + (chunk.index - 1) * progressChunkSlice;

        onProgress({
          stage: 'rendering',
          progress: Math.round(chunkBase + progressChunkSlice * 0.1),
          currentPart: chunk.index,
          totalParts: totalChunks,
          message: `Menempelkan naskah bagian ${chunk.index}/${totalChunks} (${chunk.wordCount} kata)...`
        });
        console.log(`\n[TtsEngine] 🎬 Memproses Bagian [${chunk.index}/${chunk.total}] (${chunk.wordCount} kata)...`);
        
        // 1. Snapshot baseline audio elements sebelum RUN untuk isolasi chunk
        const baselineAudioSnapshot = await captureAudioElementsSnapshot(page);
        console.log(`[TtsEngine] Audio baseline snapshot: ${baselineAudioSnapshot.length} elements detected.`);

        // 2. Paste prompt naskah
        const promptTextarea = 'textarea[aria-label="Enter a prompt"]';
        const finalPrompt = formatSpeakerPrompt(chunk.promptText || chunk.text);
        await humanPaste(page, promptTextarea, finalPrompt);
        await humanDelay(1500, 2200);

        // Siapkan listener respons jaringan backend Google AI Studio untuk monitoring
        const apiResponsePromise = page.waitForResponse(res => {
          const u = res.url();
          return (u.includes('alkalimakersuite') || u.includes('generate-speech') || u.includes('predict')) && res.status() === 200;
        }, { timeout: 120000 }).catch(() => null);

        // 3. Klik RUN
        onProgress({
          stage: 'rendering',
          progress: Math.round(chunkBase + progressChunkSlice * 0.25),
          currentPart: chunk.index,
          totalParts: totalChunks,
          message: `Mengirim perintah render suara bagian ${chunk.index}/${totalChunks} ke Gemini...`
        });
        await dismissPopups(page);
        console.log(`[TtsEngine] ⚡ Klik RUN (Bagian ${chunk.index})...`);
        const runBtn = 'button:has-text("Run"), button.run-button, [aria-label*="Run" i]';
        await humanClick(page, runBtn);

        // 4. Tunggu audio selesai dirender berdasarkan siklus tombol Run (Run -> Spinner -> Run kembali) & Kesiapan Tombol Download
        console.log('[TtsEngine] ⏳ Menunggu Gemini merender audio (memantau spinner & tombol Run/Download)...');
        const genStartTime = Date.now();
        let lastReportSec = 0;
        let detectedTargetAudio = null;

        // Beri jeda awal agar render mulai berjalan dan spinner muncul
        await humanDelay(1500, 2500);

        while (true) {
          const elapsedSec = Math.floor((Date.now() - genStartTime) / 1000);

          // Cek status lengkap UI dengan membandingkan terhadap baselineAudioSnapshot
          const uiState = await page.evaluate((baseline) => {
            // 1. Cek apakah ada spinner aktif
            const spinners = document.querySelectorAll('mat-progress-spinner, mat-spinner, .mat-mdc-progress-spinner, [role="progressbar"], .spinner');
            const hasSpinner = Array.from(spinners).some(s => {
              const rect = s.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });

            // 2. Cek apakah ada tombol Stop yang aktif
            const stopButtons = Array.from(document.querySelectorAll('button')).filter(b => {
              const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
              return t.includes('stop');
            });
            const hasStop = stopButtons.some(b => b.getBoundingClientRect().width > 0);

            // 3. Cek apakah tombol RUN sudah kembali aktif normal
            const runButtons = Array.from(document.querySelectorAll('button')).filter(b => {
              const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
              return t.includes('run') || t.includes('ctrl');
            });
            const isRunReady = runButtons.some(b => {
              const notDisabled = !b.disabled && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true';
              return b.getBoundingClientRect().width > 0 && notDisabled;
            });

            // 4. Cek tombol Download
            const dlButtons = Array.from(document.querySelectorAll('button')).filter(b => {
              const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
              return t.includes('download');
            });
            const isDownloadBtnReady = dlButtons.some(b => {
              const notDisabled = !b.disabled && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true';
              return b.getBoundingClientRect().width > 0 && notDisabled;
            });

            // 5. Cek elemen audio dan bandingkan dengan baseline snapshot
            const audios = Array.from(document.querySelectorAll('audio')).map((a, idx) => ({
              index: idx,
              src: a.src || null,
              currentSrc: a.currentSrc || null,
              readyState: a.readyState,
              duration: a.duration
            }));

            let targetAudio = null;
            // Cari elemen audio yang src-nya baru (berbeda dari baseline snapshot)
            for (const a of audios) {
              const s = a.currentSrc || a.src || '';
              if (!s.startsWith('blob:') || a.readyState < 1) continue;

              const baseMatch = (baseline || []).find(b => b.index === a.index);
              if (!baseMatch) {
                targetAudio = a;
                break;
              }
              const baseSrc = baseMatch.currentSrc || baseMatch.src || '';
              if (s !== baseSrc) {
                targetAudio = a;
                break;
              }
            }

            // Fallback: Jika baseline kosong atau audio player siap
            if (!targetAudio) {
              targetAudio = audios.filter(a => (a.currentSrc || a.src || '').startsWith('blob:') && a.readyState >= 1).pop() || null;
            }

            // 6. Cek pesan error banner
            let errorMessage = null;
            const errorNodes = document.querySelectorAll('mat-snack-bar-container, .error-message, [role="alert"], ms-banner');
            for (const el of errorNodes) {
              const txt = el.innerText.trim();
              if (txt && (txt.includes('403') || txt.includes('400') || txt.includes('500') || txt.toLowerCase().includes('permission denied') || txt.toLowerCase().includes('rate limit') || txt.toLowerCase().includes('no speakers detected'))) {
                errorMessage = txt.replace(/\s+/g, ' ');
                break;
              }
            }

            return {
              hasSpinner,
              hasStop,
              isRunReady,
              isDownloadBtnReady,
              targetAudio,
              isNewAudioReady: Boolean(targetAudio),
              errorMessage
            };
          }, baselineAudioSnapshot).catch(() => ({
            hasSpinner: true,
            hasStop: false,
            isRunReady: false,
            isDownloadBtnReady: false,
            targetAudio: null,
            isNewAudioReady: false,
            errorMessage: null
          }));

          // KONDISI 1 (SUKSES): Jika audio sudah siap di player, atau tombol Download siap, atau spinner selesai dan tombol Run kembali aktif
          const isProcessingFinished = (uiState.isNewAudioReady || uiState.isDownloadBtnReady || (uiState.isRunReady && !uiState.hasSpinner)) && !uiState.hasStop && elapsedSec >= 3;

          if (isProcessingFinished) {
            detectedTargetAudio = uiState.targetAudio;
            console.log(`[TtsEngine] ✓ Proses render audio selesai! (Durasi ${elapsedSec}s)`);
            if (detectedTargetAudio) {
              console.log(`[TtsEngine] [TTS] Audio Blob baru terdeteksi: ${detectedTargetAudio.currentSrc || detectedTargetAudio.src} | Durasi: ${detectedTargetAudio.duration || 0}s`);
            }
            break;
          }

          // KONDISI 2 (ERROR FATAL): Hanya lempar error jika TIDAK ADA audio yang berhasil terbuat setelah spinner berhenti
          if (uiState.errorMessage && !uiState.hasSpinner && !uiState.isNewAudioReady && elapsedSec >= 6) {
            throw new Error(`[Google AI Studio Rejection]: "${uiState.errorMessage}". Silakan periksa format naskah atau kuota harian akun Google.`);
          }

          if (elapsedSec - lastReportSec >= 5) {
            lastReportSec = elapsedSec;
            console.log(`   ⏳ Masih memproses audio (${elapsedSec}s berjalan)...`);
            onProgress({
              stage: 'rendering',
              progress: Math.min(Math.round(chunkBase + progressChunkSlice * 0.65), 92),
              currentPart: chunk.index,
              totalParts: totalChunks,
              message: `Gemini sedang merender suara bagian ${chunk.index}/${totalChunks} (${elapsedSec}s)...`
            });
          }

          if (elapsedSec > 900) {
            console.warn('[TtsEngine] ⚠️ Batas waktu render 15 menit tercapai.');
            break;
          }

          await new Promise(r => setTimeout(r, 800));
        }

        // Tunggu respons API jika belum selesai
        await Promise.race([
          apiResponsePromise,
          new Promise(r => setTimeout(r, 3000))
        ]);

        console.log(`[TtsEngine] ✓ Selesai generate bagian ${chunk.index}!`);

        // 5. Akuisisi audio langsung via Direct DOM Blob Extraction (tanpa perlu klik Download)
        onProgress({
          stage: 'downloading',
          progress: Math.round(chunkBase + progressChunkSlice * 0.8),
          currentPart: chunk.index,
          totalParts: totalChunks,
          message: `Mengunduh berkas audio bagian ${chunk.index}/${totalChunks}...`
        });
        console.log(`[TtsEngine] ⬇️ Mengakuisisi berkas audio bagian ${chunk.index}...`);

        const downloadStartTime = Date.now();
        const filename = `gemini_tts_${downloadStartTime}_part${chunk.index}.wav`;
        const detectedBlobSrc = detectedTargetAudio ? (detectedTargetAudio.currentSrc || detectedTargetAudio.src) : null;

        const downloadResult = await downloadWithRetry({
          page,
          downloadDir: this.downloadsDir,
          customFilename: filename,
          timeout: 25000,
          baselineSnapshot: baselineAudioSnapshot,
          targetBlobSrc: detectedBlobSrc,
          trigger: async () => {
            if (page.isClosed()) return;
            const downloadBtn = page.locator('button[aria-label*="Download" i], button:has-text("Download")').first();
            if (await downloadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
              await downloadBtn.scrollIntoViewIfNeeded().catch(() => {});
              await downloadBtn.click({ force: true });
            }
          }
        }, 1);

        const downloadedPath = downloadResult.path;

        if (downloadedPath && fs.existsSync(downloadedPath)) {
          const stats = fs.statSync(downloadedPath);
          console.log(`[TtsEngine] 🎉 File tersimpan: ${filename} (${(stats.size / 1024).toFixed(1)} KB) [${downloadResult.strategy}]`);
          generatedFiles.push({
            partIndex: chunk.index,
            totalParts: chunk.total,
            filename: filename,
            filePath: downloadedPath,
            downloadUrl: `/api/tts/download/${filename}`,
            sizeBytes: stats.size,
            sizeKb: (stats.size / 1024).toFixed(1),
            strategy: downloadResult.strategy,
            textSnippet: chunk.text.slice(0, 80) + (chunk.text.length > 80 ? '...' : ''),
            wordCount: chunk.wordCount
          });

          onProgress({
            stage: 'downloading',
            progress: Math.round(chunkBase + progressChunkSlice),
            currentPart: chunk.index,
            totalParts: totalChunks,
            message: `Berkas audio bagian ${chunk.index}/${totalChunks} berhasil disimpan (${(stats.size / 1024).toFixed(1)} KB).`
          });
        } else {
          console.error(`[TtsEngine] ❌ File audio bagian ${chunk.index} tidak berhasil diunduh.`);
          const debugImg = path.join(this.downloadsDir, `debug_download_failed_part${chunk.index}_${Date.now()}.png`);
          await page.screenshot({ path: debugImg, fullPage: true }).catch(() => {});
          throw new Error(`File audio bagian ${chunk.index} gagal diunduh. Screenshot debug disimpan di ${path.basename(debugImg)}`);
        }

        // Jeda antar bagian naskah jika ada beberapa chunk
        if (chunk.index < chunk.total) {
          console.log(`[TtsEngine] ⏳ Jeda natural sebelum bagian berikutnya...`);
          await humanDelay(2500, 4000);
        }
      }

      console.log(`\n================================================================`);
      console.log(`🎉 [TtsEngine] Semua ${generatedFiles.length} bagian berhasil dibuat!`);
      console.log(`================================================================\n`);

      onProgress({
        stage: 'completed',
        progress: 100,
        currentPart: totalChunks,
        totalParts: totalChunks,
        message: `Semua ${generatedFiles.length} bagian audio berhasil dibuat dan siap diunduh.`
      });

      // Selesai: Browser dibiarkan terbuka jika keepOpen aktif
      await humanDelay(2000, 3000);
      const shouldKeepOpen = params.keepOpen || process.env.KEEP_BROWSER_OPEN === 'true';
      if (!shouldKeepOpen) {
        await context.close().catch(() => {});
      } else {
        console.log('[TtsEngine] 🟢 Browser Chrome tetap dibiarkan terbuka di layar.');
      }

      return {
        success: true,
        message: 'Audio berhasil di-generate dan diunduh.',
        totalChunks: chunks.length,
        voiceSettings: { voice, style, pace, accent },
        files: generatedFiles
      };

    } catch (error) {
      console.error('[TtsEngine] ❌ Terjadi kesalahan:', error.message);
      // Simpan screenshot error agar user dan developer dapat memeriksa kondisi UI
      try {
        const errorScreenshot = path.join(this.downloadsDir, `error_screenshot_${Date.now()}.png`);
        await page.screenshot({ path: errorScreenshot, fullPage: true }).catch(() => {});
        console.log(`[TtsEngine] 📸 Screenshot kesalahan telah disimpan ke: ${errorScreenshot}`);
      } catch (sErr) {}

      // Jangan tutup browser mendadak agar pengguna bisa melihat tampilan di layar
      const shouldKeepOpen = params.keepOpen || process.env.KEEP_BROWSER_OPEN === 'true';
      if (!shouldKeepOpen) {
        console.log('[TtsEngine] Menunggu 8 detik sebelum menutup browser agar Anda dapat melihat tampilan...');
        await humanDelay(8000, 10000);
        await context.close().catch(() => {});
      } else {
        console.log('[TtsEngine] 🟢 Browser Chrome dibiarkan terbuka untuk pemeriksaan.');
      }
      throw error;
    }
  }
}

module.exports = {
  TtsEngine,
  splitTextIntoChunks
};
