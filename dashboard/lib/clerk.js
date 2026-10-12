/**
 * Clerk Authentication, Authorization & User Metadata synchronization module.
 *
 * Provides:
 *   - Clerk JWT / session token extraction from headers (Bearer) and cookies (__session)
 *   - Clerk user lookup (GET /v1/users/:id)
 *   - Clerk metadata update (PATCH /v1/users/:id/metadata) for tier & role synchronization
 *   - Clerk Svix webhook signature verification (svix-id, svix-timestamp, svix-signature)
 *   - Role and plan entitlement guards (RBAC / subscription authorization)
 *
 * ZERO external npm dependencies: uses pure Node https and crypto.
 */
'use strict';

const crypto = require('crypto');
const https = require('https');

const CLERK_API_HOST = 'api.clerk.com';

function validateClerkConfig(config) {
  const secretKey = config && config.secretKey ? String(config.secretKey).trim() : (process.env.CLERK_SECRET_KEY || '');
  const publishableKey = config && config.publishableKey ? String(config.publishableKey).trim() : (process.env.CLERK_PUBLISHABLE_KEY || '');
  const webhookSecret = config && config.webhookSecret ? String(config.webhookSecret).trim() : (process.env.CLERK_WEBHOOK_SECRET || '');

  return {
    secretKey,
    publishableKey,
    webhookSecret,
  };
}

/**
 * HTTPS helper for Clerk REST API calls with Bearer auth.
 */
function clerkRequest({ method, path, body, secretKey }) {
  if (!secretKey) {
    return Promise.reject(new Error('CLERK_SECRET_KEY is not configured'));
  }

  const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
      'User-Agent': 'Seevora-Clerk-Client/1.0',
    };
    if (bodyBuf) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = bodyBuf.length;
    }

    const req = https.request({
      host: CLERK_API_HOST,
      path,
      method,
      headers,
    }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(parts).toString('utf8');
        let parsed;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {
          return reject(new Error(`Failed to parse Clerk response: ${res.statusCode} ${raw}`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const errMsg = (parsed.errors && parsed.errors[0] && parsed.errors[0].message) || parsed.message || `HTTP ${res.statusCode}`;
          const err = new Error(`Clerk API error: ${errMsg}`);
          err.statusCode = res.statusCode;
          err.response = parsed;
          return reject(err);
        }
        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('Clerk API timeout')));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

/**
 * Extract token from Authorization header or cookie.
 */
function extractToken(req) {
  if (!req) return null;
  const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  // Check __session cookie
  const cookieHeader = req.headers && req.headers.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('__session=')) {
        return cookie.slice('__session='.length).trim();
      }
    }
  }

  return null;
}

/**
 * Decode standard JWT payload without verifying signature (for claims extraction).
 */
function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadJson);
  } catch (_) {
    return null;
  }
}

/**
 * Verify a Clerk session token via Clerk REST API.
 */
async function verifySessionToken(token, config) {
  const cfg = validateClerkConfig(config);
  if (!cfg.secretKey) {
    throw new Error('CLERK_SECRET_KEY is required to verify sessions');
  }

  const claims = decodeJwt(token);
  if (!claims || !claims.sub) {
    throw new Error('Invalid or malformed Clerk token');
  }

  // Check expiration if present in claims
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) {
    throw new Error('Clerk session token has expired');
  }

  // Fetch verified user from Clerk API
  const user = await clerkRequest({
    method: 'GET',
    path: `/v1/users/${encodeURIComponent(claims.sub)}`,
    secretKey: cfg.secretKey,
  });

  return {
    verified: true,
    userId: user.id,
    user: normalizeClerkUser(user),
    claims,
  };
}

/**
 * Fetch a user profile from Clerk by user ID.
 */
async function getClerkUser(userId, config) {
  const cfg = validateClerkConfig(config);
  const user = await clerkRequest({
    method: 'GET',
    path: `/v1/users/${encodeURIComponent(userId)}`,
    secretKey: cfg.secretKey,
  });
  return normalizeClerkUser(user);
}

/**
 * Update Clerk user metadata (crucial for linking Razorpay billing & subscription status).
 */
