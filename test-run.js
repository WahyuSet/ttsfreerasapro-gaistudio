/**
 * Auto-Run Test Runner for Recorded Gemini TTS Flow
 * Runs the recorded automation with Human Behavior (Bezier Mouse & Natural Typing)
 * and downloads the resulting audio file.
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { launchStealthChrome } = require('./src/stealth-browser');
const { humanClick, humanType, humanPaste, humanDelay } = require('./src/human-behavior');
const { RecorderEngine } = require('./src/recorder-engine');
const { captureGeneratedAudio } = require('./src/audio-downloader');

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function runAutoTest(options = {}) {
  const keepOpen = options.keepOpen !== false; // Default: browser selalu dibiarkan terbuka
  console.log('================================================================');
  console.log('  🚀 AuStudio - Human Behavior Auto-Test Playwright');
  console.log('  🎯 Target: Google AI Studio Gemini 2.5 Pro Preview TTS');
  console.log('  📋 Mode: Fast Human Paste + Natural Action Delays');
  console.log('================================================================\n');

  const downloadsDir = path.resolve(__dirname, 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const profileDir = path.resolve(__dirname, 'profiles', 'default');
  console.log('[1/6] Membuka Chrome Windows asli dengan profil login...');

  const { context } = await launchStealthChrome({
    userDataDir: profileDir,
    headless: false,
    extraArgs: ['--start-maximized']
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  page.setDefaultTimeout(35000);

  try {
    // Step 1: Navigasi
    console.log('[2/6] Membuka Google AI Studio TTS...');
    await page.goto('https://aistudio.google.com/generate-speech?model=gemini-2.5-pro-preview-tts', {
      waitUntil: 'domcontentloaded'
    });
    await humanDelay(2000, 3000);

    // Step 2: Pilih template The Patient Teacher
    console.log('[3/6] 👤 Memilih template "The Patient Teacher"...');
    const templateSelector = 'mat-card[aria-label*="The Patient Teacher"], mat-card:has-text("The Patient Teacher")';
    await humanClick(page, templateSelector);
    await humanDelay(1000, 1600);

    // Step 3: Switch ke mode Text
    console.log('[4/6] 👤 Beralih ke mode Teks Bebas (Text Mode)...');
    const textTabSelector = 'button:has-text("Text"), [aria-label*="Text"]';
    await humanClick(page, textTabSelector);
    await humanDelay(800, 1400);

    // Step 4: Paste Scene
    console.log('-> 📋 Paste Scene Context...');
    await humanPaste(page, 'textarea[aria-label="Scene"]', 'A modern study room, explaining everyday science concepts to curious peers.');
    await humanDelay(600, 1100);

    // Step 5: Paste Sample Context
    console.log('-> 📋 Paste Speaker Style...');
    await humanPaste(page, 'textarea[aria-label="Sample Context"]', 'Warm, encouraging, speaking like an older sibling sharing cool trivia, upbeat yet gentle pacing.');
    await humanDelay(600, 1100);

    // Step 6: Voice Settings
    console.log('-> 👤 Membuka Voice Settings & memilih Achernar...');
    await humanClick(page, 'button[aria-label="Open voice settings"]');
    await humanDelay(1000, 1500);

    const personaSelector = 'ms-autosize-textarea textarea, textarea[placeholder*="Describe the voice persona"]';
    await humanPaste(page, personaSelector, 'A relaxed and engaging storyteller, talking like a close friend sharing cool trivia, upbeat and lighthearted.');
    await humanDelay(500, 900);

    // Helper untuk memilih opsi dropdown pill (Style, Pace, Accent) dengan aman dan cepat
    async function choosePill(pillName, choiceText) {
      console.log(`-> 👤 Mengatur ${pillName} -> ${choiceText}...`);
      // Tunggu backdrop overlay sebelumnya hilang jika ada
      await page.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 3000 }).catch(() => {});
      
      const pillBtn = page.locator(`button[aria-label="${pillName}"]`);
      const currentText = await pillBtn.innerText().catch(() => '');
      if (currentText.includes(choiceText)) {
        console.log(`   ✓ ${pillName} sudah bernilai "${choiceText}"`);
        return;
      }

      await pillBtn.click();
      await humanDelay(400, 700);

      const menuOption = page.locator(`.cdk-overlay-container [role="menuitem"]:has-text("${choiceText}"), .cdk-overlay-container button:has-text("${choiceText}")`).first();
      await menuOption.waitFor({ state: 'visible', timeout: 5000 });
      await menuOption.click();

      await page.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 5000 }).catch(() => {});
      await humanDelay(400, 700);
      console.log(`   ✓ ${pillName} berhasil diatur ke "${choiceText}"`);
    }

    // Step 6: Konfigurasi 3 Pengaturan Suara Sesuai Gambar (Vocal Smile, Natural, Neutral)
    await choosePill('Style', 'Vocal Smile');
    await choosePill('Pace', 'Natural');
    await choosePill('Accent', 'Neutral');

    // Pilih suara Achernar
    console.log('-> 👤 Memilih karakter suara: Achernar...');
    const voiceCard = page.locator('button:has-text("Achernar"), div.voice-card:has-text("Achernar"), [aria-label*="Achernar"]').first();
    await voiceCard.click();
    await humanDelay(500, 900);

    // Tutup panel suara
    console.log('-> 👤 Menutup panel suara...');
    const closePanelBtn = page.locator('button[aria-label="Close panel"], button:has(span:has-text("close"))').first();
    if (await closePanelBtn.isVisible()) {
      await closePanelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await humanDelay(800, 1300);

    // Step 7: Paste Naskah (1 Kalimat Pendek)
    const promptText = 'Speaker 1 : Halo semuanya, ini adalah uji coba suara singkat.';
    console.log(`[5/6] 📋 Paste naskah suara ("${promptText}")...`);
    await humanPaste(page, 'textarea[aria-label="Enter a prompt"]', promptText);

    // Jeda manusia memeriksa naskah sebelum klik Run
    console.log('-> 👤 Jeda membaca/memeriksa naskah sebelum menekan Run...');
    await humanDelay(1500, 2400);

    // Siapkan listener respons API
    const generationDonePromise = page.waitForResponse(res => {
      const url = res.url();
      return url.includes('alkalimakersuite') && res.status() === 200;
    }, { timeout: 65000 }).catch(() => null);

    // Step 8: Klik RUN
    console.log('\n[6/6] ⚡ 👤 Mengklik tombol RUN (Generate Suara)...');
    const runBtnSelector = 'button:has-text("Run"), button.run-button, [aria-label*="Run"]';
    await humanClick(page, runBtnSelector);

    console.log('⏳ Sedang menunggu Gemini 2.5 Pro memproses audio...');

    // Tunggu status tombol Stop selesai jika muncul (mendukung durasi pendek maupun naskah panjang hingga 15 menit)
    try {
      const stopBtn = await page.waitForSelector('button:has-text("Stop"), button[aria-label*="Stop"]', { timeout: 10000 }).catch(() => null);
      if (stopBtn) {
        console.log('⏳ Tombol Stop aktif, Gemini sedang memproses audio...');
        const genStartTime = Date.now();
        let lastReportSec = 0;
        while (true) {
          // Deteksi dini error banner dari Google AI Studio (misal 403 / Rate Limit / Permission Denied)
          const onScreenError = await page.evaluate(() => {
            const errorNodes = document.querySelectorAll('mat-snack-bar-container, .error-message, [role="alert"]');
            for (const el of errorNodes) {
              const txt = el.innerText.trim();
              if (txt && (txt.includes('403') || txt.includes('400') || txt.includes('500') || txt.toLowerCase().includes('permission denied') || txt.toLowerCase().includes('rate limit'))) {
                return txt.replace(/\s+/g, ' ');
              }
            }
            return null;
          }).catch(() => null);

          if (onScreenError) {
            throw new Error(`[Google AI Studio Rejection]: "${onScreenError}". Kuota harian akun Google ini telah habis (Rate Limit Free Tier 10 RPD) atau sesi kedaluwarsa. Silakan jalankan LOGIN.bat untuk mengganti akun Google.`);
          }

          const isGenerating = await page.locator('button:has-text("Stop"), button[aria-label*="Stop"]').first().isVisible().catch(() => false);
          if (!isGenerating) break;

          await page.waitForTimeout(2000);
          const elapsedSec = Math.floor((Date.now() - genStartTime) / 1000);
          if (elapsedSec - lastReportSec >= 15) {
            lastReportSec = elapsedSec;
            console.log(`   ⏳ Masih memproses audio naskah panjang (${elapsedSec} detik berjalan)...`);
          }
          if (elapsedSec > 900) { // Batas aman 15 menit
            console.log('   ⚠️ Peringatan: Proses generate mencapai batas 15 menit.');
            break;
          }
        }
      } else {
        // Jika tidak ada tombol stop, periksa apakah ada error snackbar
        await page.waitForTimeout(1500);
        const onScreenError = await page.evaluate(() => {
          const errorNodes = document.querySelectorAll('mat-snack-bar-container, .error-message, [role="alert"]');
          for (const el of errorNodes) {
            const txt = el.innerText.trim();
            if (txt && (txt.includes('403') || txt.includes('400') || txt.includes('500') || txt.toLowerCase().includes('permission denied') || txt.toLowerCase().includes('rate limit'))) {
              return txt.replace(/\s+/g, ' ');
            }
          }
          return null;
        }).catch(() => null);

        if (onScreenError) {
          throw new Error(`[Google AI Studio Rejection]: "${onScreenError}". Kuota harian akun Google ini telah habis (Rate Limit Free Tier 10 RPD) atau sesi kedaluwarsa. Silakan jalankan LOGIN.bat untuk mengganti akun Google.`);
        }

        await generationDonePromise;
        await humanDelay(8000, 12000);
      }
    } catch (e) {
      if (e.message.includes('[Google AI Studio Rejection]')) {
        throw e;
      }
      console.log(`   (Status generate: ${e.message})`);
    }

    console.log('✓ Gemini 2.5 Pro selesai men-generate suara baru!');

    // Jeda sesuai permintaan user agar pemutar audio & tombol download siap
    console.log('⏳ Memberikan jeda aman (4 detik) agar pemutar audio dan tombol download stabil...');
    await humanDelay(3500, 5000);

    // Step 9: Download Audio (.wav) dengan Multi-Strategi (DOM Blob + Playwright Events + Watcher)
    console.log('⬇️ 👤 Mengunduh file audio (.wav)...');
    const downloadStartTime = Date.now();
    const outputFilename = `gemini_tts_${downloadStartTime}.wav`;
    const outputPath = path.join(downloadsDir, outputFilename);

    let finalAudioPath = await captureGeneratedAudio(page, context, outputPath, 25000);

    if (finalAudioPath && fs.existsSync(finalAudioPath)) {
      const stats = fs.statSync(finalAudioPath);
      console.log('\n================================================================');
      console.log('🎉 SEMUA PROSES BERHASIL 100%!');
      console.log(`📁 File Audio Baru Berhasil Disimpan:`);
      console.log(`   👉 ${finalAudioPath}`);
      console.log(`📊 Ukuran File : ${(stats.size / 1024).toFixed(1)} KB`);
      console.log('================================================================\n');
    } else {
      console.log('\n⚠️ Audio berhasil digenerate di browser, namun unduhan otomatis perlu diklik langsung di layar.');
    }

    await humanDelay(2000, 3000);
    return { success: Boolean(finalAudioPath), audioPath: finalAudioPath, context };
  } catch (err) {
    console.error('\n[❌ Notice saat menjalankan test]:', err.message);
    const errPath = path.resolve('scratch', 'test_run_error.png');
    await page.screenshot({ path: errPath }).catch(() => {});
    console.log(`Screenshot error tersimpan di: ${errPath}`);
    if (!keepOpen) {
      throw err;
    }
  } finally {
    if (!keepOpen) {
      await context.close().catch(() => {});
    }
  }
}

async function main() {
  try {
    const list = RecorderEngine.getRecordingsList();
    let result;

    if (list.length > 0) {
      const latest = list[0];
      console.log(`📁 Ditemukan sesi rekaman tersimpan:`);
      console.log(`   [1] Jalankan Rekaman Terbaru (${latest.name}, ${latest.stepCount} langkah) [Default]`);
      console.log(`   [2] Jalankan Skrip Standar Gemini TTS (test-run)`);
      console.log('');
      const ans = await askQuestion('Pilihan Anda [1 / 2, Tekan ENTER untuk 1]: ');
      if (ans === '2') {
        result = await runAutoTest({ keepOpen: true });
      } else {
        const scriptPath = path.join(latest.path, 'script.js');
        if (fs.existsSync(scriptPath)) {
          console.log(`\n▶️ Menjalankan skrip dari: ${scriptPath}...\n`);
          const { runAutomation } = require(scriptPath);
          result = await runAutomation({ headless: false, keepOpen: true });
        } else {
          result = await runAutoTest({ keepOpen: true });
        }
      }
    } else {
      result = await runAutoTest({ keepOpen: true });
    }
  } catch (err) {
    console.error('\n[Notice]:', err.message);
  }

  // Tahan agar Chrome TIDAK PERNAH tertutup otomatis
  console.log('\n🟢 Browser Chrome tetap terbuka di layar.');
  console.log('👉 Tekan [ENTER] di terminal ini jika Anda sudah selesai dan ingin menutup browser...');
  await askQuestion('');
  console.log('Menutup browser... Selesai!');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n[Error]:', err.message);
    process.exit(1);
  });
}

module.exports = { runAutoTest };
