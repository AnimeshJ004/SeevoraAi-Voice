'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const wacrm = require('../lib/wacrm');

test('Complaint Tracking: Auto-detects complaints and resolution status from call transcript', async () => {
  const db = {
    crmContacts: [],
    waConversations: [],
    waMessages: [],
    bookings: []
  };

  const callDetailsUnresolved = {
    callerNumber: '+919876543210',
    callerName: 'Sunita Verma',
    transcript: 'Caller: I have a serious complaint about my dental appointment yesterday. The filling came off and I am very unhappy with the service.\nAgent: I understand, I am very sorry to hear this Sunita ji. Let me note this down for the doctor.',
    summary: 'Patient called with a complaint regarding dental filling falling out. Service issue noted.'
  };

  const extracted = wacrm.extractLeadDataFromCall(callDetailsUnresolved);
  assert.equal(extracted.isComplaint, true, 'Should detect complaint from transcript keywords');
  assert.equal(extracted.complaintStatus, 'unresolved', 'Complaint should be unresolved by default when not fixed in call');
  assert.ok(extracted.complaintDescription.length > 0, 'Should extract complaint description');

  // Process call completion (async)
  const contact = await wacrm.processVoiceCallCompletion(db, 'tenant_test_1', callDetailsUnresolved);
  assert.ok(contact, 'Contact should be created/updated');
  assert.ok(contact.complaint, 'Contact should have complaint object');
  assert.equal(contact.complaint.status, 'unresolved', 'Contact complaint status should be unresolved');
  assert.ok(contact.tags.includes('complaint'), 'Contact should have complaint tag');
});

test('Complaint Tracking: Detects resolved complaints when resolution occurs during call', async () => {
  const db = {
    crmContacts: [],
    waConversations: [],
    waMessages: [],
    bookings: []
  };

  const callDetailsResolved = {
    callerNumber: '+919876543211',
    callerName: 'Kunal Kapoor',
    transcript: 'Caller: There was an issue with my gym membership access card this morning. Not working at turnstile.\nAgent: I apologize for the trouble. I have refreshed your card access in our system right now and the issue is resolved and sorted out.\nCaller: Great, thank you for resolving it so quickly!',
    summary: 'Gym access card issue resolved during call by agent refreshing credentials.'
  };

  const extracted = wacrm.extractLeadDataFromCall(callDetailsResolved);
  assert.equal(extracted.isComplaint, true, 'Should detect complaint');
  assert.equal(extracted.complaintStatus, 'resolved', 'Should detect that issue was resolved during call');

  const contact = await wacrm.processVoiceCallCompletion(db, 'tenant_test_1', callDetailsResolved);
  assert.ok(contact, 'Contact should be created');
  assert.ok(contact.complaint, 'Contact should have complaint');
  assert.equal(contact.complaint.status, 'resolved', 'Complaint status on contact should be resolved');
  assert.ok(contact.complaint.resolvedAt, 'resolvedAt timestamp should be set');
});

test('Complaint Tracking: Manual update via upsertContact maintains complaint history', () => {
  const db = {
    crmContacts: [],
    waConversations: []
  };

  // Create initial contact
  const c1 = wacrm.upsertContact(db, 'tenant_test_1', {
    phone: '+919876543212',
    name: 'Pooja Bhatia',
    complaint: {
      description: 'Billing issue: double charged for personal training session',
      status: 'unresolved',
      source: 'voice_ai'
    }
  });

  assert.equal(c1.complaint.status, 'unresolved');
  assert.equal(c1.complaint.description, 'Billing issue: double charged for personal training session');

  // Update status to resolved
  const c2 = wacrm.upsertContact(db, 'tenant_test_1', {
    id: c1.id,
    phone: '+919876543212',
    complaint: {
      status: 'resolved',
      resolvedAt: new Date().toISOString()
    }
  });

  assert.equal(c2.complaint.status, 'resolved');
  assert.equal(c2.complaint.description, 'Billing issue: double charged for personal training session');
  assert.ok(c2.complaint.resolvedAt);
});
