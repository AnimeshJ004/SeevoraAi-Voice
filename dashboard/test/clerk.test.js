'use strict';

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
