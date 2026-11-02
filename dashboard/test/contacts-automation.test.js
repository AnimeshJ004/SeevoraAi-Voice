'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const whatsappAutomation = require('../lib/whatsappAutomation');
const wacrm = require('../lib/wacrm');
const booking = require('../lib/booking');

test('WhatsApp Automation: Intent Classification', async (t) => {
  await t.test('detects greeting intent accurately', () => {
    const res1 = whatsappAutomation.classifyCustomerIntent('Hi');
    assert.equal(res1.intent, 'greeting');
    assert.equal(res1.matchedKeyword, 'hi');

    const res2 = whatsappAutomation.classifyCustomerIntent('Namaste, kaise hain aap?');
    assert.equal(res2.intent, 'greeting');
    assert.equal(res2.matchedKeyword, 'namaste');
  });

  await t.test('detects high interest / voice call request intent', () => {
    const res1 = whatsappAutomation.classifyCustomerIntent('I am interested in voice AI, please call me');
    assert.equal(res1.intent, 'high_interest');

    const res2 = whatsappAutomation.classifyCustomerIntent('Want to book demo and know pricing details');
    assert.equal(res2.intent, 'high_interest');
  });

  await t.test('detects call decline and preference for text/WhatsApp', () => {
    const res1 = whatsappAutomation.classifyCustomerIntent("I am in a meeting, please don't call, text only");
    assert.equal(res1.intent, 'decline_call');

    const res2 = whatsappAutomation.classifyCustomerIntent('Busy right now, prefer whatsapp messages');
    assert.equal(res2.intent, 'decline_call');
  });

  await t.test('detects not interested expressions and negations accurately', () => {
    const res1 = whatsappAutomation.classifyCustomerIntent('I am not interested');
    assert.equal(res1.intent, 'not_interested');

    const res2 = whatsappAutomation.classifyCustomerIntent('not intersred');
    assert.equal(res2.intent, 'not_interested');

    const res3 = whatsappAutomation.classifyCustomerIntent('nahi chahiye koi service');
    assert.equal(res3.intent, 'not_interested');

    const res4 = whatsappAutomation.classifyCustomerIntent('koi interest nahi hai, stop');
    assert.equal(res4.intent, 'not_interested');
  });
});

