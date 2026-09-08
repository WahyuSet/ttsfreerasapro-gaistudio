const fs = require('fs');
const path = require('path');
const { launchStealthChrome } = require('./stealth-browser');

class ScriptRunner {
  constructor() {
    this.isRunning = false;
    this.currentStep = 0;
    this.totalSteps = 0;
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
        console.error('[ScriptRunner] Listener error:', err);
      }
    }
  }

  async runSession(sessionName, options = {}) {
    if (this.isRunning) {
      throw new Error('A replay session is already running.');
    }

    const {
      delayBetweenSteps = 600,
      userDataDir = path.resolve(__dirname, '..', 'profiles', 'default'),
      headless = false,
      keepOpen = true
    } = options;

    const sessionDir = path.resolve(__dirname, '..', 'recordings', sessionName);
    const stepsFile = path.join(sessionDir, 'steps.json');

    if (!fs.existsSync(stepsFile)) {
      throw new Error(`Session "${sessionName}" steps file not found.`);
    }

    const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
    this.isRunning = true;
    this.totalSteps = steps.length;
    this.currentStep = 0;

    this.broadcast('runner_started', {
      sessionName,
      totalSteps: steps.length
    });

    console.log(`[ScriptRunner] Starting replay for "${sessionName}" with ${steps.length} steps...`);

    let context = null;
    try {
      const launched = await launchStealthChrome({
        userDataDir,
        headless
      });
      context = launched.context;

      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      page.setDefaultTimeout(20000);

      for (let i = 0; i < steps.length; i++) {
        if (!this.isRunning) {
          console.log('[ScriptRunner] Replay stopped early.');
          break;
        }

        const step = steps[i];
        this.currentStep = i + 1;

        this.broadcast('runner_step', {
          stepIndex: i,
          step,
          current: this.currentStep,
          total: this.totalSteps
        });

        console.log(`[ScriptRunner] Executing step ${this.currentStep}/${this.totalSteps}: ${step.type} (${step.selector || step.url || step.key || ''})`);

        try {
          switch (step.type) {
            case 'navigate':
              await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
              break;

            case 'click':
              await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
              await page.click(step.selector);
              break;

            case 'dblclick':
              await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
              await page.dblclick(step.selector);
              break;

            case 'fill':
              await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
              await page.fill(step.selector, step.value || '');
              break;

            case 'press':
              if (step.selector) {
                await page.press(step.selector, step.key);
              } else {
                await page.keyboard.press(step.key);
              }
              break;

            case 'select':
              await page.waitForSelector(step.selector, { state: 'visible', timeout: 10000 });
              await page.selectOption(step.selector, step.value);
              break;

            case 'scroll':
              await page.evaluate(({ x, y }) => window.scrollTo(x, y), {
                x: step.scrollX || 0,
                y: step.scrollY || 0
              });
              break;

            default:
              break;
          }
        } catch (stepErr) {
          console.warn(`[ScriptRunner] Step ${this.currentStep} warning: ${stepErr.message}`);
          this.broadcast('runner_step_warning', {
            stepIndex: i,
            error: stepErr.message
          });
        }

        await new Promise(r => setTimeout(r, delayBetweenSteps));
      }

      console.log(`[ScriptRunner] Finished replay for "${sessionName}".`);
      this.broadcast('runner_finished', {
        sessionName,
        success: true
      });

      if (!keepOpen && context) {
        await context.close();
      }
    } catch (err) {
      console.error('[ScriptRunner] Error during execution:', err);
      this.broadcast('runner_error', {
        error: err.message
      });
      if (context) {
        try { await context.close(); } catch (e) {}
      }
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    this.isRunning = false;
  }
}

module.exports = {
  ScriptRunner
};
