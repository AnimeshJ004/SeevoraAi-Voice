/**
 * RapidX Voice. Core runtime primitives. ZERO npm dependencies.
 *
 * One file, pure Node. It gives the rest of the server everything that is not
 * provider specific:
 *   - a tiny .env loader (no dotenv)
 *   - http helpers (send, sendJson, readBody, httpsPost, httpsGet)
 *   - a multi-tenant JSON store over data/db.json with ATOMIC writes and a
 *     serial write queue (no torn files, no lost updates under concurrency)
 *   - auth: scrypt password hashing, opaque session tokens, the rxv_sess cookie,
 *     getSession + requireAuth (tenant scoped)
 *   - a per-IP token-bucket rate limiter
 *   - a static file server with MIME mapping and a path-traversal guard
 *   - htmlEscape for safe DOM injection
 *
 * No em dashes anywhere. Commas and periods only.
 */
'use strict';

const http = require('http');   // referenced for typing clarity, server.js owns createServer
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const clerk = require('./clerk');
const dbSupabase = require('./db-supabase');
const logger = require('./logger');

// Project root is one level up from lib/.
const ROOT = path.join(__dirname, '..');

/* ==========================================================================
   1. .env loader (no dotenv dependency)
   Reads ROOT/.env once. Existing process.env wins, so real shell vars override.
   ========================================================================== */
function loadEnv(force = false) {
  if (process.env.NODE_ENV === 'test' && force) {
    return;
  }
  const candidates = [
    path.resolve(ROOT, '..', '.env'),      // Project root .env (primary source of truth)
    path.resolve(process.cwd(), '.env'),   // Current working directory .env
    path.resolve(ROOT, '.env'),            // dashboard/.env fallback
  ];
  for (const envFile of candidates) {
    try {
      if (!fs.existsSync(envFile)) continue;
      const txt = fs.readFileSync(envFile, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && (force || !(m[1] in process.env))) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
      }
    } catch (_) {
      // .env is optional when the vars are already in the environment.
    }
  }
}

/* ==========================================================================
   2. http helpers
   ========================================================================== */

// Security headers applied to every response.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self), payment=()',
  'Content-Security-Policy-Report-Only': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self' https://secure.payu.in https://test.payu.in",
};

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

/**
 * Read and JSON-parse a request body with a hard size cap. Resolves {} for an
 * empty body. Rejects on oversize payloads or invalid JSON so callers can map
 * to a clean 4xx instead of crashing.
 */
function readBody(req, cap = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let len = 0;
    const chunks = [];
    req.on('data', (c) => {
      len += c.length;
      if (len > cap) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

// Generic HTTPS POST. Resolves { status, headers, buffer }. Times out at 60s.
function httpsPost(host, pathname, headers, bodyBuf) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host, path: pathname, method: 'POST', headers }, (resp) => {
      const parts = [];
      resp.on('data', (d) => parts.push(d));
      resp.on('end', () => resolve({
        status: resp.statusCode,
        headers: resp.headers,
        buffer: Buffer.concat(parts),
      }));
    });
    r.on('error', reject);
    r.setTimeout(60000, () => r.destroy(new Error('upstream timeout')));
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

// Generic HTTPS GET. Resolves { status, headers, buffer }. Times out at 20s.
function httpsGet(host, pathname, headers) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host, path: pathname, method: 'GET', headers }, (resp) => {
      const parts = [];
      resp.on('data', (d) => parts.push(d));
      resp.on('end', () => resolve({
        status: resp.statusCode,
        headers: resp.headers,
        buffer: Buffer.concat(parts),
      }));
    });
    r.on('error', reject);
    r.setTimeout(20000, () => r.destroy(new Error('upstream timeout')));
    r.end();
  });
}

/* ==========================================================================
   3. htmlEscape (XSS guard for any user string injected into the DOM)
   ========================================================================== */
function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   4. Multi-tenant JSON store over data/db.json
   - Lazy load once into memory, cached.
   - Corrupt or missing file falls back to a clean default (try/catch).
   - ATOMIC writes: serialize to data/db.json.tmp then fs.renameSync into place,
     so a crash mid-write never leaves a half file.
   - A serial write queue funnels every mutation through one promise chain so
     two concurrent requests cannot clobber each other (last-write-wins is the
     bug we are preventing: each write reads-modifies-writes under the lock).
   ========================================================================== */

