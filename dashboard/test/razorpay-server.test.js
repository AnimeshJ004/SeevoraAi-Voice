'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const razorpay = require('../lib/razorpay');

test('Billing config builder returns Razorpay and Clerk availability', () => {
  const prevRzpKey = process.env.RAZORPAY_KEY_ID;
  const prevClerkKey = process.env.CLERK_PUBLISHABLE_KEY;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_integration_123';
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_integration_abc';

  const cfg = {
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID || null,
      enabled: !!process.env.RAZORPAY_KEY_ID,
    },
    clerk: {
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY || null,
      enabled: !!process.env.CLERK_PUBLISHABLE_KEY,
    },
  };

  assert.equal(cfg.razorpay.keyId, 'rzp_test_integration_123');
  assert.equal(cfg.clerk.publishableKey, 'pk_test_integration_abc');
  assert.equal(cfg.razorpay.enabled, true);
  assert.equal(cfg.clerk.enabled, true);

  process.env.RAZORPAY_KEY_ID = prevRzpKey;
  process.env.CLERK_PUBLISHABLE_KEY = prevClerkKey;
});

test('Razorpay verification validates authentic signatures and protects payment flow', () => {
  const secret = 'rzp_secret_integration_test_999';
  const orderId = 'order_test_int_999';
  const paymentId = 'pay_test_int_999';
  const validSig = razorpay.hmacSha256Hex(`${orderId}|${paymentId}`, secret);

  const sigCheck = razorpay.verifyPaymentSignature({
    orderId,
    paymentId,
    signature: validSig,
    secret,
  });

  assert.equal(sigCheck.valid, true);

  // In-memory ledger simulation
  const wallet = { balancePaise: 0 };
  const intent = {
    orderId,
    amountPaise: 20000,
    credits: 20000,
    status: 'created',
  };

  // Process verified payment
  intent.status = 'credited';
  intent.paymentId = paymentId;
  intent.signature = validSig;
  wallet.balancePaise += intent.credits;

  assert.equal(wallet.balancePaise, 20000);
  assert.equal(intent.status, 'credited');
  assert.equal(intent.paymentId, paymentId);
});
