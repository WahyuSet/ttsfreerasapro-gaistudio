#!/usr/bin/env node
const readline = require('readline');
const { RecorderEngine } = require('./src/recorder-engine');
const { findWindowsChromePath } = require('./src/stealth-browser');

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

function getDefaultSessionName() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `flow_${d}_${t}`;
}

async function runCli() {
  const args = process.argv.slice(2);
  let targetUrl = args[0];
  let sessionName = args[1];

  console.log('================================================================');
  console.log('  🚀 AuStudio Playwright - Stealth Action Recorder');
  console.log('  🛡️  Google Chrome Windows + Anti-Bot Evasion');
  console.log('  ⚡ Siap untuk integrasi ke Service API Backend');
  console.log('================================================================\n');

  if (!targetUrl) {
    const defaultUrl = 'https://aistudio.google.com/generate-speech?model=gemini-2.5-pro-preview-tts';
    targetUrl = await askQuestion(`🌐 Masukkan URL Target\n   [Tekan ENTER langsung untuk: ${defaultUrl}]: `);
    if (!targetUrl) targetUrl = defaultUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }
  }

  if (!sessionName) {
    const defaultName = getDefaultSessionName();
    sessionName = await askQuestion(`📁 Nama Sesi [Default: ${defaultName}]: `);
    if (!sessionName) sessionName = defaultName;
  }

  sessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');

  console.log('\n----------------------------------------------------------------');
  console.log(`🌐 Target URL   : ${targetUrl}`);
  console.log(`📁 Nama Sesi    : ${sessionName}`);
  console.log(`💻 Windows Chrome: ${findWindowsChromePath() || 'channel: chrome'}`);
  console.log(`🛡️  Stealth Mode : AKTIF (navigator.webdriver dinonaktifkan)`);
  console.log('----------------------------------------------------------------\n');
  console.log('Membuka Google Chrome Windows asli Anda...');

  const engine = new RecorderEngine();

  engine.onEvent((type, payload) => {
    if (type === 'step_added') {
      const s = payload.step;
      const target = s.selector || s.url || s.key || '';
      const val = s.value ? ` | value: "${s.value}"` : '';
      console.log(`  [✓ AUTO-SAVED] Step #${s.id} [${s.type.toUpperCase()}] ${target}${val}`);
    }
  });

  const session = await engine.startSession({
    sessionName,
    startUrl: targetUrl,
    headless: false
  });

  console.log('\n🔴 PEREKAMAN SEDANG BERLANGSUNG!');
  console.log('Silakan berinteraksi di jendela Chrome (klik, ketik form, login, dll.).');
  console.log('Setiap aksi LANGSUNG OTOMATIS TERSIMPAN ke disk.');
  console.log('\n>>> Tekan [ENTER] di terminal ini atau tutup Chrome kapan saja untuk SELESAI <<<\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('', async () => {
    console.log('\nMenyimpan sesi akhir...');
    await engine.stopSession();

    console.log('\n================================================================');
    console.log(`🎉 PEREKAMAN SELESAI! (${engine.steps.length} langkah tersimpan)`);
    console.log('================================================================');
    console.log(`File hasil rekaman di folder: recordings\\${sessionName}\\`);
    console.log(` 1. script.js      -> Kode Playwright modular (export function runAutomation)`);
    console.log(` 2. steps.json     -> Data langkah mentah JSON (bisa diolah backend)`);
    console.log(` 3. api-service.js -> Contoh template service API Express`);
    console.log('----------------------------------------------------------------');
    console.log('Uji coba jalankan automasi hasil rekaman Anda:');
    console.log(` > node recordings/${sessionName}/script.js\n`);

    rl.close();
    process.exit(0);
  });
}

runCli().catch(err => {
  console.error('\n[Error]:', err.message);
  process.exit(1);
});
