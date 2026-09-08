const { TtsEngine } = require('../src/tts-engine');

async function testOnce() {
  const engine = new TtsEngine();
  const params = {
    text: 'Halo semuanya!, ini adalah jamu biji.',
    voice: 'Achernar',
    style: 'Vocal Smile',
    pace: 'Natural',
    accent: 'Neutral',
    autoChunk: true,
    maxWordsPerChunk: 300,
    keepOpen: true
  };

  try {
    const res = await engine.execute(params, (p) => {
      console.log(`[${p.progress}%] [${p.stage}] ${p.message}`);
    });
    console.log('SUCCESS:', res);
  } catch (err) {
    console.error('FAILED:', err.message);
  }
}

testOnce();
