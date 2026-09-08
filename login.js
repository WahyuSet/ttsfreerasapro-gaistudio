const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { launchStealthChrome, findWindowsChromePath } = require('./src/stealth-browser');

async function runLoginHelper() {
  console.log('================================================================');
  console.log('  🔑 AuStudio - Setup Sesi Login Google / Website');
  console.log('  🛡️  Google Chrome Windows Asli + Anti-Bot Protection');
  console.log('================================================================\n');

  const userDataDir = path.resolve(__dirname, 'profiles', 'default');
  const targetUrl = process.argv[2] || 'https://aistudio.google.com/';

  console.log(`💻 Chrome Path : ${findWindowsChromePath() || 'channel: chrome'}`);
  console.log(`📁 Profile Dir : ${userDataDir}`);
  console.log(`🌐 Target URL  : ${targetUrl}\n`);
  console.log('Membuka Chrome Windows... Silakan lakukan LOGIN secara normal.');

  const { context } = await launchStealthChrome({
    userDataDir,
    headless: false
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto(targetUrl).catch(e => console.log('Navigation notice:', e.message));

  console.log('\n----------------------------------------------------------------');
  console.log('👉 Silakan login dengan akun Anda di jendela Chrome yang terbuka.');
  console.log('👉 Selesaikan verifikasi / 2FA / terms jika ada.');
  console.log('👉 Setelah BERHASIL LOGIN dan masuk ke halaman utama:');
  console.log('   KEMBALI KE SINI dan tekan [ENTER] (atau tutup jendela Chrome).');
  console.log('----------------------------------------------------------------\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const saveAndExit = async () => {
    try {
      console.log('\nMenyimpan session cookies & storage state...');
      const commonStatePath = path.resolve(__dirname, 'profiles', 'default_storage_state.json');
      await context.storageState({ path: commonStatePath });

      // Verifikasi cookies
      if (fs.existsSync(commonStatePath)) {
        const state = JSON.parse(fs.readFileSync(commonStatePath, 'utf8'));
        console.log(`[✓] Berhasil mengekstrak ${state.cookies.length} session cookies & auth tokens.`);
      }

      console.log(`[✓] Session tersimpan di: ${commonStatePath}`);
      console.log(`[✓] Browser Profile tersimpan di: ${userDataDir}`);
      console.log('\n================================================================');
      console.log('🎉 SESI LOGIN BERHASIL DISIMPAN!');
      console.log('Sekarang Anda bisa klik 2x REKAM.bat untuk merekam langkah');
      console.log('automasi. Browser akan langsung SUDAH LOGIN otomatis, dan');
      console.log('proses login TIDAK AKAN direkam ke dalam script!');
      console.log('================================================================\n');

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

runLoginHelper().catch(err => {
  console.error('Login Helper Error:', err);
  process.exit(1);
});