const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.RAPIDX_DB_FILE ? path.resolve(process.env.RAPIDX_DB_FILE) : path.join(DATA_DIR, 'db.json');
const DB_TMP = `${DB_FILE}.tmp`;

function defaultDb() {
  return {
    schemaVersion: 5,
    tenants: [], users: [], agents: [], usage: [], sessions: [],
    wallets: [], ledger: [], paymentIntents: [], supportTickets: [],
    supportMessages: [], auditEvents: [], presets: [], byonConnections: [],
    hvacJobs: [], hvacSettings: [], paymentEvents: [], demoLinks: [],
    invoices: [], invoiceEvents: [], integrationRequests: [], agencyPrompts: [],
    clientActivities: [], tenantStatusEvents: [], callRecordings: [],
    crmContacts: [], crmPipelines: [], waConversations: [], waMessages: [],
    waTemplates: [], waBroadcasts: [], wacrmConfig: [],
    // AI assistant collections (added for assistant chatbot feature)
    assistantThreads: [], assistantActions: [], pendingConfirmations: [],
    assistantSessions: [], assistantIntegrations: [],
    // Sprint-1: Auto-Call (Speed-to-Lead) Webhook Engine
    autoCallWebhooks: [], autoCallSources: [], autoCallLeads: [],
    // Sprint-2: Outbound Voice Campaign + Dialing Queue
    campaigns: [], campaignJobs: [],
    // Sprint-3: Lightweight Knowledge Base (RAG)
    knowledgeBases: [],
    // Sprint-4: Outbound CRM Webhooks Engine
    crmWebhooks: [], crmWebhookLogs: [],
    // Sprint-5: Per-Tenant Dograh Organization Isolation
    dograhOrgs: [],
    // Sprint-6: Booking engine
    bookingSchedules: [], bookingSlots: [],
    // Inbound telephony receptionist config
    inboundConfigs: [],
  };
}

const COLLECTIONS = [
  'tenants', 'users', 'agents', 'usage', 'sessions', 'wallets', 'ledger',
  'paymentIntents', 'supportTickets', 'supportMessages', 'auditEvents',
  'presets', 'byonConnections', 'hvacJobs', 'hvacSettings', 'paymentEvents', 'demoLinks',
  'invoices', 'invoiceEvents', 'integrationRequests', 'agencyPrompts',
  'clientActivities', 'tenantStatusEvents', 'callRecordings',
  'crmContacts', 'crmPipelines', 'waConversations', 'waMessages',
  'waTemplates', 'waBroadcasts', 'wacrmConfig',
  'assistantThreads', 'assistantActions', 'pendingConfirmations',
  'assistantSessions', 'assistantIntegrations',
  // Sprint collections
  'autoCallWebhooks', 'autoCallSources', 'autoCallLeads',
  'campaigns', 'campaignJobs',
  'knowledgeBases',
  'crmWebhooks', 'crmWebhookLogs',
  'dograhOrgs',
  'bookingSchedules', 'bookingSlots',
  'inboundConfigs',
];

function migrateDb(parsed) {
  const out = Object.assign(defaultDb(), parsed || {});
  for (const k of COLLECTIONS) if (!Array.isArray(out[k])) out[k] = [];
  out.schemaVersion = 5;
  for (const tenant of out.tenants) {
    if (!tenant.status) tenant.status = 'active';
    if (!tenant.privacyMode) tenant.privacyMode = 'standard';
    // Sprint-5: Provision a Dograh org slug per tenant (deterministic, idempotent)
    if (!tenant.dograhOrgId) {
      tenant.dograhOrgId = 'org_' + tenant.id.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }
  }
  for (const user of out.users) {
    if (!['super_admin', 'admin', 'owner', 'member', 'client'].includes(user.role)) user.role = 'member';
    if (!user.status) user.status = 'active';
  }
  return out;
}

let _db = null;        // in-memory cache
let _writeChain = Promise.resolve(); // serial queue tail

function ensureDataDir() {
  try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); } catch (_) {}
}

// Load db.json into memory. On a missing or corrupt file, return a fresh default
// (the caller is expected to seed and persist).
function loadDb() {
  if (_db) return _db;
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Defensive: guarantee every collection exists even if the file is partial.
    _db = migrateDb(parsed);
  } catch (_) {
    _db = defaultDb();
  }
  return _db;
}

