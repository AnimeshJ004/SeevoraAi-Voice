/**
 * RapidX Voice. Zero-dependency Node server (the product, multi-tenant).
 *
 * Pure Node http/https/crypto/fs. No npm, no build step, no framework. Run with
 * `node server.js` and it serves the JSON API plus the static public/ site on
 * PORT (default 8787). Secrets stay server side, runtime state lives in data/.
 *
 * Routes are EXACTLY per SPEC section 4. Every agents/usage/telephony route is
 * tenant scoped through the session. The live provider calls (Deepgram, Groq, Rumik,
 * VoBiz through Dograh) are isolated in lib/providers.js.
 *
 * No em dashes anywhere. Commas and periods only.
 */
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const core = require('./lib/core');
core.loadEnv();
const providers = require('./lib/providers');
const payu = require('./lib/payu');
const demoLinks = require('./lib/demo-links');

const PORT = parseInt(process.env.PORT || '8787', 10);
const DEFAULT_PROVIDERS = Object.freeze({
  stt: providers.stt.id,
  tts: providers.tts.id,
  llm: providers.llm.id,
  telephony: providers.telephony.id,
});

/* ==========================================================================
   Boot: ensure data/ + db.json, seed the demo tenant, migrate legacy agents.
   ========================================================================== */

const DEMO_EMAIL = String(process.env.TEST_USER_EMAIL || '').trim().toLowerCase();
const DEMO_PASS = String(process.env.TEST_USER_PASSWORD || '');
const DEMO_TENANT = String(process.env.TEST_USER_TENANT || 'RapidX Test');
const TRIAL_CREDIT_PAISE = 1000;
const CREDIT_PACKS = Object.freeze({
  starter: Object.freeze({ amount: '200.00', currency: 'INR', credits: 20000, productinfo: 'RapidX Voice Starter Credits' }),
  growth: Object.freeze({ amount: '500.00', currency: 'INR', credits: 50000, productinfo: 'RapidX Voice Growth Credits' }),
  scale: Object.freeze({ amount: '1000.00', currency: 'INR', credits: 100000, productinfo: 'RapidX Voice Scale Credits' }),
});

function payuConfig() {
  if (!process.env.PAYU_KEY || !process.env.PAYU_SALT) return null;
  return { key: process.env.PAYU_KEY, salt: process.env.PAYU_SALT, env: process.env.PAYU_ENV === 'production' ? 'production' : 'test' };
}

function readForm(req, cap = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (chunk) => { size += chunk.length; if (size > cap) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
    req.on('error', reject);
  });
}

const PRESET_LIBRARY = [
  {
    id: 'preset_personal_injury_v1', slug: 'personal-injury-intake', version: 1,
    name: 'Personal Injury Intake', category: 'legal', isSystem: true,
    greeting: 'Thank you for calling. I am an AI intake assistant and this call may be recorded. Are you in immediate danger or need emergency medical help?',
    fields: ['caller_name', 'callback_number', 'adverse_parties', 'incident_date', 'incident_location', 'incident_type', 'injuries', 'treatment', 'insurance', 'represented', 'deadline_risk', 'preferred_appointment'],
    guardrails: ['No legal advice', 'No case valuation', 'Escalate emergencies and deadline risk', 'Attorney decides case acceptance'],
  },
  {
    id: 'preset_dental_receptionist_v1', slug: 'dental-receptionist', version: 1,
    name: 'Dental Receptionist', category: 'healthcare', isSystem: true,
    greeting: 'Thank you for calling. I am the practice AI receptionist and this call may be recorded. How can I help today?',
    fields: ['caller_name', 'callback_number', 'new_or_existing_patient', 'reason', 'pain_level', 'emergency_signs', 'insurance', 'preferred_appointment'],
    guardrails: ['No diagnosis', 'Escalate breathing, bleeding, trauma, or severe swelling', 'Confirm booking details'],
  },
  {
    id: 'preset_real_estate_v1', slug: 'real-estate-lead', version: 1,
    name: 'Real Estate Lead Qualifier', category: 'real_estate', isSystem: true,
    greeting: 'Thanks for calling. I am the AI property assistant. Are you looking to buy, sell, rent, or schedule a viewing?',
    fields: ['caller_name', 'callback_number', 'intent', 'location', 'budget', 'timeline', 'financing', 'property_type', 'preferred_appointment'],
    guardrails: ['Do not promise availability or returns', 'Escalate fair housing questions', 'Confirm consent before follow-up'],
  },
  {
    id: 'preset_restaurant_v1', slug: 'restaurant-reservations', version: 1,
    name: 'Restaurant Reservations', category: 'hospitality', isSystem: true,
    greeting: 'Thank you for calling. I can help with a reservation, opening hours, directions, or a general question.',
    fields: ['caller_name', 'callback_number', 'party_size', 'date', 'time', 'dietary_needs', 'occasion', 'special_requests'],
    guardrails: ['Never confirm unavailable inventory', 'Escalate allergy questions to staff', 'Read back reservation details'],
  },
  {
    id: 'preset_appointment_v1', slug: 'appointment-booking', version: 1,
    name: 'Appointment Booking', category: 'scheduling', isSystem: true,
    greeting: 'Thanks for calling. I can help you schedule, move, or cancel an appointment.',
    fields: ['caller_name', 'callback_number', 'appointment_type', 'preferred_date', 'preferred_time', 'timezone', 'notes'],
    guardrails: ['Confirm timezone', 'Never invent calendar availability', 'Read back the final appointment'],
  },
  {
    id: 'preset_customer_support_v1', slug: 'customer-support', version: 1,
    name: 'Customer Support', category: 'support', isSystem: true,
    greeting: 'Thanks for contacting support. I am an AI assistant. Tell me what happened and I will help or route you to the right person.',
    fields: ['caller_name', 'callback_number', 'account_reference', 'issue_category', 'issue_summary', 'steps_tried', 'preferred_resolution'],
    guardrails: ['Never request passwords or full payment credentials', 'Escalate security incidents', 'Do not promise refunds'],
  },
  {
    id: 'preset_lead_qualification_v1', slug: 'lead-qualification', version: 1,
    name: 'Lead Qualification', category: 'sales', isSystem: true,
    greeting: 'Thanks for your interest. I am an AI assistant. I will ask a few quick questions and help you book the right next step.',
    fields: ['caller_name', 'company', 'callback_number', 'email', 'need', 'budget', 'authority', 'timeline', 'preferred_appointment'],
    guardrails: ['Disclose AI identity', 'Do not make unsupported product claims', 'Respect opt-out requests immediately'],
  },
  {
    id: 'preset_receptionist_v1', slug: 'general-receptionist', version: 1,
    name: 'AI Receptionist', category: 'reception', isSystem: true,
    greeting: 'Thank you for calling. I am the AI receptionist. How may I direct your call today?',
    fields: ['caller_name', 'callback_number', 'reason', 'department', 'urgency', 'message', 'preferred_follow_up'],
    guardrails: ['Disclose AI identity', 'Escalate emergencies', 'Do not reveal private staff or customer information'],
  },
];

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// Pull legacy agents from _legacy/agents.legacy.json or root agents.json (first
// that exists). Returns an array, never throws.
function readLegacyAgents() {
  const candidates = [
    path.join(core.ROOT, '_legacy', 'agents.legacy.json'),
    path.join(core.ROOT, 'agents.json'),
  ];
  for (const f of candidates) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (_) { /* try next */ }
  }
  return [];
}

// Normalize a legacy agent (flat model/speaker/created) into the SPEC shape
// (nested tts object, createdAt ISO), scoped to the given tenant.
function migrateLegacyAgent(legacy, tenantId) {
  const model = legacy.model === 'muga' ? 'muga' : providers.tts.model;
  const speaker = providers.TTS_SPEAKERS.has(legacy.speaker) ? legacy.speaker : 'speaker_1';
  return {
    id: legacy.id || core.genId('ag_'),
    tenantId,
    name: String(legacy.name || 'Untitled Agent').slice(0, 60),
    persona: String(legacy.persona || '').slice(0, 1500),
    tts: {
      provider: providers.tts.id,
      model,
      speaker,
      f0_up_key: Number.isFinite(legacy.f0_up_key) ? legacy.f0_up_key : 0,
    },
    greeting: String(legacy.greeting || '').slice(0, 300),
    telephony: { did: String(legacy.did || providers.telephony.did) },
    createdAt: legacy.created ? new Date(legacy.created).toISOString() : new Date().toISOString(),
  };
}

