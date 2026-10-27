const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

// Change working directory to dashboard directory so core resolves data/ correctly
process.chdir(path.join(__dirname, '..'));

const core = require('../lib/core');
const developer = require('../lib/developer');
const languages = require('../lib/languages');
const analytics = require('../lib/analytics');

test('End-to-end API Keys & Bearer Token Authentication Lifecycle', async () => {
  const d = core.db();
  const tenant = d.tenants[0] || { id: 'tenant_demo', status: 'active', name: 'Demo Workspace' };
  
  // 1. Issue an API key for the tenant
  let createRes;
  await core.mutate((mutDb) => {
    createRes = developer.createApiKey(mutDb, tenant.id, {
      name: 'Vaaad Integration Test Key',
      permissions: ['*']
    });
  });

  assert.equal(createRes.ok, true);
  assert.ok(createRes.rawKey.startsWith('vaad_live_'));
  const rawKey = createRes.rawKey;

  // 2. Authenticate mock request via Bearer token
  const mockReq = {
    headers: {
      'authorization': 'Bearer ' + rawKey,
      'host': 'localhost:8787'
    },
    url: '/api/analytics'
  };

  const sessionCtx = await core.getSession(mockReq);
  assert.ok(sessionCtx, 'Session context should be resolved from Bearer API token');
  assert.equal(sessionCtx.tenant.id, tenant.id);
  assert.equal(sessionCtx.isApiKey, true);

  // 3. Outbound Webhook Lifecycle
  let hookRes;
  await core.mutate((mutDb) => {
    hookRes = developer.createOutboundWebhook(mutDb, tenant.id, {
      targetUrl: 'https://webhook.site/test-vaaad',
      events: ['call.completed']
    });
  });
  assert.equal(hookRes.ok, true);
  assert.equal(hookRes.webhook.tenantId, tenant.id);

  const hooks = developer.listOutboundWebhooks(core.db(), tenant.id);
  assert.ok(hooks.some(h => h.id === hookRes.webhook.id));

  // 4. Analytics Computation
  const stats = analytics.getTenantAnalytics(core.db(), tenant.id);
  assert.ok('asrPercent' in stats);
  assert.ok('acdSeconds' in stats);
  assert.ok('conversionRate' in stats);
  assert.ok('sentiment' in stats);

  // 5. Clean up API key and webhook
  await core.mutate((mutDb) => {
    developer.revokeApiKey(mutDb, tenant.id, createRes.apiKey.id);
    developer.deleteOutboundWebhook(mutDb, tenant.id, hookRes.webhook.id);
  });

  const postRevokeCtx = await core.getSession(mockReq);
  assert.equal(postRevokeCtx, null, 'Revoked API key must no longer authenticate');
});
