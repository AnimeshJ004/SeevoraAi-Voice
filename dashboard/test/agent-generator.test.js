'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DASHBOARD_DIR = path.join(__dirname, '..');
const TEST_EMAIL = 'client.intake@seevora.ai';
const TEST_PASSWORD = 'Client-Needs-Test-2026!';

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForServer(baseUrl, child, readLogs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited during startup.\n${readLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_) {
      // socket not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become ready.\n${readLogs()}`);
}

test('AI Agent Generator from client needs and call transcripts', { timeout: 35000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rapidx-agent-gen-'));
  const dbFile = path.join(tempDir, 'db.json');
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];

  const child = spawn(process.execPath, ['server.js'], {
    cwd: DASHBOARD_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      RAPIDX_DB_FILE: dbFile,
      TEST_USER_EMAIL: TEST_EMAIL,
      TEST_USER_PASSWORD: TEST_PASSWORD,
      TEST_USER_TENANT: 'Seevora AI Client Test',
      PUBLIC_ORIGIN: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, child, () => logs.join(''));

  async function request(cookie, pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    let body = options.body;
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers,
      body,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: response.status, headers: response.headers, body: json, text };
  }

  // 1. Unauthenticated request to /api/agents/generate-from-needs is rejected
  const unauthed = await request(null, '/api/agents/generate-from-needs', {
    method: 'POST',
    body: { needs: 'Dental clinic needs' }
  });
  assert.equal(unauthed.status, 401, 'unauthenticated request must return 401');

  // 2. Login as the seeded test user
  const loginRes = await request(null, '/api/auth/login', {
    method: 'POST',
    body: { email: TEST_EMAIL, password: TEST_PASSWORD }
  });
  assert.equal(loginRes.status, 200, 'login must succeed');
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'must receive session cookie');

  // 3. Validation: Missing requirements returns 422
  const emptyReq = await request(cookie, '/api/agents/generate-from-needs', {
    method: 'POST',
    body: { needs: '', transcript: '' }
  });
  assert.equal(emptyReq.status, 422);
  assert.equal(emptyReq.body.code, 'missing_requirements');

  // 4. Generate agent from client needs and call transcript
  const generateRes = await request(cookie, '/api/agents/generate-from-needs', {
    method: 'POST',
    body: {
      businessName: 'Indiranagar Dental Care',
      industry: 'Healthcare / Dental',
      objective: 'Emergency triage and routine appointment booking',
      tone: 'Warm, professional, and reassuring',
      language: 'English (Indian accent)',
      needs: 'We are a dental clinic in Indiranagar, Bangalore. Consultation fee is 600 rupees. We need patient name, phone number, pain severity, and preferred appointment slot. Escalate emergencies.',
      transcript: 'Caller: Hello, I have severe toothache and swelling.\nAgent: Hi, thanks for calling Indiranagar Dental Care. We can help with that. Is there any bleeding or severe swelling?\nCaller: Yes, it is throbbing on my right jaw.\nAgent: We have an emergency slot with Dr. Sunita at 3:30 PM today. May I get your name to hold the appointment?\nCaller: My name is Rohan Mehta.\nAgent: Thank you Rohan. You are booked for 3:30 PM today.'
    }
  });

  assert.equal(generateRes.status, 200, 'generation endpoint must return 200');
  const data = generateRes.body;
  assert.ok(data.agent, 'must contain agent blueprint');
  assert.ok(data.agent.name, 'agent must have a name');
  assert.ok(data.agent.greeting, 'agent must have an opening greeting');
  assert.ok(data.agent.persona, 'agent must have a persona prompt');
  assert.ok(data.agent.tts, 'agent must have voice configuration');
  assert.ok(Array.isArray(data.agent.fields), 'agent must have fields array');
  assert.ok(Array.isArray(data.agent.guardrails), 'agent must have guardrails array');

  assert.ok(data.transcriptUnderstanding, 'must contain transcriptUnderstanding');
  assert.ok(data.transcriptUnderstanding.businessSummary, 'must have businessSummary');
  assert.ok(Array.isArray(data.transcriptUnderstanding.detectedIntents), 'must have detectedIntents');
  assert.ok(data.transcriptUnderstanding.detectedIntents.length > 0, 'must detect intents');

  assert.ok(Array.isArray(data.sampleTranscript), 'must contain sampleTranscript array');
  assert.ok(data.sampleTranscript.length >= 4, 'sampleTranscript must have multi-turn dialogue');
  const firstTurn = data.sampleTranscript[0];
  assert.ok(firstTurn.speaker, 'turns must have a speaker');
  assert.ok(firstTurn.text, 'turns must have spoken text');
  assert.ok(firstTurn.annotation, 'turns must have explanatory annotation');

  // 5. Deploy / Save the generated agent to tenant DB
  const saveRes = await request(cookie, '/api/agents', {
    method: 'POST',
    body: {
      name: data.agent.name,
      persona: data.agent.persona,
      greeting: data.agent.greeting,
      tts: data.agent.tts,
      fields: data.agent.fields,
      guardrails: data.agent.guardrails,
      sampleTranscript: data.sampleTranscript,
      transcriptUnderstanding: data.transcriptUnderstanding
    }
  });

  assert.equal(saveRes.status, 200, 'saving agent must return 200');
  const createdAgent = saveRes.body.agent;
  assert.ok(createdAgent.id, 'created agent must have an ID');
  assert.equal(createdAgent.name, data.agent.name);
  assert.deepEqual(createdAgent.fields, data.agent.fields);
  assert.deepEqual(createdAgent.guardrails, data.agent.guardrails);
  assert.ok(createdAgent.sampleTranscript, 'persisted agent must have sampleTranscript');
  assert.ok(createdAgent.transcriptUnderstanding, 'persisted agent must have transcriptUnderstanding');

  // 6. Verify GET /api/agents returns the newly created agent with transcript data
  const listRes = await request(cookie, '/api/agents');
  assert.equal(listRes.status, 200);
  const found = (listRes.body.agents || []).find((a) => a.id === createdAgent.id);
  assert.ok(found, 'saved agent must appear in GET /api/agents');
  assert.equal(found.greeting, data.agent.greeting);
  assert.ok(found.sampleTranscript.length > 0, 'sampleTranscript preserved in list');
});