// Synchronous atomic flush of the current in-memory db to disk.
function flushSync() {
  ensureDataDir();
  const json = JSON.stringify(_db, null, 2);
  try {
    fs.writeFileSync(DB_TMP, json, { mode: 0o600 });
    try { fs.chmodSync(DB_TMP, 0o600); } catch (_) {}
    fs.renameSync(DB_TMP, DB_FILE);
    try { fs.chmodSync(DB_FILE, 0o600); } catch (_) {}
  } catch (_) {
    try {
      fs.writeFileSync(DB_FILE, json, { mode: 0o600 });
    } catch (_) {}
  }
}

let _lastSupabaseSync = 0;
function syncMutationsToSupabase(d) {
  if (!dbSupabase.isConfigured() || process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  if (now - _lastSupabaseSync < 300) return; // Debounce rapid writes
  _lastSupabaseSync = now;

  try {
    const tenants = (d.tenants || []).slice(-3);
    for (const t of tenants) dbSupabase.persistTenant(t);

    const users = (d.users || []).slice(-3);
    for (const u of users) dbSupabase.persistUser(u);

    const wallets = (d.wallets || []).slice(-3);
    for (const w of wallets) dbSupabase.persistWallet(w);

    const agents = (d.agents || []).slice(-3);
    for (const a of agents) dbSupabase.persistAgent(a);

    const recs = (d.callRecordings || []).slice(-3);
    for (const r of recs) dbSupabase.persistRecording(r);

    const ledger = (d.ledger || []).slice(-3);
    for (const l of ledger) dbSupabase.recordLedgerEntry(l);
  } catch (_) {}
}

/**
 * Run a mutation against the db under the serial write lock.
 * `fn(db)` receives the live in-memory db, may mutate it, and may return a value
 * which becomes the resolved value of the returned promise. The db is flushed
 * atomically after fn runs. Errors inside fn reject without flushing a partial.
 */
function mutate(fn) {
  const run = async () => {
    const db = loadDb();
    const out = await fn(db);
    flushSync();
    syncMutationsToSupabase(db);
    return out;
  };
  // Chain onto the tail so writes execute one at a time, in order. We swallow
  // the previous result/error for the chain itself but surface this run's own
  // result to the caller.
  const next = _writeChain.then(run, run);
  _writeChain = next.catch(() => {});
  return next;
}

// Read-only snapshot accessor (no lock needed, callers must not mutate it).
function db() {
  return loadDb();
}

/* ==========================================================================
   5. Auth: scrypt password hashing, sessions, cookie, requireAuth
   ========================================================================== */

// Password hash format: scrypt$<saltHex>$<hashHex>
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Constant-time verify against the stored scrypt$salt$hash string.
function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = 'rxv_sess';

// Create a session row for a user, persist it, return the opaque token.
async function createSession(userId, tenantId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  await mutate((d) => {
    // 1. Prune any already-expired sessions (housekeeping).
    d.sessions = d.sessions.filter((s) => s.exp > Date.now());
    // 2. Cap active concurrent sessions per user (10 max) to prevent session table exhaustion.
    const userSessions = d.sessions.filter((s) => s.userId === userId);
    if (userSessions.length >= 10) {
      const oldest = userSessions.sort((a, b) => a.exp - b.exp)[0];
      if (oldest) {
        d.sessions = d.sessions.filter((s) => s !== oldest);
      }
    }
    d.sessions.push({ tokenHash, userId, tenantId, exp });
  });
  return token;
}

const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

async function createImpersonationSession(actorUserId, targetUserId, targetTenantId, reason) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const exp = Date.now() + IMPERSONATION_TTL_MS;
  await mutate((d) => {
    d.sessions = d.sessions.filter((s) => s.exp > Date.now());
    d.sessions.push({ tokenHash, userId: targetUserId, tenantId: targetTenantId, exp, impersonatorUserId: actorUserId, impersonationReason: String(reason || '').slice(0, 240) });
  });
  return token;
}

