'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const wacrm = require('../lib/wacrm');

test('WACRM: normalizeE164 standardizes 10-digit Indian numbers and preserves international format', () => {
  assert.equal(wacrm.normalizeE164('9876543210'), '+919876543210');
  assert.equal(wacrm.normalizeE164('+919876543210'), '+919876543210');
  assert.equal(wacrm.normalizeE164('919876543210'), '+919876543210');
  assert.equal(wacrm.normalizeE164('+14155550123'), '+14155550123');
  assert.equal(wacrm.normalizeE164(''), '');
});

test('WACRM: upsertContact creates lead, preserves tenant isolation, and maintains tags', () => {
  const db = { crmContacts: [], waConversations: [] };
  const tenantA = 'tenant_alpha';
  const tenantB = 'tenant_beta';

  const contactA = wacrm.upsertContact(db, tenantA, {
    phone: '9876543210',
    name: 'Rajesh Sharma',
    dealValue: 75000,
    stage: 'New Lead',
    tags: ['inbound-call', 'vip']
  });

  assert.equal(contactA.phone, '+919876543210');
  assert.equal(contactA.tenantId, tenantA);
  assert.equal(contactA.name, 'Rajesh Sharma');
  assert.equal(contactA.dealValue, 75000);
  assert.equal(contactA.stage, 'New Lead');
  assert.deepEqual(contactA.tags, ['inbound-call', 'vip']);

  // Update existing contact
  const updatedA = wacrm.upsertContact(db, tenantA, {
    phone: '9876543210',
    stage: 'Qualified',
    dealValue: 120000
  });

  assert.equal(updatedA.id, contactA.id);
  assert.equal(updatedA.stage, 'Qualified');
  assert.equal(updatedA.dealValue, 120000);

  // Tenant B with same phone number should be an isolated record
  const contactB = wacrm.upsertContact(db, tenantB, {
    phone: '9876543210',
    name: 'Different Customer'
  });

  assert.notEqual(contactB.id, contactA.id);
  assert.equal(contactB.tenantId, tenantB);
  assert.equal(db.crmContacts.filter((c) => c.tenantId === tenantA).length, 1);
  assert.equal(db.crmContacts.filter((c) => c.tenantId === tenantB).length, 1);
});

test('WACRM: recordMessage tracks inbound, outbound, and call summary events in thread', () => {
  const db = { crmContacts: [], waConversations: [], waMessages: [] };
  const tenantId = 't_test';

  const msg1 = wacrm.recordMessage(db, tenantId, {
    phone: '9876543210',
    direction: 'outbound',
    type: 'text',
    text: 'Hello from Seevora AI Voice Receptionist!'
  });

  assert.equal(msg1.direction, 'outbound');
  assert.equal(msg1.phone, '+919876543210');
  assert.equal(db.waConversations.length, 1);
  assert.equal(db.waConversations[0].lastMessageText, 'Hello from Seevora AI Voice Receptionist!');

  // Inbound customer reply
  const msg2 = wacrm.recordMessage(db, tenantId, {
    phone: '9876543210',
    direction: 'inbound',
    type: 'text',
    text: 'Hi, I would like to book a demo.'
  });

  assert.equal(msg2.direction, 'inbound');
  assert.equal(db.waConversations[0].unreadCount, 1);
  assert.equal(db.waConversations[0].lastMessageText, 'Hi, I would like to book a demo.');

  // System Call Summary message
  const msg3 = wacrm.recordMessage(db, tenantId, {
    phone: '9876543210',
    direction: 'system',
    type: 'call_summary',
    text: '📞 Call Completed (120s): Discussed pricing and scheduled site visit.'
  });

  assert.equal(msg3.type, 'call_summary');
  assert.equal(db.waMessages.length, 3);
});

test('WACRM: processVoiceCallCompletion automatically updates pipeline and records transcript', async () => {
  const db = { crmContacts: [], waConversations: [], waMessages: [], wacrmConfig: [] };
  const tenantId = 't_voice_test';

  const callDetails = {
    callerNumber: '9123456780',
    callerName: 'Ananya Verma',
    durationSec: 85,
    disposition: 'appointment_booked',
    summary: 'Caller requested appointment for Saturday at 11am.'
  };

  const contact = await wacrm.processVoiceCallCompletion(db, tenantId, callDetails);
  assert.equal(contact.phone, '+919123456780');
  assert.equal(contact.name, 'Ananya Verma');
  assert.equal(contact.stage, 'Call Completed');
  assert.ok(contact.tags.includes('ai-voice-call'));
  assert.ok(contact.tags.includes('disposition:appointment_booked'));

  // Ensure conversation timeline has call summary
  const convMessages = db.waMessages.filter((m) => m.phone === '+919123456780');
  assert.equal(convMessages.length, 1);
  assert.equal(convMessages[0].type, 'call_summary');
  assert.ok(convMessages[0].text.includes('Caller requested appointment for Saturday at 11am'));
});
