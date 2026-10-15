'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const clerk = require('../lib/clerk');

test('Clerk token extraction reads Bearer header and __session cookie', () => {
  // Test Bearer header
  const reqHeader = { headers: { authorization: 'Bearer tok_clerk_12345' } };
  assert.equal(clerk.extractToken(reqHeader), 'tok_clerk_12345');

  // Test Cookie header
  const reqCookie = { headers: { cookie: 'foo=bar; __session=tok_session_6789; baz=qux' } };
  assert.equal(clerk.extractToken(reqCookie), 'tok_session_6789');

  // Test missing
  assert.equal(clerk.extractToken({ headers: {} }), null);
});

test('Clerk JWT decoding extracts claims safely', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_2xyz',
    exp: 1893456000,
    metadata: { role: 'admin', plan: 'growth' }
  })).toString('base64url');
  const signature = 'fake_sig';
  const token = `${header}.${payload}.${signature}`;

  const claims = clerk.decodeJwt(token);
  assert.ok(claims);
  assert.equal(claims.sub, 'user_2xyz');
  assert.equal(claims.metadata.role, 'admin');
  assert.equal(claims.metadata.plan, 'growth');

  assert.equal(clerk.decodeJwt('not-a-jwt'), null);
});

test('Clerk user normalizer maps Clerk shape to internal role and plan', () => {
  const clerkRaw = {
    id: 'user_2xyz123',
    primary_email_address_id: 'em_1',
    email_addresses: [{ id: 'em_1', email_address: 'animesh@seevora.ai' }],
    first_name: 'Animesh',
    last_name: 'J',
    image_url: 'https://img.clerk.com/avatar.png',
    public_metadata: {
      role: 'owner',
      plan: 'scale',
      credits: 100000,
      subscriptionStatus: 'active'
    },
    created_at: 1700000000
  };

  const user = clerk.normalizeClerkUser(clerkRaw);
  assert.equal(user.id, 'user_2xyz123');
  assert.equal(user.email, 'animesh@seevora.ai');
  assert.equal(user.name, 'Animesh J');
  assert.equal(user.role, 'owner');
  assert.equal(user.plan, 'scale');
  assert.equal(user.credits, 100000);
  assert.equal(user.subscriptionStatus, 'active');
});

test('Clerk Svix webhook signature verification accepts valid signatures and rejects tampering', () => {
  const secretKey = 'whsec_MfKQ9rKzL4s1t8mE2v5wX0yZ7aB3cD1e';
  const secretBase64 = secretKey.slice(6);
  const secretBytes = Buffer.from(secretBase64, 'base64');

  const svixId = 'msg_2rXyZ12345';
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } });

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
  const hmac = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');
  const signature = `v1,${hmac}`;

  const headers = {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': signature,
  };

  const ok = clerk.verifySvixWebhook({ headers, rawBody, webhookSecret: secretKey });
  assert.equal(ok.valid, true);

  // Tampered payload fails
  const tampered = clerk.verifySvixWebhook({
    headers,
    rawBody: rawBody + ' ',
    webhookSecret: secretKey,
  });
  assert.equal(tampered.valid, false);
});

test('Clerk authorization hasAccess enforces plan hierarchy and roles', () => {
  const freeUser = { role: 'member', plan: 'free' };
  const proUser = { role: 'owner', plan: 'growth' };
  const adminUser = { role: 'super_admin', plan: 'free' };

  assert.equal(clerk.hasAccess(freeUser, { requiredPlan: 'starter' }), false);
  assert.equal(clerk.hasAccess(proUser, { requiredPlan: 'starter' }), true);
  assert.equal(clerk.hasAccess(proUser, { requiredPlan: 'growth' }), true);
  assert.equal(clerk.hasAccess(proUser, { requiredPlan: 'scale' }), false);

  // super_admin bypasses plan limits
  assert.equal(clerk.hasAccess(adminUser, { requiredPlan: 'enterprise' }), true);
});

test('Clerk updateClerkMetadata validates secret key and builds public_metadata payload', async () => {
  await assert.rejects(
    async () => clerk.updateClerkMetadata('user_123', { publicMetadata: { role: 'owner' } }, { secretKey: '' }),
    /CLERK_SECRET_KEY is not configured/i
  );
});

