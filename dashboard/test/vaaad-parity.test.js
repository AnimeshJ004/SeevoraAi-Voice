const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const developer = require('../lib/developer');
const languages = require('../lib/languages');

test('Developer module: API Keys generation, hashing, and verification', () => {
  const db = { apiKeys: [] };
  const tenantId = 'tenant_test_1';

  // 1. Create API key
  const res = developer.createApiKey(db, tenantId, { name: 'CRM Integration', permissions: ['auto_call', 'read_calls'] });
  assert.equal(res.ok, true);
  assert.ok(res.rawKey.startsWith('vaad_live_'));
  assert.equal(db.apiKeys.length, 1);
  assert.equal(db.apiKeys[0].tenantId, tenantId);
  assert.equal(db.apiKeys[0].name, 'CRM Integration');
  assert.equal(db.apiKeys[0].status, 'active');
  // Raw key must NOT be stored in db
  assert.notEqual(db.apiKeys[0].keyHash, res.rawKey);

  // 2. Authenticate with valid raw key
  const authRes = developer.authenticateApiKey(db, res.rawKey);
  assert.equal(authRes.ok, true);
  assert.equal(authRes.tenantId, tenantId);
  assert.deepEqual(authRes.permissions, ['auto_call', 'read_calls']);

  // 3. Authenticate with bogus key fails
  const failRes = developer.authenticateApiKey(db, 'vaad_live_invalidtoken123456');
  assert.equal(failRes.ok, false);

  // 4. Revocation
  developer.revokeApiKey(db, tenantId, res.apiKey.id);
  assert.equal(db.apiKeys[0].status, 'revoked');
  const revokedRes = developer.authenticateApiKey(db, res.rawKey);
  assert.equal(revokedRes.ok, false);
});

test('Developer module: Outbound Webhook creation and HMAC signing', () => {
  const db = { outboundWebhooks: [], webhookDeliveries: [] };
  const tenantId = 'tenant_test_2';

  const hook = developer.createOutboundWebhook(db, tenantId, {
    targetUrl: 'https://crm.example.com/webhooks/vaaad',
    events: ['call.completed', 'booking.created']
  });
  assert.equal(hook.ok, true);
  assert.equal(db.outboundWebhooks.length, 1);
  assert.ok(hook.webhook.secret.length >= 32);

  // Verify HMAC signature calculation
  const payload = { callId: 'call_123', durationSec: 145, sentiment: 'positive', costInr: 12.50 };
  const signed = developer.signWebhookPayload(hook.webhook.secret, 'call.completed', payload);
  assert.ok(signed.signature.startsWith('sha256='));
  assert.equal(signed.event, 'call.completed');

  // Verify signature verification
  const isValid = developer.verifyWebhookSignature(hook.webhook.secret, signed.rawBody, signed.signature);
  assert.equal(isValid, true);
  const isTampered = developer.verifyWebhookSignature(hook.webhook.secret, signed.rawBody + 'extra', signed.signature);
  assert.equal(isTampered, false);
});

test('Multilingual engine: 24 Vernacular languages catalog completeness', () => {
  const catalog = languages.getLanguagesCatalog();
  assert.equal(catalog.length, 24);

  const codes = catalog.map(l => l.code);
  assert.ok(codes.includes('hi-IN')); // Hindi
  assert.ok(codes.includes('hi-IN-hybrid')); // Hinglish
  assert.ok(codes.includes('en-IN')); // Indian English
  assert.ok(codes.includes('ta-IN')); // Tamil
  assert.ok(codes.includes('te-IN')); // Telugu
  assert.ok(codes.includes('kn-IN')); // Kannada
  assert.ok(codes.includes('bn-IN')); // Bengali
  assert.ok(codes.includes('mr-IN')); // Marathi
  assert.ok(codes.includes('gu-IN')); // Gujarati
  assert.ok(codes.includes('pa-IN')); // Punjabi

  const hiPrompt = languages.getSystemPromptPrefix('hi-IN', { agentName: 'Ria' });
  assert.ok(hiPrompt.includes('Hindi'));
});

test('TRAI Compliance & DND Scrub engine', () => {
  const compliance = require('../lib/compliance');
  
  // Test IST window check
  // 10:00 AM IST should be allowed
  assert.equal(compliance.isWithinTraiWindow(10), true);
  // 11:30 PM (23:30) IST should be blocked
  assert.equal(compliance.isWithinTraiWindow(23), false);
  // 3:00 AM IST should be blocked
  assert.equal(compliance.isWithinTraiWindow(3), false);

  // Test DND registry scrub
  const dndDb = { dndRegistry: ['+919876543210', '9876543211'] };
  assert.equal(compliance.isDndRegistered(dndDb, '+919876543210'), true);
  assert.equal(compliance.isDndRegistered(dndDb, '+919899999999'), false);
});