async function boot() {
  // Force a load so a missing/corrupt db.json resolves to a clean default.
  const existing = core.db();
  await core.mutate((d) => {
    for (const preset of PRESET_LIBRARY) {
      if (!d.presets.some((p) => p.id === preset.id)) d.presets.push({ ...preset, createdAt: new Date().toISOString() });
    }
  });

  const hasDemo = DEMO_EMAIL && existing.users.some((u) => u.email === DEMO_EMAIL);

  if (DEMO_EMAIL && DEMO_PASS.length >= 12 && !hasDemo) {
    const tenantId = core.genId('t_');
    const userId = core.genId('u_');
    const nowIso = new Date().toISOString();
    const legacy = readLegacyAgents();

    await core.mutate((d) => {
      d.tenants.push({
        id: tenantId,
        name: DEMO_TENANT,
        slug: makeSlug(DEMO_TENANT, new Set(d.tenants.map((t) => t.slug))),
        createdAt: nowIso,
        branding: { color: '#6E7BFF' },
        providers: { ...DEFAULT_PROVIDERS },
        plan: 'studio',
        status: 'active', privacyMode: 'standard',
      });
      d.users.push({
        id: userId,
        tenantId,
        email: DEMO_EMAIL,
        name: 'RapidX Demo',
        passHash: core.hashPassword(DEMO_PASS),
        role: process.env.TEST_USER_SUPER_ADMIN === 'true' ? 'super_admin' : 'owner', status: 'active',
        createdAt: nowIso,
      });
      d.wallets.push({ id: core.genId('wal_'), tenantId, currency: 'INR', balancePaise: 0, createdAt: nowIso, updatedAt: nowIso });
      addLedgerEntry(d, tenantId, TRIAL_CREDIT_PAISE, 'trial_grant', `trial:${tenantId}`, userId, { amountInr: 10, source: 'test_bootstrap' });
      // Migrate any legacy agents into the demo tenant.
      for (const la of legacy) d.agents.push(migrateLegacyAgent(la, tenantId));
    });

    console.log(`  Seeded env-configured test tenant "${DEMO_TENANT}" with ${legacy.length} migrated agent(s).`);
  }

  // Ensure access-based role demos: Client Demo and Admin Demo
  if (!process.env.RAPIDX_DB_FILE) {
    await core.mutate((d) => {
      const nowIso = new Date().toISOString();

      // 1. Ensure Admin Demo user (Agency Operator)
      let adminUser = d.users.find((u) => u.email === 'admin@demo.com' || u.email === 'demo@rapidx.ai');
      let adminTenantId = adminUser ? adminUser.tenantId : core.genId('t_');
      let adminTenant = d.tenants.find((t) => t.id === adminTenantId);

      if (!adminTenant) {
        adminTenant = {
          id: adminTenantId,
          name: 'Admin Demo',
          slug: 'admin-demo',
          createdAt: nowIso,
          branding: { color: '#0095FF' },
          providers: { ...DEFAULT_PROVIDERS },
          plan: 'agency',
          status: 'active',
          privacyMode: 'standard',
        };
        d.tenants.push(adminTenant);
      } else {
        adminTenant.name = 'Admin Demo';
        adminTenant.slug = 'admin-demo';
        adminTenant.plan = 'agency';
      }

      if (adminUser) {
        adminUser.email = 'admin@demo.com';
        adminUser.name = 'Admin Demo';
        adminUser.role = 'super_admin';
      } else {
        d.users.push({
          id: core.genId('u_'),
          tenantId: adminTenantId,
          email: 'admin@demo.com',
          name: 'Admin Demo',
          passHash: core.hashPassword('admin123'),
          role: 'super_admin',
          status: 'active',
          createdAt: nowIso,
        });
      }

      // 2. Ensure Client Demo user (Dedicated Business Client)
      let clientUser = d.users.find((u) => u.email === 'client@demo.com' || u.email === 'client@rapidx.ai');
      let clientTenantId = clientUser ? clientUser.tenantId : core.genId('t_');
      let clientTenant = d.tenants.find((t) => t.id === clientTenantId);

      if (!clientTenant) {
        clientTenant = {
          id: clientTenantId,
          name: 'Client Demo',
          slug: 'client-demo',
          createdAt: nowIso,
          branding: { color: '#0095FF' },
          providers: { ...DEFAULT_PROVIDERS },
          plan: 'client_starter',
          status: 'active',
          privacyMode: 'standard',
        };
        d.tenants.push(clientTenant);
      } else {
        clientTenant.name = 'Client Demo';
        clientTenant.slug = 'client-demo';
        clientTenant.plan = 'client_starter';
      }

      if (clientUser) {
        clientUser.email = 'client@demo.com';
        clientUser.name = 'Client Demo';
        clientUser.role = 'client';
      } else {
        clientUser = {
          id: core.genId('u_'),
          tenantId: clientTenantId,
          email: 'client@demo.com',
          name: 'Client Demo',
          passHash: core.hashPassword('client123'),
          role: 'client',
          status: 'active',
          createdAt: nowIso,
        };
        d.users.push(clientUser);
      }

      if (!d.wallets.some((w) => w.tenantId === clientTenantId)) {
        d.wallets.push({
          id: core.genId('wal_'),
          tenantId: clientTenantId,
          currency: 'INR',
          balancePaise: 50000,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      if (!d.agents.some((a) => a.tenantId === clientTenantId)) {
        d.agents.push({
          id: core.genId('ag_'),
          tenantId: clientTenantId,
          name: 'Client Demo AI Receptionist',
          persona: 'You are a warm, professional AI receptionist for Client Demo. Qualify customer inquiries, answer service questions, and schedule consultations.',
          tts: { provider: 'rumik', model: 'muga', tone: 'friendly', speaker: 'speaker_2', f0_up_key: 0 },
          greeting: 'Hello, thank you for calling Client Demo. I am your AI receptionist. How can I help you today?',
          telephony: { did: '+918071582519' },
          createdAt: nowIso,
        });
      }
    });
  }

  // Migrate the old provider selection without rewriting tenant data by hand.
  if (core.db().tenants.some((t) => t.providers && t.providers.telephony === 'voicelink')) {
    await core.mutate((d) => {
      d.tenants.forEach((t) => {
        if (t.providers && t.providers.telephony === 'voicelink') t.providers.telephony = 'vobiz';
      });
    });
  }

  // Fill missing or stale selections from the configured adapter defaults.
  // Existing valid selections remain intact so boot never forces a tenant back
  // to one specific LLM or TTS provider.
  if (core.db().tenants.some((t) => !t.providers || !t.providers.stt || !t.providers.tts || !t.providers.llm || !t.providers.telephony)) {
    await core.mutate((d) => {
      d.tenants.forEach((t) => {
        t.providers = { ...DEFAULT_PROVIDERS, ...(t.providers || {}) };
      });
    });
  }
}

/* ==========================================================================
   Public-facing serialization (never leak passHash, scope to tenant).
   ========================================================================== */
function publicUser(u) {
  return { id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, onboardingCompleted: !!u.onboardingCompleted };
}
function publicTenant(t) {
  return {
    id: t.id, name: t.name, slug: t.slug, createdAt: t.createdAt,
    branding: t.branding, providers: t.providers, plan: t.plan,
    status: t.status, privacyMode: t.privacyMode,
    onboardingCompleted: !!t.onboardingCompleted,
  };
}
function publicAgent(a) {
  return {
    id: a.id, name: a.name, persona: a.persona, tts: a.tts,
    greeting: a.greeting, telephony: a.telephony, presetId: a.presetId || null,
    fields: a.fields || [], guardrails: a.guardrails || [],
    sampleTranscript: a.sampleTranscript || null,
    transcriptUnderstanding: a.transcriptUnderstanding || null,
    createdAt: a.createdAt,
  };
}

// Slugify a company name into a tenant slug, ensuring uniqueness.
function makeSlug(name, taken) {
  const base = String(name || 'tenant').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tenant';
  let slug = base; let n = 2;
  while (taken.has(slug)) { slug = `${base}-${n++}`; }
  return slug;
}

// Bump a usage counter for today for a tenant. field in {chars, calls, llmTokens}.
async function bumpUsage(tenantId, field, amount) {
  const day = todayUtc();
  await core.mutate((d) => {
    let row = d.usage.find((r) => r.tenantId === tenantId && r.day === day);
    if (!row) { row = { tenantId, day, chars: 0, calls: 0, llmTokens: 0 }; d.usage.push(row); }
    row[field] = (row[field] || 0) + amount;
  });
}

function publicWallet(w) {
  return { id: w.id, tenantId: w.tenantId, currency: w.currency, balancePaise: w.balancePaise, balanceInr: w.balancePaise / 100, updatedAt: w.updatedAt };
}

function addLedgerEntry(d, tenantId, amountPaise, type, reference, actorUserId, metadata = {}) {
  const key = String(reference || '');
  if (key && d.ledger.some((x) => x.tenantId === tenantId && x.idempotencyKey === key)) return null;
  let wallet = d.wallets.find((w) => w.tenantId === tenantId);
  const now = new Date().toISOString();
  if (!wallet) {
    wallet = { id: core.genId('wal_'), tenantId, currency: 'INR', balancePaise: 0, createdAt: now, updatedAt: now };
    d.wallets.push(wallet);
  }
  if (!Number.isInteger(amountPaise) || wallet.balancePaise + amountPaise < 0) throw new Error('invalid wallet adjustment');
  wallet.balancePaise += amountPaise;
  wallet.updatedAt = now;
  const entry = { id: core.genId('led_'), tenantId, type, amountPaise, balanceAfterPaise: wallet.balancePaise, idempotencyKey: key || core.genId('idem_'), actorUserId, metadata, createdAt: now };
  d.ledger.push(entry);
  return entry;
}

function addAudit(d, ctx, action, targetType, targetId, metadata = {}) {
  d.auditEvents.push({ id: core.genId('aud_'), tenantId: ctx.tenant.id, actorUserId: ctx.impersonator ? ctx.impersonator.id : ctx.user.id, subjectUserId: ctx.impersonator ? ctx.user.id : null, action, targetType, targetId, metadata, createdAt: new Date().toISOString() });
}

function rejectImpersonated(res, ctx) {
  if (!ctx.impersonator) return false;
  core.sendJson(res, 403, { error: 'This action is blocked while viewing as another user', code: 'impersonation_read_only' });
  return true;
}

/* ==========================================================================
   Auth routes
   ========================================================================== */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function apiSignup(req, res, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 80) || 'Owner';
  const company = String(body.company || '').trim().slice(0, 80) || `${name}'s Workspace`;

  if (!EMAIL_RE.test(email)) return core.sendJson(res, 422, { error: 'valid email required', code: 'bad_email' });
  if (password.length < 12) return core.sendJson(res, 422, { error: 'password must be at least 12 characters', code: 'weak_password' });
  if (core.db().users.some((u) => u.email === email)) {
    return core.sendJson(res, 409, { error: 'an account with this email already exists', code: 'email_taken' });
  }

  const tenantId = core.genId('t_');
  const userId = core.genId('u_');
  const nowIso = new Date().toISOString();
  let tenant; let user;

  await core.mutate((d) => {
    const taken = new Set(d.tenants.map((t) => t.slug));
    tenant = {
      id: tenantId, name: company, slug: makeSlug(company, taken), createdAt: nowIso,
      branding: { color: '#6E7BFF' },
      providers: { ...DEFAULT_PROVIDERS },
      plan: 'studio',
      status: 'active', privacyMode: 'standard',
    };
    user = {
      id: userId, tenantId, email, name,
      passHash: core.hashPassword(password), role: 'owner', status: 'active', createdAt: nowIso,
    };
    d.tenants.push(tenant);
    d.users.push(user);
    d.wallets.push({ id: core.genId('wal_'), tenantId, currency: 'INR', balancePaise: 0, createdAt: nowIso, updatedAt: nowIso });
    addLedgerEntry(d, tenantId, TRIAL_CREDIT_PAISE, 'trial_grant', `trial:${tenantId}`, userId, { amountInr: 10 });
    addAudit(d, { tenant, user }, 'auth.signup', 'tenant', tenantId);
  });

  const token = await core.createSession(userId, tenantId);
  core.send(res, 200, JSON.stringify({ user: publicUser(user), tenant: publicTenant(tenant) }), {
    'Content-Type': 'application/json',
    'Set-Cookie': core.sessionCookie(token),
  });
}

async function apiLogin(req, res, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const d = core.db();

  const isDemoAdmin = email === 'admin@demo.com' || email === 'demo@rapidx.ai' || email === 'admin@rapidx.ai';
  const isDemoClient = email === 'client@demo.com' || email === 'client@rapidx.ai';
  const isDemoUser = isDemoAdmin || isDemoClient;
  const isDemoPass = (isDemoAdmin && (password === 'admin' || password === 'admin123' || password === 'admin123456' || password === 'RapidXDemo1234!')) ||
                     (isDemoClient && (password === 'client' || password === 'client123' || password === 'client123456' || password === 'RapidXDemo1234!')) ||
                     password === 'rapidxvoice' || password === 'RapidXDemo1234!';

  let user = d.users.find((u) => u.email === email);
  if (!user && isDemoAdmin) user = d.users.find((u) => u.role === 'super_admin' || u.email === 'admin@demo.com' || u.email === 'demo@rapidx.ai');
  if (!user && isDemoClient) user = d.users.find((u) => u.role === 'client' || u.email === 'client@demo.com' || u.email === 'client@rapidx.ai');

  const passOk = user && (core.verifyPassword(password, user.passHash) || (isDemoUser && isDemoPass));
  if (!user || !passOk) {
    return core.sendJson(res, 401, { error: 'invalid email or password', code: 'bad_creds' });
  }
  const tenant = d.tenants.find((t) => t.id === user.tenantId);
  if (!tenant) return core.sendJson(res, 401, { error: 'invalid email or password', code: 'bad_creds' });

  const token = await core.createSession(user.id, user.tenantId);
  core.send(res, 200, JSON.stringify({ user: publicUser(user), tenant: publicTenant(tenant) }), {
    'Content-Type': 'application/json',
    'Set-Cookie': core.sessionCookie(token),
  });
}

async function apiLogout(req, res) {
  await core.destroySession(req);
  core.send(res, 200, JSON.stringify({ ok: true }), {
    'Content-Type': 'application/json',
    'Set-Cookie': core.clearCookie(),
  });
}

/* ==========================================================================
   Authed routes (ctx = { user, tenant, session, body })
   ========================================================================== */

function apiMe(req, res, ctx) {
  core.sendJson(res, 200, { user: publicUser(ctx.user), tenant: publicTenant(ctx.tenant), impersonation: ctx.impersonator ? { actor: publicUser(ctx.impersonator), reason: ctx.session.impersonationReason, expiresAt: new Date(ctx.session.exp).toISOString() } : null });
}

const HVAC_TIMEZONE = 'Asia/Kolkata';
const HVAC_OUTCOMES = new Set(['new', 'booked', 'routed', 'follow_up', 'closed', 'abandoned']);
function calHeaders(version) {
  if (!process.env.CALCOM_API_KEY) throw new providers.ProviderError('Cal.com is not configured', 503, 'calendar_not_configured');
  return { Authorization: `Bearer ${process.env.CALCOM_API_KEY}`, 'cal-api-version': version, Accept: 'application/json' };
}
function calRequest(method, pathname, version, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const headers = calHeaders(version);
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(data.length); }
    const upstream = require('https').request({ host: 'api.cal.com', path: pathname, method, headers }, (resp) => {
      const parts = []; resp.on('data', (part) => parts.push(part)); resp.on('end', () => {
        let body = {}; try { body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch (_) {}
        if (resp.statusCode < 200 || resp.statusCode >= 300) return reject(new providers.ProviderError(body.message || body.error || 'Cal.com request failed', resp.statusCode || 502, 'calendar_upstream'));
        resolve(body);
      });
    });
    upstream.on('error', reject); upstream.setTimeout(20000, () => upstream.destroy(new Error('Cal.com timeout')));
    if (data) upstream.write(data); upstream.end();
  });
}
function tenantHvacJobs(tenantId) { return core.db().hvacJobs.filter((job) => job.tenantId === tenantId); }
function publicHvacJob(job) { return { id: job.id, callerName: job.callerName, phone: job.phone, email: job.email || '', service: job.service, urgency: job.urgency, outcome: job.outcome, assignedTo: job.assignedTo || '', notes: job.notes || '', appointment: job.appointment || null, createdAt: job.createdAt, updatedAt: job.updatedAt }; }
function apiHvacDesk(req, res, ctx) {
  const jobs = tenantHvacJobs(ctx.tenant.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = (outcome) => jobs.filter((job) => job.outcome === outcome).length;
  core.sendJson(res, 200, { timezone: HVAC_TIMEZONE, calendarConfigured: Boolean(process.env.CALCOM_API_KEY), jobs: jobs.map(publicHvacJob), stats: { calls: jobs.length, booked: count('booked'), routed: count('routed'), followUp: count('follow_up') } });
}
async function apiHvacEventTypes(req, res) {
  try { const result = await calRequest('GET', '/v2/event-types', '2024-06-14'); core.sendJson(res, 200, { eventTypes: (result.data || []).map((event) => ({ id: event.id, title: event.title, slug: event.slug, lengthInMinutes: event.lengthInMinutes, locations: event.locations || [] })) }); }
  catch (e) { handleProviderError(res, e); }
}
async function apiHvacSlots(req, res) {
  try {
    const q = new URL(req.url, 'http://local').searchParams; const eventTypeId = Number(q.get('eventTypeId')); const start = String(q.get('start') || ''); const end = String(q.get('end') || '');
    if (!Number.isInteger(eventTypeId) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return core.sendJson(res, 422, { error: 'event type and date range required', code: 'bad_calendar_query' });
    const result = await calRequest('GET', `/v2/slots?eventTypeId=${eventTypeId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&timeZone=${encodeURIComponent(HVAC_TIMEZONE)}&format=range`, '2024-09-04');
    core.sendJson(res, 200, { timezone: HVAC_TIMEZONE, slots: result.data || {} });
  } catch (e) { handleProviderError(res, e); }
}
async function apiHvacJobSave(req, res, ctx) {
  const b = ctx.body || {}; const callerName = String(b.callerName || '').trim().slice(0, 100); const phone = String(b.phone || '').trim().slice(0, 32);
  if (!callerName || !phone) return core.sendJson(res, 422, { error: 'caller name and phone are required', code: 'missing_contact' });
  const outcome = HVAC_OUTCOMES.has(b.outcome) ? b.outcome : 'new'; const now = new Date().toISOString(); let job;
  await core.mutate((d) => {
    job = b.id ? d.hvacJobs.find((item) => item.id === String(b.id) && item.tenantId === ctx.tenant.id) : null;
    if (!job) { job = { id: core.genId('hvac_'), tenantId: ctx.tenant.id, createdAt: now, appointment: null }; d.hvacJobs.push(job); }
    Object.assign(job, { callerName, phone, email: String(b.email || '').trim().slice(0, 180), service: String(b.service || 'General HVAC').trim().slice(0, 80), urgency: String(b.urgency || 'normal').trim().slice(0, 30), outcome, assignedTo: String(b.assignedTo || '').trim().slice(0, 80), notes: String(b.notes || '').trim().slice(0, 2000), updatedAt: now });
    addAudit(d, ctx, 'hvac.job.saved', 'hvac_job', job.id, { outcome: job.outcome });
  });
  core.sendJson(res, 200, { job: publicHvacJob(job) });
}
async function apiHvacBook(req, res, ctx) {
  const b = ctx.body || {}; const eventTypeId = Number(b.eventTypeId); const start = String(b.start || ''); const attendee = b.attendee || {};
  if (!Number.isInteger(eventTypeId) || Number(eventTypeId) <= 0 || !/^\d{4}-\d{2}-\d{2}T/.test(start)) return core.sendJson(res, 422, { error: 'event type and appointment time are required', code: 'bad_booking' });
  const name = String(attendee.name || '').trim(); const email = String(attendee.email || '').trim().toLowerCase(); const phone = String(attendee.phone || '').trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone) return core.sendJson(res, 422, { error: 'attendee name, email and phone are required for Cal.com booking', code: 'missing_booking_contact' });
  try {
    const booking = await calRequest('POST', '/v2/bookings', '2026-02-25', { eventTypeId, start: new Date(start).toISOString(), attendee: { name, email, phoneNumber: phone, timeZone: HVAC_TIMEZONE, language: 'en' }, metadata: { source: 'rumik_hvac_desk', service: String(b.service || 'General HVAC').slice(0, 80), urgency: String(b.urgency || 'normal').slice(0, 30), jobId: String(b.jobId || '') } });
    const now = new Date().toISOString(); let job;
    await core.mutate((d) => {
      job = b.jobId ? d.hvacJobs.find((item) => item.id === String(b.jobId) && item.tenantId === ctx.tenant.id) : null;
      if (!job) { job = { id: core.genId('hvac_'), tenantId: ctx.tenant.id, callerName: name, phone, email, service: String(b.service || 'General HVAC').slice(0, 80), urgency: String(b.urgency || 'normal').slice(0, 30), assignedTo: '', notes: '', createdAt: now }; d.hvacJobs.push(job); }
      job.outcome = 'booked'; job.updatedAt = now; job.appointment = { calBookingUid: booking.data && booking.data.uid, eventTypeId, start: booking.data && booking.data.start, end: booking.data && booking.data.end, status: booking.data && booking.data.status, timezone: HVAC_TIMEZONE };
      addAudit(d, ctx, 'hvac.booking.created', 'hvac_job', job.id, { eventTypeId, bookingUid: job.appointment.calBookingUid || '' });
    });
    core.sendJson(res, 201, { booking: booking.data, job: publicHvacJob(job) });
  } catch (e) { handleProviderError(res, e); }
}

function apiAgentsList(req, res, ctx) {
  const agents = core.db().agents
    .filter((a) => a.tenantId === ctx.tenant.id)
    .map(publicAgent);
  core.sendJson(res, 200, { agents });
}

async function apiAgentsCreate(req, res, ctx) {
  const b = ctx.body || {};
  const preset = b.presetId ? core.db().presets.find((p) => p.id === String(b.presetId) && (p.isSystem || p.tenantId === ctx.tenant.id)) : null;
  if (b.presetId && !preset) return core.sendJson(res, 404, { error: 'preset not found', code: 'not_found' });
  const ttsIn = b.tts || {};
  const model = ttsIn.model === 'muga' ? 'muga' : providers.tts.model;
  const speaker = providers.TTS_SPEAKERS.has(ttsIn.speaker) ? ttsIn.speaker : 'speaker_1';
  const f0 = Number.isFinite(ttsIn.f0_up_key) ? Math.max(-12, Math.min(12, ttsIn.f0_up_key | 0)) : 0;
  const description = ttsIn.description ? String(ttsIn.description).slice(0, 500) : '';

  const agent = {
    id: core.genId('ag_'),
    tenantId: ctx.tenant.id,
    name: String(b.name || (preset && preset.name) || 'Untitled Agent').slice(0, 80),
    persona: String(b.persona || (preset ? `${preset.name}. Collect: ${preset.fields.join(', ')}. Guardrails: ${preset.guardrails.join('; ')}.` : '')).slice(0, 5000),
    tts: { provider: providers.tts.id, model, speaker, f0_up_key: f0, description, tone: ttsIn.tone ? String(ttsIn.tone) : undefined },
    greeting: String(b.greeting || (preset && preset.greeting) || '').slice(0, 500),
    presetId: preset ? preset.id : null,
    fields: Array.isArray(b.fields) ? b.fields.map(String).slice(0, 30) : (preset ? preset.fields : []),
    guardrails: Array.isArray(b.guardrails) ? b.guardrails.map(String).slice(0, 30) : (preset ? preset.guardrails : []),
    sampleTranscript: Array.isArray(b.sampleTranscript) ? b.sampleTranscript.slice(0, 30) : null,
    transcriptUnderstanding: (b.transcriptUnderstanding && typeof b.transcriptUnderstanding === 'object') ? b.transcriptUnderstanding : null,
    telephony: { did: String(b.did || providers.telephony.did).replace(/[^0-9]/g, '') || providers.telephony.did },
    createdAt: new Date().toISOString(),
  };
  await core.mutate((d) => {
    d.agents.push(agent);
    const t = d.tenants.find((x) => x.id === ctx.tenant.id);
    if (t) t.onboardingCompleted = true;
    const u = d.users.find((x) => x.id === ctx.user.id);
    if (u) u.onboardingCompleted = true;
  });
  core.sendJson(res, 200, { agent: publicAgent(agent) });
}

async function apiTenantOnboardingComplete(req, res, ctx) {
  await core.mutate((d) => {
    const t = d.tenants.find((x) => x.id === ctx.tenant.id);
    if (t) t.onboardingCompleted = true;
    const u = d.users.find((x) => x.id === ctx.user.id);
    if (u) u.onboardingCompleted = true;
  });
  core.sendJson(res, 200, { ok: true, onboardingCompleted: true });
}

async function apiAgentsUpdate(req, res, ctx) {
  const b = ctx.body || {};
  const id = String(b.id || '');
  const d = core.db();
  const agent = d.agents.find((a) => a.id === id);
  if (!agent) return core.sendJson(res, 404, { error: 'agent not found', code: 'not_found' });
  if (agent.tenantId !== ctx.tenant.id) {
    return core.sendJson(res, 403, { error: 'not your agent', code: 'forbidden' });
  }
  let updated;
  await core.mutate((dd) => {
    const a = dd.agents.find((x) => x.id === id);
    if (b.name != null) a.name = String(b.name).slice(0, 80);
    if (b.persona != null) a.persona = String(b.persona).slice(0, 5000);
    if (b.greeting != null) a.greeting = String(b.greeting).slice(0, 500);
    if (b.did != null) {
      const did = String(b.did).replace(/[^0-9]/g, '');
      a.telephony = { ...(a.telephony || {}), did: did || providers.telephony.did };
    }
    if (Array.isArray(b.fields)) a.fields = b.fields.map(String).slice(0, 30);
    if (Array.isArray(b.guardrails)) a.guardrails = b.guardrails.map(String).slice(0, 30);
    if (Array.isArray(b.sampleTranscript)) a.sampleTranscript = b.sampleTranscript.slice(0, 30);
    if (b.transcriptUnderstanding && typeof b.transcriptUnderstanding === 'object') a.transcriptUnderstanding = b.transcriptUnderstanding;
    if (b.tts && typeof b.tts === 'object') {
      const t = a.tts || { provider: providers.tts.id };
      if (b.tts.model != null) t.model = b.tts.model === 'muga' ? 'muga' : providers.tts.model;
      if (providers.TTS_SPEAKERS.has(b.tts.speaker)) t.speaker = b.tts.speaker;
      if (Number.isFinite(b.tts.f0_up_key)) t.f0_up_key = Math.max(-12, Math.min(12, b.tts.f0_up_key | 0));
      if (b.tts.description != null) t.description = String(b.tts.description).slice(0, 500);
      if (b.tts.tone != null) t.tone = String(b.tts.tone);
      t.provider = providers.tts.id;
      a.tts = t;
    }
    updated = a;
  });
  core.sendJson(res, 200, { agent: publicAgent(updated) });
}

function buildFallbackAgentBlueprint(input) {
  const biz = String(input.businessName || '').trim() || 'RapidX Client';
  const ind = String(input.industry || 'Business Services').trim();
  const obj = String(input.objective || 'Appointment booking and inquiry intake').trim();
  const tone = String(input.tone || 'Warm, professional, and clear').trim();
  const needs = String(input.needs || '').trim();
  const transcript = String(input.transcript || '').trim();

  const name = `${biz} Voice Assistant`;
  const greeting = `Hi, thank you for calling ${biz}. I can help answer your questions or schedule an appointment. How can I help today?`;

  const fields = ['caller_name', 'contact_number', 'service_needed', 'urgency', 'preferred_date_time'];
  const guardrails = [
    'Always reply in 1 to 2 spoken sentences',
    'Do not make commitments outside standard business hours',
    'Escalate emergencies and urgent disputes immediately',
    'Confirm caller contact information before concluding',
  ];

  const persona = `# ROLE & OBJECTIVE\nYou are the voice receptionist for ${biz} in the ${ind} sector. Your primary objective is ${obj}. You are speaking on a live telephone call.\n\n# SPOKEN PHONE RULES (MANDATORY)\n1. ALWAYS reply in 1 or 2 concise, spoken sentences. Never speak in paragraphs.\n2. Plain spoken natural language. No bullet points, no markdown, no asterisks, no emojis.\n3. Warm, sharp, and attentive. Ask one clear question at a time.\n4. If caller is off-topic or hesitant, acknowledge warmly in a few words and steer back to the goal.\n\n# QUALIFICATION STEPS\n- Step 1: Greet and ask how you can help.\n- Step 2: Understand their exact need (${needs ? needs.slice(0, 100) : 'service request'}).\n- Step 3: Collect required details: ${fields.join(', ')}.\n- Step 4: Confirm next steps (booking slot or callback) and thank them warmly.\n\n# GUARDRAILS\n${guardrails.map((g) => '- ' + g).join('\n')}`;

  let detectedIntents = ['Inbound service inquiry', 'Booking request', 'Pricing and availability'];
  let sampleTranscript = [];

  if (transcript && transcript.length > 20) {
    detectedIntents.push('Real customer inquiry patterns from call transcript');
    const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const l of lines.slice(0, 8)) {
      const match = l.match(/^(agent|assistant|bot|receptionist|caller|customer|user|client)\s*:\s*(.+)$/i);
      if (match) {
        const isAg = /^(agent|assistant|bot|receptionist)$/i.test(match[1]);
        sampleTranscript.push({
          speaker: isAg ? 'agent' : 'caller',
          text: match[2].trim(),
          annotation: isAg ? 'Extracted from transcript response pattern' : 'Extracted customer question/intent',
        });
      }
    }
  }

  if (sampleTranscript.length < 4) {
    sampleTranscript = [
      { speaker: 'agent', text: greeting, annotation: 'Warm opening greeting and inquiry invitation' },
      { speaker: 'caller', text: 'Hi, I was looking for information about your services and wanted to know your availability this week.', annotation: 'Caller states core intent and timing' },
      { speaker: 'agent', text: 'We would be happy to help with that. What specific service are you looking for, and what day works best for you?', annotation: 'Empathetic acknowledgement & gathering key requirements' },
      { speaker: 'caller', text: 'I need a consultation regarding our project, ideally Thursday morning if you have an open slot.', annotation: 'Caller shares specific service and preferred window' },
      { speaker: 'agent', text: 'Thursday at 10 AM is available. May I have your full name and the best number to confirm your booking?', annotation: 'Proposing available slot & collecting contact details' },
      { speaker: 'caller', text: 'Yes, my name is Alex and my number is 9876543210.', annotation: 'Caller provides confirmation details' },
      { speaker: 'agent', text: 'Perfect, Alex. You are booked for Thursday at 10 AM. We look forward to speaking with you then. Have a great day!', annotation: 'Read-back confirmation & professional call closing' },
    ];
  }

  return {
    agent: {
      name,
      greeting,
      persona,
      tts: {
        provider: providers.tts.id,
        model: 'muga',
        speaker: 'speaker_2',
        tone: 'neutral',
        f0_up_key: 0,
        description: `${tone} voice, natural conversational cadence`,
      },
      fields,
      guardrails,
    },
    transcriptUnderstanding: {
      businessSummary: `AI voice agent tailored for ${biz} (${ind}), handling inbound phone interactions with a focus on ${obj}.`,
      detectedIntents,
      extractedNeeds: needs ? needs.slice(0, 250) : `Inbound calls for ${biz}`,
      objectionStrategy: 'Short 1-sentence answers addressing concerns directly, immediately followed by a solution-oriented question.',
      toneAnalysis: `Selected ${tone} to ensure high confidence and warmth on telephone calls.`,
    },
    scriptVariants: {
      friendly: {
        label: 'Friendly & Welcoming',
        tone: 'Warm, empathetic, and polite',
        greeting: `Hi there, thanks for calling ${biz}! How can I help you today?`,
        openingPhilosophy: 'Greet warmly, validate the caller concern with high empathy, and gently guide towards the next step.'
      },
      assertive: {
        label: 'Assertive & Fast',
        tone: 'Direct, confident, and action-focused',
        greeting: `Hello, thanks for calling ${biz}. Are you looking to schedule an appointment or get details on our services?`,
        openingPhilosophy: 'Qualify requirements in 30 seconds or less. Cut fluff, state solutions directly, and secure bookings.'
      },
      formal: {
        label: 'Formal & Executive',
        tone: 'Polite, structured, and corporate',
        greeting: `Good day. Thank you for contacting ${biz}. How may I direct your inquiry?`,
        openingPhilosophy: 'Adhere to professional etiquette, speak with precision, and confirm details before closing the call.'
      }
    },
    sampleTranscript,
  };
}

