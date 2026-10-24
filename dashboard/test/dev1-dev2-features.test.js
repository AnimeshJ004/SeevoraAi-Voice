'use strict';

const test = require('node:test');
const assert = require('node:assert');
const autocall = require('../lib/autocall');
const booking = require('../lib/booking');
const kb = require('../lib/knowledgebase');
const sms = require('../lib/sms');

test('Developer 1: Auto-Call Webhook Engine security & lead extraction', () => {
  // 1. Signature generation and verification
  const secret = autocall.generateSecret();
  const token = autocall.generateToken();
  assert.ok(secret.length >= 32, 'Secret must be at least 32 bytes hex');
  assert.ok(token.length >= 32, 'Token must be at least 32 bytes hex');

  const payload = JSON.stringify({ name: 'Rahul Verma', phone: '+919876543210', source: 'Facebook Ads' });
  const sig = autocall.computeSignature(secret, '', payload);
  assert.ok(autocall.verifyWebhookSignature(secret, payload, sig), 'HMAC signature should be verified');
  assert.strictEqual(autocall.verifyWebhookSignature(secret, payload, 'sha256=invalid'), false, 'Forged signature must fail');

  // 2. Lead extraction
  const extracted = autocall.extractLeadData({
    contact: { phone_number: '+91 98765 43210', full_name: 'Rahul Verma' },
    user_email: 'rahul@example.com'
  });
  assert.strictEqual(extracted.phone, '+919876543210');
  assert.strictEqual(extracted.name, 'Rahul Verma');
  assert.strictEqual(extracted.email, 'rahul@example.com');
});

test('Developer 1: Booking Engine schedule generation & slot isolation', async () => {
  const fakeDb = {
    bookingSchedules: [],
    bookings: []
  };

  const mutate = async (fn) => { await fn(fakeDb); };

  // 1. Configure schedule
  const schedule = await booking.upsertSchedule(mutate, 'tenant_test', 'agent_test', {
    availableDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '10:00',
    endTime: '12:00',
    slotDurationMin: 30,
    slotBufferMin: 10,
    maxBookingsPerDay: 5
  }, 'user_admin');

  assert.strictEqual(schedule.slotDurationMin, 30);
  assert.strictEqual(schedule.startTime, '10:00');

  // 2. Query available slots
  const avail = booking.getAvailableSlots(fakeDb, 'tenant_test', 'agent_test', { days: 7 });
  assert.ok(Array.isArray(avail.slots), 'Slots must be an array');
  assert.ok(avail.slots.length > 0, 'Should have slots generated for weekdays');

  const slotToBook = avail.slots[0].start;

  // 3. Reserve slot
  const res = await booking.reserveSlot(mutate, fakeDb, 'tenant_test', 'agent_test', {
    startTime: slotToBook,
    name: 'Aarav Patel',
    phone: '+919812345678',
    email: 'aarav@example.com'
  }, 'user_admin');

  assert.ok(res.booking, 'Slot reservation must succeed');
  assert.strictEqual(res.booking.status, 'confirmed');

  // 4. Double booking prevention
  const doubleRes = await booking.reserveSlot(mutate, fakeDb, 'tenant_test', 'agent_test', {
    startTime: slotToBook,
    name: 'Intruder',
    phone: '+919999999999'
  }, 'user_admin');

  assert.strictEqual(doubleRes.error, 'slot_unavailable', 'Double booking must be rejected');
});

test('Developer 1: Knowledge Base RAG pipeline chunking & vector search', async () => {
  const fakeDb = {
    knowledgeBases: []
  };
  const mutate = async (fn) => { await fn(fakeDb); };

  // 1. Ingest content
  const doc = 'Seevora AI voice receptionist handles clinic appointments 24/7. Consultation fees start at ₹500.';
  const ingestRes = await kb.ingestText(mutate, 'agent_test', 'tenant_test', doc, 'clinic_info.txt');
  assert.strictEqual(ingestRes.added, 1);

  // 2. Search
  const searchRes = kb.search(fakeDb, 'agent_test', 'tenant_test', 'what are the consultation fees?', 3);
  assert.ok(searchRes.results.length > 0, 'Should match relevant chunk');
  assert.ok(searchRes.results[0].content.includes('Consultation fees'), 'Must contain target snippet');
  assert.ok(searchRes.results[0].score > 0, 'Cosine similarity score must be positive');
});

test('Developer 2: SMS & Mobile OTP Adapter formatting and validation', () => {
  // 1. Phone normalizer
  const r1 = sms.cleanPhoneNumber('+91 98765-43210');
  assert.strictEqual(r1.valid, true);
  assert.strictEqual(r1.phone10, '9876543210');
  assert.strictEqual(r1.e164, '+919876543210');

  const r2 = sms.cleanPhoneNumber('09123456789');
  assert.strictEqual(r2.valid, true);
  assert.strictEqual(r2.phone10, '9123456789');

  const r3 = sms.cleanPhoneNumber('12345');
  assert.strictEqual(r3.valid, false);

  // 2. OTP generation
  const otp = sms.generateOtp();
  assert.strictEqual(otp.length, 6);
  assert.ok(/^\d{6}$/.test(otp), 'OTP must be 6 digits');
});
