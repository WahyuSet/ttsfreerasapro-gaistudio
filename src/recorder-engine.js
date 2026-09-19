const fs = require('fs');
const path = require('path');
const { launchStealthChrome } = require('./stealth-browser');
const { getInjectedRecorderScript } = require('./injected-recorder');
const { generateStandaloneScript, generateApiTemplate, isLoginStep } = require('./code-generator');

class RecorderEngine {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessionName = null;
    this.sessionDir = null;
    this.steps = [];
    this.context = null;
    this.page = null;
    this.lastUrl = null;
    this.eventListeners = new Set();
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  broadcast(type, payload) {
    for (const listener of this.eventListeners) {
      try {
        listener(type, payload);
      } catch (err) {
        console.error('[RecorderEngine] Listener error:', err);
      }
    }
  }

  async startSession(options = {}) {
    if (this.isRecording) {
      throw new Error('A recording session is already active.');
    }

    const {
      sessionName = `session_${Date.now()}`,
      startUrl = 'https://www.google.com',
      userDataDir = path.resolve(__dirname, '..', 'profiles', 'default'),
      headless = false
    } = options;

    this.sessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.sessionDir = path.resolve(__dirname, '..', 'recordings', this.sessionName);
    this.steps = [];
    this.isRecording = true;
    this.isPaused = false;
    this.lastUrl = null;

    // Ensure recording directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    // Sync saved login session from default_storage_state.json if exists
    const defaultState = path.resolve(__dirname, '..', 'profiles', 'default_storage_state.json');
    const sessionState = path.join(this.sessionDir, 'storage_state.json');
    if (fs.existsSync(defaultState) && !fs.existsSync(sessionState)) {
      try {
        fs.copyFileSync(defaultState, sessionState);
        console.log('[RecorderEngine] Sesi login dari profiles/default_storage_state.json berhasil di-load.');
      } catch (e) {}
    }

    // Save initial metadata
    this.autoSave();

    console.log(`[RecorderEngine] Launching Stealth Chrome for session "${this.sessionName}"...`);
    const { context, chromePath } = await launchStealthChrome({
      userDataDir,
      headless
    });
    this.context = context;

    // Expose binding to receive recorded events from browser page
    await context.exposeBinding('__austudio_record_action', async (source, actionJson) => {
      if (!this.isRecording || this.isPaused) return;
      try {
        const action = JSON.parse(actionJson);
        this.addStep(action);
      } catch (err) {
        console.error('[RecorderEngine] Error parsing action:', err);
      }
    });

    // Inject recorder script into every document/frame
    await context.addInitScript(getInjectedRecorderScript());

    // Listen to new pages / popups
    context.on('page', (newPage) => {
      this.setupPageListeners(newPage);
    });

    // Use primary page
    const pages = context.pages();
    this.page = pages.length > 0 ? pages[0] : await context.newPage();
    this.setupPageListeners(this.page);

    // Initial navigation
    if (startUrl) {
      console.log(`[RecorderEngine] Navigating to initial URL: ${startUrl}`);
      this.addStep({
        type: 'navigate',
        url: startUrl,
        timestamp: Date.now()
      });
      await this.page.goto(startUrl).catch(err => {
        console.warn(`[RecorderEngine] Initial navigation notice: ${err.message}`);
      });
      this.lastUrl = startUrl;
    }

    // Listen to context close (e.g. user manually closed browser)
    context.on('close', () => {
      console.log('[RecorderEngine] Browser context closed by user.');
      this.stopSession();
    });

    this.broadcast('started', {
      sessionName: this.sessionName,
      chromePath,
      startUrl
    });

    return {
      sessionName: this.sessionName,
      sessionDir: this.sessionDir,
      chromePath
    };
  }

