const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { launchStealthChrome, findWindowsChromePath } = require('../src/stealth-browser');
const { generateStandaloneScript } = require('../src/code-generator');
const { RecorderEngine } = require('../src/recorder-engine');

async function runTests() {
  console.log('--- 1. Testing Chrome Windows Path Detection ---');
  const chromePath = findWindowsChromePath();
  console.log('Detected Chrome Path:', chromePath);
  assert.ok(chromePath, 'Google Chrome Windows executable must be detected');

  console.log('\n--- 2. Testing Stealth Anti-Bot Flags ---');
  const testProfileDir = path.resolve(__dirname, '..', 'profiles', 'test_profile');
  const { context } = await launchStealthChrome({
    userDataDir: testProfileDir,
    headless: true
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto('data:text/html,<html><body><h1>Test</h1></body></html>');

  const webdriverVal = await page.evaluate(() => navigator.webdriver);
  const chromeType = await page.evaluate(() => typeof window.chrome);

  console.log('navigator.webdriver value:', webdriverVal);
  console.log('typeof window.chrome:', chromeType);

  assert.ok(webdriverVal === false || webdriverVal === undefined, 'navigator.webdriver must be false or undefined (stealth protected)');
  assert.strictEqual(chromeType, 'object', 'window.chrome must be present as an object');
  await context.close();

  console.log('\n--- 3. Testing Code Generator ---');
  const sampleSteps = [
    { id: 1, type: 'navigate', url: 'https://example.com', timestamp: Date.now() },
    { id: 2, type: 'click', selector: 'button#login', text: 'Sign In', timestamp: Date.now() },
    { id: 3, type: 'fill', selector: 'input[name="user"]', value: 'admin', timestamp: Date.now() }
  ];
  const generatedScript = generateStandaloneScript('test_session', sampleSteps);
  assert.ok(generatedScript.includes('page.goto("https://example.com"'), 'Script should include navigation');
  assert.ok(generatedScript.includes('page.click("button#login"'), 'Script should include click');
  assert.ok(generatedScript.includes('page.fill("input[name=\\"user\\"]", "admin"'), 'Script should include fill');
  console.log('Code Generator generated valid Playwright code.');

  console.log('\n--- 4. Testing Real-Time Auto-Save in RecorderEngine ---');
  const engine = new RecorderEngine();
  const testSessionName = `unit_test_autosave_${Date.now()}`;
  engine.sessionName = testSessionName;
  engine.sessionDir = path.resolve(__dirname, '..', 'recordings', testSessionName);
  fs.mkdirSync(engine.sessionDir, { recursive: true });

  engine.addStep({ type: 'navigate', url: 'https://example.com' });
  engine.addStep({ type: 'click', selector: '#test-btn' });

  const stepsJsonPath = path.join(engine.sessionDir, 'steps.json');
  const scriptJsPath = path.join(engine.sessionDir, 'script.js');

  assert.ok(fs.existsSync(stepsJsonPath), 'steps.json should be auto-saved to disk');
  assert.ok(fs.existsSync(scriptJsPath), 'script.js should be auto-saved to disk');

  const savedSteps = JSON.parse(fs.readFileSync(stepsJsonPath, 'utf8'));
  assert.strictEqual(savedSteps.length, 2, 'Two steps should be auto-saved');
  console.log('Auto-Save verified: steps.json and script.js exist and match.');

  // Clean up test recordings
  fs.rmSync(engine.sessionDir, { recursive: true, force: true });
  fs.rmSync(testProfileDir, { recursive: true, force: true });

  console.log('\n======================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  console.log('======================================\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
