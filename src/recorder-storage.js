const fs = require('fs');
const path = require('path');
const { generateStandaloneScript, generateApiTemplate } = require('./code-generator');

/**
 * Menyimpan storageState (cookies & localStorage) dari context browser.
 * @param {import('playwright').BrowserContext} context
 * @param {string} sessionDir
 */
async function saveContextStorageState(context, sessionDir) {
  if (!context || !sessionDir) return;
  try {
    const sessionState = path.join(sessionDir, 'storage_state.json');
    await context.storageState({ path: sessionState });
    console.log(`[RecorderStorage] Storage state disimpan ke: ${sessionState}`);

    const defaultProfileDir = path.resolve(__dirname, '..', 'profiles');
    if (fs.existsSync(defaultProfileDir)) {
      const defaultState = path.join(defaultProfileDir, 'default_storage_state.json');
      fs.copyFileSync(sessionState, defaultState);
      console.log(`[RecorderStorage] Storage state disinkronkan ke default profile.`);
    }
  } catch (err) {
    console.warn('[RecorderStorage] Gagal menyimpan storageState:', err.message);
  }
}

/**
 * Menyimpan langkah-langkah, skrip runner, dan metadata rekaman ke disk secara otomatis.
 * @param {string} sessionDir
 * @param {string} sessionName
 * @param {Array} steps
 */
function autoSaveSessionFiles(sessionDir, sessionName, steps) {
  if (!sessionDir) return;
  try {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const stepsPath = path.join(sessionDir, 'steps.json');
    fs.writeFileSync(stepsPath, JSON.stringify(steps, null, 2), 'utf8');

    const scriptPath = path.join(sessionDir, 'script.js');
    const generatedScript = generateStandaloneScript(steps, { sessionName });
    fs.writeFileSync(scriptPath, generatedScript, 'utf8');

    const apiPath = path.join(sessionDir, 'api-template.json');
    const apiJson = generateApiTemplate(steps, { sessionName });
    fs.writeFileSync(apiPath, apiJson, 'utf8');
  } catch (err) {
    console.error('[RecorderStorage] Auto-save error:', err.message);
  }
}

/**
 * Mengambil daftar seluruh rekaman sesi yang tersimpan.
 * @returns {Array<{ name: string, stepCount: number, updatedAt: Date|null, path: string }>}
 */
function getRecordingsList() {
  const recordingsDir = path.resolve(__dirname, '..', 'recordings');
  if (!fs.existsSync(recordingsDir)) return [];

  const dirs = fs.readdirSync(recordingsDir, { withFileTypes: true });
  return dirs
    .filter(d => d.isDirectory())
    .map(d => {
      const dirPath = path.join(recordingsDir, d.name);
      const stepsPath = path.join(dirPath, 'steps.json');
      let stepCount = 0;
      let updatedAt = null;

      if (fs.existsSync(stepsPath)) {
        try {
          const steps = JSON.parse(fs.readFileSync(stepsPath, 'utf8'));
          stepCount = steps.length;
          const stat = fs.statSync(stepsPath);
          updatedAt = stat.mtime;
        } catch (e) {}
      }

      return {
        name: d.name,
        stepCount,
        updatedAt,
        path: dirPath
      };
    })
    .sort((a, b) => (b.updatedAt ? new Date(b.updatedAt) : 0) - (a.updatedAt ? new Date(a.updatedAt) : 0));
}

/**
 * Mengambil detail langkah dan skrip dari satu sesi rekaman.
 * @param {string} sessionName
 * @returns {Object|null}
 */
function getRecordingDetails(sessionName) {
  const cleanName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.resolve(__dirname, '..', 'recordings', cleanName);
  if (!fs.existsSync(dir)) return null;

  const stepsPath = path.join(dir, 'steps.json');
  const scriptPath = path.join(dir, 'script.js');

  let steps = [];
  let script = '';

  if (fs.existsSync(stepsPath)) {
    try {
      steps = JSON.parse(fs.readFileSync(stepsPath, 'utf8'));
    } catch (e) {}
  }

  if (fs.existsSync(scriptPath)) {
    try {
      script = fs.readFileSync(scriptPath, 'utf8');
    } catch (e) {}
  }

  return {
    name: cleanName,
    steps,
    script
  };
}

module.exports = {
  saveContextStorageState,
  autoSaveSessionFiles,
  getRecordingsList,
  getRecordingDetails
};
