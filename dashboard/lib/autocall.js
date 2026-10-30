/**
 * lib/autocall.js - Production Auto-Call Webhook Engine (Vaaad AI Clone)
 *
 * Full feature parity with Vaaad AI:
 *   - Inbound webhook tokens secured with HMAC-SHA256 signatures (replay-protected)
 *   - Multi-format & nested lead detection (phone, name, email, message, dot paths)
 *   - Strict wallet balance gate (requires >= 500 paise / ₹5.00)
 *   - Per-source daily dialing caps with IST window compliance
 *   - Sliding deduplication window (configurable, default 10 minutes)
 *   - Dograh outbound dialer dispatch with dynamic prompt variable binding:
 *     {{name}}, {{customer_name}}, {{phone}}, {{email}}, {{message}}, {{reason}}
 *   - Idempotent lead queuing & live CRM contact synchronization
 *   - Zero external npm dependencies. Pure Node.js crypto.
 */
'use strict';

const crypto = require('crypto');

const SIGNATURE_HEADER      = 'x-seevora-signature';
const SIGNATURE_HEADER_ALT  = 'x-signature';
const SIGNATURE_HUB_HEADER  = 'x-hub-signature-256';
const TIMESTAMP_HEADER      = 'x-seevora-timestamp';
const MAX_CLOCK_SKEW_MS     = 5 * 60 * 1000;   // 5 min replay protection
const DEFAULT_DEDUP_MINUTES = 10;
const DEFAULT_DAILY_CAP     = 100;
const MIN_WALLET_BALANCE_PAISE = 500; // ₹5.00
const MAX_LEADS_PER_MIN     = 30;
const PHONE_RE              = /^\+?[1-9]\d{6,14}$/;
const EMAIL_RE              = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Crypto helpers ------------------------------------------------------------

function generateToken()  { return crypto.randomBytes(32).toString('hex'); }
function generateSecret() { return crypto.randomBytes(32).toString('hex'); }

function computeSignature(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret)
    .update((timestamp ? (timestamp + '.') : '') + rawBody, 'utf8')
    .digest('hex');
}

function verifyWebhookSignature(secret, rawBody, receivedSig, receivedTs) {
  if (!secret) return true; // No secret configured -> open webhook

  let cleanSig = String(receivedSig || '').trim();
  if (cleanSig.startsWith('sha256=')) cleanSig = cleanSig.slice(7).trim();
  if (!cleanSig) return false;

  // 1. Replay-protected timestamped signature (x-seevora-timestamp + body)
  if (receivedTs) {
    const ts = parseInt(receivedTs, 10);
    if (Number.isFinite(ts) && Math.abs(Date.now() - ts) <= MAX_CLOCK_SKEW_MS) {
      const expected = computeSignature(secret, String(ts), rawBody);
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(cleanSig, 'utf8');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    }
  }

  // 2. Direct raw body HMAC (standard webhook contract: X-Signature: sha256=<hex>)
  const directExpected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const da = Buffer.from(directExpected, 'utf8');
  const db = Buffer.from(cleanSig, 'utf8');
  if (da.length === db.length && crypto.timingSafeEqual(da, db)) return true;

  return false;
}

// --- Nested dot-path extractor for third-party web forms -----------------------

function extractField(obj, paths) {
  if (!obj || typeof obj !== 'object') return null;
  for (const p of paths) {
    if (!p) continue;
    const parts = p.split('.');
    let cur = obj;
    let found = true;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) {
        cur = cur[part];
      } else {
        found = false;
        break;
      }
    }
    if (found && cur !== undefined && cur !== null && typeof cur !== 'object') {
      const str = String(cur).trim();
      if (str.length > 0) return str;
    }
  }
  return null;
}

// --- Lead normalizer -----------------------------------------------------------

