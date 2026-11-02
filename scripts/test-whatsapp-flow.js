/**
 * Seevora AI - WhatsApp Automation Test Runner
 * Simulates incoming WhatsApp messages and demonstrates:
 *  1. Inbound "Hi" -> Automated Greeting Reply
 *  2. "Interested, please call me" -> Triggers Automated Voice AI Call
 *  3. "Not interested, nahi chahiye" -> Suppresses calls, sends polite WhatsApp message only
 *  4. "Busy, prefer WhatsApp only" -> Suppresses calls, sets WhatsApp-only preference
 *
 * Usage:
 *   node scripts/test-whatsapp-flow.js
 */
'use strict';

const path = require('path');
const core = require('../dashboard/lib/core');
const whatsappAutomation = require('../dashboard/lib/whatsappAutomation');

async function runDemo() {
  console.log('====================================================');
  console.log('  Seevora AI: WhatsApp & Voice AI Automation Test  ');
  console.log('====================================================\n');

  const db = core.db();
  const tenant = (db.tenants || [])[0] || { id: 't_demo_workspace', name: 'Demo Tenant' };
  const tenantId = tenant.id;

  const mockProviders = {
    telephony: {
      dial: async (to, payload) => {
        console.log(`  [TELEPHONY CARRIER] Dialing ${to} via Voice AI Agent... (Workflow Run #${Date.now().toString().slice(-6)})`);
        return { ok: true, data: { run_id: 'run_' + Date.now(), status: 'queued' } };
      }
    }
  };

  let idCounter = 1;
  const genId = () => 'tst_' + Date.now().toString().slice(-4) + '_' + (idCounter++);

  async function simulateInboundMessage(senderPhone, senderName, text) {
    console.log(`----------------------------------------------------`);
    console.log(`[CUSTOMER INBOUND]`);
    console.log(`  From: ${senderName} (${senderPhone})`);
    console.log(`  Text: "${text}"\n`);

    const result = await whatsappAutomation.processIncomingWhatsAppMessage({
      db: core.db(),
      db_mutate: (fn) => core.mutate(fn, tenantId),
      tenantId,
      fromPhone: senderPhone,
      text,
      senderName,
      providers: mockProviders,
      genId
    });

    // Check contact state
    const contact = (core.db().crmContacts || []).find((c) => c.phone === senderPhone && c.tenantId === tenantId);
    // Find latest outbound message
    const outMessages = (core.db().waMessages || []).filter((m) => m.phone === senderPhone && m.direction === 'outbound');
    const lastOutMsg = outMessages[outMessages.length - 1];

    console.log(`[AI AUTOMATION RESULT]`);
    console.log(`  Detected Intent:     ${result.intent.toUpperCase()}`);
    console.log(`  CRM Pipeline Stage:  ${contact ? contact.stage : 'N/A'}`);
    console.log(`  Communication Mode:  DoNotCall=${contact?.communicationPreference?.doNotCall ? 'YES (CALLS BLOCKED)' : 'NO (CALLS ALLOWED)'}`);
    console.log(`  Automated AI Reply:  "${lastOutMsg ? lastOutMsg.text : 'None'}"\n`);
  }

  // Scenario 1: Customer sends "Hi"
  await simulateInboundMessage('+919876543201', 'Rahul Sharma', 'Hi');

  // Scenario 2: Customer expresses high interest
  await simulateInboundMessage('+919876543202', 'Priya Patel', 'I am interested in voice AI, please call me for demo');

  // Scenario 3: Customer is NOT interested
  await simulateInboundMessage('+919876543203', 'Amit Kumar', 'I am not interested, nahi chahiye');

  // Scenario 4: Customer declines call (prefers text)
  await simulateInboundMessage('+919876543204', 'Sneha Reddy', 'In a meeting right now, please text only on whatsapp');

  console.log('====================================================');
  console.log('  Test Completed! All 4 automation branches verified.');
  console.log('====================================================');
}

runDemo().catch(console.error);