// Build the Set-Cookie header value for a fresh session.
function sessionCookie(token, req) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const proto = (req && req.headers && (req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http'))) || 'http';
  const isHttps = proto.toLowerCase() === 'https' ||
    (req && req.headers && req.headers.origin && req.headers.origin.startsWith('https://')) ||
    (req && req.headers && req.headers.referer && req.headers.referer.startsWith('https://'));
  const isSecureExplicit = process.env.COOKIE_SECURE === 'true';
  const isSecureDisabled = process.env.COOKIE_SECURE === 'false';
  const secure = (isSecureExplicit || (isHttps && !isSecureDisabled)) ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

// Build the Set-Cookie header value that clears the session.
function clearCookie(req) {
  const proto = (req && req.headers && (req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http'))) || 'http';
  const isHttps = proto.toLowerCase() === 'https' ||
    (req && req.headers && req.headers.origin && req.headers.origin.startsWith('https://')) ||
    (req && req.headers && req.headers.referer && req.headers.referer.startsWith('https://'));
  const isSecureExplicit = process.env.COOKIE_SECURE === 'true';
  const isSecureDisabled = process.env.COOKIE_SECURE === 'false';
  const secure = (isSecureExplicit || (isHttps && !isSecureDisabled)) ? '; Secure' : '';
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

// Parse the request cookie header for our session token.
function parseCookieToken(req) {
  const raw = (req && req.headers && req.headers.cookie) || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return '';
}

/**
 * Resolve the session for a request. Returns { session, user, tenant } when the
 * cookie maps to a live, unexpired session whose user and tenant still exist.
 * A tampered or expired cookie resolves to null (treated as no session).
 * Expired sessions are removed as a side effect.
 */
async function getSession(req) {
  // 1. Support Clerk tokens via Bearer Authorization header or __session cookie
  const clerkToken = clerk.extractToken(req);
  if (clerkToken && clerkToken.includes('.')) {
    try {
      // Cryptographically verify RS256 signature, expiration, and claims
      const verifiedResult = await clerk.verifyClerkToken(clerkToken);
      const claims = verifiedResult.claims;
      if (claims && claims.sub) {
        const d = db();
        // Strict privacy: A user account is strictly keyed to their unique Clerk sub
        let user = d.users.find((u) => u.clerkUserId === claims.sub);

        let clerkUser = verifiedResult.user || null;
        let headerEmail = '';
        let headerName = '';
        try {
          if (req.headers && req.headers['x-clerk-user-email']) headerEmail = decodeURIComponent(req.headers['x-clerk-user-email']);
          if (req.headers && req.headers['x-clerk-user-name']) headerName = decodeURIComponent(req.headers['x-clerk-user-name']);
        } catch (_) {}
        let email = claims.email || (claims.primary_email_address) || headerEmail || '';
        let name = claims.name || headerName || '';
        const clientHeaderOnboarded = req.headers && req.headers['x-clerk-onboarded'] === '1';

        // Extract role strictly from verified Clerk public_metadata or verified Clerk Backend API.
        // NEVER trust client-writable unsafe_metadata, untrusted root claims, or client headers!
        const publicMeta = claims.public_metadata || claims.publicMetadata || (clerkUser && clerkUser.publicMetadata) || {};
        let role = (publicMeta.role === 'super_admin' || publicMeta.role === 'admin') ? publicMeta.role : 'client';
        let plan = publicMeta.plan || 'starter';

        const needsClerkFetch = process.env.CLERK_SECRET_KEY && (
          !user ||
          ((!user.email || user.email.includes('@clerk.user')) && !headerEmail) ||
          ((!user.name || user.name.startsWith('user_')) && !headerName) ||
          !user.clerkRoleCheckedAt ||
          (Date.now() - user.clerkRoleCheckedAt > 300000)
        );

        if (needsClerkFetch) {
          try {
            clerkUser = await clerk.getClerkUser(claims.sub);
            if (clerkUser) {
              if (clerkUser.email) email = clerkUser.email;
              if (clerkUser.name && !clerkUser.name.startsWith('user_')) name = clerkUser.name;
              const metaRole = clerkUser.publicMetadata && clerkUser.publicMetadata.role;
              // Admin role must only be assigned if explicitly set in Clerk publicMetadata
              if (metaRole === 'super_admin' || metaRole === 'admin') {
                role = metaRole;
              } else {
                role = 'client';
              }
              if (clerkUser.publicMetadata && clerkUser.publicMetadata.plan) {
                plan = clerkUser.publicMetadata.plan;
              }
            }
          } catch (_) {}
        }

        // If existing user, synchronize role, real name, email, or onboarding state
        if (user) {
          const targetRole = role || 'client';
          const isFallbackName = !user.name || user.name.startsWith('user_') || /^User [a-zA-Z0-9]{4}$/.test(user.name);
          const shouldUpdateName = isFallbackName && name && !name.startsWith('user_') && !/^User [a-zA-Z0-9]{4}$/.test(name);
          const shouldUpdateEmail = (!user.email || user.email.includes('@clerk.user')) && email && !email.includes('@clerk.user');
          const userEmail = email || user.email;
          const wasEverOnboarded = !!(userEmail && d.users.some((x) => x.email && x.email.toLowerCase() === userEmail.toLowerCase() && x.onboardingCompleted));
          const shouldUpdateOnboard = (clientHeaderOnboarded || wasEverOnboarded || (clerkUser && clerkUser.publicMetadata && clerkUser.publicMetadata.onboardingCompleted)) && !user.onboardingCompleted;
          const shouldUpdateRole = user.role !== targetRole || !user.clerkRoleCheckedAt || (Date.now() - user.clerkRoleCheckedAt > 300000);

          if (shouldUpdateRole || shouldUpdateName || shouldUpdateEmail || shouldUpdateOnboard) {
            await mutate((mutDb) => {
              const u = mutDb.users.find((x) => x.id === user.id);
              if (u) {
                if (shouldUpdateRole) {
                  u.role = targetRole;
                  u.clerkRoleCheckedAt = Date.now();
                }
                if (shouldUpdateName) u.name = name;
                if (shouldUpdateEmail) u.email = email;
                if (shouldUpdateOnboard) u.onboardingCompleted = true;
              }
              const t = mutDb.tenants.find((x) => x.id === user.tenantId);
              if (t) {
                if (shouldUpdateName && (t.name.startsWith('user_') || /Workspace$/.test(t.name))) {
                  t.name = `${name}'s Workspace`;
                }
                if (shouldUpdateOnboard) t.onboardingCompleted = true;
              }
            });
            if (shouldUpdateRole) {
              user.role = targetRole;
              user.clerkRoleCheckedAt = Date.now();
            }
            if (shouldUpdateName) user.name = name;
            if (shouldUpdateEmail) user.email = email;
            if (shouldUpdateOnboard) {
              user.onboardingCompleted = true;
              if (tenant) tenant.onboardingCompleted = true;
            }
          }
        }

        let tenant = user ? d.tenants.find((t) => t.id === user.tenantId) : null;

        if (!user) {
          if (!name || name.startsWith('user_')) {
            const handle = email && !email.includes('@clerk.user') ? email.split('@')[0] : '';
            name = handle ? (handle.charAt(0).toUpperCase() + handle.slice(1)) : (claims.sub ? `User ${claims.sub.slice(-4)}` : 'User');
          }

          email = email || `${claims.sub}@clerk.user`;

          const tenantId = genId('t_');
          const userId = genId('u_');
          const existingUserWithEmail = d.users.find((x) => x.email && email && x.email.toLowerCase() === email.toLowerCase() && x.onboardingCompleted);
          const clerkOnboarded = !!(
            (clerkUser && clerkUser.publicMetadata && clerkUser.publicMetadata.onboardingCompleted) ||
            clientHeaderOnboarded ||
            existingUserWithEmail
          );

          tenant = {
            id: tenantId,
            name: `${name}'s Workspace`,
            slug: `tenant-${tenantId.slice(2)}`,
            plan,
            status: 'active',
            onboardingCompleted: clerkOnboarded,
            createdAt: new Date().toISOString(),
          };

          user = {
            id: userId,
            tenantId,
            clerkUserId: claims.sub,
            email,
            name,
            role: role || 'client',
            status: 'active',
            clerkRoleCheckedAt: Date.now(),
            onboardingCompleted: clerkOnboarded,
            createdAt: new Date().toISOString(),
          };

          await mutate((mutDb) => {
            mutDb.tenants.push(tenant);
            mutDb.users.push(user);
            if (!mutDb.wallets.some((w) => w.tenantId === tenantId)) {
              mutDb.wallets.push({ id: genId('wal_'), tenantId, currency: 'INR', balancePaise: 1000, updatedAt: new Date().toISOString() });
            }
          });

          if (process.env.CLERK_SECRET_KEY && claims.sub) {
            clerk.updateClerkMetadata(claims.sub, {
              publicMetadata: {
                role: user.role || 'client',
                plan: tenant.plan || 'starter',
                billingStatus: 'active',
                billingInterval: 'monthly',
                tenantId: tenant.id,
                credits: 1000,
                onboardingCompleted: Boolean(clerkOnboarded),
              }
            }).catch((err) => {
              logger.error('Clerk initial publicMetadata sync failed', { error: err.message });
            });
          }
        } else if (!tenant) {
          const tenantId = user.tenantId || genId('t_');
          tenant = {
            id: tenantId,
            name: `${user.name || 'My'}'s Workspace`,
            slug: `tenant-${tenantId.slice(2)}`,
            plan: 'starter',
            status: 'active',
            onboardingCompleted: !!user.onboardingCompleted,
            createdAt: new Date().toISOString(),
          };
          await mutate((mutDb) => {
            const u = mutDb.users.find((x) => x.id === user.id);
            if (u) u.tenantId = tenantId;
            mutDb.tenants.push(tenant);
            if (!mutDb.wallets.some((w) => w.tenantId === tenantId)) {
              mutDb.wallets.push({ id: genId('wal_'), tenantId, currency: 'INR', balancePaise: 1000, updatedAt: new Date().toISOString() });
            }
          });
        }

        if (user && tenant) {
          // Self-heal: If user has a dummy "user_..." name or email, fetch the real Clerk name/email
          const hasDummyName = !user.name || user.name.startsWith('user_');
          const hasDummyTenant = !tenant.name || tenant.name.startsWith('user_');
          const hasDummyEmail = !user.email || user.email.includes('@clerk.user');

          if (hasDummyName || hasDummyTenant || hasDummyEmail) {
            let realEmail = user.email;
            let realName = user.name;
            if (process.env.CLERK_SECRET_KEY && !clerkUser) {
              try {
                clerkUser = await clerk.getClerkUser(claims.sub);
              } catch (_) {}
            }
            if (clerkUser) {
              if (clerkUser.email) realEmail = clerkUser.email;
              if (clerkUser.name && !clerkUser.name.startsWith('user_')) realName = clerkUser.name;
            }
            if (!realName || realName.startsWith('user_')) {
              const handle = realEmail && !realEmail.includes('@clerk.user') ? realEmail.split('@')[0] : '';
              realName = handle ? (handle.charAt(0).toUpperCase() + handle.slice(1)) : 'User';
            }
            const tenantTitle = `${realName}'s Workspace`;
            await mutate((mutDb) => {
              const u = mutDb.users.find((x) => x.id === user.id);
              if (u) {
                u.name = realName;
                if (realEmail && !realEmail.includes('@clerk.user')) u.email = realEmail;
              }
              const t = mutDb.tenants.find((x) => x.id === tenant.id);
              if (t && (!t.name || t.name.startsWith('user_'))) {
                t.name = tenantTitle;
              }
            });
            user.name = realName;
            if (realEmail && !realEmail.includes('@clerk.user')) user.email = realEmail;
            if (!tenant.name || tenant.name.startsWith('user_')) tenant.name = tenantTitle;
          }

          // Auto-heal onboarding status if admin, tenant has active agent, or Clerk has metadata
          const isAdmin = ['admin', 'super_admin'].includes(user.role);
          const hasAgents = d.agents && d.agents.some((a) => a.tenantId === tenant.id);
          const clerkOnboarded = !!(clerkUser && clerkUser.publicMetadata && clerkUser.publicMetadata.onboardingCompleted);
          const isFinished = !!(isAdmin || user.onboardingCompleted || tenant.onboardingCompleted || hasAgents || clerkOnboarded);

          if (isFinished && (!user.onboardingCompleted || !tenant.onboardingCompleted)) {
            user.onboardingCompleted = true;
            tenant.onboardingCompleted = true;
            await mutate((mutDb) => {
              const u = mutDb.users.find((x) => x.id === user.id);
              if (u) u.onboardingCompleted = true;
              const t = mutDb.tenants.find((x) => x.id === tenant.id);
              if (t) t.onboardingCompleted = true;
            });
          }
        }

        if (user && tenant && user.status === 'active' && tenant.status === 'active') {
          return {
            session: { token: clerkToken, userId: user.id, tenantId: tenant.id, clerkUserId: claims.sub },
            user,
            tenant,
            impersonator: null,
          };
        }
      }
    } catch (clerkErr) {
      logger.warn('Clerk session resolution non-fatal warning', { error: clerkErr.message });
      // Fall through to standard cookie session
    }
  }

  // 2. Fall back to standard session cookie
  const token = parseCookieToken(req);
  if (!token || token.length < 16) return null;
  const d = db();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = d.sessions.find((s) => s.tokenHash === tokenHash || s.token === token);
  if (!session) return null;
  if (session.exp <= Date.now()) {
    // Expired: drop it so the next request is clean.
    await mutate((dd) => {
      dd.sessions = dd.sessions.filter((s) => s.token !== token && s.tokenHash !== tokenHash);
    });
    return null;
  }
  const user = d.users.find((u) => u.id === session.userId);
  const tenant = d.tenants.find((t) => t.id === session.tenantId);
  if (!user || !tenant || user.status !== 'active' || tenant.status !== 'active') return null;
  const impersonator = session.impersonatorUserId ? d.users.find((u) => u.id === session.impersonatorUserId && u.status === 'active') : null;
  if (session.impersonatorUserId && (!impersonator || (impersonator.role !== 'admin' && impersonator.role !== 'super_admin'))) return null;
  return { session, user, tenant, impersonator };
}

// Remove a session by token (logout).
async function destroySession(req) {
  const token = parseCookieToken(req);
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await mutate((d) => { d.sessions = d.sessions.filter((s) => s.token !== token && s.tokenHash !== tokenHash); });
}

const ROLE_LEVEL = { client: 1, member: 1, owner: 1, admin: 3, super_admin: 3 };
function hasRole(user, minimum) {
  return (ROLE_LEVEL[user && user.role] || 0) >= (ROLE_LEVEL[minimum] || 99);
}

async function requireRole(req, res, minimum, handler, body) {
  return requireAuth(req, res, (r, s, ctx) => {
    if (!hasRole(ctx.user, minimum)) return sendJson(s, 403, { error: 'insufficient role', code: 'forbidden' });
    return handler(r, s, ctx);
  }, body);
}

/**
 * Gate a handler behind auth. Resolves the session; on success calls
 * handler(req, res, ctx) where ctx = { user, tenant, session, body }. On a
 * missing or invalid session, replies 401 and clears any stale cookie.
 * Every authed route is therefore tenant scoped via ctx.tenant.id.
 */
async function requireAuth(req, res, handler, body) {
  const ctx = await getSession(req);
  if (!ctx) {
    const headers = { 'Content-Type': 'application/json' };
    if (parseCookieToken(req)) {
      headers['Set-Cookie'] = clearCookie(req);
    }
    return send(res, 401, JSON.stringify({ error: 'authentication required', code: 'no_session' }), headers);
  }
  return handler(req, res, { ...ctx, body });
}

/* ==========================================================================
   6. Per-IP token-bucket rate limiter (90 req / 60s, refilling)
   ========================================================================== */
const _buckets = new Map();
function rateOk(ip, capacity = 90, perMinute = 90) {
  const now = Date.now();
  let b = _buckets.get(ip);
  if (!b) { b = { tokens: capacity, ts: now }; _buckets.set(ip, b); }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.ts) / 60000) * perMinute);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/* ==========================================================================
   7. Static file server with MIME map + path-traversal guard
   ========================================================================== */
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  // Resolve against PUBLIC_DIR and verify the result stays inside it. This
  // catches .., encoded traversal, and absolute escapes in one check.
  const resolved = path.normalize(path.join(PUBLIC_DIR, p));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 400, 'bad path');
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      // Single-page app and marketing both live as real files, so a 404 here is
      // a genuine missing asset. Keep it plain.
      return send(res, 404, 'not found');
    }
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
  });
}