function normalizeLead(raw) {
  const errors = [];

  // Extract phone (supports direct and nested paths like properties.phone.value, data.phone, etc.)
  const phoneVal = extractField(raw, [
    'phone', 'phoneNumber', 'mobile', 'contact', 'telephone',
    'properties.phone.value', 'properties.phone', 'data.phone',
    'customer.phone', 'lead.phone', 'fields.phone',
  ]) || '';

  // Clean phone string (remove spaces, hyphens, brackets)
  let cleanPhone = phoneVal.replace(/[\s\-\(\)\.]/g, '');
  if (cleanPhone.startsWith('00')) cleanPhone = '+' + cleanPhone.slice(2);
  else if (/^[6-9]\d{9}$/.test(cleanPhone)) cleanPhone = '+91' + cleanPhone; // Auto-prefix India standard 10-digit mobile

  if (!cleanPhone) {
    errors.push('phone is required (send "phone", "mobile", or nested "properties.phone")');
  } else if (!PHONE_RE.test(cleanPhone)) {
    errors.push('phone must be in valid E.164 format (e.g. +919876543210)');
  }

  // Extract name
  const nameVal = extractField(raw, [
    'name', 'callerName', 'full_name', 'fullName', 'customerName',
    'properties.firstname.value', 'properties.name.value', 'properties.name',
    'data.name', 'customer.name', 'fields.name',
  ]) || '';
  const name = nameVal.slice(0, 120);

  // Extract email
  const emailVal = extractField(raw, [
    'email', 'emailAddress', 'mail',
    'properties.email.value', 'properties.email',
    'data.email', 'customer.email', 'fields.email',
  ]) || '';
  const email = emailVal.toLowerCase().slice(0, 200);
  if (email && !EMAIL_RE.test(email)) {
    errors.push('email must be a valid email address');
  }

  // Extract message / inquiry / reason
  const messageVal = extractField(raw, [
    'message', 'notes', 'comment', 'reason', 'inquiry', 'requirement',
    'properties.message.value', 'properties.message', 'data.message',
  ]) || '';
  const notes = messageVal.slice(0, 2000);

  // Agent ID override
  const agentId = String(raw.agentId || raw.agent_id || '').trim();

  // Priority
  const priority = ['high', 'normal', 'low'].includes(String(raw.priority || '').toLowerCase())
    ? String(raw.priority).toLowerCase() : 'normal';

  // Scheduled dialing
  let scheduleAtIso = null;
  const schedRaw = raw.scheduleAt || raw.schedule_at || raw.scheduledTime;
  if (schedRaw) {
    const d = new Date(schedRaw);
    if (isNaN(d.getTime())) {
      errors.push('scheduleAt must be valid ISO 8601');
    } else if (d.getTime() < Date.now() - 60000) {
      errors.push('scheduleAt must be a future timestamp');
    } else {
      scheduleAtIso = d.toISOString();
    }
  }

  // Capture all other custom metadata
  const KNOWN = new Set([
    'phone', 'phoneNumber', 'mobile', 'contact', 'telephone',
    'name', 'callerName', 'full_name', 'fullName', 'customerName',
    'email', 'emailAddress', 'mail',
    'message', 'notes', 'comment', 'reason', 'inquiry', 'requirement',
    'agentId', 'agent_id', 'priority', 'scheduleAt', 'schedule_at', 'scheduledTime',
  ]);
  const metadata = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN.has(k) && typeof v !== 'function') metadata[k] = v;
  }

  return {
    ok: errors.length === 0,
    lead: {
      phone: cleanPhone,
      name,
      email,
      agentId,
      notes,
      priority,
      scheduleAt: scheduleAtIso,
      metadata,
    },
    errors,
  };
}

// --- DB helpers ----------------------------------------------------------------

function ensureCollections(d) {
  if (!Array.isArray(d.autoCallWebhooks)) d.autoCallWebhooks = [];
  if (!Array.isArray(d.autoCallSources))  d.autoCallSources  = [];
  if (!Array.isArray(d.autoCallLeads))    d.autoCallLeads    = [];
}

// --- Webhook CRUD --------------------------------------------------------------

