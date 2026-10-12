/**
 * Razorpay Payment Gateway integration module.
 *
 * Provides:
 *   - Razorpay order creation (smallest currency unit: paise for INR)
 *   - Cryptographic signature verification for client checkout (HMAC-SHA256)
 *   - Cryptographic signature verification for webhooks (X-Razorpay-Signature)
 *   - Verification against Razorpay REST API (GET /v1/payments/:id)
 *   - Checkout options generator for frontend Razorpay modal
 *
 * ZERO external npm dependencies: uses pure Node https and crypto.
 */
'use strict';

const crypto = require('crypto');
const https = require('https');

const RAZORPAY_API_HOST = 'api.razorpay.com';

function requiredString(value, name, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`invalid ${name}`);
  }
  return value.trim();
}

function validateConfig(config) {
  if (!config) throw new Error('Razorpay configuration required');
  return {
    keyId: requiredString(config.keyId, 'Razorpay Key ID'),
    keySecret: requiredString(config.keySecret, 'Razorpay Key Secret'),
    webhookSecret: config.webhookSecret ? String(config.webhookSecret).trim() : null,
  };
}

function hmacSha256Hex(data, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(data), 'utf8').digest('hex');
}

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const strA = String(a).toLowerCase();
  const strB = String(b).toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(strA) || !/^[a-f0-9]{64}$/i.test(strB)) return false;
  const left = Buffer.from(strA, 'hex');
  const right = Buffer.from(strB, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Perform HTTPS request to Razorpay REST API with HTTP Basic Auth.
 */
function razorpayRequest({ method, path, body, config }) {
  const cfg = validateConfig(config);
  const authHeader = 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64');
  const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Seevora-Razorpay-Client/1.0',
    };
    if (bodyBuf) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = bodyBuf.length;
    }

    const req = https.request({
      host: RAZORPAY_API_HOST,
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
          return reject(new Error(`Failed to parse Razorpay response: ${res.statusCode} ${raw}`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const errMsg = parsed.error ? (parsed.error.description || parsed.error.code) : `HTTP ${res.statusCode}`;
          const err = new Error(`Razorpay API error: ${errMsg}`);
          err.statusCode = res.statusCode;
          err.response = parsed;
          return reject(err);
        }
        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Razorpay API timeout')));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

/**
 * Create a Razorpay Order.
 * Amount is in paise (1 INR = 100 paise).
 */
async function createOrder({ amountPaise, currency = 'INR', receipt, notes = {}, config }) {
  const numAmount = Math.round(Number(amountPaise));
  if (!Number.isFinite(numAmount) || numAmount < 100) {
    throw new Error('amountPaise must be at least 100 (₹1.00)');
  }

  const payload = {
    amount: numAmount,
    currency: String(currency || 'INR').toUpperCase(),
    receipt: receipt ? String(receipt).slice(0, 40) : undefined,
    notes: typeof notes === 'object' && notes !== null ? notes : {},
    payment_capture: 1, // Auto-capture payments
  };

  const order = await razorpayRequest({
    method: 'POST',
    path: '/v1/orders',
    body: payload,
    config,
  });

  return {
    id: order.id,
    entity: order.entity,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt,
    status: order.status,
    createdAt: order.created_at,
    raw: order,
  };
}

/**
 * Verify client payment return signature:
 * Razorpay generates: HMAC_SHA256(order_id + "|" + payment_id, secret)
 */
function verifyPaymentSignature({ orderId, paymentId, signature, secret }) {
  if (!orderId || !paymentId || !signature || !secret) {
    return { valid: false, reason: 'missing parameters for signature verification' };
  }
  const payload = `${orderId}|${paymentId}`;
  const expected = hmacSha256Hex(payload, secret);
  const isValid = safeEqualHex(signature, expected);
  return {
    valid: isValid,
    reason: isValid ? 'signature verified' : 'signature mismatch',
  };
}

/**
 * Verify Razorpay Webhook signature from X-Razorpay-Signature header.
 */
function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  if (!rawBody || !signature || !webhookSecret) {
    return { valid: false, reason: 'missing parameters for webhook signature' };
  }
  const expected = hmacSha256Hex(rawBody, webhookSecret);
  const isValid = safeEqualHex(signature, expected);
  return {
    valid: isValid,
    reason: isValid ? 'webhook verified' : 'webhook signature mismatch',
  };
}

/**
 * Verify payment status with Razorpay servers directly.
 */
async function verifyPayment({ paymentId, config }) {
  if (!paymentId) throw new Error('paymentId required');
  const payment = await razorpayRequest({
    method: 'GET',
    path: `/v1/payments/${encodeURIComponent(paymentId)}`,
    config,
  });

  const isCaptured = payment.status === 'captured';
  return {
    verified: isCaptured,
    status: payment.status,
    amountPaise: payment.amount,
    currency: payment.currency,
    orderId: payment.order_id,
    email: payment.email,
    contact: payment.contact,
    method: payment.method,
    raw: payment,
  };
}

/**
 * Helper to construct frontend Razorpay options object.
 */
function buildCheckoutOptions({ order, keyId, customer = {}, appName = 'Seevora AI Voice', themeColor = '#0095FF' }) {
  return {
    key: keyId,
    amount: order.amount,
    currency: order.currency || 'INR',
    name: appName,
    description: order.receipt || 'Subscription & Voice Credits',
    order_id: order.id,
    prefill: {
      name: customer.name || '',
      email: customer.email || '',
      contact: customer.phone || '',
    },
    theme: {
      color: themeColor,
    },
  };
}

module.exports = {
  validateConfig,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  verifyPayment,
  buildCheckoutOptions,
  hmacSha256Hex,
};
