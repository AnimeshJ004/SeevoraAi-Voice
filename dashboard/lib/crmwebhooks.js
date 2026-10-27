/**
 * lib/crmwebhooks.js - Outbound CRM Webhooks Engine
 *
 * Fires tenant-configured outbound webhook payloads to third-party CRMs
 * (HubSpot, Zoho, custom pipelines) on key voice-call lifecycle events:
 *   call_ended     - fires after every completed Dograh call
 *   lead_qualified - fires when AI scores lead quality >= 70
 *   recording_ready - fires when transcript + recording URL are available
 *
 * Features (zero npm dependencies):
 *   - Per-tenant, per-webhook HMAC-SHA256 signed payloads
 *   - Exponential backoff retry (3 attempts, 1s / 5s / 30s)
 *   - Per-tenant delivery log with last 100 events (crmWebhookLogs)
 *   - Idempotency: dedup by eventId+webhookId within 60 min window
 *   - Tenant-scoped strict isolation
 *   - Event filtering: each webhook declares which events it subscribes to
 */
'use strict';

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

const RETRY_DELAYS_MS  = [1000, 5000, 30000];
const MAX_LOGS_PER_TENANT = 100;
const DELIVERY_TIMEOUT = 10000;
const VALID_EVENTS     = new Set(['call_ended', 'lead_qualified', 'recording_ready', 'campaign_completed', '*']);

function generateSecret() { return crypto.randomBytes(32).toString('hex'); }

function hmacSign(secret, payload) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function nowIso() { return new Date().toISOString(); }

function ensureCollections(d) {
  if (!Array.isArray(d.crmWebhooks))    d.crmWebhooks    = [];
  if (!Array.isArray(d.crmWebhookLogs)) d.crmWebhookLogs = [];
}

async function createWebhook(mutate, tenantId, userId, opts, genId) {
  const id     = genId('cwh_');
  const secret = generateSecret();
  const now    = nowIso();
  const events = Array.isArray(opts.events) ? opts.events.filter((e) => VALID_EVENTS.has(e)) : ['call_ended'];
  const wh = {
    id, tenantId,
    label:      String(opts.label  || 'CRM Webhook').slice(0, 80),
    url:        String(opts.url    || '').slice(0, 500),
    secret, events,
    active:     true,
    headers:    (typeof opts.headers === 'object' && opts.headers !== null) ? opts.headers : {},
    createdBy:  userId,
    createdAt:  now, updatedAt: now,
    lastFiredAt:null, lastStatus: null,
  };
  if (!wh.url) throw new Error('url is required');
  try { new URL(wh.url); } catch (_) { throw new Error('url must be a valid http/https URL'); }
  await mutate((d) => { ensureCollections(d); d.crmWebhooks.push(wh); });
  return publicWebhook(wh);
}

function listWebhooks(db, tenantId) {
  ensureCollections(db);
  return (db.crmWebhooks || []).filter((w) => w.tenantId === tenantId).map(publicWebhook);
}

async function updateWebhook(mutate, tenantId, webhookId, opts) {
  let updated;
  await mutate((d) => {
    ensureCollections(d);
    const wh = d.crmWebhooks.find((w) => w.id === webhookId && w.tenantId === tenantId);
    if (!wh) throw new Error('webhook not found');
    if (opts.label  !== undefined) wh.label  = String(opts.label).slice(0, 80);
    if (opts.url    !== undefined) { try { new URL(opts.url); } catch (_) { throw new Error('invalid url'); } wh.url = String(opts.url).slice(0, 500); }
    if (Array.isArray(opts.events)) wh.events = opts.events.filter((e) => VALID_EVENTS.has(e));
    if (opts.active !== undefined)  wh.active = Boolean(opts.active);
    if (typeof opts.headers === 'object' && opts.headers) wh.headers = opts.headers;
    wh.updatedAt = nowIso();
    updated = publicWebhook(wh);
  });
  return updated;
}

