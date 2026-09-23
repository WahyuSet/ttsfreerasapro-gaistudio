/**
 * Utilitas pemrosesan naskah dan pembagian chunk teks untuk TTS
 */

/**
 * Memastikan prompt diawali dengan label speaker (default: Speaker 1 :)
 * @param {string} text
 * @param {string} defaultSpeaker
 * @returns {string}
 */
function formatSpeakerPrompt(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^speaker\s*\d+\s*:\s*/i, '');
}

/**
 * Membagi teks panjang menjadi beberapa bagian (chunk) alami berdasarkan kalimat
 * @param {string} text
 * @param {number} maxWords
 * @returns {Array<{ index: number, total: number, text: string, promptText: string, wordCount: number }>}
 */
function splitTextIntoChunks(text, maxWords = 300) {
  if (!text || typeof text !== 'string') return [];
  let cleanText = text
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(speaker\s*\d+)\s*:\s*/i, '');
  if (!cleanText) return [];

  const words = cleanText.split(/\s+/);
  if (words.length <= maxWords) {
    return [{
      index: 1,
      total: 1,
      text: cleanText,
      promptText: cleanText,
      wordCount: words.length
    }];
  }

  const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const rawSentences = cleanText.match(sentenceRegex) || [cleanText];

  const chunks = [];
  let currentChunk = [];
  let currentWordCount = 0;

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const sentWords = trimmed.split(/\s+/).length;

    if (currentWordCount + sentWords > maxWords && currentChunk.length > 0) {
      const chunkText = currentChunk.join(' ');
      chunks.push({
        text: chunkText,
        promptText: chunkText,
        wordCount: currentWordCount
      });
      currentChunk = [trimmed];
      currentWordCount = sentWords;
    } else {
      currentChunk.push(trimmed);
      currentWordCount += sentWords;
    }
  }

  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join(' ');
    chunks.push({
      text: chunkText,
      promptText: chunkText,
      wordCount: currentWordCount
    });
  }

  return chunks.map((c, idx) => ({
    index: idx + 1,
    total: chunks.length,
    ...c
  }));
}

module.exports = {
  formatSpeakerPrompt,
  splitTextIntoChunks
};