test('core.syncClerkMetadataForUser populates Clerk publicMetadata with plan, role, tenantId, and credits', async () => {
  const core = require('../lib/core');
  const origUpdate = clerk.updateClerkMetadata;
  const prevKey = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = 'sk_test_mock_123';

  let calledWith = null;
  clerk.updateClerkMetadata = async (userId, body) => {
    calledWith = { userId, body };
    return { id: userId, publicMetadata: body.publicMetadata };
  };

  try {
    // Ensure test user has a clerkUserId
    await core.mutate((mutDb) => {
      const u = mutDb.users[0];
      if (u) u.clerkUserId = u.clerkUserId || 'user_clerk_test_123';
    });

    const testUser = core.db().users[0];
    const res = await core.syncClerkMetadataForUser(testUser.id);
    assert.ok(calledWith, 'updateClerkMetadata should have been called');
    assert.equal(calledWith.userId, testUser.clerkUserId);
    assert.equal(calledWith.body.publicMetadata.role, testUser.role);
    assert.ok(calledWith.body.publicMetadata.plan, 'plan must be populated');
    assert.ok(calledWith.body.publicMetadata.tenantId, 'tenantId must be populated');
    assert.ok(typeof calledWith.body.publicMetadata.credits === 'number', 'credits must be numeric');
    assert.equal(calledWith.body.publicMetadata.billingStatus, 'active');
  } finally {
    clerk.updateClerkMetadata = origUpdate;
    process.env.CLERK_SECRET_KEY = prevKey;
  }
});

test('verifyClerkToken cryptographically accepts authentic RS256 signed tokens and validates claims', async () => {
  const token = clerk.signTestToken({
    sub: 'user_authentic_123',
    email: 'animesh@seevora.ai',
    public_metadata: { role: 'admin', plan: 'growth' },
  });

  const verified = await clerk.verifyClerkToken(token);
  assert.equal(verified.verified, true);
  assert.equal(verified.userId, 'user_authentic_123');
  assert.equal(verified.claims.email, 'animesh@seevora.ai');
  assert.equal(verified.claims.public_metadata.role, 'admin');
});

test('verifyClerkToken rejects unsigned or forged tokens (.fake_sig, tampered payload)', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_hacker',
    public_metadata: { role: 'super_admin' },
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const forgedToken = `${header}.${payload}.fake_signature_bytes`;

  await assert.rejects(
    async () => clerk.verifyClerkToken(forgedToken),
    /Invalid JWT cryptographic signature|Clerk token cannot be verified/i
  );

  // Tampered payload with valid signature from another token
  const validToken = clerk.signTestToken({ sub: 'user_real' });
  const parts = validToken.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'user_hijacked', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

  await assert.rejects(
    async () => clerk.verifyClerkToken(tamperedToken),
    /Invalid JWT cryptographic signature/i
  );
});

test('verifyClerkToken rejects expired tokens', async () => {
  const expiredToken = clerk.signTestToken({
    sub: 'user_expired',
    exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
  });

  await assert.rejects(
    async () => clerk.verifyClerkToken(expiredToken),
    /Clerk session token has expired/i
  );
});

test('verifyClerkToken rejects algorithm confusion (e.g. "none" or "HS256")', async () => {
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user_none', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const noneToken = `${noneHeader}.${payload}.`;

  await assert.rejects(
    async () => clerk.verifyClerkToken(noneToken),
    /Unsupported JWT algorithm/i
  );

  const hsHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const hsToken = `${hsHeader}.${payload}.dummy_hmac`;

  await assert.rejects(
    async () => clerk.verifyClerkToken(hsToken),
    /Unsupported JWT algorithm/i
  );
});

test('verifyClerkToken rejects tokens missing sub claim', async () => {
  const noSubToken = clerk.signTestToken({
    sub: '',
    email: 'nosub@test.com',
  });

  await assert.rejects(
    async () => clerk.verifyClerkToken(noSubToken),
    /missing subject \(sub\) claim/i
  );
});

test('verifyClerkToken supports local CLERK_JWT_KEY PEM verification', async () => {
  // Generate dedicated test keypair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'custom_pem_1' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_pem_custom',
    email: 'pem@custom.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const data = Buffer.from(`${header}.${payload}`, 'utf8');
  const sig = crypto.sign('sha256', data, privateKey).toString('base64url');
  const token = `${header}.${payload}.${sig}`;

  const verified = await clerk.verifyClerkToken(token, { jwtKey: pem });
  assert.equal(verified.verified, true);
  assert.equal(verified.userId, 'user_pem_custom');
});


