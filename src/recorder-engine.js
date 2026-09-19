const fs = require('fs');
const path = require('path');
const { launchStealthChrome } = require('./stealth-browser');
const { getInjectedRecorderScript } = require('./injected-recorder');
const { isLoginStep } = require('./code-generator');
const {
  saveContextStorageState,
  autoSaveSessionFiles,
  getRecordingsList,
  getRecordingDetails
} = require('./recorder-storage');

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
      throw new Error('Sesi rekaman sudah aktif.');
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

    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    const defaultState = path.resolve(__dirname, '..', 'profiles', 'default_storage_state.json');
    const sessionState = path.join(this.sessionDir, 'storage_state.json');
    if (fs.existsSync(defaultState) && !fs.existsSync(sessionState)) {
      try {
        fs.copyFileSync(defaultState, sessionState);
        console.log('[RecorderEngine] Sesi login disinkronkan.');
      } catch (e) {}
    }

    this.autoSave();

    console.log(`[RecorderEngine] Meluncurkan Stealth Chrome untuk "${this.sessionName}"...`);
    const { context } = await launchStealthChrome({
      userDataDir,
      headless
    });
    this.context = context;

    await context.exposeBinding('__austudio_record_action', async (source, actionJson) => {
      if (!this.isRecording || this.isPaused) return;
      try {
        const action = JSON.parse(actionJson);
        this.addStep(action);
      } catch (err) {
        console.error('[RecorderEngine] Error parsing action:', err);
      }
    });

    await context.addInitScript(getInjectedRecorderScript());

    context.on('page', (newPage) => {
      this.setupPageListeners(newPage);
    });

    const pages = context.pages();
    this.page = pages.length > 0 ? pages[0] : await context.newPage();
    this.setupPageListeners(this.page);

    if (startUrl) {
      console.log(`[RecorderEngine] Navigasi ke URL awal: ${startUrl}`);
      this.addStep({
        type: 'navigate',
        url: startUrl,
        timestamp: Date.now()
      });
      await this.page.goto(startUrl).catch(err => {
        console.warn(`[RecorderEngine] Peringatan navigasi awal: ${err.message}`);
      });
      this.lastUrl = startUrl;
    }

    context.on('close', () => {
      console.log('[RecorderEngine] Browser context ditutup pengguna.');
      this.stopSession();
    });

    this.broadcast('started', {
      sessionName: this.sessionName,
      sessionDir: this.sessionDir,
      startUrl
    });

    return {
      sessionName: this.sessionName,
      sessionDir: this.sessionDir
    };
  }

  setupPageListeners(page) {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && this.isRecording && !this.isPaused) {
        const url = frame.url();
        if (url && url !== 'about:blank' && url !== this.lastUrl) {
          this.lastUrl = url;
          this.addStep({
            type: 'navigate',
            url,
            timestamp: Date.now()
          });
        }
      }
    });
  }

  addStep(action) {
    if (!this.isRecording || this.isPaused) return;

    if (action.type === 'input' && this.steps.length > 0) {
      const lastStep = this.steps[this.steps.length - 1];
      if (lastStep.type === 'input' && lastStep.selector === action.selector) {
        lastStep.value = action.value;
        lastStep.timestamp = action.timestamp;
        this.autoSave();
        this.broadcast('step_updated', { step: lastStep, index: this.steps.length - 1 });
        return;
      }
    }

    const step = {
      index: this.steps.length + 1,
      ...action,
      isLoginRelated: isLoginStep(action)
    };

    this.steps.push(step);
    console.log(`[RecorderEngine] Rekam langkah #${step.index}: ${step.type} -> ${step.selector || step.url || ''}`);

    this.autoSave();
    this.broadcast('step_added', { step, totalSteps: this.steps.length });
  }

  pause() {
    this.isPaused = true;
    this.broadcast('paused', { sessionName: this.sessionName });
  }

  resume() {
    this.isPaused = false;
    this.broadcast('resumed', { sessionName: this.sessionName });
  }

  autoSave() {
    autoSaveSessionFiles(this.sessionDir, this.sessionName, this.steps);
  }

  async saveStorageState() {
    await saveContextStorageState(this.context, this.sessionDir);
  }

  async stopSession() {
    if (!this.isRecording) return { success: false };

    this.isRecording = false;
    this.isPaused = false;

    await this.saveStorageState();
    this.autoSave();

    if (this.context) {
      try {
        await this.context.close();
      } catch (e) {}
      this.context = null;
      this.page = null;
    }

    console.log(`[RecorderEngine] Sesi "${this.sessionName}" disimpan (${this.steps.length} langkah).`);
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
    return getRecordingsList();
  }

  static getRecordingDetails(sessionName) {
    return getRecordingDetails(sessionName);
  }
}

module.exports = {
  RecorderEngine
};