  setupPageListeners(page) {
    // Tangani event download secara otomatis agar browser tidak terganggu
    page.on('download', async (download) => {
      try {
        const filename = download.suggestedFilename() || `speech_${Date.now()}.wav`;
        const targetPath = path.join(this.sessionDir, filename);
        console.log(`[RecorderEngine] [⬇️ Download] Mengunduh file audio: ${filename}...`);
        await download.saveAs(targetPath);
        console.log(`[RecorderEngine] [✓ Download] File audio berhasil disimpan ke: ${targetPath}`);
      } catch (err) {
        console.warn(`[RecorderEngine] Notice unduhan: ${err.message}`);
      }
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && this.isRecording && !this.isPaused) {
        const currentUrl = frame.url();
        // Ignore blank or internal scheme or same URL
        if (currentUrl && currentUrl !== 'about:blank' && currentUrl !== this.lastUrl) {
          this.lastUrl = currentUrl;
          this.addStep({
            type: 'navigate',
            url: currentUrl,
            timestamp: Date.now()
          });
        }
      }
    });
  }

  isLoginStep(step) {
    return isLoginStep(step);
  }

  addStep(step) {
    // Filter out login / authentication steps
    if (this.isLoginStep(step)) {
      console.log(`[RecorderEngine] [ℹ️ Ignored Login] Mengabaikan langkah login (${step.type}: ${step.selector || step.url})`);
      return;
    }

    step.id = this.steps.length + 1;
    step.timestamp = step.timestamp || Date.now();

    // Avoid duplicate rapid clicks or identical navigations
    const lastStep = this.steps[this.steps.length - 1];
    if (lastStep) {
      if (lastStep.type === step.type && lastStep.selector === step.selector && step.type === 'click') {
        const timeDiff = step.timestamp - lastStep.timestamp;
        if (timeDiff < 250) return; // ignore duplicate click bounce
      }
      if (lastStep.type === 'navigate' && step.type === 'navigate' && lastStep.url === step.url) {
        return; // ignore duplicate navigation
      }
    }

    this.steps.push(step);
    console.log(`[RecorderEngine] [Step ${step.id}] ${step.type.toUpperCase()}: ${step.selector || step.url || step.key || ''}`);

    // Instant Real-Time Auto Save to disk!
    this.autoSave();

    // Broadcast to UI
    this.broadcast('step_added', {
      step,
      totalSteps: this.steps.length
    });
  }

  autoSave() {
    if (!this.sessionDir) return;

    try {
      // 1. Save steps.json
      const stepsFile = path.join(this.sessionDir, 'steps.json');
      fs.writeFileSync(stepsFile, JSON.stringify(this.steps, null, 2), 'utf8');

      // 2. Save runnable & API-importable script.js
      const scriptFile = path.join(this.sessionDir, 'script.js');
      const scriptCode = generateStandaloneScript(this.sessionName, this.steps);
      fs.writeFileSync(scriptFile, scriptCode, 'utf8');

      // 3. Save api-service.js template
      const apiFile = path.join(this.sessionDir, 'api-service.js');
      const apiCode = generateApiTemplate(this.sessionName);
      fs.writeFileSync(apiFile, apiCode, 'utf8');
    } catch (err) {
      console.error('[RecorderEngine] Auto-save error:', err);
    }
  }

  pause() {
    this.isPaused = true;
    this.broadcast('paused', {});
  }

  resume() {
    this.isPaused = false;
    this.broadcast('resumed', {});
  }

  async saveStorageState() {
    if (this.context && this.sessionDir) {
      try {
        const storageStatePath = path.join(this.sessionDir, 'storage_state.json');
        await this.context.storageState({ path: storageStatePath });
      } catch (e) {
        // ignore if context is already closing or navigating
      }
    }
  }

  async stopSession() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.isPaused = false;

    // Save session storageState (cookies & localStorage) before closing context
    await this.saveStorageState();

    // Final auto-save of files
    this.autoSave();

    // Close browser if still open
    if (this.context) {
      try {
        await this.context.close();
      } catch (e) {
        // already closed
      }
      this.context = null;
      this.page = null;
    }

    console.log(`[RecorderEngine] Session "${this.sessionName}" saved (${this.steps.length} steps).`);
    this.broadcast('stopped', {
      sessionName: this.sessionName,
      totalSteps: this.steps.length,
      sessionDir: this.sessionDir
    });

    return {
      sessionName: this.sessionName,
      totalSteps: this.steps.length,
      sessionDir: this.sessionDir
    };
  }

  getStatus() {
    return {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      sessionName: this.sessionName,
      totalSteps: this.steps.length,
      steps: this.steps
    };
  }

  static getRecordingsList() {
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

  static getRecordingDetails(sessionName) {
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
}

module.exports = {
  RecorderEngine
};