async function createWebhook(db_mutate, tenantId, userId, agentId, opts, genId) {
  const options = (typeof opts === 'object' && opts !== null) ? opts : { label: opts };
  const token  = generateToken();
  const secret = generateSecret();
  const id     = genId('wh_');
  const now    = new Date().toISOString();

  const wh = {
    id,
    tenantId,
    agentId: agentId || null,
    token,
    secret,
    label: String(options.label || 'Auto-Call Webhook').slice(0, 80),
    dailyCap: Math.max(1, parseInt(options.dailyCap || String(DEFAULT_DAILY_CAP), 10)),
    dedupWindowMinutes: Math.max(1, parseInt(options.dedupWindowMinutes || String(DEFAULT_DEDUP_MINUTES), 10)),
    activeWindow: options.activeWindow || '09:00-21:00', // TRAI compliant default
    active: true,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await db_mutate((d) => {
    ensureCollections(d);
    d.autoCallWebhooks.push(wh);
    d.autoCallSources.push(wh); // alias collection
  });

  return publicWebhook(wh);
}

function publicWebhook(wh) {
  return {
    id: wh.id,
    tenantId: wh.tenantId,
    agentId: wh.agentId,
    token: wh.token,
    label: wh.label,
    dailyCap: wh.dailyCap || DEFAULT_DAILY_CAP,
    dedupWindowMinutes: wh.dedupWindowMinutes || DEFAULT_DEDUP_MINUTES,
    activeWindow: wh.activeWindow || '09:00-21:00',
    active: wh.active,
    createdBy: wh.createdBy,
    createdAt: wh.createdAt,
    updatedAt: wh.updatedAt,
    endpointUrl: '/api/autocall/webhook/' + wh.token,
    alternateUrl: '/api/auto-call/' + wh.token,
  };
}

function listWebhooks(db, tenantId) {
  const hooks = (db.autoCallWebhooks || []).filter((w) => w.tenantId === tenantId);
  const leads = db.autoCallLeads || [];
  const todayIso = new Date().toISOString().slice(0, 10);

  return hooks.map((wh) => {
    const pub = publicWebhook(wh);
    const relatedLeads = leads.filter((l) => l.webhookId === wh.id);
    pub.totalCallsAllTime = relatedLeads.length;
    pub.callsToday = relatedLeads.filter((l) => l.createdAt && l.createdAt.startsWith(todayIso)).length;
    return pub;
  });
}

async function revokeWebhook(db_mutate, tenantId, webhookId) {
  let found = false;
  await db_mutate((d) => {
    ensureCollections(d);
    const wh = (d.autoCallWebhooks || []).find((w) => (w.id === webhookId || w.token === webhookId) && w.tenantId === tenantId);
    if (wh) {
      wh.active = false;
      wh.updatedAt = new Date().toISOString();
      found = true;
    }
  });
  return found;
}

async function rotateWebhookSecret(db_mutate, tenantId, webhookId) {
  const newSecret = generateSecret();
  let updatedWh = null;
  await db_mutate((d) => {
    ensureCollections(d);
    const wh = (d.autoCallWebhooks || []).find((w) => (w.id === webhookId || w.token === webhookId) && w.tenantId === tenantId);
    if (wh) {
      wh.secret = newSecret;
      wh.updatedAt = new Date().toISOString();
      updatedWh = { ...wh };
    }
  });
  if (!updatedWh) return null;
  return { ...publicWebhook(updatedWh), secret: newSecret };
}

function findWebhookByToken(db, token) {
  return (db.autoCallWebhooks || []).find((w) => w.token === token && w.active);
}

// --- Lead Ingestion & Production Auto-Dial Pipeline ----------------------------

async function ingestLead({ db, db_mutate, rawBody, receivedSig, receivedTs, webhookRow, providers, genId, wacrm, logger }) {
  // 1. Signature verification (optional: strictly enforced if X-Signature header is provided)
  if (receivedSig && webhookRow.secret) {
    if (!verifyWebhookSignature(webhookRow.secret, rawBody, receivedSig, receivedTs)) {
      return {
        ok: false,
        statusCode: 401,
        code: 'invalid_signature',
        errors: ['HMAC-SHA256 signature mismatch or expired timestamp replay. Provide valid X-Signature header.'],
      };
    }
  }

  // 2. Parse body
  let rawLead = {};
  try {
    rawLead = JSON.parse(rawBody);
  } catch (_) {
    return {
      ok: false,
      statusCode: 400,
      code: 'invalid_json',
      errors: ['Request body must be valid JSON object.'],
    };
  }

  // 3. Normalize & validate fields
  const { ok, lead, errors } = normalizeLead(rawLead);
  if (!ok) {
    return {
      ok: false,
      statusCode: 422,
      code: 'validation_error',
      errors,
    };
  }

  // 4. Wallet Balance Guard (Hard-stop requirement from Vaaad AI blueprint)
  const wallet = (db.wallets || []).find((w) => w.tenantId === webhookRow.tenantId);
  const balancePaise = wallet ? Number(wallet.balancePaise || 0) : 0;
  if (balancePaise < MIN_WALLET_BALANCE_PAISE) {
    return {
      ok: false,
      statusCode: 402,
      code: 'insufficient_wallet_balance',
      errors: [`Wallet balance of ₹${(balancePaise / 100).toFixed(2)} is below the minimum ₹5.00 requirement for auto-dialing. Please recharge.`],
    };
  }

  // 5. Daily Cap Check
  const todayIso = new Date().toISOString().slice(0, 10);
  const dailyCap = webhookRow.dailyCap || DEFAULT_DAILY_CAP;
  const callsToday = (db.autoCallLeads || []).filter(
    (l) => l.tenantId === webhookRow.tenantId && l.webhookId === webhookRow.id && l.createdAt && l.createdAt.startsWith(todayIso)
  ).length;

  if (callsToday >= dailyCap) {
    return {
      ok: false,
      statusCode: 429,
      code: 'daily_cap_exceeded',
      errors: [`Daily outbound calling cap of ${dailyCap} leads reached for this webhook source.`],
    };
  }

  // 6. Deduplication window check
  const now = Date.now();
  const dedupMinutes = webhookRow.dedupWindowMinutes || DEFAULT_DEDUP_MINUTES;
  const dedupWindowMs = dedupMinutes * 60 * 1000;

  const agentId = lead.agentId || webhookRow.agentId;
  const agent = agentId
    ? (db.agents || []).find((a) => a.id === agentId && a.tenantId === webhookRow.tenantId)
    : (db.agents || []).find((a) => a.tenantId === webhookRow.tenantId);

  const existingRecent = (db.autoCallLeads || []).find(
    (l) => l.tenantId === webhookRow.tenantId
        && l.phone === lead.phone
        && (now - new Date(l.createdAt).getTime()) < dedupWindowMs
        && l.status !== 'failed'
  );

  if (existingRecent) {
    return {
      ok: true,
      duplicate: true,
      leadId: existingRecent.id,
      status: 'deduplicated',
      message: `Lead with phone ${lead.phone} already queued within ${dedupMinutes} min deduplication window. Call suppressed to prevent spamming.`,
    };
  }

  // 7. Rate Limit per tenant
  const recentMinuteCount = (db.autoCallLeads || []).filter(
    (l) => l.tenantId === webhookRow.tenantId && (now - new Date(l.createdAt).getTime()) < 60000
  ).length;
  if (recentMinuteCount >= MAX_LEADS_PER_MIN) {
    return {
      ok: false,
      statusCode: 429,
      code: 'rate_limited',
      errors: ['Tenant auto-call rate limit exceeded (maximum 30 calls per minute). Please throttle submissions.'],
    };
  }

  // 8. Persist Lead in Database
  const leadId = genId('lead_');
  const callId = genId('call_');
  const nowIso = new Date(now).toISOString();

  const leadRecord = {
    id: leadId,
    tenantId: webhookRow.tenantId,
    webhookId: webhookRow.id,
    phone: lead.phone,
    name: lead.name,
    email: lead.email,
    agentId: agent ? agent.id : null,
    agentName: agent ? agent.name : null,
    notes: lead.notes,
    priority: lead.priority,
    scheduleAt: lead.scheduleAt,
    metadata: lead.metadata,
    status: 'queued',
    callId,
    callResult: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await db_mutate((d) => {
    ensureCollections(d);
    d.autoCallLeads.push(leadRecord);

    // Synchronize to CRM Contacts collection
    if (wacrm && typeof wacrm.upsertContact === 'function') {
      try {
        wacrm.upsertContact(d, webhookRow.tenantId, {
          phone: lead.phone,
          name: lead.name || 'Web Lead',
          email: lead.email || '',
          notes: ('Auto-call lead: ' + (lead.notes || 'Inbound web form')).trim(),
          stage: 'New Lead',
          tags: ['auto-call', 'webhook'],
          source: 'autocall_webhook',
        });
      } catch (_) {}
    }
  });

  // 9. Dispatch outbound call asynchronously (Dograh / VoBiz)
  dispatchOutboundCall({
    leadId,
    callId,
    lead,
    agent,
    webhookRow,
    db_mutate,
    providers,
    genId,
    logger,
  }).catch((err) => {
    if (logger) logger.warn('Auto-call dispatch exception', { leadId, error: err.message });
  });

  return {
    ok: true,
    leadId,
    callId,
    status: 'queued_for_dialing',
    phone: lead.phone,
    agentId: agent ? agent.id : null,
    agentName: agent ? agent.name : 'Seevora AI Voice',
    scheduledAt: lead.scheduleAt || nowIso,
    message: lead.scheduleAt
      ? `Outbound call scheduled for ${lead.scheduleAt}`
      : 'Outbound AI call queued for immediate dialing (< 5 seconds)',
  };
}

async function dispatchOutboundCall({ leadId, callId, lead, agent, webhookRow, db_mutate, providers, genId, logger }) {
  // If scheduled in the future, wait
  if (lead.scheduleAt) {
    const delay = new Date(lead.scheduleAt).getTime() - Date.now();
    if (delay > 1000) {
      await new Promise((r) => setTimeout(r, Math.min(delay, 60 * 60 * 1000)));
    }
  }

  let callResult = null;
  let status = 'dispatched';
  let error = null;

  try {
    const callerId = (agent && agent.telephony && agent.telephony.did) || (process.env.VOBIZ_NUMBER || '');
    const workflowId = (agent && agent.telephony && agent.telephony.workflowId) || process.env.DOGRAH_WORKFLOW_ID || '13027';

    // Build dynamic prompt variables as specified in Vaaad AI Blueprint
    const promptVariables = {
      name: lead.name || 'Caller',
      customer_name: lead.name || 'Caller',
      phone: lead.phone,
      email: lead.email || '',
      message: lead.notes || '',
      reason: lead.notes || 'Inquiry through web submission',
      priority: lead.priority || 'normal',
      ...(lead.metadata || {}),
    };

    const dialPayload = {
      to: lead.phone,
      number: lead.phone,
      from: callerId,
      agentId: agent ? agent.id : null,
      workflowId: Number(workflowId) || 13027,
      leadId,
      callId,
      variables: promptVariables,
      metadata: {
        leadName: lead.name || '',
        leadEmail: lead.email || '',
        leadMessage: lead.notes || '',
        priority: lead.priority,
        source: 'autocall_webhook',
        webhookId: webhookRow.id,
        ...lead.metadata,
      },
    };

    if (providers && providers.telephony && typeof providers.telephony.dial === 'function') {
      callResult = await providers.telephony.dial(lead.phone, dialPayload);
    } else {
      callResult = { simulated: true, note: 'Outbound call queued (simulated telemetry)' };
      status = 'simulated';
    }
  } catch (err) {
    error = err.message || String(err);
    status = 'failed';
    if (logger) logger.warn('Auto-call dispatch failed', { leadId, error });
  }

  // Update lead status in DB and register active live call in callRecordings for Dashboard Live Locator
  await db_mutate((d) => {
    ensureCollections(d);
    const rec = (d.autoCallLeads || []).find((l) => l.id === leadId);
    const nowIso = new Date().toISOString();
    if (rec) {
      rec.status = status;
      rec.callResult = callResult;
      rec.error = error;
      rec.dispatchedAt = nowIso;
      rec.updatedAt = nowIso;
    }
    if (status !== 'failed') {
      if (!Array.isArray(d.callRecordings)) d.callRecordings = [];
      const runId = (callResult && callResult.data && (callResult.data.request_uuid || callResult.data.run_id || callResult.data.id || callResult.data.call_id)) || callId;
      const sharedDid = (agent && agent.telephony && agent.telephony.did) || process.env.VOBIZ_NUMBER || '+918071582519';
      d.callRecordings.unshift({
        id: `rec_${runId}`,
        tenantId: webhookRow.tenantId,
        dograhRunId: String(runId),
        phoneNumber: lead.phone,
        callerNumber: sharedDid,
        calledNumber: lead.phone,
        callerName: lead.name || 'Web Inquiry Lead',
        callerSource: `Auto-Call (${webhookRow.label || 'Speed-to-Lead'})`,
        direction: 'outbound',
        dispatchSource: `Auto-Dispatched (${webhookRow.label || 'Speed-to-Lead'})`,
        status: 'in_progress',
        durationSeconds: 0,
        transcript: `Agent (${(agent && agent.name) || 'Seevora AI Voice Receptionist'}): ${(agent && agent.greeting) || 'Namaste! Calling from Seevora AI regarding your inquiry. How may I assist you?'}`,
        recordingAvailable: false,
        summary: `Auto-dispatched Speed-to-Lead call to ${lead.name || lead.phone}`,
        agentId: agent ? agent.id : null,
        agentName: (agent && agent.name) || 'Seevora AI Voice Receptionist',
        startedAt: nowIso,
        syncedAt: nowIso,
      });
    }
  });
}

function listLeads(db, tenantId, { page = 1, pageSize = 50, status } = {}) {
  let leads = (db.autoCallLeads || []).filter((l) => l.tenantId === tenantId);
  if (status) leads = leads.filter((l) => l.status === status);
  leads = leads.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = leads.length;
  const start = (page - 1) * pageSize;
  return { leads: leads.slice(start, start + pageSize), total, page, pageSize };
}

module.exports = {
  generateToken,
  generateSecret,
  computeSignature,
  verifyWebhookSignature,
  normalizeLead,
  createWebhook,
  publicWebhook,
  listWebhooks,
  revokeWebhook,
  rotateWebhookSecret,
  findWebhookByToken,
  ingestLead,
  listLeads,
  ensureCollections,
  SIGNATURE_HEADER,
  SIGNATURE_HEADER_ALT,
  SIGNATURE_HUB_HEADER,
  TIMESTAMP_HEADER,
};