/* ==========================================================================
   8. id & clerk sync helpers
   ========================================================================== */
function genId(prefix) {
  return prefix + crypto.randomBytes(8).toString('hex');
}

const _clerkSyncInFlight = new Map();
let _clerkRateLimitedUntil = 0;

/**
 * Pushes the user's role, plan, tenantId, credits, and onboarding status
 * to Clerk's public_metadata so the Clerk Dashboard displays full user metadata.
 * Uses in-flight deduplication and optional throttling to prevent 429 rate limit errors.
 */
async function syncClerkMetadataForUser(userIdOrClerkId, options = {}) {
  if (!process.env.CLERK_SECRET_KEY) return null;
  const force = Boolean(options && (options.force || options === true));
  const throttle = Boolean(options && options.throttle);

  // If Clerk returned 429 previously, wait until backoff expires
  if (Date.now() < _clerkRateLimitedUntil && !force) return null;

  const d = db();
  const user = d.users.find((u) => u.id === userIdOrClerkId || u.clerkUserId === userIdOrClerkId);
  if (!user || !user.clerkUserId) return null;

  // Throttle: don't re-sync if already synced within the last 10 minutes when throttle is requested
  if (throttle && !force && user.clerkSyncedAt && (Date.now() - user.clerkSyncedAt < 600000)) {
    return null;
  }

  // Deduplicate in-flight promises so concurrent requests share one call
  if (_clerkSyncInFlight.has(user.clerkUserId)) {
    return _clerkSyncInFlight.get(user.clerkUserId);
  }

  const syncPromise = (async () => {
    try {
      const tenant = d.tenants.find((t) => t.id === user.tenantId) || { id: user.tenantId, plan: 'starter', status: 'active', billingInterval: 'monthly' };
      const wallet = (d.wallets || []).find((w) => w.tenantId === tenant.id) || { balancePaise: 1000 };
      const isFinished = Boolean(user.onboardingCompleted || tenant.onboardingCompleted);

      // Check current Clerk metadata so we never clobber an admin assignment made in Clerk Dashboard!
      let effectiveRole = user.role || 'client';
      try {
        const remoteUser = await clerk.getClerkUser(user.clerkUserId);
        if (remoteUser && remoteUser.publicMetadata && remoteUser.publicMetadata.role) {
          if (remoteUser.publicMetadata.role === 'admin' || remoteUser.publicMetadata.role === 'super_admin') {
            effectiveRole = remoteUser.publicMetadata.role;
            if (user.role !== effectiveRole) {
              await mutate((mutDb) => {
                const mu = mutDb.users.find((x) => x.id === user.id);
                if (mu) {
                  mu.role = effectiveRole;
                  mu.clerkRoleCheckedAt = Date.now();
                }
              });
              user.role = effectiveRole;
            }
          }
        }
      } catch (_) {}

      const payload = {
        role: effectiveRole,
        plan: tenant.plan || 'starter',
        billingStatus: tenant.planStatus || tenant.status || 'active',
        billingInterval: tenant.billingInterval || 'monthly',
        tenantId: tenant.id,
        credits: wallet.balancePaise,
        onboardingCompleted: isFinished,
      };

      const updated = await clerk.updateClerkMetadata(user.clerkUserId, {
        publicMetadata: payload,
      });

      await mutate((mutDb) => {
        const mu = mutDb.users.find((x) => x.id === user.id);
        if (mu) mu.clerkSyncedAt = Date.now();
      });
      user.clerkSyncedAt = Date.now();
      return updated;
    } catch (err) {
      if (err && (err.statusCode === 429 || (err.message && err.message.includes('Too many requests')))) {
        // Backoff for 2 minutes and fail silently without throwing unhandled rejection
        _clerkRateLimitedUntil = Date.now() + 120000;
        return null;
      }
      throw err;
    } finally {
      _clerkSyncInFlight.delete(user.clerkUserId);
    }
  })();

  _clerkSyncInFlight.set(user.clerkUserId, syncPromise);
  return syncPromise;
}

module.exports = {
  ROOT, DATA_DIR, DB_FILE, PUBLIC_DIR,
  loadEnv,
  send, sendJson, readBody, httpsPost, httpsGet,
  htmlEscape,
  db, mutate, loadDb, defaultDb, migrateDb,
  hashPassword, verifyPassword,
  createSession, createImpersonationSession, destroySession, getSession, requireAuth, requireRole, hasRole,
  sessionCookie, clearCookie, COOKIE_NAME,
  rateOk,
  serveStatic, MIME,
  genId,
  syncClerkMetadataForUser,
  clerk,
  dbSupabase,
};