test('WhatsApp Automation: Inbound Workflow Execution', async (t) => {
  const tenantId = 't_test_automation';
  let mockDb = {
    crmContacts: [],
    waMessages: [],
    waConversations: [],
    agents: [{ id: 'ag_test', tenantId, name: 'Seevora AI Test Agent', isPrimary: true, telephony: { did: '+918071582519', workflowId: 13027 } }],
    wallets: [{ tenantId, balancePaise: 50000 }],
    autoCallLeads: [],
    callRecordings: []
  };

  const dbMutate = async (fn) => {
    await fn(mockDb);
  };

  let idCounter = 1;
  const genId = () => 'id_' + (idCounter++);

  const mockProviders = {
    telephony: {
      dial: async (to, payload) => ({
        ok: true,
        data: { run_id: 'run_mock_123', request_uuid: 'req_123' }
      })
    }
  };

  await t.test('Step 1: Inbound "Hi" creates contact and dispatches automated greeting', async () => {
    const fromPhone = '+919876543210';
    await whatsappAutomation.processIncomingWhatsAppMessage({
      db: mockDb,
      db_mutate: dbMutate,
      tenantId,
      fromPhone,
      text: 'Hi',
      senderName: 'Aarav Patel',
      providers: mockProviders,
      genId
    });

    const contact = mockDb.crmContacts.find((c) => c.phone === fromPhone);
    assert.ok(contact, 'Contact should be created');
    assert.equal(contact.name, 'Aarav Patel');
    assert.equal(contact.stage, 'New Lead');

    const messages = mockDb.waMessages.filter((m) => m.phone === fromPhone);
    assert.equal(messages.length, 2, 'Should have 1 inbound and 1 outbound reply');
    assert.equal(messages[0].direction, 'inbound');
    assert.equal(messages[1].direction, 'outbound');
    assert.match(messages[1].text, /Welcome to Seevora AI/i);
  });

  await t.test('Step 2: Customer declines voice call ("Prefer WhatsApp only")', async () => {
    const fromPhone = '+919876543210';
    await whatsappAutomation.processIncomingWhatsAppMessage({
      db: mockDb,
      db_mutate: dbMutate,
      tenantId,
      fromPhone,
      text: "I am traveling, please don't call, whatsapp only",
      senderName: 'Aarav Patel',
      providers: mockProviders,
      genId
    });

    const contact = mockDb.crmContacts.find((c) => c.phone === fromPhone);
    assert.equal(contact.communicationPreference.prefersWhatsApp, true);
    assert.equal(contact.communicationPreference.doNotCall, true);
    assert.ok(contact.tags.includes('prefers_whatsapp'));
    assert.ok(contact.tags.includes('do_not_call'));

    // Verify outbound phone call was NOT placed
    assert.equal(mockDb.autoCallLeads.length, 0, 'No outbound call should be placed');
  });

  await t.test('Step 3: New customer expresses high interest -> Triggers Voice AI agent', async () => {
    const highIntentPhone = '+919988776655';
    await whatsappAutomation.processIncomingWhatsAppMessage({
      db: mockDb,
      db_mutate: dbMutate,
      tenantId,
      fromPhone: highIntentPhone,
      text: 'I am very interested in voice receptionist, please call me urgently',
      senderName: 'Neha Sharma',
      providers: mockProviders,
      genId
    });

    const contact = mockDb.crmContacts.find((c) => c.phone === highIntentPhone);
    assert.ok(contact, 'Contact should exist');
    assert.equal(contact.stage, 'Call Completed');
    assert.ok(contact.tags.includes('voice_ai_triggered'));
    assert.ok(contact.tags.includes('high_intent'));

    // Verify outbound call was registered
    assert.ok(mockDb.callRecordings.length > 0, 'Call recording should be initialized');
    const rec = mockDb.callRecordings.find((r) => r.phoneNumber === highIntentPhone);
    assert.ok(rec, 'Live call recording should be registered');
  });

  await t.test('Step 4: Customer states NOT INTERESTED -> Dispatches polite WhatsApp message, suppresses calls', async () => {
    const notInterestedPhone = '+919111222333';
    const initialCallCount = mockDb.callRecordings.length;

    await whatsappAutomation.processIncomingWhatsAppMessage({
      db: mockDb,
      db_mutate: dbMutate,
      tenantId,
      fromPhone: notInterestedPhone,
      text: 'I am not interested, nahi chahiye',
      senderName: 'Rohit Verma',
      providers: mockProviders,
      genId
    });

    const contact = mockDb.crmContacts.find((c) => c.phone === notInterestedPhone);
    assert.ok(contact, 'Contact should exist');
    assert.equal(contact.stage, 'Closed / Lost');
    assert.equal(contact.communicationPreference.doNotCall, true);
    assert.equal(contact.communicationPreference.isInterested, false);
    assert.ok(contact.tags.includes('not_interested'));
    assert.ok(contact.tags.includes('do_not_call'));

    // Verify NO call was dispatched
    assert.equal(mockDb.callRecordings.length, initialCallCount, 'No voice call must be placed for not interested customer');

    // Verify polite WhatsApp message was sent
    const messages = mockDb.waMessages.filter((m) => m.phone === notInterestedPhone);
    assert.equal(messages.length, 2, 'Should have inbound and outbound message');
    assert.equal(messages[1].direction, 'outbound');
    assert.match(messages[1].text, /not interested at this time/i);
  });
});