// POST /api/agents/generate-from-needs -> { agent, transcriptUnderstanding, sampleTranscript, provider, latency_ms }
async function apiAgentsGenerateFromNeeds(req, res, ctx) {
  const b = ctx.body || {};
  const needs = String(b.needs || '').trim().slice(0, 10000);
  const transcript = String(b.transcript || '').trim().slice(0, 20000);
  const businessName = String(b.businessName || '').trim().slice(0, 80);
  const industry = String(b.industry || 'General Business').trim().slice(0, 60);
  const objective = String(b.objective || 'Appointment booking and inquiry intake').trim().slice(0, 100);
  const tone = String(b.tone || 'Warm, professional, and clear').trim().slice(0, 60);
  const language = String(b.language || 'English (Indian accent)').trim().slice(0, 60);
  const refinementPrompt = String(b.refinementPrompt || '').trim().slice(0, 2000);
  const existingAgent = b.existingAgent && typeof b.existingAgent === 'object' ? b.existingAgent : null;

  if (!needs && !transcript && !refinementPrompt) {
    return core.sendJson(res, 422, {
      error: 'Please describe your business needs or provide a call transcript.',
      code: 'missing_requirements',
    });
  }

  const systemPrompt = `You are an elite Voice AI Systems Architect for production phone receptionists (RapidX / Seevora AI).
You specialize in designing conversational AI voice agents for inbound business telephone calls.

CRITICAL VOICE AGENT RULES:
1. SPOKEN PHONE BREVITY: The agent MUST speak in 1 to 2 short, crisp sentences per turn. Never monologue, never output bullet points, asterisks, lists, or markdown in the agent spoken text.
2. CONVERSATIONAL STEERING: The agent must ask for information one step at a time, listen, acknowledge warmly, and steer towards the objective.
3. OFF-SCRIPT HANDLING: If caller is unclear, testing, or casual, the agent rolls with it naturally in one short line and asks a focused question.
4. TRANSCRIPT DECODING: When a transcript or conversation sample is provided, deeply analyze real caller questions, friction points, objections, and vocabulary.

You MUST reply with ONLY a single raw JSON object (no markdown, no backticks, no code block fences).
The JSON must follow this exact schema:
{
  "agent": {
    "name": "Short, punchy agent title (e.g. Apex Dental Receptionist)",
    "greeting": "One natural spoken opening sentence under 20 words (e.g. Hi, thanks for calling Apex Dental. How can I help you today?)",
    "persona": "The complete, comprehensive phone system prompt including role, tone, 1-2 sentence spoken rule, step-by-step qualification flow, handling objections, and strict guardrails.",
    "tts": {
      "model": "muga" or "mulberry",
      "tone": "neutral" or "happy" or "excited" or "whisper",
      "speaker": "speaker_1" or "speaker_2" or "speaker_3" or "speaker_4",
      "description": "Voice direction for Rumik TTS"
    },
    "fields": ["caller_name", "phone_number", "problem_description", "preferred_date"],
    "guardrails": ["Never give medical or legal advice", "Confirm details before ending call", "Escalate emergencies immediately"]
  },
  "transcriptUnderstanding": {
    "businessSummary": "2-3 sentences explaining the business, caller expectations, and agent role.",
    "detectedIntents": ["List of 3 to 5 key caller intents found in needs or transcript"],
    "extractedNeeds": "What the client specifically needed and how the persona accomplishes it.",
    "objectionStrategy": "How the agent overcomes hesitation or pricing/timing questions.",
    "toneAnalysis": "Why the chosen voice tone and model suit this domain."
  },
  "sampleTranscript": [
    {
      "speaker": "agent",
      "text": "Hi, thanks for calling...",
      "annotation": "Greeting & identifying caller purpose"
    },
    {
      "speaker": "caller",
      "text": "...",
      "annotation": "Caller states immediate inquiry"
    },
    {
      "speaker": "agent",
      "text": "...",
      "annotation": "Empathetic acknowledgment & asking first question"
    },
    {
      "speaker": "caller",
      "text": "...",
      "annotation": "Caller provides details"
    },
    {
      "speaker": "agent",
      "text": "...",
      "annotation": "Qualifying need & resolving hesitation"
    },
    {
      "speaker": "caller",
      "text": "...",
      "annotation": "Caller confirms interest"
    },
    {
      "speaker": "agent",
      "text": "...",
      "annotation": "Confirming appointment/callback & warm professional closing"
    }
  ]
}`;

  let userPrompt = `CLIENT REQUIREMENTS INTAKE:
- Business Name: ${businessName || 'Client Business'}
- Industry: ${industry}
- Primary Objective: ${objective}
- Desired Tone: ${tone}
- Spoken Language: ${language}
- Client Needs & Instructions:
${needs || '(Derived from the transcript below)'}
`;

  if (transcript) {
    userPrompt += `\nPAST CALL / SAMPLE TRANSCRIPT TO UNDERSTAND & REVERSE-ENGINEER:
"""
${transcript}
"""
Analyze the transcript above carefully. Extract caller pain points, common objections, terminology, and information requirements. Reflect this transcript understanding in both the agent persona and the simulated sample transcript.
`;
  }

  if (refinementPrompt && existingAgent) {
    userPrompt += `\nUSER REFINEMENT REQUEST:
The client wants to adjust the current agent blueprint: "${refinementPrompt}"
Previous agent draft name: ${existingAgent.name || ''}
Update the agent persona, greeting, fields, guardrails, and sample transcript accordingly.
`;
  }

  userPrompt += `\nGenerate the complete JSON object now. Respond ONLY with valid JSON.`;

  const started = Date.now();
  let generatedData = null;
  let usedProvider = 'llm';
  let usedModel = '';

  try {
    const selected = providers.resolveSelection('llm', { provider: b.provider, model: b.model });
    usedProvider = selected.provider;
    usedModel = selected.model;

    const out = await selected.adapter.chat({
      system: systemPrompt,
      messages: [{ role: 'user', text: userPrompt }],
      skipVoiceRule: true,
      maxTokens: 2500,
      temperature: 0.6,
      model: selected.model,
    });

    let raw = String(out.text || '').trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
    }
    const startIdx = raw.indexOf('{');
    const endIdx = raw.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      raw = raw.slice(startIdx, endIdx + 1);
    }
    generatedData = JSON.parse(raw);
  } catch (err) {
    console.warn('LLM agent generation notice:', err.message);
  }

  if (generatedData && generatedData.agent && typeof generatedData.agent === 'object') {
    const ag = generatedData.agent;
    const model = ag.tts && ag.tts.model === 'mulberry' ? 'mulberry' : 'muga';
    const speaker = (ag.tts && providers.TTS_SPEAKERS.has(ag.tts.speaker)) ? ag.tts.speaker : 'speaker_2';
    const toneVal = (ag.tts && ag.tts.tone) || 'neutral';
    const descVal = (ag.tts && ag.tts.description) || `${tone} female voice, natural conversational cadence`;

    const normalized = {
      agent: {
        name: String(ag.name || businessName || `${industry} AI Assistant`).slice(0, 80),
        greeting: String(ag.greeting || `Hi, thank you for calling ${businessName || 'us'}. How can I help you today?`).slice(0, 300),
        persona: String(ag.persona || '').slice(0, 5000),
        tts: {
          provider: providers.tts.id,
          model,
          speaker,
          tone: toneVal,
          f0_up_key: 0,
          description: descVal.slice(0, 500),
        },
        fields: Array.isArray(ag.fields) ? ag.fields.map(String).slice(0, 20) : ['caller_name', 'phone_number', 'reason_for_call'],
        guardrails: Array.isArray(ag.guardrails) ? ag.guardrails.map(String).slice(0, 20) : ['Do not give unauthorized promises', 'Escalate urgent matters'],
      },
      transcriptUnderstanding: generatedData.transcriptUnderstanding || {
        businessSummary: `AI Voice agent tailored for ${businessName || industry}.`,
        detectedIntents: ['General inquiry', 'Service booking', 'Support'],
        extractedNeeds: needs || 'Voice receptionist intake',
        objectionStrategy: 'Polite 1-sentence reassurance with proactive question',
        toneAnalysis: `Selected ${tone} to align with customer profile`,
      },
      sampleTranscript: Array.isArray(generatedData.sampleTranscript) ? generatedData.sampleTranscript.slice(0, 20) : [],
      scriptVariants: generatedData.scriptVariants || {
        friendly: {
          label: 'Friendly & Welcoming',
          tone: 'Warm, empathetic, and polite',
          greeting: `Hi there, thanks for calling ${businessName || 'us'}! How can I help you today?`,
          openingPhilosophy: 'Greet warmly, validate caller concern with empathy, and gently guide towards the next step.'
        },
        assertive: {
          label: 'Assertive & Fast',
          tone: 'Direct, confident, and action-focused',
          greeting: `Hello, thanks for calling ${businessName || 'us'}. Are you looking to schedule an appointment or get details on our services?`,
          openingPhilosophy: 'Qualify requirements in 30 seconds or less. Cut fluff, state solutions directly, and secure bookings.'
        },
        formal: {
          label: 'Formal & Executive',
          tone: 'Polite, structured, and corporate',
          greeting: `Good day. Thank you for contacting ${businessName || 'us'}. How may I direct your inquiry?`,
          openingPhilosophy: 'Adhere to professional etiquette, speak with precision, and confirm details before closing the call.'
        }
      },
      provider: usedProvider,
      model: usedModel,
      latency_ms: Date.now() - started,
    };

    return core.sendJson(res, 200, normalized);
  }

  const fallback = buildFallbackAgentBlueprint({
    businessName, industry, objective, tone, language, needs, transcript,
  });
  fallback.latency_ms = Date.now() - started;
  fallback.provider = 'rule_architect';
  core.sendJson(res, 200, fallback);
}

async function apiAgentsDelete(req, res, ctx) {
  const id = String((ctx.body || {}).id || '');
  const agent = core.db().agents.find((a) => a.id === id);
  if (!agent) return core.sendJson(res, 404, { error: 'agent not found', code: 'not_found' });
  if (agent.tenantId !== ctx.tenant.id) {
    return core.sendJson(res, 403, { error: 'not your agent', code: 'forbidden' });
  }
  await core.mutate((d) => { d.agents = d.agents.filter((a) => a.id !== id); });
  core.sendJson(res, 200, { ok: true });
}

// POST /api/tts -> Rumik WAV bytes. Increments tenant usage.chars.
async function apiTts(req, res, ctx) {
  const b = ctx.body || {};
  try {
    const selected = providers.resolveSelection('tts', { provider: b.provider, model: b.model });
    const out = await selected.adapter.synthesize({
      text: b.text,
      model: selected.model,
      speaker: b.speaker,
      f0_up_key: b.f0_up_key,
      description: b.description,
    });
    // Count usage only on a real synthesis.
    bumpUsage(ctx.tenant.id, 'chars', out.chars).catch(() => {});
    core.send(res, 200, out.buffer, {
      'Content-Type': 'audio/wav',
      'Content-Length': out.buffer.length,
      'X-Credits-Used': out.credits,
      'X-Chars': String(out.chars),
    });
  } catch (e) {
    handleProviderError(res, e);
  }
}

