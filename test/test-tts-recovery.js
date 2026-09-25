const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  extractBaselineBlobUrls,
  isFreshBlob,
  findFreshBlobAudio,
  downloadFile
} = require('../src/audio-downloader');
const {
  normalizePillValue,
  isPillValueMatching
} = require('../src/tts-ui-helpers');
const {
  formatSpeakerPrompt,
  splitTextIntoChunks
} = require('../src/tts-text-utils');
const { mergeAudioFiles } = require('../src/audio-converter');
const { formatJobOutput } = require('../src/job-storage');

async function runUnitTests() {
  console.log('🧪 Menjalankan unit test pemulihan TTS & logika freshness snapshot...');

  // Test 1: extractBaselineBlobUrls
  {
    const baseline = [
      { index: 0, src: 'blob:https://aistudio.google.com/sample-1', currentSrc: 'blob:https://aistudio.google.com/sample-1' },
      { index: 1, src: 'https://example.com/audio.mp3', currentSrc: null },
      { index: 2, src: null, currentSrc: null }
    ];
    const extracted = extractBaselineBlobUrls(baseline);
    assert.strictEqual(extracted.size, 1);
    assert.ok(extracted.has('blob:https://aistudio.google.com/sample-1'));
    assert.ok(!extracted.has('https://example.com/audio.mp3'));
    console.log('  ✓ Test 1: extractBaselineBlobUrls PASS');
  }

  // Test 2: New Blob at same index
  {
    const baseline = [
      { index: 0, src: 'blob:https://aistudio.google.com/old-uuid', currentSrc: 'blob:https://aistudio.google.com/old-uuid' }
    ];
    const current = [
      { index: 0, src: 'blob:https://aistudio.google.com/fresh-uuid', currentSrc: 'blob:https://aistudio.google.com/fresh-uuid', readyState: 4 }
    ];
    const fresh = findFreshBlobAudio(current, baseline);
    assert.ok(fresh !== null, 'Harus mendeteksi fresh blob');
    assert.strictEqual(fresh.currentSrc, 'blob:https://aistudio.google.com/fresh-uuid');
    console.log('  ✓ Test 2: New Blob at same index PASS');
  }

  // Test 3: Stale Blob moved to another index
  {
    const baseline = [
      { index: 0, src: 'blob:https://aistudio.google.com/template-preview-uuid', currentSrc: 'blob:https://aistudio.google.com/template-preview-uuid' }
    ];
    // Template preview blob berpindah posisi ke index 1, index 0 adalah elemen tanpa blob
    const current = [
      { index: 0, src: null, currentSrc: null },
      { index: 1, src: 'blob:https://aistudio.google.com/template-preview-uuid', currentSrc: 'blob:https://aistudio.google.com/template-preview-uuid' }
    ];
    const fresh = findFreshBlobAudio(current, baseline);
    assert.strictEqual(fresh, null, 'Tidak boleh menganggap stale preview sebagai fresh blob');
    console.log('  ✓ Test 3: Stale Blob moved to another index PASS');
  }

  // Test 4: Multiple audios (stale baseline blob + genuinely fresh chunk blob)
  {
    const baseline = [
      { index: 0, src: 'blob:https://aistudio.google.com/template-blob', currentSrc: 'blob:https://aistudio.google.com/template-blob' }
    ];
    const current = [
      { index: 0, src: 'blob:https://aistudio.google.com/template-blob', currentSrc: 'blob:https://aistudio.google.com/template-blob' },
      { index: 1, src: 'blob:https://aistudio.google.com/newly-rendered-chunk', currentSrc: 'blob:https://aistudio.google.com/newly-rendered-chunk' }
    ];
    const fresh = findFreshBlobAudio(current, baseline);
    assert.ok(fresh !== null);
    assert.strictEqual(fresh.index, 1);
    assert.strictEqual(fresh.currentSrc, 'blob:https://aistudio.google.com/newly-rendered-chunk');
    console.log('  ✓ Test 4: Multiple audios isolation PASS');
  }

  // Test 5: Fallback only when baseline is completely empty
  {
    const current = [
      { index: 0, src: 'blob:https://aistudio.google.com/first-time-blob', currentSrc: 'blob:https://aistudio.google.com/first-time-blob' }
    ];
    const fresh = findFreshBlobAudio(current, []);
    assert.ok(fresh !== null);
    assert.strictEqual(fresh.currentSrc, 'blob:https://aistudio.google.com/first-time-blob');
    console.log('  ✓ Test 5: Empty baseline fallback PASS');
  }

  // Test 6: Pill value matching & normalization (Accent = Neutral)
  {
    // Kasus 1: Exact Neutral
    assert.ok(isPillValueMatching('Neutral', 'Neutral'));
    // Kasus 2: Button teks lengkap dengan Angular Material icon
    assert.ok(isPillValueMatching('accent Neutral arrow_drop_down', 'Neutral'));
    // Kasus 3: Button saat ini bernilai American (Gen)
    assert.ok(!isPillValueMatching('American (Gen)', 'Neutral'));
    // Kasus 4: Vocal Smile dengan deskripsi panjang
    assert.ok(isPillValueMatching('The "Vocal Smile": The soft palate is raised', 'Vocal Smile'));
    // Kasus 5: Pace Natural dengan whitespace dan icon
    assert.ok(isPillValueMatching('pace  Natural  arrow_drop_down', 'Natural'));
    console.log('  ✓ Test 6: Pill value matching & normalization PASS');
  }

  // Test 7: formatSpeakerPrompt & splitTextIntoChunks
  {
    assert.strictEqual(formatSpeakerPrompt('Halo dunia'), 'Halo dunia');
    assert.strictEqual(formatSpeakerPrompt('Speaker 2 : Halo dunia'), 'Halo dunia');
    assert.strictEqual(formatSpeakerPrompt('speaker 1: Halo dunia'), 'Halo dunia');

    const shortChunks = splitTextIntoChunks('Satu dua tiga', 10);
    assert.strictEqual(shortChunks.length, 1);
    assert.strictEqual(shortChunks[0].promptText, 'Satu dua tiga');
    console.log('  ✓ Test 7: Prompt formatting & chunking PASS');
  }

  // Test 8: Terminal closed-page error handling
  {
    const mockClosedPage = {
      isClosed: () => true
    };
    let threwClosedError = false;
    try {
      await downloadFile({
        page: mockClosedPage,
        downloadDir: './downloads'
      });
    } catch (err) {
      threwClosedError = true;
      assert.ok(err.message.includes('ditutup') || err.message.includes('closed'));
    }
    assert.ok(threwClosedError, 'Harus menolak download jika page sudah ditutup');
    console.log('  ✓ Test 8: Terminal closed-page error handling PASS');
  }

  // Test 9: mergeAudioFiles
  {
    const part1 = path.resolve(__dirname, '../downloads/gemini_tts_1790309037332_part1.mp3');
    const part2 = path.resolve(__dirname, '../downloads/gemini_tts_1790309111356_part2.mp3');
    if (fs.existsSync(part1) && fs.existsSync(part2)) {
      const testMergedOutput = path.resolve(__dirname, '../downloads/test_unit_merged.mp3');
      try { if (fs.existsSync(testMergedOutput)) fs.unlinkSync(testMergedOutput); } catch {}
      await mergeAudioFiles([part1, part2], testMergedOutput);
      assert.ok(fs.existsSync(testMergedOutput), 'Berkas hasil merge harus ada di disk');
      const sizeMerged = fs.statSync(testMergedOutput).size;
      const size1 = fs.statSync(part1).size;
      const size2 = fs.statSync(part2).size;
      assert.ok(sizeMerged >= Math.min(size1, size2), 'Ukuran berkas gabungan harus valid');
      try { fs.unlinkSync(testMergedOutput); } catch {}
      console.log('  ✓ Test 9: mergeAudioFiles with actual MP3s PASS');
    } else {
      console.log('  ⚠ Test 9: mergeAudioFiles skipped (test samples not found)');
    }
  }

  // Test 10: formatJobOutput exposes mergedFile and unified audio URL
  {
    const mockJob = {
      id: 'job-test-merge-123',
      status: 'completed',
      progress: 100,
      stage: 'completed',
      message: 'Selesai',
      params: { text: 'Testing', wordCount: 1, voice: 'Zephyr' },
      result: {
        mergedFile: {
          filename: 'job-test_merged.mp3',
          downloadUrl: '/api/tts/download/job-test_merged.mp3'
        },
        files: [
          { filename: 'job-test_part1.mp3', downloadUrl: '/api/tts/download/job-test_part1.mp3' },
          { filename: 'job-test_part2.mp3', downloadUrl: '/api/tts/download/job-test_part2.mp3' }
        ]
      }
    };
    const formatted = formatJobOutput(mockJob, 'http://localhost:3000');
    assert.strictEqual(formatted.audioUrl, 'http://localhost:3000/api/tts/download/job-test_merged.mp3');
    assert.strictEqual(formatted.audio_url, 'http://localhost:3000/api/tts/download/job-test_merged.mp3');
    assert.strictEqual(formatted.mergedFile.url, 'http://localhost:3000/api/tts/download/job-test_merged.mp3');
    assert.strictEqual(formatted.result.files.length, 2);
    console.log('  ✓ Test 10: formatJobOutput mergedFile & unified audioUrl PASS');
  }

  console.log('\n🎉 SEMUA UNIT TEST PASS (10/10)!');
}

runUnitTests().catch(err => {
  console.error('❌ UNIT TEST GAGAL:', err);
  process.exit(1);
});
