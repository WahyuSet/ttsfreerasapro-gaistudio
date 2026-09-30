const { humanDelay } = require('./human-behavior');

/**
 * Normalisasi teks pill untuk komparasi (hilangkan karakter non-alphanumeric, lowercase).
 * @param {string} val
 * @returns {string}
 */
function normalizePillValue(val) {
  if (!val || typeof val !== 'string') return '';
  return val.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Memeriksa apakah teks atau aria-label elemen cocok dengan target pill.
 * @param {string} actualText
 * @param {string} targetVal
 * @returns {boolean}
 */
function isPillValueMatching(actualText, targetVal) {
  if (!actualText || !targetVal) return false;
  const normActual = normalizePillValue(actualText);
  const normTarget = normalizePillValue(targetVal);
  return normActual.includes(normTarget);
}

/**
 * Menutup modal dialog popup onboarding atau persetujuan Google AI Studio secara otomatis.
 * @param {import('playwright').Page} page
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
      'button[aria-label="Dismiss"]',
      'button[aria-label="Close guided tour"]'
    ];

    for (const selector of dialogBtnSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`[TtsEngine] Menutup dialog modal popup Google AI Studio (${selector})...`);
        await btn.click({ force: true }).catch(() => {});
        await humanDelay(500, 800);
      }
    }
  } catch (e) {
    console.warn('[TtsEngine] Non-critical dismissPopups warning:', e.message);
  }
}

/**
 * Memilih opsi dropdown pill (Style, Pace, Accent) pada menu voice settings.
 * @param {import('playwright').Page} page
 * @param {'Style'|'Pace'|'Accent'} pillName
 * @param {string} targetVal
 */
async function selectVoicePill(page, pillName, targetVal) {
  if (!targetVal) return;

  let resolvedVal = String(targetVal).trim();
  if (pillName.toLowerCase() === 'accent' && (/neutral/i.test(resolvedVal) || /default/i.test(resolvedVal))) {
    resolvedVal = 'Neutral';
  }

  console.log(`[TtsEngine] Memilih ${pillName}: "${resolvedVal}"...`);

  // 1. Tunggu overlay/backdrop sebelumnya selesai menutup
  await page.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 3500 }).catch(() => {});
  await humanDelay(250, 450);

  // 2. Temukan tombol pill
  const pillBtn = page.locator(`button[aria-label="${pillName}" i], button[aria-label*="${pillName}" i], button:has-text("${pillName}")`).first();
  if (!(await pillBtn.isVisible({ timeout: 3500 }).catch(() => false))) {
    console.warn(`[TtsEngine] Tombol pill ${pillName} tidak ditemukan.`);
    return;
  }

  // 3. Cek Idempotency
  const currentText = await pillBtn.innerText().catch(() => '');
  const currentAria = await pillBtn.getAttribute('aria-label').catch(() => '');
  if (isPillValueMatching(currentText, resolvedVal) || (isPillValueMatching(currentAria, resolvedVal) && !currentAria.toLowerCase().endsWith(pillName.toLowerCase()))) {
    console.log(`[TtsEngine] ${pillName} sudah bernilai "${resolvedVal}" (idempotent, lewati pemilihan).`);
    return;
  }

  // 4. Buka menu dropdown pill
  await pillBtn.scrollIntoViewIfNeeded().catch(() => {});
  await pillBtn.click().catch(async () => {
    await pillBtn.click({ force: true });
  });

  // 5. Tunggu container overlay CDK muncul
  await page.waitForSelector('.cdk-overlay-container .cdk-overlay-pane', { state: 'visible', timeout: 4000 }).catch(() => {});
  await humanDelay(350, 550);

  // 6. Pilih opsi target dari overlay aktif yang paling baru
  const overlayPanes = page.locator('.cdk-overlay-container .cdk-overlay-pane');
  const activePane = overlayPanes.last();

  const exactRegex = new RegExp(`^\\s*${resolvedVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const wordRegex = new RegExp(`\\b${resolvedVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

  let optionBtn = activePane.locator('[role="menuitem"], .mat-mdc-menu-item, button').filter({ hasText: exactRegex }).first();
  if (!(await optionBtn.isVisible({ timeout: 1500 }).catch(() => false))) {
    optionBtn = activePane.locator('.preset-label, .preset-description, span').filter({ hasText: exactRegex }).first();
  }
  if (!(await optionBtn.isVisible({ timeout: 1500 }).catch(() => false))) {
    optionBtn = activePane.locator('[role="menuitem"], .mat-mdc-menu-item, button').filter({ hasText: wordRegex }).first();
  }
  if (!(await optionBtn.isVisible({ timeout: 1500 }).catch(() => false))) {
    optionBtn = page.locator(`.cdk-overlay-container [role="menuitem"]:has-text("${resolvedVal}"), .cdk-overlay-container button:has-text("${resolvedVal}")`).last();
  }

  if (await optionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await optionBtn.scrollIntoViewIfNeeded().catch(() => {});
    await optionBtn.click({ force: true }).catch(async () => await optionBtn.click());
    console.log(`[TtsEngine] Klik opsi "${resolvedVal}" pada menu ${pillName}.`);
  } else {
    await page.keyboard.press('Escape').catch(() => {});
    console.warn(`[TtsEngine] Opsi "${resolvedVal}" tidak ditemukan dalam menu dropdown ${pillName}, melanjutkan.`);
  }

  // 7. Tunggu backdrop menutup sepenuhnya
  await page.waitForSelector('.cdk-overlay-backdrop', { state: 'detached', timeout: 4000 }).catch(() => {});
  await humanDelay(350, 650);

  // 8. Postcondition Verification
  const verifiedText = await pillBtn.innerText().catch(() => '');
  const verifiedAria = await pillBtn.getAttribute('aria-label').catch(() => '');
  const isVerified = isPillValueMatching(verifiedText, resolvedVal) || isPillValueMatching(verifiedAria, resolvedVal);

  if (!isVerified) {
    console.warn(`[TtsEngine] Postcondition notice untuk ${pillName}: aktual="${verifiedText}" (aria="${verifiedAria}"). Melanjutkan.`);
  } else {
    console.log(`[TtsEngine] Konfigurasi ${pillName} terverifikasi: "${targetVal}".`);
  }
}

module.exports = {
  normalizePillValue,
  isPillValueMatching,
  dismissPopups,
  selectVoicePill
};
