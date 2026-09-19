const { TtsEngine } = require('../src/tts-engine');

async function testOnce() {
  const engine = new TtsEngine();
  const params = {
    text: 'Halo semuanya!, ini adalah jamu biji segar.',
    voice: 'Achernar',
    style: 'Vocal Smile',
    pace: 'Natural',
    accent: 'Neutral',
    persona: 'A relaxed and engaging storyteller, talking like a close friend sharing cool trivia, upbeat and lighthearted.',
    autoChunk: true,
    maxWordsPerChunk: 300,
    keepOpen: true
  };

  try {
    const res = await engine.execute(params, (p) => {
      console.log(`[${p.progress}%] [${p.stage}] ${p.message}`);
    });
    console.log('\n================================================================');
    console.log('🎉 SMOKE TEST LIVE SUCCESS:');
    console.log('   Total chunks:', res.totalChunks);
    console.log('   Voice settings:', JSON.stringify(res.voiceSettings));
    if (res.files && res.files.length > 0) {
      for (const f of res.files) {
        console.log(`   File: ${f.filename} | Size: ${f.sizeKb} KB | Strategy: ${f.strategy} | Path: ${f.filePath}`);
      }
    }
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ SMOKE TEST LIVE FAILED:', err.message);
    process.exitCode = 1;
  }
}

testOnce();