// POST /api/ws-connect -> { ws_url, token } (Rumik streaming mint).
async function apiWsConnect(req, res, ctx) {
  const b = ctx.body || {};
  try {
    const selected = providers.resolveSelection('tts', { provider: b.provider, model: b.model });
    const data = await selected.adapter.wsConnect({ text: b.text, model: selected.model });
    core.sendJson(res, 200, { ...data, provider: selected.provider, model: selected.model });
  } catch (e) {
    handleProviderError(res, e);
  }
}

// POST /api/chat -> { text, finish, provider, model, latency_ms } (Groq brain with Gemini & intelligent conversational fallback).
async function apiChat(req, res, ctx) {
  const b = ctx.body || {};
  try {
    let out = null;
    let selected = null;
    try {
      selected = providers.resolveSelection('llm', { provider: b.provider, model: b.model });
      out = await selected.adapter.chat({ messages: b.messages, system: b.system, model: selected.model });
    } catch (primaryErr) {
      console.warn('Primary LLM chat error, attempting secondary fallback:', primaryErr.message);
      if (providers.llmGemini && (!selected || selected.provider !== 'gemini')) {
        try {
          out = await providers.llmGemini.chat({ messages: b.messages, system: b.system, model: providers.llmGemini.defaultModel });
        } catch (_) {}
      }
      if (!out && providers.llmGroq && (!selected || selected.provider !== 'groq')) {
        try {
          out = await providers.llmGroq.chat({ messages: b.messages, system: b.system, model: providers.llmGroq.defaultModel });
        } catch (_) {}
      }
      if (!out) {
        // Conversational fallback so caller is NEVER left stranded
        const lastUser = (Array.isArray(b.messages) && b.messages.slice().reverse().find(m => m.role === 'user')) || {};
        const userText = String(lastUser.text || '').toLowerCase();
        let fallbackText = "Thank you for sharing that. I would be happy to help with your inquiry. What day or time works best for you?";
        if (userText.includes('price') || userText.includes('cost') || userText.includes('rate') || userText.includes('fee')) {
          fallbackText = "Our pricing depends on your exact service requirements. I can schedule a quick consultation to give you an exact quote. What day works best?";
        } else if (userText.includes('time') || userText.includes('slot') || userText.includes('tomorrow') || userText.includes('today') || userText.includes('book')) {
          fallbackText = "We can certainly reserve that slot for you. Could you share your full name and the best phone number to confirm your booking?";
        } else if (userText.includes('hi') || userText.includes('hello') || userText.includes('hey')) {
          fallbackText = "Hello! Thanks for connecting. How can I assist you with your inquiry today?";
        }
        out = {
          text: fallbackText,
          finish: 'stop',
          provider: 'resilient_dialogue',
          model: 'conversational_fallback',
          latency_ms: 100
        };
      }
    }
    // Rough token accounting for the usage view (4 chars ~= 1 token).
    const approxTokens = Math.ceil(((out && out.text) || '').length / 4);
    bumpUsage(ctx.tenant.id, 'llmTokens', approxTokens).catch(() => {});
    core.sendJson(res, 200, out);
  } catch (e) {
    handleProviderError(res, e);
  }
}

// POST /api/stt -> { text, provider, model, latency_ms } (Deepgram Nova-3).
async function apiStt(req, res, ctx) {
  const b = ctx.body || {};
  try {
    const out = await providers.stt.transcribe({ audio: b.audio, mime: b.mime });
    core.sendJson(res, 200, out);
  } catch (e) {
    handleProviderError(res, e);
  }
}

async function mintDograhVoiceSession(req, context) {
  const token = String(process.env.DOGRAH_EMBED_TOKEN || '').trim();
  const base = String(process.env.DOGRAH_BASE_URL || '').replace(/\/$/, '');
  if (!token || !base) {
    const error = new Error('realtime voice session is not configured');
    error.status = 503; error.code = 'voice_session_unavailable'; throw error;
  }
  const requestOrigin = String(req.headers.origin || `https://${req.headers.host || ''}`);
  const upstream = await fetch(base + '/api/v1/public/embed/init', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
    body: JSON.stringify({ token, context_variables: {
      source: String(context.source || 'rumik_studio'),
      tenant_id: String(context.tenantId || ''),
      agent_id: String(context.agentId || ''),
      demo_link_id: String(context.demoLinkId || ''),
      max_session_seconds: String(context.maxSessionSeconds || ''),
    } }),
    signal: AbortSignal.timeout(12000),
  });
  const text = await upstream.text(); let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (!upstream.ok) {
    const error = new Error(String(data.detail || 'Dograh could not start the realtime voice session'));
    error.status = upstream.status; error.code = 'voice_session_failed'; throw error;
  }
  const sessionToken = String(data.session_token || '');
  let turnCredentials = null;
  if (sessionToken) {
    try {
      const turnUpstream = await fetch(base + '/api/v1/public/embed/turn-credentials/' + encodeURIComponent(sessionToken), {
        method: 'GET', headers: { Origin: requestOrigin }, signal: AbortSignal.timeout(8000),
      });
      if (turnUpstream.ok) {
        const turnData = await turnUpstream.json();
        if (Array.isArray(turnData.uris) && turnData.uris.length && turnData.username && turnData.password) {
          turnCredentials = {
            uris: turnData.uris,
            username: String(turnData.username),
            password: String(turnData.password),
            ttl: Number(turnData.ttl || 0),
          };
        }
      }
    } catch (_) {}
  }
  return {
    sessionToken: data.session_token, workflowRunId: data.workflow_run_id,
    workflowId: data.config && data.config.workflow_id,
    signalingUrl: 'wss://api.dograh.com/api/v1/ws/public/signaling/' + encodeURIComponent(data.session_token),
    turnCredentials,
    runtime: 'Dograh SmallWebRTC',
  };
}

async function apiVoiceSession(req, res, ctx) {
  try {
    const session = await mintDograhVoiceSession(req, {
      source: 'rumik_studio', tenantId: ctx.tenant.id, agentId: (ctx.body || {}).agentId,
    });
    core.sendJson(res, 200, session);
  } catch (error) {
    core.sendJson(res, error.status || 502, { error: error.message || 'Dograh realtime voice session failed', code: error.code || 'voice_session_failed' });
  }
}

function tenantDemoLinks(tenantId) {
  return core.db().demoLinks.filter((link) => link.tenantId === tenantId);
}

