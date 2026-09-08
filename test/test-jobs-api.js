const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { JobManager } = require('../src/job-manager');
const { DEFAULT_API_KEY } = require('../src/auth');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Jobs System Unit & API Integration Tests');
  console.log('====================================================\n');

  const testStorageFile = path.resolve(__dirname, 'test_jobs_data.json');
  if (fs.existsSync(testStorageFile)) {
    fs.unlinkSync(testStorageFile);
  }

  // ----------------------------------------------------
  // Test 1: JobManager Unit Tests
  // ----------------------------------------------------
  console.log('[Test 1] Initializing JobManager...');
  const manager = new JobManager({ storageFile: testStorageFile });

  // Mock worker
  let workerCalledWith = null;
  manager.setWorker(async (params, onProgress) => {
    workerCalledWith = params;
    onProgress({ stage: 'initializing', progress: 20, message: 'Step 1' });
    await new Promise(r => setTimeout(r, 50));
    onProgress({ stage: 'rendering', progress: 70, message: 'Step 2' });
    await new Promise(r => setTimeout(r, 50));
    return {
      success: true,
      totalChunks: 1,
      voiceSettings: { voice: params.voice, style: params.style },
      files: [{
        filename: 'test_audio.wav',
        downloadUrl: '/api/tts/download/test_audio.wav',
        sizeBytes: 1024,
        sizeKb: '1.0'
      }]
    };
  });

  console.log('[Test 2] Creating a job with valid text...');
  const progressUpdates = [];
  manager.on('job:progress', (j) => {
    progressUpdates.push({ progress: j.progress, stage: j.stage, message: j.message });
  });

  const createdJob = manager.createJob({
    text: 'Halo ini naskah uji coba JobManager',
    voice: 'Achernar',
    style: 'Natural'
  });

  assert.ok(createdJob.id.startsWith('job_'), 'Job ID should start with job_');
  assert.strictEqual(createdJob.status, 'queued', 'Initial status should be queued');
  assert.strictEqual(createdJob.queuePosition, 1, 'Initial queue position should be 1');

  console.log('[Test 3] Waiting for job completion via waitForJob()...');
  const completedJob = await manager.waitForJob(createdJob.id, 5000);
  assert.strictEqual(completedJob.status, 'completed', 'Status should transition to completed');
  assert.strictEqual(completedJob.progress, 100, 'Progress should reach 100%');
  assert.ok(completedJob.result, 'Result must be populated');
  assert.strictEqual(completedJob.result.files[0].filename, 'test_audio.wav');
  assert.ok(progressUpdates.length >= 2, 'Should receive progress updates');

  console.log('[Test 4] Testing cancellation of a queued job...');
  // Pause processing by not assigning worker temporarily or queuing multiple jobs
  const jobToCancel = manager.createJob({
    text: 'Job kedua yang akan dibatalkan'
  });
  const cancelResult = manager.cancelJob(jobToCancel.id);
  assert.strictEqual(cancelResult.success, true, 'Cancellation should succeed');
  assert.strictEqual(cancelResult.job.status, 'cancelled', 'Status should be cancelled');

  const fetchedCancelled = manager.getJob(jobToCancel.id);
  assert.strictEqual(fetchedCancelled.status, 'cancelled', 'Fetched job status should be cancelled');

  console.log('[Test 5] Checking stats and listJobs...');
  const list = manager.listJobs();
  assert.ok(list.total >= 2, 'Should have at least 2 jobs in history');
  const stats = manager.getStats();
  assert.strictEqual(stats.completed, 1, 'Should have 1 completed job');
  assert.strictEqual(stats.cancelled, 1, 'Should have 1 cancelled job');

  // Clean up test storage file
  if (fs.existsSync(testStorageFile)) {
    fs.unlinkSync(testStorageFile);
  }

  // ----------------------------------------------------
  // Test 6: HTTP Express Routes Integration Tests
  // ----------------------------------------------------
  console.log('[Test 6] Testing Express Server Endpoints...');
  const { app, jobManager: serverJobManager } = require('../src/server');

  // Mock serverJobManager worker during API tests so it completes instantly without opening browser
  serverJobManager.setWorker(async (params, onProgress) => {
    onProgress({ stage: 'initializing', progress: 20, message: 'Server test step 1' });
    onProgress({ stage: 'rendering', progress: 80, message: 'Server test step 2' });
    return {
      success: true,
      totalChunks: 1,
      voiceSettings: { voice: params.voice || 'Achernar', style: params.style || 'Natural' },
      files: [{
        filename: 'server_test_audio.wav',
        downloadUrl: '/api/tts/download/server_test_audio.wav',
        sizeBytes: 2048,
        sizeKb: '2.0'
      }]
    };
  });

  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, resolve));
  const testPort = testServer.address().port;
  const baseUrl = `http://localhost:${testPort}`;
  console.log(`Test server running on port ${testPort}`);

  try {
    // 6a. Health Check
    console.log('-> Testing GET /health ...');
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, 'healthy');
    assert.ok(healthData.jobs, 'Health response should include jobs stats');

    // 6b. Unauthorized POST /api/tts/jobs (no API key)
    console.log('-> Testing POST /api/tts/jobs without API key ...');
    const unauthRes = await fetch(`${baseUrl}/api/tts/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Halo' })
    });
    assert.strictEqual(unauthRes.status, 401, 'Should return 401 Unauthorized');

    // 6c. Valid POST /api/tts/jobs
    console.log('-> Testing POST /api/tts/jobs with valid API key ...');
    const createRes = await fetch(`${baseUrl}/api/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DEFAULT_API_KEY
      },
      body: JSON.stringify({
        text: 'Pengujian endpoint REST API Jobs',
        voice: 'Achernar'
      })
    });
    assert.strictEqual(createRes.status, 202, 'Should return 202 Accepted');
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true);
    assert.ok(createData.jobId);
    assert.ok(createData.statusUrl);

    // 6d. GET /api/tts/jobs/:id
    console.log(`-> Testing GET /api/tts/jobs/${createData.jobId} ...`);
    const getJobRes = await fetch(`${baseUrl}/api/tts/jobs/${createData.jobId}`, {
      headers: { 'x-api-key': DEFAULT_API_KEY }
    });
    assert.strictEqual(getJobRes.status, 200);
    const getJobData = await getJobRes.json();
    assert.strictEqual(getJobData.success, true);
    assert.strictEqual(getJobData.job.id, createData.jobId);

    // 6e. GET /api/tts/jobs (Listing)
    console.log('-> Testing GET /api/tts/jobs ...');
    const listRes = await fetch(`${baseUrl}/api/tts/jobs`, {
      headers: { 'x-api-key': DEFAULT_API_KEY }
    });
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.success, true);
    assert.ok(Array.isArray(listData.jobs));
    assert.ok(listData.jobs.some(j => j.id === createData.jobId));

    // 6f. Invalid text validation
    console.log('-> Testing POST /api/tts/jobs with empty text ...');
    const badReqRes = await fetch(`${baseUrl}/api/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DEFAULT_API_KEY
      },
      body: JSON.stringify({ text: '' })
    });
    assert.strictEqual(badReqRes.status, 400, 'Should return 400 Bad Request');

    // 6g. POST /api/tts/generate (default async mode)
    console.log('-> Testing POST /api/tts/generate (default async job mode) ...');
    const genRes = await fetch(`${baseUrl}/api/tts/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DEFAULT_API_KEY
      },
      body: JSON.stringify({ text: 'Generate async test' })
    });
    assert.strictEqual(genRes.status, 202, 'Should return 202 Accepted for async job');
    const genData = await genRes.json();
    assert.ok(genData.jobId);

    console.log('\n====================================================');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } finally {
    if (typeof testServer.closeAllConnections === 'function') {
      testServer.closeAllConnections();
    }
    await new Promise(resolve => testServer.close(resolve));
  }
}

runTests().catch(err => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
