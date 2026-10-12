'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const razorpay = require('../lib/razorpay');

test('Razorpay configuration validator validates keys', () => {
  assert.throws(() => razorpay.validateConfig(null), /configuration required/i);
  assert.throws(() => razorpay.validateConfig({ keyId: '' }), /invalid razorpay key id/i);
  assert.throws(() => razorpay.validateConfig({ keyId: 'rzp_test_123', keySecret: '' }), /invalid razorpay key secret/i);

  const valid = razorpay.validateConfig({
    keyId: 'rzp_test_123',
    keySecret: 'sec_test_abc',
    webhookSecret: 'whsec_999'
  });
  assert.equal(valid.keyId, 'rzp_test_123');
  assert.equal(valid.keySecret, 'sec_test_abc');
  assert.equal(valid.webhookSecret, 'whsec_999');
});

test('Razorpay payment signature verification succeeds for authentic signatures', () => {
  const secret = 'my_razorpay_secret_123';
  const orderId = 'order_DAvL23490sd';
  const paymentId = 'pay_29013jdsakd';

  // Compute expected HMAC SHA-256
  const validSig = razorpay.hmacSha256Hex(`${orderId}|${paymentId}`, secret);

  const res = razorpay.verifyPaymentSignature({
    orderId,
    paymentId,
    signature: validSig,
    secret,
  });

  assert.equal(res.valid, true);
  assert.equal(res.reason, 'signature verified');
});

test('Razorpay payment signature verification rejects tampered order or payment ID', () => {
  const secret = 'my_razorpay_secret_123';
  const orderId = 'order_DAvL23490sd';
  const paymentId = 'pay_29013jdsakd';
  const validSig = razorpay.hmacSha256Hex(`${orderId}|${paymentId}`, secret);

  // Tamper with order ID
  const tamperedRes = razorpay.verifyPaymentSignature({
    orderId: 'order_TAMPERED',
    paymentId,
    signature: validSig,
    secret,
  });
  assert.equal(tamperedRes.valid, false);
  assert.equal(tamperedRes.reason, 'signature mismatch');

  // Tamper with signature
  const fakeSig = 'a'.repeat(64);
  const fakeRes = razorpay.verifyPaymentSignature({
    orderId,
    paymentId,
    signature: fakeSig,
    secret,
  });
  assert.equal(fakeRes.valid, false);
});

test('Razorpay webhook signature verification validates X-Razorpay-Signature', () => {
  const webhookSecret = 'wh_secret_super_safe';
  const rawBody = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_99', amount: 50000 } } }
  });

  const validSig = razorpay.hmacSha256Hex(rawBody, webhookSecret);

  const ok = razorpay.verifyWebhookSignature({
    rawBody,
    signature: validSig,
    webhookSecret,
  });
  assert.equal(ok.valid, true);

  const tampered = razorpay.verifyWebhookSignature({
    rawBody: rawBody + ' ',
    signature: validSig,
    webhookSecret,
  });
  assert.equal(tampered.valid, false);
});

test('Razorpay buildCheckoutOptions produces valid parameters for browser SDK', () => {
  const opts = razorpay.buildCheckoutOptions({
    order: { id: 'order_123', amount: 20000, currency: 'INR', receipt: 'rcpt_voice_1' },
    keyId: 'rzp_test_123',
    customer: { name: 'Animesh', email: 'animesh@example.com', phone: '9876543210' },
    appName: 'RapidX Voice Studio',
    themeColor: '#0095FF',
  });

  assert.equal(opts.key, 'rzp_test_123');
  assert.equal(opts.order_id, 'order_123');
  assert.equal(opts.amount, 20000);
  assert.equal(opts.currency, 'INR');
  assert.equal(opts.name, 'RapidX Voice Studio');
  assert.equal(opts.prefill.name, 'Animesh');
  assert.equal(opts.prefill.email, 'animesh@example.com');
  assert.equal(opts.theme.color, '#0095FF');
});
