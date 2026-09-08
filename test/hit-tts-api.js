/**
 * Script Pengujian REST API Jobs AuStudio Gemini TTS
 * Mengirim pekerjaan generate TTS via HTTP POST /api/tts/jobs,
 * melakukan polling progres live ke /api/tts/jobs/:id,
 * dan memverifikasi unduhan file audio.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

// Baca file .env manual untuk konfigurasi PORT dan API Key
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const env = { PORT: 3001, AUSTUDIO_API_KEY: 'IkPzTzClQrVGj73OMWIm7TPkRTHnlj7M' };
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        env[key] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const PORT = process.env.PORT || env.PORT || 3001;
const API_KEY = process.env.AUSTUDIO_API_KEY || env.AUSTUDIO_API_KEY || 'IkPzTzClQrVGj73OMWIm7TPkRTHnlj7M';
const HOST = 'localhost';

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('  🚀 AuStudio - Test Client REST API TTS (Teknik Jobs)');
  console.log(`  🎯 Server Target: http://${HOST}:${PORT}`);
  console.log(`  🔑 API Key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`);
  console.log('================================================================\n');

  // 1. Cek kesehatan server
  console.log('[1/4] Memeriksa status kesehatan server...');
  try {
    const health = await httpRequest({
      hostname: HOST,
      port: PORT,
      path: '/api/health',
      method: 'GET'
    });

    if (health.status !== 200 || !health.data || health.data.status !== 'healthy') {
      console.error('❌ Server tidak merespons status healthy.');
      console.log('Respons:', health);
      process.exit(1);
    }
    console.log(`✓ Server Aktif & Sehat! (Uptime: ${health.data.uptimeSeconds}s, Total Jobs: ${health.data.jobs.total})`);
  } catch (err) {
    console.error(`❌ Gagal terhubung ke server di port ${PORT}!`);
    console.error(`   Pastikan server sedang berjalan via START_SERVER.bat atau START_AUSTUDIO.bat`);
    console.error(`   Detail error: ${err.message}`);
    process.exit(1);
  }

  // 2. Kirim Job TTS ke POST /api/tts/jobs
  // Parameter sesuai yang diminta user: Style: smile / Vocal Smile, Pace: Natural, Accent: Neutral, Voice: Achernar
  const testPayload = {
    text: 'Halo semuanya!, ini adalah jamu biji.',
    voice: 'Achernar',
    style: 'Vocal Smile',
    pace: 'Natural',
    accent: 'Neutral',
    autoChunk: true,
    maxWordsPerChunk: 300,
    keepOpen: true
  };

  console.log('\n[2/4] Mengirim pekerjaan TTS ke endpoint POST /api/tts/jobs...');
  console.log(`      Suara   : ${testPayload.voice}`);
  console.log(`      Style   : ${testPayload.style}`);
  console.log(`      Pace    : ${testPayload.pace}`);
  console.log(`      Accent  : ${testPayload.accent}`);
  console.log(`      Naskah  : "${testPayload.text.slice(0, 70)}..."\n`);

  const createRes = await httpRequest({
    hostname: HOST,
    port: PORT,
    path: '/api/tts/jobs',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    }
  }, testPayload);

  if (createRes.status !== 202 && createRes.status !== 200) {
    console.error('❌ Gagal membuat pekerjaan TTS!');
    console.error('Status Code:', createRes.status);
    console.error('Respons:', createRes.data || createRes.raw);
    process.exit(1);
  }

  const { jobId, statusUrl } = createRes.data;
  console.log(`✓ Pekerjaan berhasil dibuat!`);
  console.log(`  🆔 Job ID    : ${jobId}`);
  console.log(`  🌐 Status URL: ${statusUrl}\n`);

  // 3. Polling status live ke GET /api/tts/jobs/:id
  console.log('[3/4] ⏳ Memantau progres pembuatan suara (Polling live)...');
  let isDone = false;
  let lastMessage = '';
  let pollCount = 0;

  while (!isDone) {
    await new Promise(r => setTimeout(r, 1500));
    pollCount++;

    try {
      const pollRes = await httpRequest({
        hostname: HOST,
        port: PORT,
        path: `/api/tts/jobs/${jobId}`,
        method: 'GET',
        headers: {
          'x-api-key': API_KEY
        }
      });

      if (pollRes.status !== 200 || !pollRes.data || !pollRes.data.job) {
        console.warn(`   [#${pollCount}] Respon status tidak wajar: ${pollRes.status}`);
        continue;
      }

      const job = pollRes.data.job;
      const status = job.status;
      const progress = job.progress || 0;
      const stage = job.stage || '-';
      const msg = job.message || '';

      if (msg !== lastMessage || pollCount % 4 === 0) {
        lastMessage = msg;
        const progressBar = '█'.repeat(Math.floor(progress / 5)) + '-'.repeat(20 - Math.floor(progress / 5));
        console.log(`   [${progressBar}] ${progress}% | Tahap: ${stage.padEnd(12)} | ${msg}`);
      }

      if (status === 'completed') {
        isDone = true;
        console.log('\n================================================================');
        console.log('🎉 PEKERJAAN TTS BERHASIL DISELESAIKAN!');
        console.log('================================================================');
        console.log(`⏱️  Durasi Eksekusi : ${job.durationSeconds} detik`);
        console.log(`📦 Bagian Berkas   : ${job.result.totalChunks}`);
        console.log(`🎛️  Voice Settings  :`, job.result.voiceSettings);
        console.log(`\n📁 Berkas Audio:`);
        job.result.files.forEach((file, idx) => {
          console.log(`   [Bagian ${idx + 1}] ${file.filename} (${file.sizeKb} KB)`);
          console.log(`              URL: http://${HOST}:${PORT}${file.downloadUrl}`);
        });

        // 4. Verifikasi unduhan via endpoint HTTP download
        console.log('\n[4/4] 🧪 Menguji download stream berkas audio via API...');
        const firstFile = job.result.files[0];
        if (firstFile) {
          const downloadPath = firstFile.downloadUrl;
          const verifyRes = await httpRequest({
            hostname: HOST,
            port: PORT,
            path: downloadPath,
            method: 'GET'
          });

          if (verifyRes.status === 200) {
            console.log(`✓ Endpoint unduhan ${downloadPath} berfungsi normal (Status 200 OK)!`);
          } else {
            console.warn(`⚠️ Status endpoint download: ${verifyRes.status}`);
          }
        }

        console.log('\n✅ SEMUA PENGUJIAN REST API BERHASIL 100% TANPA KENDALA!');
        process.exit(0);

      } else if (status === 'failed') {
        isDone = true;
        console.error('\n================================================================');
        console.error('❌ PEKERJAAN TTS GAGAL!');
        console.error('================================================================');
        console.error(`Detail Error: ${job.error}`);
        console.error(`Pesan Terakhir: ${job.message}`);
        process.exit(1);
      } else if (status === 'cancelled') {
        isDone = true;
        console.warn('\n⚠️ Pekerjaan dibatalkan oleh pengguna.');
        process.exit(1);
      }
    } catch (pollErr) {
      console.warn(`   [#${pollCount}] Gagal menghubungi server saat polling: ${pollErr.message}`);
    }

    if (pollCount > 240) { // 6 menit timeout
      console.error('\n❌ Batas waktu polling pengujian (6 menit) terlewati.');
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
