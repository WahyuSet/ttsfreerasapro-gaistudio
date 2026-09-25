const { TtsEngine } = require('../src/tts-engine');
const fs = require('fs');
const path = require('path');

async function runTest() {
  console.log('================================================================');
  console.log('🚀 PENGUJIAN LIVE GENERATE VOICE & AUTO-MERGING GEMINI TTS');
  console.log('================================================================\n');

  const engine = new TtsEngine();

  // Naskah multi-chunk (~230 kata) dengan maxWordsPerChunk: 120 -> 2 Chunks
  const text = `Tahukah Anda bahwa di kedalaman samudra terdapat makhluk-makhluk yang memancarkan cahaya sendiri dalam kegelapan abadi? Fenomena ini disebut bioluminesensi, sebuah keajaiban alam di mana reaksi kimia di dalam tubuh makhluk hidup menghasilkan pendaran cahaya yang memukau tanpa menghasilkan panas sama sekali. Di zona abisal yang tidak pernah tersentuh sinar matahari, cahaya ini digunakan untuk menarik mangsa, berkomunikasi dengan sesama jenis, atau mengelabui predator yang mengintai di balik bayang-bayang. Para ilmuwan memperkirakan bahwa lebih dari sembilan puluh persen kehidupan di laut dalam memiliki kemampuan luar biasa ini.

Selain bioluminesensi, palung laut terdalam seperti Palung Mariana juga menyimpan misteri tekanan air yang luar biasa ekstrem, mencapai ribuan kali lipat tekanan di permukaan. Namun kehidupan tetap berkembang subur di sana. Ikan siput laut dalam dan amfipoda raksasa beradaptasi dengan protein khusus dan struktur sel fleksibel yang mencegah tubuh mereka rusak. Setiap ekspedisi eksplorasi selalu membawa pulang penemuan spesies baru yang memukau, membuktikan betapa luasnya rahasia bumi yang belum terungkap.`;

  const params = {
    text,
    voice: 'Zephyr',
    style: 'Vocal Smile',
    pace: 'Natural',
    accent: 'Neutral',
    autoChunk: true,
    maxWordsPerChunk: 120,
    keepOpen: false
  };

  const startTime = Date.now();

  try {
    const result = await engine.execute(params, (p) => {
      console.log(`[${p.progress}%] [${p.stage}] [Part ${p.currentPart || 1}/${p.totalParts || 1}] ${p.message}`);
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log('\n================================================================');
    console.log(`✅ HASIL PENGUJIAN LIVE TTS SUKSES (${elapsed} detik):`);
    console.log('   Total bagian (chunks):', result.totalChunks);
    console.log('   Voice settings:', JSON.stringify(result.voiceSettings));

    if (result.mergedFile) {
      console.log('\n🎵 1 FILE GABUNGAN (AUTO-MERGED):');
      console.log(`   File    : ${result.mergedFile.filename}`);
      console.log(`   Size    : ${result.mergedFile.sizeKb} KB`);
      console.log(`   Path    : ${result.mergedFile.filePath}`);
      console.log(`   URL     : ${result.mergedFile.downloadUrl}`);
      console.log(`   Exists? : ${fs.existsSync(result.mergedFile.filePath)}`);
    }

    if (result.files && result.files.length > 0) {
      console.log(`\n📂 DAFTAR FILE PER BAGIAN (${result.files.length} bagian):`);
      for (const f of result.files) {
        console.log(`   Part ${f.partIndex}: ${f.filename} (${f.sizeKb} KB) [${f.strategy}]`);
      }
    }
    console.log('================================================================\n');

  } catch (error) {
    console.error('\n❌ PENGUJIAN TTS GAGAL:', error.message);
    process.exitCode = 1;
  }
}

runTest();
