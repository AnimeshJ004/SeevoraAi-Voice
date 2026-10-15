/**
 * SeevoraVoice - Authentication & Backdoor Elimination Test Suite
 *
 * Verifies that:
 * 1. Zero-password bypasses (e.g. animeshj425@gmail.com) are strictly rejected with 401.
 * 2. Hardcoded backdoor strings (RapidXDemo1234!, rapidxvoice, etc.) are rejected with 401.
 * 3. Demo accounts (admin@demo.com, client@demo.com) are strictly blocked with 403 when ENABLE_DEMO_LOGIN is false.
 * 4. Legitimate scrypt password hashing verifies correctly.
 * 5. apiBillingConfig advertises demoLoginEnabled: false.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { mkdtemp, rm } = require('fs/promises');
const { spawn } = require('child_process');
const net = require('net');

const DASHBOARD_DIR = path.resolve(__dirname, '..');

async function reservePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function waitForServer(baseUrl, child, getLogs, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (child.exitCode !== null) {
        return reject(new Error(`Server exited early with code ${child.exitCode}:\n${getLogs()}`));
      }
      fetch(`${baseUrl}/healthz`)
        .then((res) => {
          if (res.ok) resolve();
          else setTimeout(check, 100);
        })
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Timed out waiting for server:\n${getLogs()}`));
          } else {
            setTimeout(check, 100);
          }
        });
    };
    check();
  });
}

test('Authentication security: zero-password bypasses and demo backdoors are eliminated', { timeout: 30000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'seevora-auth-sec-'));
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
      ENABLE_DEMO_LOGIN: 'false',
      PUBLIC_ORIGIN: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (c) => logs.push(c.toString()));
  child.stderr.on('data', (c) => logs.push(c.toString()));

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

  async function postJson(endpoint, data) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.statusCode || res.status, json };
  }

  // 1. Zero-password backdoor rejection
  const zeroPassRes = await postJson('/api/auth/login', {
    email: 'animeshj425@gmail.com',
    password: '',
  });
  assert.equal(zeroPassRes.status, 401, 'Zero-password attempt must return 401');
  assert.equal(zeroPassRes.json.code, 'bad_creds');

  // 2. Random password against unseeded/backdoor account is rejected
  const randomPassRes = await postJson('/api/auth/login', {
    email: 'animeshj425@gmail.com',
    password: 'any_random_guess_123',
  });
  assert.equal(randomPassRes.status, 401, 'Random password attempt must return 401');

  // 3. Hardcoded demo passwords without matching user are rejected
  const backdoorRes = await postJson('/api/auth/login', {
    email: 'stranger@example.com',
    password: 'RapidXDemo1234!',
  });
  assert.equal(backdoorRes.status, 401, 'Hardcoded backdoor string must return 401');

  // 4. Public demo login is blocked when ENABLE_DEMO_LOGIN=false
  const demoAdminRes = await postJson('/api/auth/login', {
    email: 'admin@demo.com',
    password: 'admin',
  });
  assert.equal(demoAdminRes.status, 403, 'Demo login in production must return 403 Forbidden');
  assert.equal(demoAdminRes.json.code, 'demo_disabled');

  const demoClientRes = await postJson('/api/auth/login', {
    email: 'client@demo.com',
    password: 'client123',
  });
  assert.equal(demoClientRes.status, 403, 'Demo client login in production must return 403 Forbidden');
  assert.equal(demoClientRes.json.code, 'demo_disabled');

  // 5. Billing config exposes demoLoginEnabled: false
  const cfgRes = await fetch(`${baseUrl}/api/billing/config`);
  const cfg = await cfgRes.json();
  assert.equal(cfgRes.status, 200);
  assert.equal(cfg.auth.demoLoginEnabled, false, 'demoLoginEnabled must be advertised as false');

  // 6. Legitimate signup and login works strictly with scrypt password verification
  const signupRes = await postJson('/api/auth/signup', {
    email: 'verified_user@production.org',
    password: 'ComplexSecurePassword2026!',
    name: 'Verified Org Admin',
  });
  assert.equal(signupRes.status, 200, 'Legitimate signup must succeed');

  // Successful login with correct password
  const legitimateLoginRes = await postJson('/api/auth/login', {
    email: 'verified_user@production.org',
    password: 'ComplexSecurePassword2026!',
  });
  assert.equal(legitimateLoginRes.status, 200, 'Legitimate login must return 200');
  assert.equal(legitimateLoginRes.json.user.email, 'verified_user@production.org');

  // Failed login with wrong password
  const wrongPasswordRes = await postJson('/api/auth/login', {
    email: 'verified_user@production.org',
    password: 'WrongPasswordGuess!',
  });
  assert.equal(wrongPasswordRes.status, 401, 'Wrong password must return 401');

  // 7. Forged unsigned or fake Clerk JWT token against protected endpoints is strictly rejected with 401
  const fakeClerkHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const fakeClerkPayload = Buffer.from(JSON.stringify({
    sub: 'user_attacker_sub_999',
    email: 'attacker@evil.com',
    role: 'super_admin',
    public_metadata: { role: 'super_admin' },
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const forgedClerkToken = `${fakeClerkHeader}.${fakeClerkPayload}.fake_unverified_sig`;

  const forgedMeRes = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${forgedClerkToken}` },
  });
  assert.equal(forgedMeRes.status, 401, 'Forged Clerk token on /api/me must return 401 Unauthorized');
  const forgedMeJson = await forgedMeRes.json();
  assert.equal(forgedMeJson.code, 'no_session');

  const forgedAdminRes = await fetch(`${baseUrl}/api/invoices`, {
    headers: { Authorization: `Bearer ${forgedClerkToken}` },
  });
  assert.equal(forgedAdminRes.status, 401, 'Forged Clerk token on admin route must return 401 Unauthorized');

  // 8. Clerk Webhook strictly rejects unverified requests (400 invalid_signature when secret configured, 503 if unconfigured)
  const webhookUnsignedRes = await fetch(`${baseUrl}/api/clerk/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user.created', data: { id: 'user_clerk_injected' } }),
  });
  assert.ok(
    webhookUnsignedRes.status === 400 || webhookUnsignedRes.status === 503,
    `Unsigned webhook must be rejected, got status ${webhookUnsignedRes.status}`
  );
  if (webhookUnsignedRes.status === 400) {
    const json = await webhookUnsignedRes.json();
    assert.equal(json.code, 'invalid_signature');
  }
});