async function updateClerkMetadata(userId, { publicMetadata, privateMetadata, unsafeMetadata }, config) {
  const cfg = validateClerkConfig(config);
  const body = {};
  if (publicMetadata !== undefined) body.public_metadata = publicMetadata;
  if (privateMetadata !== undefined) body.private_metadata = privateMetadata;
  if (unsafeMetadata !== undefined) body.unsafe_metadata = unsafeMetadata;

  const updated = await clerkRequest({
    method: 'PATCH',
    path: `/v1/users/${encodeURIComponent(userId)}/metadata`,
    body,
    secretKey: cfg.secretKey,
  });

  return normalizeClerkUser(updated);
}

/**
 * Normalize Clerk user response into standard internal shape.
 */
function normalizeClerkUser(user) {
  if (!user) return null;
  const primaryEmailId = user.primary_email_address_id;
  const emailObj = (user.email_addresses || []).find((e) => e.id === primaryEmailId) || (user.email_addresses && user.email_addresses[0]);
  const email = emailObj ? emailObj.email_address : '';
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || email.split('@')[0] || 'User';

  const publicMeta = user.public_metadata || {};
  return {
    id: user.id,
    email,
    name: fullName,
    imageUrl: user.image_url,
    publicMetadata: publicMeta,
    privateMetadata: user.private_metadata || {},
    role: publicMeta.role || 'member',
    plan: publicMeta.plan || 'free',
    credits: Number(publicMeta.credits || 0),
    subscriptionStatus: publicMeta.subscriptionStatus || 'inactive',
    tenantId: publicMeta.tenantId || null,
    createdAt: user.created_at,
  };
}

/**
 * Verify Svix Webhook signature sent by Clerk webhooks.
 * Headers: svix-id, svix-timestamp, svix-signature
 */
function verifySvixWebhook({ headers, rawBody, webhookSecret }) {
  if (!headers || !rawBody || !webhookSecret) {
    return { valid: false, reason: 'missing webhook parameters' };
  }

  const id = headers['svix-id'] || headers['Svix-Id'];
  const timestamp = headers['svix-timestamp'] || headers['Svix-Timestamp'];
  const signature = headers['svix-signature'] || headers['Svix-Signature'];

  if (!id || !timestamp || !signature) {
    return { valid: false, reason: 'missing required Svix headers' };
  }

  // Reject timestamps older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) {
    return { valid: false, reason: 'timestamp out of tolerance' };
  }

  // Svix secret key format is usually "whsec_..."
  let secretBytes;
  if (webhookSecret.startsWith('whsec_')) {
    secretBytes = Buffer.from(webhookSecret.slice(6), 'base64');
  } else {
    secretBytes = Buffer.from(webhookSecret, 'utf8');
  }

  const toSign = `${id}.${timestamp}.${rawBody}`;
  const hmac = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');
  const expectedSig = `v1,${hmac}`;

  // svix-signature can contain multiple space-separated signatures (e.g. "v1,abc v1,def")
  const signatures = signature.split(' ');
  for (const s of signatures) {
    if (s.length === expectedSig.length) {
      if (crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expectedSig))) {
        return { valid: true };
      }
    }
  }

  return { valid: false, reason: 'signature mismatch' };
}

/**
 * Authorization guard: check if user has required role or plan.
 */
function hasAccess(user, { requiredPlan, requiredRole }) {
  if (!user) return false;
  const isSuper = user.role === 'super_admin';
  if (isSuper) return true;

  if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
    return false;
  }

  if (requiredPlan) {
    const planHierarchy = { free: 0, starter: 1, growth: 2, scale: 3, enterprise: 4 };
    const userRank = planHierarchy[String(user.plan).toLowerCase()] || 0;
    const reqRank = planHierarchy[String(requiredPlan).toLowerCase()] || 0;
    if (userRank < reqRank) return false;
  }

  return true;
}

module.exports = {
  validateClerkConfig,
  extractToken,
  decodeJwt,
  verifySessionToken,
  getClerkUser,
  updateClerkMetadata,
  normalizeClerkUser,
  verifySvixWebhook,
  hasAccess,
};