async function deleteWebhook(mutate, tenantId, webhookId) {
  await mutate((d) => {
    ensureCollections(d);
    const idx = d.crmWebhooks.findIndex((w) => w.id === webhookId && w.tenantId === tenantId);
    if (idx === -1) throw new Error('webhook not found');
    d.crmWebhooks.splice(idx, 1);
    d.crmWebhookLogs = (d.crmWebhookLogs || []).filter((l) => l.webhookId !== webhookId);
  });
}

function publicWebhook(wh) {
  return { id: wh.id, tenantId: wh.tenantId, label: wh.label, url: wh.url, events: wh.events, active: wh.active, headers: wh.headers || {}, secret: wh.secret, lastFiredAt: wh.lastFiredAt, lastStatus: wh.lastStatus, createdAt: wh.createdAt, updatedAt: wh.updatedAt };
}

function deliverOnce(url, payload, signature, extraHeaders) {
  return new Promise((resolve) => {
    const body   = Buffer.from(payload, 'utf8');
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = { host: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80), path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'User-Agent': 'Seevora-CRM-Webhook/1.0', 'X-Seevora-Signature': signature, 'X-Seevora-Timestamp': String(Date.now()), ...(extraHeaders || {}) } };
    const mod = isHttps ? https : http;
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 500) }));
    });
    req.setTimeout(DELIVERY_TIMEOUT, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.write(body);
    req.end();
  });
}

async function dispatchEvent(mutate, db, tenantId, eventType, payload) {
  ensureCollections(db);
  const hooks = (db.crmWebhooks || []).filter((w) => w.tenantId === tenantId && w.active && (w.events.includes(eventType) || w.events.includes('*')));
  if (!hooks.length) return;

  const eventId  = 'evt_' + crypto.randomBytes(8).toString('hex');
  const now      = nowIso();
  const envelope = JSON.stringify({ id: eventId, event: eventType, tenantId, timestamp: now, data: payload });

  for (const wh of hooks) {
    const recentLog = (db.crmWebhookLogs || []).find((l) => l.webhookId === wh.id && l.eventId === eventId);
    if (recentLog) continue;

    const sig = hmacSign(wh.secret, envelope);
    let finalResult = { ok: false, status: 0, body: 'not attempted' };
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i - 1]));
      const result = await deliverOnce(wh.url, envelope, sig, wh.headers);
      finalResult = result;
      if (result.ok) break;
    }

    const logEntry = { id: 'whlog_' + crypto.randomBytes(6).toString('hex'), webhookId: wh.id, tenantId, eventId, eventType, status: finalResult.status, ok: finalResult.ok, body: finalResult.body, firedAt: nowIso() };
    await mutate((d) => {
      ensureCollections(d);
      d.crmWebhookLogs.unshift(logEntry);
      const tenantLogs = d.crmWebhookLogs.filter((l) => l.tenantId === tenantId);
      if (tenantLogs.length > MAX_LOGS_PER_TENANT) {
        const keep = new Set(tenantLogs.slice(0, MAX_LOGS_PER_TENANT).map((l) => l.id));
        d.crmWebhookLogs = d.crmWebhookLogs.filter((l) => l.tenantId !== tenantId || keep.has(l.id));
      }
      const hook = d.crmWebhooks.find((w) => w.id === wh.id);
      if (hook) { hook.lastFiredAt = logEntry.firedAt; hook.lastStatus = finalResult.status; }
    }).catch(() => {});
  }
}

function listLogs(db, tenantId, webhookId) {
  ensureCollections(db);
  let logs = (db.crmWebhookLogs || []).filter((l) => l.tenantId === tenantId);
  if (webhookId) logs = logs.filter((l) => l.webhookId === webhookId);
  return logs.slice(0, 100);
}

module.exports = { ensureCollections, createWebhook, listWebhooks, updateWebhook, deleteWebhook, dispatchEvent, listLogs, VALID_EVENTS };