test('Voice AI Integration: Call Completion & Appointment Syncing', async (t) => {
  const tenantId = 't_test_voice_sync';
  const phone = '+919820011223';
  let mockDb = {
    crmContacts: [],
    waMessages: [],
    waConversations: [],
    bookings: []
  };

  await t.test('processVoiceCallCompletion extracts caller, updates stage to Qualified, and syncs appointment', async () => {
    const callDetails = {
      callerNumber: phone,
      callerName: 'Rajesh Malhotra',
      email: 'rajesh@malhotracorp.com',
      company: 'Malhotra Enterprises',
      durationSeconds: 145,
      summary: 'Caller inquired about 24/7 receptionist. Appointment confirmed for tomorrow at 3 PM.',
      transcript: 'Agent: Namaste Rajesh Malhotra ji! ... Caller: Yes please schedule appointment for tomorrow at 3 PM.',
      gathered_context: {
        appointment: 'tomorrow at 3 PM',
        dealValue: 35000,
        service: '24/7 Voice AI Receptionist'
      }
    };

    const contact = await wacrm.processVoiceCallCompletion(mockDb, tenantId, callDetails);

    assert.ok(contact, 'Contact should be returned');
    assert.equal(contact.name, 'Rajesh Malhotra');
    assert.equal(contact.phone, phone);
    assert.equal(contact.stage, 'Call Completed');
    assert.equal(contact.dealValue, 35000);

    // Verify system timeline event was recorded
    const sysMsg = mockDb.waMessages.find((m) => m.phone === phone && m.direction === 'system');
    assert.ok(sysMsg, 'System call summary message should be logged');
    assert.equal(sysMsg.type, 'call_summary');

    // Verify appointment was synced to bookings collection
    assert.equal(mockDb.bookings.length, 1, 'Booking should be created');
    const b = mockDb.bookings[0];
    assert.equal(b.callerPhone, phone);
    assert.equal(b.callerName, 'Rajesh Malhotra');
    assert.equal(b.source, 'voice_ai');
    assert.equal(b.status, 'confirmed');
  });

  await t.test('booking.listBookings filters by phone number', () => {
    const result = booking.listBookings(mockDb, tenantId, null, { phone });
    assert.equal(result.total, 1);
    assert.equal(result.bookings[0].callerPhone, phone);

    const nonExistent = booking.listBookings(mockDb, tenantId, null, { phone: '+919999999999' });
    assert.equal(nonExistent.total, 0);
  });
});

test('Platform Support Isolation: supportTickets vs crmContacts separation', () => {
  const tenantId = 't_isolation_test';
  const mockDb = {
    supportTickets: [
      { id: 'tkt_01', tenantId, createdBy: 'u_admin', subject: 'Dashboard audio player latency', status: 'open' }
    ],
    crmContacts: [
      { id: 'con_01', tenantId, name: 'Customer Lead', phone: '+919876543210', stage: 'New Lead' }
    ],
    waMessages: [
      { id: 'msg_01', tenantId, phone: '+919876543210', text: 'Hi, customer inquiry' }
    ]
  };

  // Assert that supportTickets only contains platform issues and does not leak customer records
  assert.equal(mockDb.supportTickets.length, 1);
  assert.equal(mockDb.supportTickets[0].subject, 'Dashboard audio player latency');
  assert.equal(mockDb.supportTickets[0].phone, undefined, 'Support tickets do not contain customer phone');

  // Assert that crmContacts and waMessages only hold customer CRM data
  assert.equal(mockDb.crmContacts[0].name, 'Customer Lead');
  assert.equal(mockDb.waMessages[0].text, 'Hi, customer inquiry');
});


test('Multi-User Concurrency: Per-tenant mutex & serialization', async (t) => {
  const core = require('../lib/core');

  await t.test('concurrent mutations on distinct tenants run in parallel', async () => {
    const trace = [];
    await Promise.all([
      core.mutate(async () => {
        trace.push('tA_start');
        await new Promise((r) => setTimeout(r, 40));
        trace.push('tA_end');
      }, 't_concurrent_A'),
      core.mutate(async () => {
        trace.push('tB_start');
        await new Promise((r) => setTimeout(r, 10));
        trace.push('tB_end');
      }, 't_concurrent_B')
    ]);

    // tB should start before tA finishes because they are on separate tenant chains
    assert.equal(trace[0], 'tA_start');
    assert.equal(trace[1], 'tB_start');
    assert.equal(trace[2], 'tB_end');
    assert.equal(trace[3], 'tA_end');
  });

  await t.test('mutations on the same tenant serialize strictly', async () => {
    const trace = [];
    await Promise.all([
      core.mutate(async () => {
        trace.push('seq1_start');
        await new Promise((r) => setTimeout(r, 30));
        trace.push('seq1_end');
      }, 't_same_tenant'),
      core.mutate(async () => {
        trace.push('seq2_start');
        await new Promise((r) => setTimeout(r, 10));
        trace.push('seq2_end');
      }, 't_same_tenant')
    ]);

    // seq2 must not start until seq1 finishes
    assert.deepEqual(trace, ['seq1_start', 'seq1_end', 'seq2_start', 'seq2_end']);
  });
});
