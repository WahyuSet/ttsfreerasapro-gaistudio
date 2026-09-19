const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { RecorderEngine } = require('../src/recorder-engine');

async function testEndToEnd() {
  console.log('=== Starting End-to-End Recording & Auto-Save Test ===');
  const engine = new RecorderEngine();
  const sessionName = `e2e_test_${Date.now()}`;

  // Start session with a test html data URL
  const testHtml = encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <head><title>AuStudio Test Page</title></head>
      <body>
        <h1 id="title">AuStudio Test</h1>
        <input id="username-input" placeholder="Masukkan username" />
        <button id="submit-btn">Kirim Data</button>
        <div id="result"></div>
        <script>
          document.getElementById('submit-btn').addEventListener('click', () => {
            const val = document.getElementById('username-input').value;
            document.getElementById('result').innerText = 'Halo, ' + val;
          });
        </script>
      </body>
    </html>
  `);

  const startUrl = `data:text/html,${testHtml}`;

  console.log('1. Starting recording session...');
  const session = await engine.startSession({
    sessionName,
    startUrl,
    headless: true
  });

  assert.ok(session.sessionDir, 'Session directory should be returned');
  assert.ok(fs.existsSync(session.sessionDir), 'Session directory should exist on disk');

  // Verify initial auto-save
  const stepsFile = path.join(session.sessionDir, 'steps.json');
  const scriptFile = path.join(session.sessionDir, 'script.js');
  assert.ok(fs.existsSync(stepsFile), 'steps.json must be created immediately');
  assert.ok(fs.existsSync(scriptFile), 'script.js must be created immediately');

  console.log('2. Performing user actions in the page...');
  const page = engine.page;

  // Type into input
  const inputEl = await page.waitForSelector('#username-input');
  await inputEl.click();
  await inputEl.fill('jerry_austudio');
  // Dispatch blur so debounced recorder flushes immediately
  await page.evaluate(() => {
    const el = document.getElementById('username-input');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });

  await new Promise(r => setTimeout(r, 700));

  // Click button
  const buttonEl = await page.waitForSelector('#submit-btn');
  await buttonEl.click();

  await new Promise(r => setTimeout(r, 600));

  console.log('3. Checking steps recorded and auto-saved...');
  const currentSteps = engine.steps;
  console.log('Total steps recorded:', currentSteps.length);
  assert.ok(currentSteps.length >= 2, 'Should have recorded at least navigation and interaction');

  // Check that files on disk reflect the steps
  const savedSteps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  const savedScript = fs.readFileSync(scriptFile, 'utf8');

  assert.strictEqual(savedSteps.length, currentSteps.length, 'Disk steps.json should match in-memory steps');
  assert.ok(savedScript.includes('data:text/html'), 'Script should include navigation');
  assert.ok(savedScript.includes('humanClick') || savedScript.includes('humanPaste') || savedScript.includes('page.click') || savedScript.includes('page.fill'), 'Script should include interactions');

  console.log('4. Stopping recording session...');
  await engine.stopSession();
  assert.strictEqual(engine.isRecording, false, 'Session should be stopped');

  console.log('\n5. Executing the generated script to verify standalone playback...');
  // Execute the generated script with Node
  const { execSync } = require('child_process');
  const output = execSync(`node "${scriptFile}"`, { encoding: 'utf8' });
  console.log('Playback Output:\n', output);
  assert.ok(output.includes('[AuStudio] All recorded steps executed successfully!'), 'Script executed successfully');

  // Clean up e2e test recording
  fs.rmSync(session.sessionDir, { recursive: true, force: true });

  console.log('\n======================================================');
  console.log('🎉 E2E TEST PASSED: Auto-Save and Replay 100% WORKING!');
  console.log('======================================================\n');
}

testEndToEnd().catch(err => {
  console.error('E2E Test failed:', err);
  process.exit(1);
});
