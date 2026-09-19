'use strict';

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { launchStealthChrome, findWindowsChromePath } = require('./stealth-browser');

async function main() {
  console.log('================================================================');
  console.log(' Membuka Browser Google AI Studio (TTS) - Windows Chrome');
  console.log(' Stealth Engine Aktif (Anti-Bot Bypass)');
  console.log('================================================================\n');

  const userDataDir = path.resolve(__dirname, '..', 'profiles', 'default');
  const targetUrl = process.argv[2] || 'https://aistudio.google.com/';

  console.log(`Chrome Path : ${findWindowsChromePath() || 'channel: chrome'}`);
  console.log(`Profile Dir : ${userDataDir}`);
  console.log(`Target URL  : ${targetUrl}\n`);
  console.log('Membuka Chrome Windows... Silakan lakukan LOGIN secara normal.');

  const { context } = await launchStealthChrome({
    userDataDir,
    headless: false,
    offscreen: false
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto(targetUrl).catch((e) => console.log('Info navigasi:', e.message));

  console.log('\n----------------------------------------------------------------');
  console.log('Silakan login dengan akun Google Anda di jendela Chrome yang terbuka.');
  console.log('Selesaikan verifikasi / 2FA / terms jika ada.');
  console.log('Setelah BERHASIL LOGIN dan masuk ke halaman utama Google AI Studio:');
  console.log('Tekan [ENTER] di terminal ini atau tutup jendela Chrome.');
  console.log('----------------------------------------------------------------\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let isClosing = false;
  const saveAndExit = async () => {
    if (isClosing) return;
    isClosing = true;
    try {
      console.log('\nMenyimpan session cookies dan storage state...');
      const profilesDir = path.resolve(__dirname, '..', 'profiles');
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
      }
      const commonStatePath = path.resolve(profilesDir, 'default_storage_state.json');
      await context.storageState({ path: commonStatePath });

      if (fs.existsSync(commonStatePath)) {
        const state = JSON.parse(fs.readFileSync(commonStatePath, 'utf8'));
        console.log(`Berhasil mengekstrak ${state.cookies ? state.cookies.length : 0} session cookies.`);
      }

      console.log(`Session tersimpan di: ${commonStatePath}`);
      console.log(`Browser Profile tersimpan di: ${userDataDir}`);
      console.log('\nSesi login berhasil disimpan.');

      await context.close().catch(() => {});
    } catch (err) {
      console.error('Error saat menyimpan session:', err.message);
    }
    rl.close();
    process.exit(0);
  };

  context.on('close', () => {
    console.log('\nBrowser Chrome ditutup oleh pengguna.');
    saveAndExit();
  });

  rl.question('Tekan [ENTER] jika sudah selesai login: ', async () => {
    await saveAndExit();
  });
}

main().catch((err) => {
  console.error('Open Browser Error:', err);
  process.exit(1);
});
