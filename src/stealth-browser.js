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
 * Sinkronisasi preferensi penempatan jendela Chrome di Default/Preferences
 * Agar posisi off-screen tidak tersimpan permanen saat pengguna ingin membuka browser secara normal
 */
function syncWindowPlacementPref(userDataDir, offscreen) {
  const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
  try {
    if (!fs.existsSync(prefsPath)) return;
    const raw = fs.readFileSync(prefsPath, 'utf8');
    const prefs = JSON.parse(raw);
    if (!prefs.browser) prefs.browser = {};
    if (!prefs.browser.window_placement) prefs.browser.window_placement = {};

    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;

    if (!prefs.download) prefs.download = {};
    prefs.download.prompt_for_download = false;

    if (offscreen) {
      prefs.browser.window_placement.left = -10000;
      prefs.browser.window_placement.top = -10000;
      prefs.browser.window_placement.right = -8560;
      prefs.browser.window_placement.bottom = -9100;
      prefs.browser.window_placement.maximized = false;
    } else {
      if (
        typeof prefs.browser.window_placement.left === 'number' &&
        (prefs.browser.window_placement.left < 0 || prefs.browser.window_placement.top < 0)
      ) {
        prefs.browser.window_placement.left = 100;
        prefs.browser.window_placement.top = 50;
        prefs.browser.window_placement.right = 1540;
        prefs.browser.window_placement.bottom = 950;
        prefs.browser.window_placement.maximized = false;
      }
    }
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // Abaikan jika preferensi belum ada
  }
}

/**
 * Launch Stealth Windows Chrome with persistent context or standard context
 */
async function launchStealthChrome(options = {}) {
  const {
    userDataDir = path.resolve(__dirname, '..', 'profiles', 'default'),
    headless = false,
    offscreen = true,
    viewport = null,
    muteAudio = true,
    extraArgs = []
  } = options;

  const chromePath = findWindowsChromePath();

  // Ensure user data directory exists
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Sinkronkan preferensi window placement sebelum Chrome dibuka
  syncWindowPlacementPref(userDataDir, offscreen);

  const defaultArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    ...(muteAudio ? ['--mute-audio'] : []),
    ...(offscreen && !headless
      ? ['--window-position=-10000,-10000', '--window-size=1440,900']
      : ['--start-maximized']),
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
