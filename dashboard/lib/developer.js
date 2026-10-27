/**
 * lib/developer.js - Vaaad AI Developer API Keys & Outbound CRM Webhooks Engine
 *
 * Implements:
 *   - Bearer token API keys (vaad_live_...) with SHA-256 secure hashing
 *   - Key prefix masking (vaad_live_xxxx...) and permission scopes
 *   - Real-time outbound webhook dispatching for call.completed, booking.created
 *   - HMAC-SHA256 signature generation and verification headers
 *   - Automated webhook retry queue with exponential backoff (1m, 5m, 30m)
 *
 * Zero external npm dependencies. Pure Node crypto & https/http.
 */
'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

function genId(prefix) {
  return (prefix || 'id_') + crypto.randomBytes(8).toString('hex');
}

// -----------------------------------------------------------------------------
// 1. API Keys Engine
// -----------------------------------------------------------------------------

function createApiKey(db, tenantId, { name, permissions } = {}) {
  if (!db.apiKeys) db.apiKeys = [];

  const rawToken = crypto.randomBytes(24).toString('hex');
  const rawKey = 'vaad_live_' + rawToken;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 14) + '...';

  const apiKey = {
    id: genId('ak_'),
    tenantId,
    name: String(name || 'Default API Key').trim().slice(0, 60),
    keyHash,
    keyPrefix,
    permissions: Array.isArray(permissions) && permissions.length ? permissions : ['*'],
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    status: 'active'
  };

  db.apiKeys.unshift(apiKey);

  return {
    ok: true,
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      permissions: apiKey.permissions,
      createdAt: apiKey.createdAt,
      status: apiKey.status
    },
    rawKey // Only returned once at creation time!
  };
}

function listApiKeys(db, tenantId) {
  return (db.apiKeys || [])
    .filter((k) => k.tenantId === tenantId)
    .map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      permissions: k.permissions,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      status: k.status
    }));
}

function revokeApiKey(db, tenantId, keyId) {
  const key = (db.apiKeys || []).find((k) => k.id === keyId && k.tenantId === tenantId);
  if (!key) return { ok: false, error: 'API key not found' };
  key.status = 'revoked';
  key.updatedAt = new Date().toISOString();
  return { ok: true, status: 'revoked' };
}

function authenticateApiKey(db, rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return { ok: false, error: 'Missing token' };
  const keyHash = crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
  const found = (db.apiKeys || []).find((k) => k.keyHash === keyHash && k.status === 'active');
  if (!found) return { ok: false, error: 'Invalid or revoked API key' };

  found.lastUsedAt = new Date().toISOString();
  return {
    ok: true,
    tenantId: found.tenantId,
    permissions: found.permissions
  };
}

// -----------------------------------------------------------------------------
// 2. Outbound CRM Webhook Engine
// -----------------------------------------------------------------------------

function createOutboundWebhook(db, tenantId, { targetUrl, events, secret } = {}) {
  if (!db.outboundWebhooks) db.outboundWebhooks = [];

  const url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'targetUrl must be a valid http or https URL' };
  }

  const hookSecret = (secret && String(secret).trim().length >= 16)
    ? String(secret).trim()
    : crypto.randomBytes(32).toString('hex');

  const webhook = {
    id: genId('owh_'),
    tenantId,
    targetUrl: url,
    secret: hookSecret,
    events: Array.isArray(events) && events.length ? events : ['call.completed'],
    status: 'active',
    failureCount: 0,
    lastDeliveredAt: null,
    createdAt: new Date().toISOString()
  };

  db.outboundWebhooks.unshift(webhook);

  return { ok: true, webhook };
}

function listOutboundWebhooks(db, tenantId) {
  return (db.outboundWebhooks || [])
    .filter((w) => w.tenantId === tenantId)
    .map((w) => ({
      id: w.id,
      targetUrl: w.targetUrl,
      events: w.events,
      status: w.status,
      failureCount: w.failureCount,
      lastDeliveredAt: w.lastDeliveredAt,
      createdAt: w.createdAt
    }));
}

function deleteOutboundWebhook(db, tenantId, webhookId) {
  const beforeLen = (db.outboundWebhooks || []).length;
  db.outboundWebhooks = (db.outboundWebhooks || []).filter(
    (w) => !(w.id === webhookId && w.tenantId === tenantId)
  );
  return { ok: (db.outboundWebhooks.length < beforeLen) };
}

function signWebhookPayload(secret, event, data) {
  const ts = new Date().toISOString();
  const rawBody = JSON.stringify({ event, timestamp: ts, data });
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return { event, timestamp: ts, rawBody, signature };
}

function verifyWebhookSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSig));
}

async function deliverWebhookHttp(targetUrl, signatureHeader, eventName, rawBody) {
  return new Promise((resolve) => {
    try {
      const u = new URL(targetUrl);
      const isHttps = u.protocol === 'https:';
      const transport = isHttps ? https : http;
      const opts = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody),
          'X-Vaaad-Signature': signatureHeader,
          'X-Vaaad-Event': eventName,
          'User-Agent': 'Vaaad-AI-Webhook-Dispatcher/2.1.0'
        },
        timeout: 8000
      };

      const req = transport.request(opts, (res) => {
        let respData = '';
        res.on('data', (c) => { respData += c; });
        res.on('end', () => {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: respData.slice(0, 500) });
        });
      });

      req.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Webhook delivery timed out after 8000ms' });
      });

      req.write(rawBody);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

async function dispatchOutboundWebhook(db, tenantId, event, data) {
  if (!db.webhookDeliveries) db.webhookDeliveries = [];
  if (!db.webhookRetries) db.webhookRetries = [];

  const matchingHooks = (db.outboundWebhooks || []).filter(
    (w) => w.tenantId === tenantId && w.status === 'active' && (w.events.includes(event) || w.events.includes('*'))
  );

  const results = [];
  for (const hook of matchingHooks) {
    const { rawBody, signature } = signWebhookPayload(hook.secret, event, data);
    const delivery = await deliverWebhookHttp(hook.targetUrl, signature, event, rawBody);

    const logEntry = {
      id: genId('dlv_'),
      webhookId: hook.id,
      tenantId,
      event,
      timestamp: new Date().toISOString(),
      ok: delivery.ok,
      statusCode: delivery.statusCode || null,
      error: delivery.error || null
    };
    db.webhookDeliveries.unshift(logEntry);
    if (db.webhookDeliveries.length > 500) db.webhookDeliveries.length = 500;

    if (delivery.ok) {
      hook.failureCount = 0;
      hook.lastDeliveredAt = new Date().toISOString();
    } else {
      hook.failureCount = (hook.failureCount || 0) + 1;
      // Schedule exponential retry (retry 1 at +60s, retry 2 at +300s, retry 3 at +1800s)
      const nextDelaySec = hook.failureCount === 1 ? 60 : (hook.failureCount === 2 ? 300 : 1800);
      if (hook.failureCount <= 3) {
        db.webhookRetries.push({
          id: genId('ret_'),
          webhookId: hook.id,
          targetUrl: hook.targetUrl,
          secret: hook.secret,
          event,
          rawBody,
          signature,
          retryCount: hook.failureCount,
          nextAttemptAt: new Date(Date.now() + nextDelaySec * 1000).toISOString()
        });
      }
    }
    results.push({ hookId: hook.id, ok: delivery.ok });
  }

  return results;
}

module.exports = {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  authenticateApiKey,
  createOutboundWebhook,
  listOutboundWebhooks,
  deleteOutboundWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
  deliverWebhookHttp,
  dispatchOutboundWebhook
};
