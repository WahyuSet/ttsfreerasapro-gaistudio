const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

/**
 * Konversi berkas WAV ke MP3 berkualitas tinggi (192 kbps, stereo/mono disesuaikan sumber).
 * @param {string} wavPath Path berkas WAV sumber
 * @param {string} [outputPath] Path berkas MP3 target (opsional)
 * @returns {Promise<string>} Path berkas MP3 hasil konversi
 */
function convertWavToMp3(wavPath, outputPath = null) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(wavPath)) {
      return reject(new Error(`Berkas WAV sumber tidak ditemukan: ${wavPath}`));
    }

    const targetMp3 = outputPath || wavPath.replace(/\.wav$/i, '.mp3');

    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      return reject(new Error('Binary ffmpeg-static tidak tersedia di server.'));
    }

    const args = [
      '-y',
      '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      targetMp3
    ];

    execFile(ffmpegPath, args, (err) => {
      if (err) {
        return reject(new Error(`Gagal konversi WAV ke MP3: ${err.message}`));
      }

      if (!fs.existsSync(targetMp3)) {
        return reject(new Error(`Berkas MP3 tidak berhasil terbentuk pada ${targetMp3}`));
      }

      resolve(targetMp3);
    });
  });
}

module.exports = {
  convertWavToMp3
};
