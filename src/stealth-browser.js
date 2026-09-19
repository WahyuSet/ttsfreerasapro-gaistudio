const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth plugin
chromium.use(stealthPlugin());

/**
 * Locate Chrome executable on Windows
 */
function findWindowsChromePath() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Launch Stealth Windows Chrome with persistent context or standard context
 */
async function launchStealthChrome(options = {}) {
  const {
    userDataDir = path.resolve(__dirname, '..', 'profiles', 'default'),
    headless = false,
    viewport = null, // null allows full window size with --start-maximized
    muteAudio = true, // Mute browser audio output so automation runs silently
    extraArgs = []
  } = options;

  const chromePath = findWindowsChromePath();

  // Ensure user data directory exists
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const defaultArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    ...(muteAudio ? ['--mute-audio'] : []),
    ...extraArgs
  ];

  const launchOptions = {
    headless,
    viewport,
    acceptDownloads: true,
    downloadsPath: options.downloadsPath || path.resolve(__dirname, '..', 'downloads'),
    ignoreDefaultArgs: ['--enable-automation'],
    args: defaultArgs
  };

  if (chromePath) {
    launchOptions.executablePath = chromePath;
  } else {
    launchOptions.channel = 'chrome';
  }

  // Launch persistent context so logins, cookies & anti-bot trust persist
  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  // Additional anti-detection init script
  await context.addInitScript(() => {
    // 1. Mask navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true
    });

    // 2. Ensure window.chrome exists
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update'
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic'
        },
        PlatformArch: {
          ARM: 'arm',
          ARM64: 'arm64',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64'
        },
        PlatformNaclArch: {
          ARM: 'arm',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64'
        },
        PlatformOs: {
          ANDROID: 'android',
          CROS: 'cros',
          LINUX: 'linux',
          MAC: 'mac',
          OPENBSD: 'openbsd',
          WIN: 'win'
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: 'no_update',
          THROTTLED: 'throttled',
          UPDATE_AVAILABLE: 'update_available'
        }
      };
    }

    // 3. Realistic permissions query
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }

    // 4. Realistic languages and plugins
    Object.defineProperty(navigator, 'languages', {
      get: () => ['id-ID', 'id', 'en-US', 'en'],
      configurable: true
    });
  });

  return { context, chromePath };
}

module.exports = {
  launchStealthChrome,
  findWindowsChromePath
};
