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

    const options = {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    };

    execFile(ffmpegPath, args, options, (err, stdout, stderr) => {
      if (err) {
        const errMsg = stderr ? stderr.toString() : err.message;
        return reject(new Error(`Gagal konversi WAV ke MP3: ${errMsg || err.message}`));
      }

      if (!fs.existsSync(targetMp3)) {
        return reject(new Error(`Berkas MP3 tidak berhasil terbentuk pada ${targetMp3}`));
      }

      resolve(targetMp3);
    });
  });
}

/**
 * Menggabungkan beberapa berkas audio (MP3) menjadi 1 berkas utuh menggunakan ffmpeg concat.
 * @param {string[]} filePaths Daftar path berkas audio sumber
 * @param {string} outputPath Path berkas target hasil penggabungan
 * @returns {Promise<string>} Path berkas hasil penggabungan
 */
function mergeAudioFiles(filePaths, outputPath) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return reject(new Error('Daftar berkas audio untuk digabungkan kosong.'));
    }

    if (filePaths.length === 1) {
      if (path.resolve(filePaths[0]) !== path.resolve(outputPath)) {
        fs.copyFileSync(filePaths[0], outputPath);
      }
      return resolve(outputPath);
    }

    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      return reject(new Error('Binary ffmpeg-static tidak tersedia di server.'));
    }

    const listFile = path.join(
      path.dirname(outputPath),
      `concat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`
    );

    const fileContent = filePaths
      .map(p => `file '${path.resolve(p).split('\\').join('/').replace(/'/g, "'\\''")}'`)
      .join('\n');

    fs.writeFileSync(listFile, fileContent, 'utf8');

    const copyArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath
    ];

    const options = {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    };

    execFile(ffmpegPath, copyArgs, options, (err, stdout, stderr) => {
      if (!err && fs.existsSync(outputPath)) {
        try { fs.unlinkSync(listFile); } catch {}
        return resolve(outputPath);
      }

      // Fallback: re-encode jika stream copy gagal
      const reencodeArgs = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',
        outputPath
      ];

      execFile(ffmpegPath, reencodeArgs, options, (reErr, reStdout, reStderr) => {
        try { fs.unlinkSync(listFile); } catch {}
        if (reErr) {
          const errMsg = reStderr ? reStderr.toString() : reErr.message;
          return reject(new Error(`Gagal menggabungkan berkas audio: ${errMsg || reErr.message}`));
        }
        if (!fs.existsSync(outputPath)) {
          return reject(new Error(`Berkas gabungan tidak terbentuk pada ${outputPath}`));
        }
        resolve(outputPath);
      });
    });
  });
}

module.exports = {
  convertWavToMp3,
  mergeAudioFiles
};
