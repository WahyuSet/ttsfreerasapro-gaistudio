const { humanClick, humanPaste, humanDelay } = require('./human-behavior');
const { dismissPopups, selectVoicePill } = require('./tts-ui-helpers');

/**
 * Konfigurasi lingkungan Studio Google AI TTS sebelum perenderan audio dimulai.
 * @param {import('playwright').Page} page
 * @param {Object} params
 * @param {Function} onProgress
 * @param {number} totalChunks
 */
async function setupTtsStudio(page, params, onProgress, totalChunks) {
  const {
    voice = 'Achernar',
    style = 'Vocal Smile',
    pace = 'Natural',
    accent = 'Neutral',
    scene = 'A modern study room, explaining everyday science concepts to curious peers.',
    sampleContext = 'Warm, encouraging, speaking like an older sibling sharing cool trivia, upbeat yet gentle pacing.',
    persona = 'A relaxed and engaging storyteller, talking like a close friend sharing cool trivia, upbeat and lighthearted.'
  } = params;

  // 1. Buka AI Studio TTS
  onProgress({
    stage: 'initializing',
    progress: 15,
    currentPart: 0,
    totalParts: totalChunks,
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
    totalParts: totalChunks,
    message: 'Memilih template suara...'
  });
  await dismissPopups(page);
  console.log('[TtsEngine] Memilih template "The Patient Teacher"...');
  const templateSelector = 'mat-card[aria-label="The Patient Teacher - A patient and encouraging language teacher."], mat-card[aria-label*="The Patient Teacher"], mat-card:has-text("The Patient Teacher")';
  await humanClick(page, templateSelector).catch(() => {});
  await humanDelay(1000, 1600);

  // 3. Switch ke Text Mode
  onProgress({
    stage: 'configuring',
    progress: 25,
    currentPart: 0,
    totalParts: totalChunks,
    message: 'Beralih ke Text Mode & mengatur konteks adegan...'
  });
  await dismissPopups(page);
  console.log('[TtsEngine] Beralih ke Text Mode...');
  const textTab = page.locator('button:has-text("edit_noteText"), button:has-text("Text"), [aria-label*="Text" i]').first();
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
    totalParts: totalChunks,
    message: `Mengatur karakter suara (${voice}, ${style}, ${pace}, ${accent})...`
  });
  console.log('[TtsEngine] Mengatur karakter suara...');
  const voiceTrigger = page.locator('button[aria-label="Open voice settings"], button:has-text("Achernar"), button:has-text("Speaker 1"), .speaker-voice-trigger, [aria-label*="voice settings" i], [aria-label*="Voice" i]').first();
  if (await voiceTrigger.isVisible({ timeout: 4000 }).catch(() => false)) {
    await voiceTrigger.click({ force: true });
    await humanDelay(800, 1200);

    // Isi Persona jika tersedia
    if (persona) {
      console.log('[TtsEngine] Mengisi voice persona...');
      const personaSelector = 'textarea[placeholder*="Describe the voice persona" i], textarea[placeholder*="voice persona" i]';
      const personaField = page.locator(personaSelector).first();
      if (await personaField.isVisible({ timeout: 2500 }).catch(() => false)) {
        await humanPaste(page, personaSelector, persona);
        await humanDelay(400, 700);
      }
    }

    // Atur Voice Settings Pill (Style, Pace, Accent) dengan verifikasi postcondition
    if (style) await selectVoicePill(page, 'Style', style);
    if (pace) await selectVoicePill(page, 'Pace', pace);
    if (accent) await selectVoicePill(page, 'Accent', accent);

    // Pilih Voice (prioritaskan pencarian lewat input Search voices)
    if (voice) {
      console.log(`[TtsEngine] Memilih karakter suara: ${voice}...`);
      const searchInput = page.locator('input[aria-label="Search voices"], input[placeholder*="Search voices" i]').first();
      if (await searchInput.isVisible({ timeout: 2500 }).catch(() => false)) {
        await humanPaste(page, 'input[aria-label="Search voices"]', voice.toLowerCase());
        await humanDelay(400, 700);
      }

      const voiceCard = page.locator(`button[aria-label="${voice}" i], button[aria-label*="${voice}" i], button:has-text("${voice}"), div.voice-card:has-text("${voice}")`).first();
      if (await voiceCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await voiceCard.scrollIntoViewIfNeeded().catch(() => {});
        await voiceCard.click({ force: true });
        await humanDelay(500, 800);
        console.log(`[TtsEngine] Suara ${voice} dipilih.`);
      } else {
        console.warn(`[TtsEngine] Suara ${voice} tidak ditemukan.`);
      }
    }

    // Tutup panel
    const closeBtn = page.locator('button[aria-label="Close panel"], button[aria-label="Close"], button:has(span:has-text("close"))').first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await humanDelay(800, 1200);
  }
}

module.exports = {
  setupTtsStudio
};