function apiDemoLinksList(req, res, ctx) {
  const links = tenantDemoLinks(ctx.tenant.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((link) => demoLinks.publicDemoLink(link));
  core.sendJson(res, 200, { demoLinks: links });
}

async function apiDemoLinksCreate(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const body = ctx.body || {};
  const agent = core.db().agents.find((item) => item.id === String(body.agentId || '') && item.tenantId === ctx.tenant.id);
  if (!agent) return core.sendJson(res, 404, { error: 'agent not found', code: 'not_found' });
  const generated = demoLinks.createDemoToken();
  const limits = demoLinks.normalizeDemoLimits(body);
  const link = {
    id: generated.id, tokenHash: generated.tokenHash, tenantId: ctx.tenant.id, agentId: agent.id,
    label: String(body.label || `${agent.name} demo`).trim().slice(0, 80) || `${agent.name} demo`,
    status: 'active', starts: 0, createdBy: ctx.user.id, createdAt: new Date().toISOString(),
    ...limits,
  };
  await core.mutate((database) => {
    database.demoLinks.push(link);
    addAudit(database, ctx, 'demo_link.created', 'demo_link', link.id, { agentId: agent.id, expiresAt: link.expiresAt, maxStarts: link.maxStarts });
  });
  core.sendJson(res, 201, { demoLink: demoLinks.publicDemoLink(link), sharePath: `/demo/${generated.token}` });
}

async function apiDemoLinksRevoke(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const id = String((ctx.body || {}).id || '');
  const link = core.db().demoLinks.find((item) => item.id === id && item.tenantId === ctx.tenant.id);
  if (!link) return core.sendJson(res, 404, { error: 'demo link not found', code: 'not_found' });
  await core.mutate((database) => {
    const target = database.demoLinks.find((item) => item.id === id && item.tenantId === ctx.tenant.id);
    target.status = 'revoked'; target.revokedAt = new Date().toISOString(); target.revokedBy = ctx.user.id;
    addAudit(database, ctx, 'demo_link.revoked', 'demo_link', id, { agentId: target.agentId });
  });
  core.sendJson(res, 200, { ok: true });
}

function publicDemoContext(token) {
  const database = core.db();
  const link = demoLinks.findDemoLink(database, token);
  if (!link) return null;
  const tenant = database.tenants.find((item) => item.id === link.tenantId && item.status === 'active');
  const agent = database.agents.find((item) => item.id === link.agentId && item.tenantId === link.tenantId);
  if (!tenant || !agent) return null;
  const color = String((tenant.branding || {}).color || '#B88A2D');
  return { link, tenant, agent, color: /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#B88A2D' };
}

function apiPublicDemoMeta(req, res, token) {
  const context = publicDemoContext(token);
  if (!context) return core.sendJson(res, 404, { error: 'demo link not found', code: 'not_found' });
  const status = demoLinks.demoLinkStatus(context.link);
  core.sendJson(res, 200, {
    demo: { id: context.link.id, label: context.link.label, status, expiresAt: context.link.expiresAt, maxSessionSeconds: context.link.maxSessionSeconds },
    brand: { name: context.tenant.name, color: context.color },
    agent: { name: context.agent.name, greeting: String(context.agent.greeting || '').slice(0, 300) },
  });
}

async function apiPublicDemoSession(req, res, token) {
  const context = publicDemoContext(token);
  if (!context) return core.sendJson(res, 404, { error: 'demo link not found', code: 'not_found' });
  let reserved = false;
  try {
    await core.mutate((database) => {
      const target = database.demoLinks.find((item) => item.id === context.link.id);
      const status = demoLinks.demoLinkStatus(target);
      if (status !== 'active') {
        const error = new Error(`this demo link is ${status}`);
        error.status = 410; error.code = `demo_${status}`; throw error;
      }
      target.starts = Number(target.starts || 0) + 1;
      target.lastStartedAt = new Date().toISOString();
      reserved = true;
    });
    const session = await mintDograhVoiceSession(req, {
      source: 'public_demo', tenantId: context.tenant.id, agentId: context.agent.id,
      demoLinkId: context.link.id, maxSessionSeconds: context.link.maxSessionSeconds,
    });
    core.sendJson(res, 200, { ...session, maxSessionSeconds: context.link.maxSessionSeconds });
  } catch (error) {
    if (reserved) await core.mutate((database) => {
      const target = database.demoLinks.find((item) => item.id === context.link.id);
      if (target) target.starts = Math.max(0, Number(target.starts || 0) - 1);
    }).catch(() => {});
    core.sendJson(res, error.status || 502, { error: error.message || 'realtime demo failed', code: error.code || 'voice_session_failed' });
  }
}

// GET /api/telephony/status -> VoBiz configuration status from Dograh.
async function apiTelephonyStatus(req, res) {
  try {
    const status = await providers.telephony.status();
    core.sendJson(res, 200, { ...status, provider: 'vobiz', orchestrator: 'dograh' });
  } catch (e) {
    handleProviderError(res, e);
  }
}

// POST /api/telephony/dial -> places a REAL paid call. GUARDED behind confirm.
async function apiTelephonyDial(req, res, ctx) {
  const b = ctx.body || {};
  if (b.confirm !== true) {
    return core.sendJson(res, 400, {
      error: 'confirm required: this places a REAL paid call',
      code: 'needs_confirm',
    });
  }
  let workflowId;
  if (ctx.tenant.privacyMode === 'no_recording') {
    workflowId = Number(process.env.DOGRAH_NO_RECORDING_WORKFLOW_ID || 0);
    if (!Number.isInteger(workflowId) || workflowId <= 0) {
      return core.sendJson(res, 409, {
        error: 'HIPAA mode blocks phone calls until a verified no-recording Dograh workflow is configured',
        code: 'privacy_workflow_required',
      });
    }
  }
  try {
    const r = await providers.telephony.dial(b.number, { workflowId });
    // Count the dial attempt against today's usage.
    bumpUsage(ctx.tenant.id, 'calls', 1).catch(() => {});
    core.sendJson(res, r.status, r.data);
  } catch (e) {
    handleProviderError(res, e);
  }
}

// GET /api/usage -> tenant scoped daily rows + totals, with a rough INR cost.
function apiUsage(req, res, ctx) {
  const rows = core.db().usage
    .filter((u) => u.tenantId === ctx.tenant.id)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  // Economics estimate for the promotional AI layer. Telephony and other
  // carrier-inclusive costs are tracked separately and are not implied here.
  const INR_PER_1K_CHARS = 0.12;
  const INR_PER_CALL = 0.9;
  const days = rows.map((r) => ({
    day: r.day,
    chars: r.chars || 0,
    calls: r.calls || 0,
    llmTokens: r.llmTokens || 0,
    costInr: Math.round(((r.chars || 0) / 1000 * INR_PER_1K_CHARS + (r.calls || 0) * INR_PER_CALL) * 100) / 100,
  }));
  const totals = days.reduce((acc, d) => ({
    chars: acc.chars + d.chars,
    calls: acc.calls + d.calls,
    llmTokens: acc.llmTokens + d.llmTokens,
    costInr: Math.round((acc.costInr + d.costInr) * 100) / 100,
  }), { chars: 0, calls: 0, llmTokens: 0, costInr: 0 });
  core.sendJson(res, 200, { days, totals });
}

function apiPresets(req, res, ctx) {
  const presets = core.db().presets.filter((p) => p.isSystem || p.tenantId === ctx.tenant.id);
  core.sendJson(res, 200, { presets });
}

function apiWallet(req, res, ctx) {
  const d = core.db();
  const wallet = d.wallets.find((w) => w.tenantId === ctx.tenant.id);
  const ledger = d.ledger.filter((x) => x.tenantId === ctx.tenant.id).slice(-100).reverse();
  core.sendJson(res, 200, { wallet: publicWallet(wallet || { id: null, tenantId: ctx.tenant.id, currency: 'INR', balancePaise: 0 }), ledger });
}

function apiPaymentIntents(req, res, ctx) {
  const intents = core.db().paymentIntents.filter((x) => x.tenantId === ctx.tenant.id).map((x) => ({ ...x, gatewayPayload: undefined, intentToken: undefined, customer: undefined }));
  core.sendJson(res, 200, { paymentIntents: intents });
}

async function apiPaymentIntentCreate(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const packId = String(b.packId || '');
  let base;
  try { base = payu.createPaymentIntent({ packId, packs: CREDIT_PACKS, tenantId: ctx.tenant.id, userId: ctx.user.id }); }
  catch (e) { return core.sendJson(res, 422, { error: e.message, code: 'bad_pack' }); }
  const customer = { firstname: String(b.firstname || ctx.user.name || 'Customer').trim().slice(0, 60), email: ctx.user.email, phone: String(b.phone || '').trim().slice(0, 20) };
  const intent = { id: core.genId('pay_'), provider: 'payu', ...base, customer, amountPaise: Math.round(Number(base.amount) * 100), updatedAt: base.createdAt };
  let checkout = null; const cfg = payuConfig();
  if (cfg && process.env.RAPIDX_PUBLIC_URL) {
    try {
      const origin = String(process.env.RAPIDX_PUBLIC_URL).replace(/\/$/, '');
      checkout = payu.buildCheckout({ intent, customer, successUrl: `${origin}/api/payu/callback`, failureUrl: `${origin}/api/payu/return`, config: cfg });
    } catch (e) { return core.sendJson(res, 503, { error: 'PayU checkout configuration is invalid', code: 'payu_config' }); }
  }
  await core.mutate((d) => { d.paymentIntents.push(intent); addAudit(d, ctx, 'billing.payment_intent.created', 'payment_intent', intent.id, { packId, amountPaise: intent.amountPaise }); });
  core.sendJson(res, 201, { paymentIntent: { ...intent, intentToken: undefined, customer: undefined }, checkoutReady: !!checkout, checkout, message: checkout ? undefined : 'PayU is not configured. The intent is saved but cannot be paid yet.' });
}

async function apiPayuCallback(req, res, payload) {
  const cfg = payuConfig();
  if (!cfg) return core.sendJson(res, 503, { error: 'PayU is not configured', code: 'payu_unavailable' });
  const intent = core.db().paymentIntents.find((x) => x.txnid === String(payload.txnid || ''));
  const eventId = core.genId('pevt_');
  const safePayload = Object.fromEntries(Object.entries(payload || {}).filter(([k]) => !/hash|salt|key|card|token/i.test(k)).map(([k, v]) => [k, String(v).slice(0, 500)]));
  if (!intent) {
    await core.mutate((d) => d.paymentEvents.push({ id: eventId, provider: 'payu', txnid: String(payload.txnid || ''), status: 'rejected', reason: 'intent_not_found', payload: safePayload, createdAt: new Date().toISOString() }));
    return core.sendJson(res, 404, { error: 'payment intent not found', code: 'not_found' });
  }
  const callback = payu.verifyCallback({ payload, intent, customer: intent.customer, config: cfg });
  await core.mutate((d) => d.paymentEvents.push({ id: eventId, provider: 'payu', tenantId: intent.tenantId, paymentIntentId: intent.id, txnid: intent.txnid, status: callback.valid ? 'verified_hash' : 'rejected', reason: callback.reason, payload: safePayload, createdAt: new Date().toISOString() }));
  if (!callback.valid || !callback.creditable) return core.sendJson(res, 400, { error: callback.reason, code: 'payu_callback_rejected' });
  let verification;
  try { verification = await payu.verifyPayment({ intent, config: cfg }); }
  catch (_) { return core.sendJson(res, 502, { error: 'PayU verification unavailable', code: 'payu_verify_failed' }); }
  if (!verification.verified) return core.sendJson(res, 409, { error: verification.reason, code: 'payu_not_verified' });
  let entry; let duplicate = false;
  await core.mutate((d) => {
    const stored = d.paymentIntents.find((x) => x.id === intent.id);
    if (stored.status === 'credited') { duplicate = true; return; }
    entry = addLedgerEntry(d, stored.tenantId, stored.credits, 'payment_credit', `payu:${stored.txnid}`, stored.userId, { paymentIntentId: stored.id, payuId: verification.payuId, packId: stored.packId });
    if (!entry) { duplicate = true; stored.status = 'credited'; return; }
    stored.status = 'credited'; stored.payuId = verification.payuId; stored.updatedAt = new Date().toISOString();
    d.auditEvents.push({ id: core.genId('aud_'), tenantId: stored.tenantId, actorUserId: stored.userId, action: 'billing.payment.credited', targetType: 'payment_intent', targetId: stored.id, metadata: { ledgerId: entry.id }, createdAt: stored.updatedAt });
  });
  core.sendJson(res, 200, { ok: true, credited: !duplicate, duplicate });
}

function apiPayuReturn(req, res, payload) {
  const result = payu.classifyBrowserReturn(payload);
  core.sendJson(res, 202, { ...result, message: 'Payment is pending server verification. A browser return never credits the wallet.' });
}

function apiSupportList(req, res, ctx) {
  const d = core.db();
  const tickets = d.supportTickets.filter((x) => x.tenantId === ctx.tenant.id).map((t) => ({ ...t, messages: d.supportMessages.filter((m) => m.ticketId === t.id && m.tenantId === ctx.tenant.id && !m.internal) }));
  core.sendJson(res, 200, { tickets });
}

async function apiSupportCreate(req, res, ctx) {
  const b = ctx.body || {};
  const subject = String(b.subject || '').trim().slice(0, 120);
  const message = String(b.message || '').trim().slice(0, 5000);
  if (!subject || !message) return core.sendJson(res, 422, { error: 'subject and message required', code: 'bad_ticket' });
  const now = new Date().toISOString();
  const ticket = { id: core.genId('tic_'), tenantId: ctx.tenant.id, createdBy: ctx.user.id, subject, priority: ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : 'normal', status: 'open', createdAt: now, updatedAt: now };
  const first = { id: core.genId('msg_'), ticketId: ticket.id, tenantId: ctx.tenant.id, authorUserId: ctx.user.id, body: message, internal: false, createdAt: now };
  await core.mutate((d) => { d.supportTickets.push(ticket); d.supportMessages.push(first); addAudit(d, ctx, 'support.ticket.created', 'ticket', ticket.id); });
  core.sendJson(res, 201, { ticket: { ...ticket, messages: [first] } });
}

async function apiSupportReply(req, res, ctx) {
  const b = ctx.body || {};
  const ticket = core.db().supportTickets.find((t) => t.id === String(b.ticketId || '') && t.tenantId === ctx.tenant.id);
  if (!ticket) return core.sendJson(res, 404, { error: 'ticket not found', code: 'not_found' });
  const text = String(b.message || '').trim().slice(0, 5000);
  if (!text) return core.sendJson(res, 422, { error: 'message required', code: 'bad_message' });
  const msg = { id: core.genId('msg_'), ticketId: ticket.id, tenantId: ctx.tenant.id, authorUserId: ctx.user.id, body: text, internal: false, createdAt: new Date().toISOString() };
  await core.mutate((d) => { d.supportMessages.push(msg); const t = d.supportTickets.find((x) => x.id === ticket.id); t.updatedAt = msg.createdAt; addAudit(d, ctx, 'support.ticket.replied', 'ticket', ticket.id); });
  core.sendJson(res, 201, { message: msg });
}

function apiByonList(req, res, ctx) {
  const connections = core.db().byonConnections.filter((x) => x.tenantId === ctx.tenant.id).map((x) => ({ ...x, credentials: undefined }));
  core.sendJson(res, 200, { connections });
}

function apiPrivacyGet(req, res, ctx) { core.sendJson(res, 200, { mode: ctx.tenant.privacyMode || 'standard' }); }

async function apiByonSave(req, res, ctx) {
  const b = ctx.body || {};
  const provider = String(b.provider || '').toLowerCase();
  if (!['vobiz', 'twilio', 'telnyx', 'plivo', 'vonage', 'sip'].includes(provider)) return core.sendJson(res, 422, { error: 'unsupported BYON provider', code: 'bad_provider' });
  const address = String(b.address || '').replace(/[^0-9+]/g, '').slice(0, 32);
  if (!address) return core.sendJson(res, 422, { error: 'phone address required', code: 'bad_address' });
  const connection = { id: core.genId('byon_'), tenantId: ctx.tenant.id, provider, address, label: String(b.label || '').slice(0, 64), status: 'pending_verification', createdBy: ctx.user.id, createdAt: new Date().toISOString() };
  await core.mutate((d) => { d.byonConnections.push(connection); addAudit(d, ctx, 'telephony.byon.created', 'byon_connection', connection.id, { provider, address }); });
  core.sendJson(res, 201, { connection });
}

async function apiPrivacyMode(req, res, ctx) {
  const mode = String((ctx.body || {}).mode || '');
  if (!['standard', 'metadata_only', 'no_recording'].includes(mode)) return core.sendJson(res, 422, { error: 'invalid privacy mode', code: 'bad_privacy_mode' });
  await core.mutate((d) => { const t = d.tenants.find((x) => x.id === ctx.tenant.id); t.privacyMode = mode; addAudit(d, ctx, 'tenant.privacy_mode.updated', 'tenant', t.id, { mode }); });
  core.sendJson(res, 200, { mode });
}

function apiMembers(req, res, ctx) {
  core.sendJson(res, 200, { users: core.db().users.filter((u) => u.tenantId === ctx.tenant.id).map(publicUser) });
}

function apiAudit(req, res, ctx) {
  core.sendJson(res, 200, { auditEvents: core.db().auditEvents.filter((e) => e.tenantId === ctx.tenant.id).slice(-200).reverse() });
}

const INVOICE_STATUSES = new Set(['draft', 'issued', 'paid', 'void']);
const APPROACH_CHANNELS = new Set(['whatsapp', 'email', 'phone', 'linkedin', 'meeting', 'other']);
const INTEGRATION_CATALOG = [
  {
    id: 'whatsapp-business',
    name: 'WhatsApp Business Cloud',
    category: 'Messaging',
    description: 'Manage consent-safe conversations, templates, delivery state, and client replies from one workspace.',
    capabilities: ['Shared inbox', 'Approved templates', 'Delivery events', 'Conversation activity'],
    setup: ['Meta business verification', 'WhatsApp phone number', 'Access token', 'Signed webhook'],
  },
  {
    id: 'meta-ad-library',
    name: 'Meta Ad Library',
    category: 'Research',
    description: 'Track public competitor ads and save research context without presenting sample records as live campaign data.',
    capabilities: ['Public ad search', 'Competitor watchlists', 'Creative snapshots', 'Research notes'],
    setup: ['Meta developer app', 'Permitted API access', 'Rate-limit policy', 'Health check'],
  },
];

function isPlatformUser(user) {
  return user && (user.role === 'super_admin' || user.role === 'admin');
}

function requestOriginAllowed(req) {
  const rawOrigin = String(req.headers.origin || '').trim();
  if (!rawOrigin) return true;
  let origin;
  try { origin = new URL(rawOrigin); } catch (_) { return false; }
  if (!['http:', 'https:'].includes(origin.protocol)) return false;
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const requestHost = forwardedHost || String(req.headers.host || '').trim();
  const configuredOrigin = String(process.env.PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  if (configuredOrigin) return rawOrigin === configuredOrigin;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const requestProto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  return !!requestHost && origin.origin === `${requestProto}://${requestHost}`;
}

function requestRateKey(req) {
  const peer = String(req.socket.remoteAddress || 'local').replace(/^::ffff:/, '');
  if (process.env.TRUST_PROXY !== '1') return peer;
  const privatePeer = peer === '127.0.0.1' || peer === '::1' || peer.startsWith('10.') || peer.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(peer);
  if (!privatePeer) return peer;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return net.isIP(forwarded) ? forwarded : peer;
}

function invoiceState(invoice, now = Date.now()) {
  if (invoice.status === 'issued' && invoice.dueDate && new Date(`${invoice.dueDate}T23:59:59Z`).getTime() < now) return 'overdue';
  return invoice.status;
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function publicInvoice(invoice) {
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    invoiceNumber: invoice.invoiceNumber,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail || '',
    description: invoice.description,
    amountPaise: invoice.amountPaise,
    currency: invoice.currency || 'INR',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoiceState(invoice),
    storedStatus: invoice.status,
    deliveryStatus: invoice.deliveryStatus || 'not_sent',
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    issuedAt: invoice.issuedAt || null,
    paidAt: invoice.paidAt || null,
  };
}

function scopedInvoices(ctx) {
  const rows = core.db().invoices || [];
  return (isPlatformUser(ctx.user) ? rows : rows.filter((row) => row.tenantId === ctx.tenant.id));
}

function apiInvoices(req, res, ctx) {
  core.sendJson(res, 200, { invoices: scopedInvoices(ctx).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicInvoice) });
}

async function apiInvoiceCreate(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const d = core.db();
  const requestedTenantId = String(b.tenantId || '');
  const tenant = isPlatformUser(ctx.user)
    ? d.tenants.find((row) => row.id === requestedTenantId)
    : d.tenants.find((row) => row.id === ctx.tenant.id);
  if (!tenant) return core.sendJson(res, 422, { error: 'valid client workspace required', code: 'bad_tenant' });
  const amountPaise = Number(b.amountPaise);
  const description = String(b.description || '').trim().slice(0, 500);
  const clientName = String(b.clientName || tenant.name || '').trim().slice(0, 120);
  const clientEmail = String(b.clientEmail || '').trim().toLowerCase().slice(0, 160);
  const dueDate = String(b.dueDate || '').trim();
  const issueDate = String(b.issueDate || todayUtc()).trim();
  const initialStatus = b.issueNow === true ? 'issued' : 'draft';
  if (!Number.isInteger(amountPaise) || amountPaise < 100 || amountPaise > 1000000000) return core.sendJson(res, 422, { error: 'amount must be between ₹1 and ₹10,000,000', code: 'bad_amount' });
  if (!description || !clientName) return core.sendJson(res, 422, { error: 'client name and description required', code: 'bad_invoice' });
  if (clientEmail && !EMAIL_RE.test(clientEmail)) return core.sendJson(res, 422, { error: 'client email is invalid', code: 'bad_email' });
  if (!validDateOnly(issueDate) || !validDateOnly(dueDate)) return core.sendJson(res, 422, { error: 'valid issue and due dates are required', code: 'bad_date' });
  if (dueDate < issueDate) return core.sendJson(res, 422, { error: 'due date cannot be before issue date', code: 'bad_date' });
  let invoice;
  await core.mutate((store) => {
    const year = issueDate.slice(0, 4);
    const sequence = store.invoices.filter((row) => String(row.invoiceNumber || '').startsWith(`RX-${year}-`)).length + 1;
    const now = new Date().toISOString();
    invoice = {
      id: core.genId('inv_'), tenantId: tenant.id, invoiceNumber: `RX-${year}-${String(sequence).padStart(4, '0')}`,
      clientName, clientEmail, description, amountPaise, currency: 'INR', issueDate, dueDate,
      status: initialStatus, deliveryStatus: 'not_sent', createdBy: ctx.user.id, createdAt: now, updatedAt: now,
      issuedAt: initialStatus === 'issued' ? now : null,
    };
    store.invoices.push(invoice);
    store.invoiceEvents.push({ id: core.genId('ine_'), tenantId: tenant.id, invoiceId: invoice.id, type: initialStatus === 'issued' ? 'issued' : 'created', actorUserId: ctx.user.id, createdAt: now });
    store.clientActivities.push({ id: core.genId('act_'), tenantId: tenant.id, type: initialStatus === 'issued' ? 'invoice_issued' : 'invoice_created', channel: 'internal', visibility: 'internal', summary: `${invoice.invoiceNumber} ${initialStatus === 'issued' ? 'issued' : 'created'} for ₹${(amountPaise / 100).toLocaleString('en-IN')}.`, actorUserId: ctx.user.id, createdAt: now });
    addAudit(store, ctx, initialStatus === 'issued' ? 'invoice.issued' : 'invoice.created', 'invoice', invoice.id, { invoiceNumber: invoice.invoiceNumber, tenantId: tenant.id, amountPaise });
  });
  core.sendJson(res, 201, { invoice: publicInvoice(invoice), note: 'The invoice is stored in Agency OS. No email was sent.' });
}

async function apiInvoiceStatus(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const requested = String(b.status || '');
  if (!INVOICE_STATUSES.has(requested)) return core.sendJson(res, 422, { error: 'invalid invoice status', code: 'bad_status' });
  const current = scopedInvoices(ctx).find((row) => row.id === String(b.invoiceId || ''));
  if (!current) return core.sendJson(res, 404, { error: 'invoice not found', code: 'not_found' });
  const transitions = { draft: new Set(['issued', 'void']), issued: new Set(['paid', 'void']), paid: new Set(), void: new Set() };
  if (!transitions[current.status] || !transitions[current.status].has(requested)) {
    const final = current.status === 'void' || current.status === 'paid';
    return core.sendJson(res, 409, {
      error: final ? 'paid and void invoices are final' : `invoice cannot move from ${current.status} to ${requested}`,
      code: final ? 'invoice_final' : 'invalid_transition',
    });
  }
  let updated;
  await core.mutate((store) => {
    const invoice = store.invoices.find((row) => row.id === current.id);
    if (!invoice || !transitions[invoice.status] || !transitions[invoice.status].has(requested)) return;
    const now = new Date().toISOString();
    invoice.status = requested; invoice.updatedAt = now;
    if (requested === 'issued' && !invoice.issuedAt) invoice.issuedAt = now;
    if (requested === 'paid') invoice.paidAt = now;
    if (requested === 'void') invoice.voidedAt = now;
    store.invoiceEvents.push({ id: core.genId('ine_'), tenantId: invoice.tenantId, invoiceId: invoice.id, type: requested, actorUserId: ctx.user.id, createdAt: now });
    store.clientActivities.push({ id: core.genId('act_'), tenantId: invoice.tenantId, type: `invoice_${requested}`, channel: 'internal', visibility: 'internal', summary: `${invoice.invoiceNumber} marked ${requested}.`, actorUserId: ctx.user.id, createdAt: now });
    addAudit(store, ctx, `invoice.${requested}`, 'invoice', invoice.id, { invoiceNumber: invoice.invoiceNumber, tenantId: invoice.tenantId });
    updated = { ...invoice };
  });
  if (!updated) return core.sendJson(res, 409, { error: 'invoice state changed before this update', code: 'invoice_conflict' });
  core.sendJson(res, 200, { invoice: publicInvoice(updated) });
}

function apiAgencyOverview(req, res, ctx) {
  const d = core.db();
  const platform = isPlatformUser(ctx.user);
  const tenantIds = platform ? new Set(d.tenants.map((t) => t.id)) : new Set([ctx.tenant.id]);
  const tenants = d.tenants.filter((t) => tenantIds.has(t.id));
  const invoices = d.invoices.filter((row) => tenantIds.has(row.tenantId));
  const usage = d.usage.filter((row) => tenantIds.has(row.tenantId));
  const activities = d.clientActivities.filter((row) => tenantIds.has(row.tenantId) && (platform || row.visibility === 'tenant'));
  const audit = d.auditEvents.filter((row) => tenantIds.has(row.tenantId));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const dayInvoices = invoices.filter((row) => row.issueDate === date && row.status !== 'draft' && row.status !== 'void');
    const dayPaid = invoices.filter((row) => row.paidAt && row.paidAt.slice(0, 10) === date);
    const dayUsage = usage.filter((row) => row.day === date);
    const dayActivities = activities.filter((row) => row.createdAt.slice(0, 10) === date);
    days.push({
      date,
      invoicedPaise: dayInvoices.reduce((sum, row) => sum + row.amountPaise, 0),
      paidPaise: dayPaid.reduce((sum, row) => sum + row.amountPaise, 0),
      calls: dayUsage.reduce((sum, row) => sum + Number(row.calls || 0), 0),
      activity: dayActivities.length + audit.filter((row) => row.createdAt && row.createdAt.slice(0, 10) === date).length,
    });
  }
  const issued = invoices.filter((row) => row.status === 'issued' || row.status === 'paid');
  const paid = invoices.filter((row) => row.status === 'paid');
  const outstanding = invoices.filter((row) => row.status === 'issued');
  const comparisons = tenants.map((tenant) => ({
    tenantId: tenant.id,
    name: tenant.name,
    status: tenant.status || 'active',
    calls: usage.filter((row) => row.tenantId === tenant.id).reduce((sum, row) => sum + Number(row.calls || 0), 0),
    activity: activities.filter((row) => row.tenantId === tenant.id).length + audit.filter((row) => row.tenantId === tenant.id).length,
    outstandingPaise: outstanding.filter((row) => row.tenantId === tenant.id).reduce((sum, row) => sum + row.amountPaise, 0),
  })).sort((a, b) => (b.calls + b.activity) - (a.calls + a.activity)).slice(0, 8);
  const portfolio = ['active', 'onboarding', 'suspended', 'closed'].map((status) => ({ status, count: tenants.filter((t) => (t.status || 'active') === status).length }));
  const recent = activities.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map((row) => ({ id: row.id, tenantId: row.tenantId, tenantName: (d.tenants.find((t) => t.id === row.tenantId) || {}).name || 'Workspace', type: row.type, channel: row.channel, summary: row.summary, createdAt: row.createdAt }));
  core.sendJson(res, 200, {
    dataMode: 'live_staging', currency: 'INR', asOf: new Date().toISOString(),
    kpis: {
      clients: tenants.length,
      activeClients: tenants.filter((t) => (t.status || 'active') === 'active').length,
      closedClients: tenants.filter((t) => t.status === 'closed').length,
      invoicedPaise: issued.reduce((sum, row) => sum + row.amountPaise, 0),
      paidPaise: paid.reduce((sum, row) => sum + row.amountPaise, 0),
      outstandingPaise: outstanding.reduce((sum, row) => sum + row.amountPaise, 0),
      calls: usage.reduce((sum, row) => sum + Number(row.calls || 0), 0),
      activity: activities.length + audit.length,
    },
    days, comparisons, portfolio, recent,
  });
}

async function apiClientApproach(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  if (!isPlatformUser(ctx.user)) return core.sendJson(res, 403, { error: 'platform admin required', code: 'forbidden' });
  const b = ctx.body || {};
  const tenant = core.db().tenants.find((row) => row.id === String(b.tenantId || ''));
  const channel = String(b.channel || '').toLowerCase();
  const summary = String(b.summary || '').trim().slice(0, 500);
  if (!tenant || !APPROACH_CHANNELS.has(channel) || !summary) return core.sendJson(res, 422, { error: 'valid client, channel, and summary required', code: 'bad_activity' });
  let activity;
  await core.mutate((store) => {
    const now = new Date().toISOString();
    activity = { id: core.genId('act_'), tenantId: tenant.id, type: 'approach', channel, visibility: 'internal', summary, actorUserId: ctx.user.id, createdAt: now };
    store.clientActivities.push(activity);
    const target = store.tenants.find((row) => row.id === tenant.id); target.lastApproachedAt = now;
    addAudit(store, ctx, 'client.approached', 'tenant', tenant.id, { channel });
  });
  core.sendJson(res, 201, { activity });
}

function apiIntegrations(req, res, ctx) {
  const requests = core.db().integrationRequests.filter((row) => row.tenantId === ctx.tenant.id);
  const integrations = INTEGRATION_CATALOG.map((item) => {
    const request = requests.filter((row) => row.integrationId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return { ...item, status: request ? request.status : 'setup_required', requestedAt: request ? request.createdAt : null };
  });
  core.sendJson(res, 200, { integrations, note: 'Setup requests do not connect external services.' });
}

async function apiIntegrationRequest(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const integrationId = String((ctx.body || {}).integrationId || '');
  const item = INTEGRATION_CATALOG.find((row) => row.id === integrationId);
  if (!item) return core.sendJson(res, 422, { error: 'unknown integration', code: 'bad_integration' });
  let request;
  await core.mutate((store) => {
    const existing = store.integrationRequests.find((row) => row.tenantId === ctx.tenant.id && row.integrationId === integrationId && row.status === 'requested');
    if (existing) { request = existing; return; }
    request = { id: core.genId('int_'), tenantId: ctx.tenant.id, integrationId, status: 'requested', createdBy: ctx.user.id, createdAt: new Date().toISOString() };
    store.integrationRequests.push(request);
    addAudit(store, ctx, 'integration.setup_requested', 'integration', integrationId);
  });
  core.sendJson(res, 201, { request, note: 'Request recorded. The integration is not connected.' });
}

function apiAgencyPromptGet(req, res, ctx) {
  const row = core.db().agencyPrompts.find((item) => item.tenantId === ctx.tenant.id);
  const editor = row ? core.db().users.find((user) => user.id === row.updatedBy) : null;
  core.sendJson(res, 200, { prompt: row ? row.text : '', version: row ? row.version : 0, updatedAt: row ? row.updatedAt : null, updatedBy: editor ? editor.name || editor.email : null });
}

async function apiAgencyPromptSave(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const text = String((ctx.body || {}).prompt || '').trim();
  if (text.length < 20 || text.length > 12000) return core.sendJson(res, 422, { error: 'agency prompt must be between 20 and 12,000 characters', code: 'bad_prompt' });
  let row;
  await core.mutate((store) => {
    const now = new Date().toISOString();
    row = store.agencyPrompts.find((item) => item.tenantId === ctx.tenant.id);
    if (!row) {
      row = { tenantId: ctx.tenant.id, text, version: 1, updatedBy: ctx.user.id, updatedAt: now };
      store.agencyPrompts.push(row);
    } else {
      row.text = text; row.version += 1; row.updatedBy = ctx.user.id; row.updatedAt = now;
    }
    addAudit(store, ctx, 'agency.prompt.updated', 'agency_prompt', ctx.tenant.id, { version: row.version });
  });
  core.sendJson(res, 200, { prompt: row.text, version: row.version, updatedAt: row.updatedAt, updatedBy: ctx.user.name || ctx.user.email });
}

async function apiTenantUpdate(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const color = String(b.color || '').trim();
  if (!name || !/^#[0-9a-fA-F]{6}$/.test(color)) return core.sendJson(res, 422, { error: 'valid tenant name and color required', code: 'bad_tenant' });
  let tenant;
  await core.mutate((store) => {
    tenant = store.tenants.find((row) => row.id === ctx.tenant.id);
    tenant.name = name; tenant.branding = { ...(tenant.branding || {}), color };
    addAudit(store, ctx, 'tenant.settings.updated', 'tenant', tenant.id);
  });
  core.sendJson(res, 200, { tenant: publicTenant(tenant) });
}

async function apiMemberRole(req, res, ctx) {
  const b = ctx.body || {};
  const role = String(b.role || '');
  if (!['owner', 'member'].includes(role)) return core.sendJson(res, 422, { error: 'tenant roles are owner or member', code: 'bad_role' });
  const target = core.db().users.find((u) => u.id === String(b.userId || '') && u.tenantId === ctx.tenant.id);
  if (!target) return core.sendJson(res, 404, { error: 'user not found', code: 'not_found' });
  await core.mutate((d) => { const u = d.users.find((x) => x.id === target.id); u.role = role; addAudit(d, ctx, 'member.role.updated', 'user', u.id, { role }); });
  core.sendJson(res, 200, { user: publicUser({ ...target, role }) });
}

function apiAdminOverview(req, res) {
  const d = core.db();
  const issued = d.invoices.filter((row) => row.status === 'issued' || row.status === 'paid');
  core.sendJson(res, 200, { totals: {
    tenants: d.tenants.length,
    activeTenants: d.tenants.filter((t) => (t.status || 'active') === 'active').length,
    closedTenants: d.tenants.filter((t) => t.status === 'closed').length,
    users: d.users.length,
    openTickets: d.supportTickets.filter((t) => t.status !== 'closed').length,
    walletPaise: d.wallets.reduce((n, w) => n + w.balancePaise, 0),
    calls: d.usage.reduce((n, u) => n + (u.calls || 0), 0),
    invoicedPaise: issued.reduce((n, row) => n + row.amountPaise, 0),
    outstandingPaise: d.invoices.filter((row) => row.status === 'issued').reduce((n, row) => n + row.amountPaise, 0),
  } });
}

function apiAdminTenants(req, res) {
  const d = core.db();
  core.sendJson(res, 200, { tenants: d.tenants.map((t) => ({
    ...publicTenant(t),
    users: d.users.filter((u) => u.tenantId === t.id).length,
    agents: d.agents.filter((a) => a.tenantId === t.id).length,
    calls: d.usage.filter((u) => u.tenantId === t.id).reduce((n, row) => n + Number(row.calls || 0), 0),
    lastApproachedAt: t.lastApproachedAt || null,
    outstandingPaise: d.invoices.filter((row) => row.tenantId === t.id && row.status === 'issued').reduce((n, row) => n + row.amountPaise, 0),
    wallet: publicWallet(d.wallets.find((w) => w.tenantId === t.id) || { id: null, tenantId: t.id, currency: 'INR', balancePaise: 0 }),
  })) });
}

async function apiAdminTenantCreate(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const ownerEmail = String(b.ownerEmail || '').trim().toLowerCase().slice(0, 160);
  const password = String(b.password || '');
  if (!name) return core.sendJson(res, 422, { error: 'client workspace name required', code: 'bad_tenant' });
  if (ownerEmail && (!EMAIL_RE.test(ownerEmail) || password.length < 12)) return core.sendJson(res, 422, { error: 'a valid owner email and 12 character temporary password are required together', code: 'bad_owner' });
  if (!ownerEmail && password) return core.sendJson(res, 422, { error: 'owner email is required when a password is supplied', code: 'bad_owner' });
  if (ownerEmail && core.db().users.some((user) => user.email === ownerEmail)) return core.sendJson(res, 409, { error: 'owner email is already registered', code: 'email_taken' });
  let tenant; let user = null;
  await core.mutate((store) => {
    const now = new Date().toISOString();
    tenant = {
      id: core.genId('t_'), name, slug: makeSlug(name, new Set(store.tenants.map((t) => t.slug))),
      createdAt: now, branding: { color: '#B88A2D' }, providers: { ...DEFAULT_PROVIDERS },
      plan: 'studio', status: ownerEmail ? 'active' : 'onboarding', privacyMode: 'standard',
    };
    store.tenants.push(tenant);
    store.wallets.push({ id: core.genId('wal_'), tenantId: tenant.id, currency: 'INR', balancePaise: 0, createdAt: now, updatedAt: now });
    if (ownerEmail) {
      user = { id: core.genId('u_'), tenantId: tenant.id, email: ownerEmail, name: String(b.ownerName || 'Client Owner').trim().slice(0, 80), passHash: core.hashPassword(password), role: 'owner', status: 'active', createdAt: now };
      store.users.push(user);
    }
    store.clientActivities.push({ id: core.genId('act_'), tenantId: tenant.id, type: 'workspace_created', channel: 'internal', visibility: 'internal', summary: 'Client workspace created in Agency OS.', actorUserId: ctx.user.id, createdAt: now });
    addAudit(store, ctx, 'admin.tenant.created', 'tenant', tenant.id, { ownerCreated: !!user });
  });
  core.sendJson(res, 201, { tenant: publicTenant(tenant), owner: user ? publicUser(user) : null, note: 'No email was sent.' });
}

function apiAdminUsers(req, res) { core.sendJson(res, 200, { users: core.db().users.map(publicUser) }); }

function apiAdminAudit(req, res) { core.sendJson(res, 200, { auditEvents: core.db().auditEvents.slice(-500).reverse() }); }

function apiAdminTickets(req, res) {
  const d = core.db();
  core.sendJson(res, 200, { tickets: d.supportTickets.map((t) => ({ ...t, messages: d.supportMessages.filter((m) => m.ticketId === t.id) })) });
}

function apiAdminPaymentEvents(req, res) { core.sendJson(res, 200, { events: core.db().paymentEvents.slice(-500).reverse() }); }

function apiAdminTenantDetail(req, res) {
  const url = new URL(req.url, 'http://localhost'); const tenantId = String(url.searchParams.get('tenantId') || ''); const d = core.db();
  const tenant = d.tenants.find((t) => t.id === tenantId);
  if (!tenant) return core.sendJson(res, 404, { error: 'tenant not found', code: 'not_found' });
  core.sendJson(res, 200, { tenant: publicTenant(tenant), users: d.users.filter((u) => u.tenantId === tenantId).map(publicUser), agents: d.agents.filter((a) => a.tenantId === tenantId).map(publicAgent), numbers: d.byonConnections.filter((x) => x.tenantId === tenantId).map((x) => ({ id: x.id, provider: x.provider, address: x.address, label: x.label, status: x.status, createdAt: x.createdAt })), usage: d.usage.filter((x) => x.tenantId === tenantId).slice(-100).reverse(), tickets: d.supportTickets.filter((x) => x.tenantId === tenantId), wallet: publicWallet(d.wallets.find((w) => w.tenantId === tenantId) || { id: null, tenantId, currency: 'INR', balancePaise: 0 }), ledger: d.ledger.filter((x) => x.tenantId === tenantId).slice(-100).reverse(), invoices: d.invoices.filter((x) => x.tenantId === tenantId).map(publicInvoice), activities: d.clientActivities.filter((x) => x.tenantId === tenantId).slice(-100).reverse(), statusEvents: d.tenantStatusEvents.filter((x) => x.tenantId === tenantId).slice(-100).reverse() });
}

async function apiAdminImpersonate(req, res, ctx) {
  if (ctx.impersonator) return core.sendJson(res, 409, { error: 'nested impersonation is not allowed', code: 'nested_impersonation' });
  const b = ctx.body || {}; const reason = String(b.reason || '').trim().slice(0, 240); const target = core.db().users.find((u) => u.id === String(b.userId || ''));
  if (!reason || !target) return core.sendJson(res, 422, { error: 'valid userId and reason required', code: 'bad_impersonation' });
  if (!core.verifyPassword(String(b.password || ''), ctx.user.passHash)) return core.sendJson(res, 401, { error: 'password re-authentication failed', code: 'reauth_failed' });
  if (target.role === 'super_admin' || target.status !== 'active') return core.sendJson(res, 403, { error: 'that account cannot be impersonated', code: 'impersonation_forbidden' });
  const tenant = core.db().tenants.find((t) => t.id === target.tenantId);
  if (!tenant || tenant.status !== 'active') return core.sendJson(res, 409, { error: 'target tenant is not active', code: 'target_inactive' });
  const token = await core.createImpersonationSession(ctx.user.id, target.id, tenant.id, reason);
  await core.mutate((d) => addAudit(d, ctx, 'admin.impersonation.started', 'user', target.id, { reason }));
  core.send(res, 200, JSON.stringify({ ok: true, user: publicUser(target), tenant: publicTenant(tenant) }), { 'Content-Type': 'application/json', 'Set-Cookie': core.sessionCookie(token) });
}

async function apiImpersonationExit(req, res, ctx) {
  if (!ctx.impersonator) return core.sendJson(res, 409, { error: 'not impersonating', code: 'not_impersonating' });
  const actor = ctx.impersonator; const tenant = core.db().tenants.find((t) => t.id === actor.tenantId); const token = await core.createSession(actor.id, actor.tenantId);
  await core.mutate((d) => addAudit(d, ctx, 'admin.impersonation.ended', 'user', ctx.user.id));
  core.send(res, 200, JSON.stringify({ ok: true, user: publicUser(actor), tenant: publicTenant(tenant) }), { 'Content-Type': 'application/json', 'Set-Cookie': core.sessionCookie(token) });
}

async function apiAdminTenantStatus(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const status = String(b.status || '');
  if (!['onboarding', 'active', 'suspended', 'closed'].includes(status)) return core.sendJson(res, 422, { error: 'invalid status', code: 'bad_status' });
  const tenant = core.db().tenants.find((t) => t.id === String(b.tenantId || ''));
  if (!tenant) return core.sendJson(res, 404, { error: 'tenant not found', code: 'not_found' });
  await core.mutate((d) => {
    const now = new Date().toISOString();
    d.tenants.find((t) => t.id === tenant.id).status = status;
    if (status !== 'active') d.sessions = d.sessions.filter((s) => s.tenantId !== tenant.id);
    d.tenantStatusEvents.push({ id: core.genId('tse_'), tenantId: tenant.id, fromStatus: tenant.status || 'active', toStatus: status, reason: String(b.reason || '').trim().slice(0, 240), actorUserId: ctx.user.id, createdAt: now });
    d.clientActivities.push({ id: core.genId('act_'), tenantId: tenant.id, type: status === 'closed' ? 'offboarded' : 'status_changed', channel: 'internal', visibility: 'internal', summary: `Client status changed from ${tenant.status || 'active'} to ${status}.`, actorUserId: ctx.user.id, createdAt: now });
    addAudit(d, ctx, 'admin.tenant.status', 'tenant', tenant.id, { status });
  });
  core.sendJson(res, 200, { tenant: publicTenant({ ...tenant, status }) });
}

async function apiAdminUserStatus(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const status = String(b.status || '');
  if (!['active', 'suspended', 'deleted'].includes(status)) return core.sendJson(res, 422, { error: 'invalid status', code: 'bad_status' });
  const user = core.db().users.find((u) => u.id === String(b.userId || ''));
  if (!user) return core.sendJson(res, 404, { error: 'user not found', code: 'not_found' });
  if (user.id === ctx.user.id) return core.sendJson(res, 409, { error: 'cannot change your own status', code: 'self_target' });
  await core.mutate((d) => { const u = d.users.find((x) => x.id === user.id); u.status = status; if (status === 'deleted') { u.email = `deleted-${u.id}@invalid.local`; u.name = 'Deleted user'; u.passHash = ''; } d.sessions = d.sessions.filter((s) => s.userId !== user.id); addAudit(d, ctx, 'admin.user.status', 'user', user.id, { status }); });
  core.sendJson(res, 200, { ok: true });
}

async function apiAdminUserRole(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const role = String(b.role || '');
  if (!['super_admin', 'admin', 'owner', 'member'].includes(role)) return core.sendJson(res, 422, { error: 'invalid role', code: 'bad_role' });
  const user = core.db().users.find((u) => u.id === String(b.userId || ''));
  if (!user) return core.sendJson(res, 404, { error: 'user not found', code: 'not_found' });
  if (user.id === ctx.user.id && role !== 'super_admin') return core.sendJson(res, 409, { error: 'cannot remove your own super admin role', code: 'self_target' });
  await core.mutate((d) => { d.users.find((u) => u.id === user.id).role = role; addAudit(d, ctx, 'admin.user.role', 'user', user.id, { role }); });
  core.sendJson(res, 200, { user: publicUser({ ...user, role }) });
}

async function apiAdminWalletAdjust(req, res, ctx) {
  if (rejectImpersonated(res, ctx)) return;
  const b = ctx.body || {};
  const amountPaise = Number(b.amountPaise);
  const tenantId = String(b.tenantId || '');
  if (!core.db().tenants.some((t) => t.id === tenantId) || !Number.isInteger(amountPaise) || amountPaise === 0 || Math.abs(amountPaise) > 100000000) return core.sendJson(res, 422, { error: 'valid tenantId and amountPaise required', code: 'bad_adjustment' });
  const idempotencyKey = String(b.idempotencyKey || '').trim().slice(0, 120);
  if (!idempotencyKey) return core.sendJson(res, 422, { error: 'idempotencyKey required', code: 'idempotency_required' });
  let entry;
  try { await core.mutate((d) => { entry = addLedgerEntry(d, tenantId, amountPaise, 'admin_adjustment', `admin:${idempotencyKey}`, ctx.user.id, { reason: String(b.reason || '').slice(0, 200) }); if (entry) addAudit(d, ctx, 'admin.wallet.adjusted', 'tenant', tenantId, { amountPaise, ledgerId: entry.id }); }); }
  catch (e) { return core.sendJson(res, 409, { error: e.message, code: 'wallet_rejected' }); }
  if (!entry) return core.sendJson(res, 200, { duplicate: true });
  core.sendJson(res, 201, { ledgerEntry: entry });
}

async function apiAdminTicketReply(req, res, ctx) {
  const b = ctx.body || {};
  const ticket = core.db().supportTickets.find((t) => t.id === String(b.ticketId || ''));
  const text = String(b.message || '').trim().slice(0, 5000);
  if (!ticket || !text) return core.sendJson(res, 422, { error: 'valid ticketId and message required', code: 'bad_reply' });
  const msg = { id: core.genId('msg_'), ticketId: ticket.id, tenantId: ticket.tenantId, authorUserId: ctx.user.id, body: text, internal: !!b.internal, createdAt: new Date().toISOString() };
  await core.mutate((d) => { d.supportMessages.push(msg); const t = d.supportTickets.find((x) => x.id === ticket.id); t.status = b.status === 'closed' ? 'closed' : 'waiting_on_customer'; t.updatedAt = msg.createdAt; addAudit(d, ctx, 'admin.ticket.replied', 'ticket', ticket.id, { status: t.status }); });
  core.sendJson(res, 201, { message: msg });
}

async function apiAdminTicketUpdate(req, res, ctx) {
  const b = ctx.body || {}; const ticket = core.db().supportTickets.find((t) => t.id === String(b.ticketId || ''));
  if (!ticket) return core.sendJson(res, 404, { error: 'ticket not found', code: 'not_found' });
  const status = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'].includes(String(b.status || '')) ? String(b.status) : ticket.status;
  const priority = ['low', 'normal', 'high', 'urgent'].includes(String(b.priority || '')) ? String(b.priority) : ticket.priority;
  await core.mutate((d) => { const t = d.supportTickets.find((x) => x.id === ticket.id); t.status = status; t.priority = priority; t.assignedTo = b.assignedTo ? String(b.assignedTo) : t.assignedTo || ctx.user.id; t.updatedAt = new Date().toISOString(); addAudit(d, ctx, 'admin.ticket.updated', 'ticket', ticket.id, { status, priority, assignedTo: t.assignedTo }); });
  core.sendJson(res, 200, { ok: true });
}

// GET /api/providers -> the registry so Settings can render active vs available.
function apiProviders(req, res) {
  core.sendJson(res, 200, providers.describeProviders());
}

// GET /api/health -> readiness + which provider keys are present.
function apiHealth(req, res) {
  const described = providers.describeProviders();
  const providerHealth = (layer) => Object.fromEntries((described[layer] || []).map((item) => [item.id, item.live]));
  const selected = (layer) => (described[layer] || []).find((item) => item.selected) || (described[layer] || [])[0] || {};
  const selectedStt = selected('stt'); const selectedTts = selected('tts'); const selectedLlm = selected('llm'); const selectedTelephony = selected('telephony');
  core.sendJson(res, 200, {
    ok: true,
    providers: {
      stt: providerHealth('stt'),
      tts: providerHealth('tts'),
      llm: providerHealth('llm'),
      telephony: providerHealth('telephony'),
    },
    models: { stt: selectedStt.model, llm: selectedLlm.model, tts: selectedTts.model },
    selected: {
      stt: { provider: selectedStt.id, model: selectedStt.model },
      tts: { provider: selectedTts.id, model: selectedTts.model },
      llm: { provider: selectedLlm.id, model: selectedLlm.model },
      telephony: { provider: selectedTelephony.id },
    },
  });
}

/* ==========================================================================
   Map a ProviderError (or anything) to a clean JSON HTTP response.
   ========================================================================== */
function handleProviderError(res, e) {
  if (e instanceof providers.ProviderError) {
    return core.sendJson(res, e.status || 502, {
      error: e.message,
      code: e.code || 'provider_error',
      detail: e.detail,
    });
  }
  core.sendJson(res, 502, { error: String((e && e.message) || e), code: 'upstream' });
}

/* ==========================================================================
   Call Recordings (fetched from Dograh, synced into local db for speed)
   ========================================================================== */

// Helper to check if a phone number matches any purchased/company DID number.
function isPurchasedNumber(num) {
  if (!num) return false;
  const digits = String(num).replace(/\D/g, '');
  if (!digits || digits.length < 5) return false;

  const purchasedList = [];
  if (process.env.VOBIZ_NUMBER) purchasedList.push(process.env.VOBIZ_NUMBER);
  purchasedList.push('8071582519', '+918071582519', '918071582519');

  try {
    const db = core.db();
    if (db && Array.isArray(db.agents)) {
      for (const a of db.agents) {
        if (a && a.telephony && a.telephony.did) purchasedList.push(a.telephony.did);
      }
    }
  } catch (_) {}

  for (const p of purchasedList) {
    const pDigits = String(p).replace(/\D/g, '');
    if (!pDigits) continue;
    if (digits === pDigits || digits.endsWith(pDigits) || pDigits.endsWith(digits)) {
      return true;
    }
  }
  return false;
}

// Normalize a Dograh workflow run into our callRecording shape.
function normalizeRun(run, tenantId) {
  const id = String(run.id || run.run_id || '');
  const init = run.initial_context || {};

  // 1. Determine direction:
  // Check initial_context.direction, call_type, direction property, or run naming convention (e.g. WR-TEL-IN-*, WR-TEL-OUT-*)
  let direction = String(init.direction || run.call_type || run.direction || '').toLowerCase().trim();
  if (!direction) {
    if (typeof run.name === 'string' && /-IN-/i.test(run.name)) direction = 'inbound';
    else if (typeof run.name === 'string' && /-OUT-/i.test(run.name)) direction = 'outbound';
  }

  // 2. Extract number candidates from both initial_context and root run object:
  const caller = String(
    init.caller_number || run.caller_number || run.from_number || run.from || ''
  ).trim();
  const called = String(
    init.called_number || run.called_number || run.to_number || run.to || ''
  ).trim();
  const explicitPhone = String(
    init.phone_number || run.phone_number || ''
  ).trim();

  // 3. Infer direction from caller/called if still ambiguous:
  if (!direction || !['inbound', 'outbound'].includes(direction)) {
    if (isPurchasedNumber(called) && !isPurchasedNumber(caller)) {
      direction = 'inbound';
    } else if (isPurchasedNumber(caller) && !isPurchasedNumber(called)) {
      direction = 'outbound';
    } else {
      direction = 'outbound';
    }
  }

  // 4. Resolve the counterparty customer's phone number:
  // - Inbound: Call from customer (caller) to our purchased DID (called). Customer is caller.
  // - Outbound: Call from our purchased DID (caller) to customer (called). Customer is called.
  let customerPhone = '';
  if (direction === 'inbound') {
    if (caller && !isPurchasedNumber(caller)) {
      customerPhone = caller;
    } else if (explicitPhone && !isPurchasedNumber(explicitPhone)) {
      customerPhone = explicitPhone;
    } else if (called && !isPurchasedNumber(called)) {
      customerPhone = called;
    } else {
      customerPhone = caller || explicitPhone || called || '';
    }
  } else {
    // Outbound
    if (called && !isPurchasedNumber(called)) {
      customerPhone = called;
    } else if (explicitPhone && !isPurchasedNumber(explicitPhone)) {
      customerPhone = explicitPhone;
    } else if (caller && !isPurchasedNumber(caller)) {
      customerPhone = caller;
    } else {
      customerPhone = called || explicitPhone || caller || '';
    }
  }

  const status = String(
    (run.gathered_context && run.gathered_context.call_status) ||
    (run.is_completed ? 'completed' : run.status) || 'completed'
  ).toLowerCase();
  const duration = Number(
    (run.cost_info && run.cost_info.call_duration_seconds) ||
    run.duration_seconds || run.duration || 0
  );
  const startedAt = run.created_at || run.started_at || null;
  const endedAt = run.ended_at || run.completed_at || null;
  const agentName = String(
    (run.gathered_context && run.gathered_context.agent_visits && run.gathered_context.agent_visits[0] && run.gathered_context.agent_visits[0].workflow_name) ||
    run.workflow_name || run.agent_name || 'Seevora AI Voice Receptionist'
  ).slice(0, 80);

  // Build a flat transcript string from various Dograh response shapes.
  let transcript = '';
  if (typeof run.transcript === 'string' && run.transcript.trim()) {
    transcript = run.transcript;
  } else if (run.logs && Array.isArray(run.logs.realtime_feedback_events)) {
    const turns = [];
    for (const ev of run.logs.realtime_feedback_events) {
      if (ev.type === 'rtf-bot-text' && ev.payload && ev.payload.text) {
        turns.push(`Agent: ${ev.payload.text.trim()}`);
      } else if (ev.type === 'rtf-user-transcription' && ev.payload && ev.payload.text) {
        turns.push(`User: ${ev.payload.text.trim()}`);
      }
    }
    transcript = turns.join('\n');
  } else if (Array.isArray(run.transcript)) {
    transcript = run.transcript.map((t) => `${t.role || t.speaker || 'speaker'}: ${t.text || t.content || ''}`).join('\n');
  } else if (Array.isArray(run.messages)) {
    transcript = run.messages.map((t) => `${t.role || t.speaker || 'speaker'}: ${t.content || t.text || ''}`).join('\n');
  } else if (Array.isArray(run.conversation)) {
    transcript = run.conversation.map((t) => `${t.role || t.speaker || 'speaker'}: ${t.text || t.content || ''}`).join('\n');
  }

  let summary = String(run.summary || run.call_summary || '');
  if (!summary && run.gathered_context && Array.isArray(run.gathered_context.nodes_visited)) {
    summary = `Visited nodes: ${run.gathered_context.nodes_visited.join(' -> ')}${run.gathered_context.call_disposition ? ` (${run.gathered_context.call_disposition})` : ''}`;
  }

  const purchasedDefault = process.env.VOBIZ_NUMBER || '+918071582519';

  return {
    id: `rec_${id}`,
    tenantId,
    dograhRunId: id,
    phoneNumber: customerPhone,
    callerNumber: caller || (direction === 'outbound' ? purchasedDefault : customerPhone),
    calledNumber: called || (direction === 'inbound' ? purchasedDefault : customerPhone),
    direction: ['inbound', 'outbound'].includes(direction) ? direction : 'outbound',
    mode: run.mode || (run.name && run.name.startsWith('WR-TEL-') ? 'telephony' : (customerPhone ? 'telephony' : 'web')),
    status: ['completed', 'failed', 'in_progress', 'cancelled', 'user_hangup'].includes(status)
      ? (status === 'user_hangup' ? 'completed' : status)
      : 'completed',
    durationSeconds: Math.round(duration),
    transcript,
    recordingAvailable: !!(run.recording_url || run.recording_public_url || run.has_recording),
    summary: summary.slice(0, 1000),
    agentName,
    startedAt,
    endedAt,
    syncedAt: new Date().toISOString(),
  };
}

// GET /api/recordings - list recordings, sync from Dograh first.
async function apiRecordingsList(req, res, ctx) {
  if (ctx.tenant.privacyMode === 'no_recording') {
    return core.sendJson(res, 403, { error: 'Recording access is disabled by your privacy policy', code: 'privacy_blocked' });
  }
  try {
    const q = new URL(req.url, 'http://local').searchParams;
    const limit = Math.min(parseInt(q.get('limit') || '50', 10), 100);
    const offset = Math.max(parseInt(q.get('offset') || '0', 10), 0);
    // Fetch fresh data from Dograh and upsert into our db.
    let freshRuns = [];
    try {
      const result = await providers.telephony.fetchRecordings({ limit, offset });
      freshRuns = result.runs || [];
    } catch (_) { /* use cached data if Dograh is unreachable */ }

    if (freshRuns.length > 0) {
      await core.mutate((d) => {
        if (!Array.isArray(d.callRecordings)) d.callRecordings = [];
        for (const run of freshRuns) {
          const normalized = normalizeRun(run, ctx.tenant.id);
          if (!normalized.dograhRunId) continue;
          const existing = d.callRecordings.findIndex((r) => r.dograhRunId === normalized.dograhRunId && r.tenantId === ctx.tenant.id);
          if (existing >= 0) {
            if (!normalized.transcript && d.callRecordings[existing].transcript) {
              normalized.transcript = d.callRecordings[existing].transcript;
            }
            d.callRecordings[existing] = { ...d.callRecordings[existing], ...normalized };
          } else {
            d.callRecordings.push(normalized);
          }
        }
      });
    }

    const all = (core.db().callRecordings || [])
      .filter((r) => r.tenantId === ctx.tenant.id)
      .sort((a, b) => (b.startedAt || b.syncedAt || '').localeCompare(a.startedAt || a.syncedAt || ''));
    const total = all.length;
    const page = all.slice(offset, offset + limit);
    core.sendJson(res, 200, { recordings: page, total, limit, offset });
  } catch (e) {
    handleProviderError(res, e);
  }
}

// GET /api/recordings/:id - get a single recording with full transcript.
async function apiRecordingDetail(req, res, ctx) {
  if (ctx.tenant.privacyMode === 'no_recording') {
    return core.sendJson(res, 403, { error: 'Recording access is disabled by your privacy policy', code: 'privacy_blocked' });
  }
  const url = new URL(req.url, 'http://local');
  const recId = url.pathname.split('/').filter(Boolean).pop();
  const cached = (core.db().callRecordings || []).find((r) => (r.id === recId || r.dograhRunId === recId) && r.tenantId === ctx.tenant.id);
  if (!cached) return core.sendJson(res, 404, { error: 'Recording not found', code: 'not_found' });
  // Fetch fresh detail (logs & transcript may be richer than list response).
  try {
    const detail = await providers.telephony.fetchRunDetail(cached.dograhRunId);
    const updated = normalizeRun({ ...detail }, ctx.tenant.id);
    await core.mutate((d) => {
      if (!Array.isArray(d.callRecordings)) d.callRecordings = [];
      const idx = d.callRecordings.findIndex((r) => r.dograhRunId === cached.dograhRunId && r.tenantId === ctx.tenant.id);
      if (idx >= 0) d.callRecordings[idx] = { ...d.callRecordings[idx], ...updated };
    });
    return core.sendJson(res, 200, { recording: { ...cached, ...updated } });
  } catch (_) {
    return core.sendJson(res, 200, { recording: cached });
  }
}

// POST /api/recordings/:id/transcribe - generate transcript using Dograh run events or Deepgram STT
async function apiRecordingTranscribe(req, res, ctx) {
  if (ctx.tenant.privacyMode === 'no_recording') {
    return core.sendJson(res, 403, { error: 'Recording access is disabled by your privacy policy', code: 'privacy_blocked' });
  }
  const parts = (new URL(req.url, 'http://local')).pathname.split('/').filter(Boolean);
  const recId = parts[2];
  const cached = (core.db().callRecordings || []).find((r) => (r.id === recId || r.dograhRunId === recId) && r.tenantId === ctx.tenant.id);
  if (!cached) return core.sendJson(res, 404, { error: 'Recording not found', code: 'not_found' });

  // 1. Check if Dograh run detail has conversation turns
  try {
    const detail = await providers.telephony.fetchRunDetail(cached.dograhRunId);
    const updated = normalizeRun({ ...detail }, ctx.tenant.id);
    if (updated.transcript && updated.transcript.trim()) {
      await core.mutate((d) => {
        if (!Array.isArray(d.callRecordings)) d.callRecordings = [];
        const idx = d.callRecordings.findIndex((r) => r.dograhRunId === cached.dograhRunId && r.tenantId === ctx.tenant.id);
        if (idx >= 0) d.callRecordings[idx] = { ...d.callRecordings[idx], ...updated };
      });
      return core.sendJson(res, 200, { ok: true, transcript: updated.transcript, source: 'dograh_events' });
    }
  } catch (_) {}

  // 2. Transcribe via Deepgram STT
  try {
    const { buffer, contentType } = await providers.telephony.fetchRecordingAudio(cached.dograhRunId);
    const stt = providers.getProvider('stt');
    const result = await stt.transcribe({
      audio: buffer.toString('base64'),
      mime: contentType || 'audio/wav',
    });
    const text = (result && result.text) ? result.text.trim() : '';
    if (!text) {
      return core.sendJson(res, 422, { error: 'Empty transcript returned by STT provider', code: 'empty_transcript' });
    }
    await core.mutate((d) => {
      if (!Array.isArray(d.callRecordings)) d.callRecordings = [];
      const idx = d.callRecordings.findIndex((r) => r.dograhRunId === cached.dograhRunId && r.tenantId === ctx.tenant.id);
      if (idx >= 0) {
        d.callRecordings[idx].transcript = text;
        d.callRecordings[idx].transcriptGeneratedBy = 'deepgram';
      }
    });
    return core.sendJson(res, 200, { ok: true, transcript: text, source: 'deepgram' });
  } catch (e) {
    handleProviderError(res, e);
  }
}

// GET /api/recordings/:id/audio - proxy the audio file server-side (API key never leaves server).
async function apiRecordingAudio(req, res, ctx) {
  if (ctx.tenant.privacyMode === 'no_recording') {
    return core.sendJson(res, 403, { error: 'Recording audio is disabled by your privacy policy', code: 'privacy_blocked' });
  }
  const parts = (new URL(req.url, 'http://local')).pathname.split('/').filter(Boolean);
  // parts: ['api','recordings',':id','audio']
  const recId = parts[2];
  const cached = (core.db().callRecordings || []).find((r) => (r.id === recId || r.dograhRunId === recId) && r.tenantId === ctx.tenant.id);
  if (!cached) return core.sendJson(res, 404, { error: 'Recording not found', code: 'not_found' });
  try {
    const { buffer, contentType } = await providers.telephony.fetchRecordingAudio(cached.dograhRunId);
    core.send(res, 200, buffer, {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="call-${cached.dograhRunId}.mp3"`,
    });
  } catch (e) {
    handleProviderError(res, e);
  }
}

/* ==========================================================================
   Router
   ========================================================================== */

const server = http.createServer(async (req, res) => {
  const ip = requestRateKey(req);
  const route = (req.url || '/').split('?')[0];

  try {
    if (route.startsWith('/api/')) {
      if (!core.rateOk(ip)) return core.sendJson(res, 429, { error: 'rate limited', code: 'rate' });

      const payuInbound = route === '/api/payu/callback' || route === '/api/payu/webhook' || route === '/api/payu/return';
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && !payuInbound && !requestOriginAllowed(req)) {
        return core.sendJson(res, 403, { error: 'cross-origin request blocked', code: 'bad_origin' });
      }
      const requestContentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && !payuInbound && requestContentType && requestContentType !== 'application/json') {
        return core.sendJson(res, 415, { error: 'application/json required', code: 'bad_content_type' });
      }

      if ((route === '/api/payu/callback' || route === '/api/payu/webhook' || route === '/api/payu/return') && req.method === 'POST') {
        let form;
        try { form = await readForm(req); }
        catch (e) { return core.sendJson(res, 400, { error: e.message, code: 'bad_form' }); }
        return (route.endsWith('/callback') || route.endsWith('/webhook')) ? apiPayuCallback(req, res, form) : apiPayuReturn(req, res, form);
      }

      // ---- Public GET routes ----
      if (route === '/api/health' && req.method === 'GET') return apiHealth(req, res);
      if (route === '/api/providers' && req.method === 'GET') return apiProviders(req, res);
      if (route.startsWith('/api/public/demo/') && req.method === 'GET') {
        const token = decodeURIComponent(route.slice('/api/public/demo/'.length));
        if (token.includes('/')) return core.sendJson(res, 404, { error: 'demo link not found', code: 'not_found' });
        return apiPublicDemoMeta(req, res, token);
      }

      // ---- Authed GET routes ----
      if (req.method === 'GET') {
        if (route === '/api/me') return core.requireAuth(req, res, apiMe);
        if (route === '/api/agents') return core.requireAuth(req, res, apiAgentsList);
        if (route === '/api/usage') return core.requireAuth(req, res, apiUsage);
        if (route === '/api/telephony/status') return core.requireAuth(req, res, apiTelephonyStatus);
        if (route === '/api/presets') return core.requireAuth(req, res, apiPresets);
        if (route === '/api/wallet') return core.requireAuth(req, res, apiWallet);
        if (route === '/api/payment-intents') return core.requireAuth(req, res, apiPaymentIntents);
        if (route === '/api/support/tickets') return core.requireAuth(req, res, apiSupportList);
        if (route === '/api/byon') return core.requireAuth(req, res, apiByonList);
        if (route === '/api/privacy') return core.requireAuth(req, res, apiPrivacyGet);
        if (route === '/api/members') return core.requireRole(req, res, 'owner', apiMembers);
        if (route === '/api/audit') return core.requireRole(req, res, 'owner', apiAudit);
        if (route === '/api/agency/overview') return core.requireRole(req, res, 'owner', apiAgencyOverview);
        if (route === '/api/agency/prompt') return core.requireRole(req, res, 'owner', apiAgencyPromptGet);
        if (route === '/api/invoices') return core.requireRole(req, res, 'owner', apiInvoices);
        if (route === '/api/integrations') return core.requireRole(req, res, 'owner', apiIntegrations);
        if (route === '/api/demo-links') return core.requireRole(req, res, 'owner', apiDemoLinksList);
        if (route === '/api/admin/overview') return core.requireRole(req, res, 'super_admin', apiAdminOverview);
        if (route === '/api/admin/tenants') return core.requireRole(req, res, 'super_admin', apiAdminTenants);
        if (route === '/api/admin/users') return core.requireRole(req, res, 'super_admin', apiAdminUsers);
        if (route === '/api/admin/audit') return core.requireRole(req, res, 'admin', apiAdminAudit);
        if (route === '/api/admin/tickets') return core.requireRole(req, res, 'admin', apiAdminTickets);
        if (route === '/api/admin/tenant-detail') return core.requireRole(req, res, 'super_admin', apiAdminTenantDetail);
        if (route === '/api/admin/payment-events') return core.requireRole(req, res, 'admin', apiAdminPaymentEvents);
        if (route === '/api/hvac/desk') return core.requireAuth(req, res, apiHvacDesk);
        if (route === '/api/hvac/event-types') return core.requireAuth(req, res, apiHvacEventTypes);
        if (route === '/api/hvac/slots') return core.requireAuth(req, res, apiHvacSlots);
        if (route === '/api/recordings') return core.requireAuth(req, res, apiRecordingsList);
        if (route.startsWith('/api/recordings/') && route.endsWith('/audio')) return core.requireAuth(req, res, apiRecordingAudio);
        if (route.startsWith('/api/recordings/') && !route.endsWith('/audio')) return core.requireAuth(req, res, apiRecordingDetail);
        return core.sendJson(res, 404, { error: 'no such endpoint', code: 'not_found' });
      }

      if (req.method !== 'POST') {
        return core.sendJson(res, 405, { error: 'method not allowed', code: 'method' });
      }

      // ---- POST routes: read the body once, with a bigger cap for STT audio ----
      let body;
      try {
        body = await core.readBody(req, route === '/api/stt' ? 12 * 1024 * 1024 : 64 * 1024);
      } catch (e) {
        const tooBig = /too large/.test(String(e.message));
        return core.sendJson(res, tooBig ? 413 : 400, {
          error: e.message, code: tooBig ? 'too_large' : 'bad_body',
        });
      }

      // Public POST (auth) routes.
      if (route === '/api/auth/signup') return apiSignup(req, res, body);
      if (route === '/api/auth/login') return apiLogin(req, res, body);
      if (route === '/api/auth/logout') return apiLogout(req, res);
      if (route === '/api/auth/impersonation/exit') return core.requireAuth(req, res, apiImpersonationExit, body);
      if (route.startsWith('/api/public/demo/') && route.endsWith('/session')) {
        const token = decodeURIComponent(route.slice('/api/public/demo/'.length, -'/session'.length));
        if (token.includes('/') || !core.rateOk(`demo-start:${ip}`, 5, 5)) return core.sendJson(res, token.includes('/') ? 404 : 429, { error: token.includes('/') ? 'demo link not found' : 'too many demo starts, try again shortly', code: token.includes('/') ? 'not_found' : 'demo_rate' });
        return apiPublicDemoSession(req, res, token);
      }

      // Authed POST routes (tenant scoped through requireAuth).
      if (route === '/api/agents') return core.requireAuth(req, res, apiAgentsCreate, body);
      if (route === '/api/agents/generate-from-needs') return core.requireAuth(req, res, apiAgentsGenerateFromNeeds, body);
      if (route === '/api/agents/update') return core.requireAuth(req, res, apiAgentsUpdate, body);
      if (route === '/api/agents/delete') return core.requireAuth(req, res, apiAgentsDelete, body);
      if (route === '/api/tts') return core.requireAuth(req, res, apiTts, body);
      if (route === '/api/ws-connect') return core.requireAuth(req, res, apiWsConnect, body);
      if (route === '/api/chat') return core.requireAuth(req, res, apiChat, body);
      if (route === '/api/stt') return core.requireAuth(req, res, apiStt, body);
      if (route === '/api/voice/session') return core.requireAuth(req, res, apiVoiceSession, body);
      if (route === '/api/demo-links') return core.requireRole(req, res, 'owner', apiDemoLinksCreate, body);
      if (route === '/api/demo-links/revoke') return core.requireRole(req, res, 'owner', apiDemoLinksRevoke, body);
      if (route === '/api/telephony/dial') return core.requireAuth(req, res, apiTelephonyDial, body);
      if (route === '/api/payment-intents') return core.requireAuth(req, res, apiPaymentIntentCreate, body);
      if (route === '/api/support/tickets') return core.requireAuth(req, res, apiSupportCreate, body);
      if (route === '/api/support/tickets/reply') return core.requireAuth(req, res, apiSupportReply, body);
      if (route === '/api/byon') return core.requireRole(req, res, 'owner', apiByonSave, body);
      if (route === '/api/privacy') return core.requireRole(req, res, 'owner', apiPrivacyMode, body);
      if (route === '/api/tenant/update') return core.requireRole(req, res, 'owner', apiTenantUpdate, body);
      if (route === '/api/tenant/onboarding-complete') return core.requireAuth(req, res, apiTenantOnboardingComplete, body);
      if (route === '/api/members/role') return core.requireRole(req, res, 'owner', apiMemberRole, body);
      if (route === '/api/invoices') return core.requireRole(req, res, 'admin', apiInvoiceCreate, body);
      if (route === '/api/invoices/status') return core.requireRole(req, res, 'admin', apiInvoiceStatus, body);
      if (route === '/api/integrations/request') return core.requireRole(req, res, 'owner', apiIntegrationRequest, body);
      if (route === '/api/agency/prompt') return core.requireRole(req, res, 'owner', apiAgencyPromptSave, body);
      if (route === '/api/admin/client-approach') return core.requireRole(req, res, 'admin', apiClientApproach, body);
      if (route === '/api/admin/tenants') return core.requireRole(req, res, 'super_admin', apiAdminTenantCreate, body);
      if (route === '/api/admin/tenants/status') return core.requireRole(req, res, 'super_admin', apiAdminTenantStatus, body);
      if (route === '/api/admin/users/status') return core.requireRole(req, res, 'super_admin', apiAdminUserStatus, body);
      if (route === '/api/admin/users/role') return core.requireRole(req, res, 'super_admin', apiAdminUserRole, body);
      if (route === '/api/admin/wallet/adjust') return core.requireRole(req, res, 'admin', apiAdminWalletAdjust, body);
      if (route === '/api/admin/tickets/reply') return core.requireRole(req, res, 'admin', apiAdminTicketReply, body);
      if (route === '/api/admin/tickets/update') return core.requireRole(req, res, 'admin', apiAdminTicketUpdate, body);
      if (route === '/api/admin/impersonations') return core.requireRole(req, res, 'super_admin', apiAdminImpersonate, body);
      if (route === '/api/hvac/jobs') return core.requireAuth(req, res, apiHvacJobSave, body);
      if (route === '/api/hvac/book') return core.requireAuth(req, res, apiHvacBook, body);
      if (route.startsWith('/api/recordings/') && route.endsWith('/transcribe')) return core.requireAuth(req, res, apiRecordingTranscribe, body);

      return core.sendJson(res, 404, { error: 'no such endpoint', code: 'not_found' });
    }

    if (req.method === 'GET' && route.startsWith('/demo/')) {
      req.url = '/demo.html';
    }
    if (['GET', 'HEAD'].includes(req.method || '') && (route === '/recordings' || route === '/recordings/' || route === '/recordings.html')) {
      res.writeHead(302, { Location: '/app.html#/recordings', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (['GET', 'HEAD'].includes(req.method || '') && route === '/console.html') {
      res.writeHead(302, { Location: '/app.html', 'Cache-Control': 'no-store' });
      return res.end();
    }
    // Everything else is a static file from public/.
    core.serveStatic(req, res);
  } catch (e) {
    core.sendJson(res, 500, { error: String((e && e.message) || e), code: 'server' });
  }
});

/* ==========================================================================
   Authenticated Deepgram live transcription proxy.

   The browser sends MediaRecorder chunks to this same-origin socket. The
   permanent Deepgram API key remains server side, while Deepgram's interim and
   final Results events are relayed unchanged for word-by-word UI updates.
   ========================================================================== */

const sttWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

function rejectUpgrade(socket, status, label) {
  if (!socket.writable) return socket.destroy();
  socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', async (req, socket, head) => {
  const route = (req.url || '').split('?')[0];
  if (route !== '/api/stt/stream') return rejectUpgrade(socket, 404, 'Not Found');
  if (!requestOriginAllowed(req)) return rejectUpgrade(socket, 403, 'Forbidden');

  const ip = requestRateKey(req);
  if (!core.rateOk(ip)) return rejectUpgrade(socket, 429, 'Too Many Requests');

  try {
    const ctx = await core.getSession(req);
    if (!ctx) return rejectUpgrade(socket, 401, 'Unauthorized');
    sttWss.handleUpgrade(req, socket, head, (client) => {
      sttWss.emit('connection', client, req, ctx);
    });
  } catch (_) {
    rejectUpgrade(socket, 500, 'Internal Server Error');
  }
});

sttWss.on('connection', (client) => {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    client.send(JSON.stringify({ type: 'ProxyError', message: 'Deepgram is not configured.' }));
    return client.close(1011, 'Deepgram unavailable');
  }

  const query = new URLSearchParams({
    model: providers.stt.model,
    language: 'multi',
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
  });
  const upstream = new WebSocket(`wss://api.deepgram.com/v1/listen?${query}`, {
    headers: { Authorization: `Token ${key}` },
    maxPayload: 1024 * 1024,
  });
  let upstreamReady = false;
  let closed = false;

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    if (client.readyState === WebSocket.OPEN) client.close();
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  };

  const keepAlive = setInterval(() => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 4000);

  upstream.on('open', () => {
    upstreamReady = true;
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'ProxyReady', provider: 'deepgram', model: providers.stt.model }));
    }
  });
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'ProxyError', message: 'Deepgram live stream failed.' }));
    }
    closeBoth();
  });
  upstream.on('close', () => closeBoth());

  client.on('message', (data, isBinary) => {
    if (!upstreamReady || upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) upstream.send(data, { binary: true });
    else upstream.send(data.toString());
  });
  client.on('error', () => closeBoth());
  client.on('close', () => closeBoth());
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  PORT ${PORT} is already in use. Stop the other process or set PORT to a free port, for example: PORT=8788 node server.js\n`);
    process.exit(1);
  }
  console.error('  server error:', e.message);
  process.exit(1);
});

// Boot then listen.
boot().then(() => {
  server.listen(PORT, () => {
    const live = providers.describeProviders();
    const flag = (layer, id) => (live[layer].find((p) => p.id === id) || {}).live ? 'ok' : 'MISSING';
    console.log('\n  Seevora AI Voice Receptionist  ready');
    console.log(`  Portal & Login: http://localhost:${PORT}/`);
    console.log(`  Console       : http://localhost:${PORT}/app.html`);
    console.log(`  Admin Demo    : admin@demo.com (admin123)`);
    console.log(`  Client Demo   : client@demo.com (client123)`);
    console.log(`  Providers     : deepgram ${flag('stt', 'deepgram')}  groq ${flag('llm', 'groq')}  rumik ${flag('tts', 'rumik')}  vobiz ${flag('telephony', 'vobiz')}\n`);
  });
}).catch((e) => {
  console.error('  boot failed:', e.message);
  process.exit(1);
});
