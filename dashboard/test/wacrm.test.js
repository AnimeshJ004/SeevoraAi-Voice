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
  const summaryMessages = db.waMessages.filter((m) => m.phone === '+919123456780' && m.type === 'call_summary');
  assert.equal(summaryMessages.length, 1);
  assert.equal(summaryMessages[0].type, 'call_summary');
  assert.ok(summaryMessages[0].text.includes('Caller requested appointment for Saturday at 11am'));
});

test('WACRM: extractLeadDataFromCall extracts real caller name, budget, email, company, and appointment', () => {
  const callWithGreeting = {
    phoneNumber: '+919820011223',
    summary: 'Home sample collection booked for tomorrow 8:00 AM.',
    transcript: 'Agent: Hello Deepa! Welcome to Seevora Voice. How may I assist you today?\nCaller: Hi, do you offer home sample collection for diagnostic tests?\nAgent: Yes, we provide complimentary home sample collection between 7 AM and 11 AM daily. Would you like me to book a phlebotomist visit for tomorrow?\nCaller: Yes, please book 8 AM tomorrow at Bandra West.\nAgent: All set Deepa! Our technician will arrive at 8:00 AM tomorrow. Booking confirmation sent on WhatsApp.'
  };

  const extractedGreeting = wacrm.extractLeadDataFromCall(callWithGreeting);
  assert.equal(extractedGreeting.name, 'Deepa');
  assert.equal(extractedGreeting.phone, '+919820011223');
  assert.ok(extractedGreeting.tags.includes('appointment-booked'));
  assert.ok(extractedGreeting.structuredNotes.includes('Home sample collection booked'));

  const callWithFullDetails = {
    phoneNumber: '+919820987654',
    transcript: 'Caller: Hi, my name is Vikramaditya Malhotra and I am calling from Zenith Logistics. My email is vikram@zenithlog.com. We need an enterprise voice assistant. Our budget is around 1.5 Lakhs. Can we schedule a demo for tomorrow?\nAgent: Absolutely Vikramaditya! I have booked your demo for tomorrow and sent the confirmation to vikram@zenithlog.com.'
  };

  const extractedFull = wacrm.extractLeadDataFromCall(callWithFullDetails);
  assert.equal(extractedFull.name, 'Vikramaditya Malhotra');
  assert.equal(extractedFull.email, 'vikram@zenithlog.com');
  assert.equal(extractedFull.company, 'Zenith Logistics');
  assert.equal(extractedFull.dealValue, 150000);
  assert.ok(extractedFull.tags.includes('budget-qualified'));
  assert.ok(extractedFull.structuredNotes.includes('Estimated Deal: ₹1,50,000'));
});

test('WACRM: processVoiceCallCompletion populates real extracted data into CRM contact', async () => {
  const db = { crmContacts: [], waConversations: [], waMessages: [], wacrmConfig: [] };
  const tenantId = 't_voice_extract_test';

  const call = {
    phoneNumber: '+919820154321',
    summary: 'Consultation booking for root canal treatment.',
    transcript: 'Agent: Namaste Amit Sharma ji! Welcome to Seevora Dental Clinic.\nCaller: Hi Priya, I need a consultation for root canal treatment. What would be the price?\nAgent: Our comprehensive root canal package is ₹18,500. Can I book you for Friday 5 PM?\nCaller: Yes, Friday 5 PM is perfect. My email is amit.sharma@gmail.com.\nAgent: Booking confirmed for Friday 5:00 PM!'
  };

  const contact = await wacrm.processVoiceCallCompletion(db, tenantId, call);
  assert.equal(contact.phone, '+919820154321');
  assert.equal(contact.name, 'Amit Sharma');
  assert.equal(contact.email, 'amit.sharma@gmail.com');
  assert.equal(contact.dealValue, 18500);
  assert.ok(contact.notes.includes('18,500'));
  assert.ok(contact.tags.includes('appointment-booked'));
});

test('WACRM: syncCallRecordingsToCrm synchronizes completed call recordings into CRM leads', () => {
  const db = {
    callRecordings: [
      {
        id: 'rec_test_1',
        tenantId: 't_sync_1',
        phoneNumber: '+919820011223',
        summary: 'Home sample collection booked for tomorrow 8:00 AM.',
        transcript: 'Agent: Hello Deepa! Welcome to Seevora Voice.\nCaller: Book for tomorrow 8 AM.\nAgent: Confirmed Deepa!'
      },
      {
        id: 'rec_test_2',
        tenantId: 't_sync_2',
        phoneNumber: '+919811190234',
        summary: 'Appointment reschedule request.',
        transcript: 'Agent: Namaste Amit ji! Welcome to Seevora Voice.\nCaller: Reschedule to Friday 5 PM.\nAgent: Done Amit!'
      }
    ],
    crmContacts: [],
    waConversations: []
  };

  // Sync for tenant 1
  const synced1 = wacrm.syncCallRecordingsToCrm(db, 't_sync_1');
  assert.equal(synced1.length, 1);
  assert.equal(synced1[0].name, 'Deepa');
  assert.equal(synced1[0].phone, '+919820011223');
  assert.equal(db.crmContacts.filter((c) => c.tenantId === 't_sync_1').length, 1);

  // Tenant isolation: tenant 2 contacts remain separate
  assert.equal(db.crmContacts.filter((c) => c.tenantId === 't_sync_2').length, 0);
  const synced2 = wacrm.syncCallRecordingsToCrm(db, 't_sync_2');
  assert.equal(synced2.length, 1);
  assert.equal(synced2[0].name, 'Amit');
  assert.equal(db.crmContacts.filter((c) => c.tenantId === 't_sync_2').length, 1);
});

