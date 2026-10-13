'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const ADMIN_TENANT_ID = 't_61cb4c3f0a845e2a';
const CLIENT_TENANT_ID = 't_4feb1d5f86369faa';

function genId(prefix) {
  return (prefix || '') + crypto.randomBytes(8).toString('hex');
}

// 1. Ensure wallets for both demo tenants
function ensureWallet(tenantId, balancePaise) {
  if (!db.wallets) db.wallets = [];
  let w = db.wallets.find((x) => x.tenantId === tenantId);
  if (!w) {
    w = {
      id: genId('wal_'),
      tenantId,
      currency: 'INR',
      balancePaise: balancePaise || 10000,
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString()
    };
    db.wallets.push(w);
  } else {
    w.balancePaise = balancePaise;
  }
  return w;
}

ensureWallet(ADMIN_TENANT_ID, 250000); // ₹2,500
ensureWallet(CLIENT_TENANT_ID, 185000); // ₹1,850

// 2. Extra Portfolio Workspaces for Admin Panel
const extraTenants = [
  {
    id: 't_apex_diag_demo',
    name: 'Apex Health & Diagnostics',
    slug: 'apex-health',
    plan: 'growth',
    status: 'active',
    privacyMode: 'standard',
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    providers: { stt: 'deepgram', tts: 'rumik', llm: 'groq', telephony: 'vobiz' },
    walletBalance: 320000,
    userCount: 3,
    calls: 142
  },
  {
    id: 't_nexus_realty_demo',
    name: 'Nexus Prime Real Estate',
    slug: 'nexus-realty',
    plan: 'agency',
    status: 'active',
    privacyMode: 'standard',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    providers: { stt: 'deepgram', tts: 'rumik', llm: 'groq', telephony: 'vobiz' },
    walletBalance: 850000,
    userCount: 4,
    calls: 215
  },
  {
    id: 't_starlight_auto_demo',
    name: 'Starlight Motors Sales & Service',
    slug: 'starlight-motors',
    plan: 'starter',
    status: 'active',
    privacyMode: 'standard',
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    providers: { stt: 'deepgram', tts: 'rumik', llm: 'groq', telephony: 'vobiz' },
    walletBalance: 120000,
    userCount: 2,
    calls: 89
  },
  {
    id: 't_horizon_law_demo',
    name: 'Horizon Advisory & Corporate Law',
    slug: 'horizon-law',
    plan: 'studio',
    status: 'active',
    privacyMode: 'standard',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    providers: { stt: 'deepgram', tts: 'rumik', llm: 'groq', telephony: 'vobiz' },
    walletBalance: 450000,
    userCount: 2,
    calls: 64
  }
];

extraTenants.forEach((et) => {
  let existing = db.tenants.find((t) => t.id === et.id);
  if (!existing) {
    db.tenants.push({
      id: et.id,
      name: et.name,
      slug: et.slug,
      plan: et.plan,
      status: et.status,
      privacyMode: et.privacyMode,
      createdAt: et.createdAt,
      providers: et.providers,
      onboardingCompleted: true
    });
  }
  ensureWallet(et.id, et.walletBalance);
  // Add demo user for tenant
  const userExists = db.users.some((u) => u.tenantId === et.id);
  if (!userExists) {
    db.users.push({
      id: genId('u_'),
      tenantId: et.id,
      email: `manager@${et.slug}.com`,
      name: et.name.split(' ')[0] + ' Manager',
      role: 'client',
      status: 'active',
      createdAt: et.createdAt,
      onboardingCompleted: true
    });
  }
});

// 3. Usage Records (Last 7 Days) for realistic charts
if (!db.usage) db.usage = [];
const today = new Date();
for (let d = 6; d >= 0; d--) {
  const dt = new Date(today);
  dt.setDate(today.getDate() - d);
  const dayStr = dt.toISOString().slice(0, 10);

  // Client Demo usage
  if (!db.usage.some((u) => u.tenantId === CLIENT_TENANT_ID && u.day === dayStr)) {
    db.usage.push({
      tenantId: CLIENT_TENANT_ID,
      day: dayStr,
      chars: 8500 + d * 1100,
      calls: 14 + (d % 3) * 6,
      llmTokens: 14200 + d * 1800
    });
  }

  // Extra tenants usage
  extraTenants.forEach((et) => {
    if (!db.usage.some((u) => u.tenantId === et.id && u.day === dayStr)) {
      db.usage.push({
        tenantId: et.id,
        day: dayStr,
        chars: 12000 + (d % 4) * 2000,
        calls: 18 + (d % 4) * 8,
        llmTokens: 19000 + (d % 4) * 3000
      });
    }
  });
}

// 4. Invoices (Platform & Client)
if (!db.invoices) db.invoices = [];
const dummyInvoices = [
  {
    id: 'inv_demo_01',
    tenantId: CLIENT_TENANT_ID,
    invoiceNumber: 'RX-2026-0012',
    clientName: 'Client Demo Workspace',
    clientEmail: 'client@demo.com',
    description: 'Growth Plan (Quarterly Voice Receptionist + WhatsApp Suite)',
    amountPaise: 899700, // ₹8,997
    currency: 'INR',
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    status: 'paid',
    deliveryStatus: 'sent',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T14:30:00.000Z',
    issuedAt: '2026-10-01T10:00:00.000Z'
  },
  {
    id: 'inv_demo_02',
    tenantId: CLIENT_TENANT_ID,
    invoiceNumber: 'RX-2026-0019',
    clientName: 'Client Demo Workspace',
    clientEmail: 'client@demo.com',
    description: 'Custom CRM Webhook & Google Sheets Automation Setup',
    amountPaise: 350000, // ₹3,500
    currency: 'INR',
    issueDate: '2026-10-10',
    dueDate: '2026-10-24',
    status: 'issued',
    deliveryStatus: 'sent',
    createdAt: '2026-10-10T09:15:00.000Z',
    updatedAt: '2026-10-10T09:15:00.000Z',
    issuedAt: '2026-10-10T09:15:00.000Z'
  },
  {
    id: 'inv_demo_03',
    tenantId: 't_nexus_realty_demo',
    invoiceNumber: 'RX-2026-0015',
    clientName: 'Nexus Prime Real Estate',
    clientEmail: 'billing@nexusrealty.com',
    description: 'Agency Unlimited Plan (5 Voice Agents + 10,000 Outbound Minutes)',
    amountPaise: 2499900, // ₹24,999
    currency: 'INR',
    issueDate: '2026-10-05',
    dueDate: '2026-10-19',
    status: 'paid',
    deliveryStatus: 'sent',
    createdAt: '2026-10-05T11:00:00.000Z',
    updatedAt: '2026-10-06T12:00:00.000Z',
    issuedAt: '2026-10-05T11:00:00.000Z'
  },
  {
    id: 'inv_demo_04',
    tenantId: 't_apex_diag_demo',
    invoiceNumber: 'RX-2026-0021',
    clientName: 'Apex Health & Diagnostics',
    clientEmail: 'accounts@apexhealth.in',
    description: 'Dedicated Indian Virtual DID Number + Studio Addon',
    amountPaise: 500000, // ₹5,000
    currency: 'INR',
    issueDate: '2026-10-11',
    dueDate: '2026-10-25',
    status: 'issued',
    deliveryStatus: 'sent',
    createdAt: '2026-10-11T16:20:00.000Z',
    updatedAt: '2026-10-11T16:20:00.000Z',
    issuedAt: '2026-10-11T16:20:00.000Z'
  }
];

dummyInvoices.forEach((inv) => {
  if (!db.invoices.some((x) => x.id === inv.id)) {
    db.invoices.push(inv);
  }
});

// 5. Payment Events (PayU / Webhooks log for Admin Panel)
if (!db.paymentEvents) db.paymentEvents = [];
const dummyPaymentEvents = [
  {
    id: genId('pe_'),
    txnid: 'payu_tx_90128471',
    reason: 'Wallet Auto-Recharge (₹2,500 approved via UPI)',
    status: 'success',
    amountPaise: 250000,
    tenantId: CLIENT_TENANT_ID,
    createdAt: '2026-10-12T11:45:22.000Z'
  },
  {
    id: genId('pe_'),
    txnid: 'payu_tx_89110294',
    reason: 'Invoice RX-2026-0012 Payment - Growth Quarterly Plan',
    status: 'success',
    amountPaise: 899700,
    tenantId: CLIENT_TENANT_ID,
    createdAt: '2026-10-02T14:30:10.000Z'
  },
  {
    id: genId('pe_'),
    txnid: 'payu_tx_88049102',
    reason: 'Invoice RX-2026-0015 Payment - Agency Unlimited Plan',
    status: 'success',
    amountPaise: 2499900,
    tenantId: 't_nexus_realty_demo',
    createdAt: '2026-10-06T12:00:45.000Z'
  },
  {
    id: genId('pe_'),
    txnid: 'payu_tx_87901842',
    reason: 'Wallet Top-Up - ₹5,000 Call Credits',
    status: 'success',
    amountPaise: 500000,
    tenantId: 't_apex_diag_demo',
    createdAt: '2026-10-08T18:12:05.000Z'
  },
  {
    id: genId('pe_'),
    txnid: 'payu_tx_86491023',
    reason: 'Webhook Ping / Signature Verification Test',
    status: 'received',
    amountPaise: 0,
    tenantId: ADMIN_TENANT_ID,
    createdAt: '2026-10-09T08:00:00.000Z'
  }
];

dummyPaymentEvents.forEach((pe) => {
  if (!db.paymentEvents.some((x) => x.txnid === pe.txnid)) {
    db.paymentEvents.push(pe);
  }
});

// 6. Support Tickets & Messages (Populates Admin and Client Support views)
if (!db.supportTickets) db.supportTickets = [];
if (!db.supportMessages) db.supportMessages = [];

const dummyTickets = [
  {
    id: 'tic_demo_01',
    tenantId: CLIENT_TENANT_ID,
    createdBy: 'u_client_demo',
    subject: 'WhatsApp Meta Cloud API Template Approval Help',
    priority: 'normal',
    status: 'open',
    createdAt: '2026-10-12T10:15:00.000Z',
    updatedAt: '2026-10-12T14:22:00.000Z',
    messages: [
      {
        id: genId('msg_'),
        authorName: 'Client Demo User',
        body: 'Hi team, we registered the "welcome_appointment" template in our Meta WABA account. Does Seevora support auto-retry if Meta returns code 132001?',
        createdAt: '2026-10-12T10:15:00.000Z'
      },
      {
        id: genId('msg_'),
        authorName: 'Seevora Support Engineer',
        body: 'Hello! Yes, Seevora includes automated fallback retry between en_US and en for error code 132001. Your template will dispatch seamlessly!',
        createdAt: '2026-10-12T14:22:00.000Z'
      }
    ]
  },
  {
    id: 'tic_demo_02',
    tenantId: 't_apex_diag_demo',
    createdBy: 'u_apex_demo',
    subject: 'Custom Medical Terminology Pronunciation for Rumik TTS',
    priority: 'high',
    status: 'in_progress',
    createdAt: '2026-10-11T15:30:00.000Z',
    updatedAt: '2026-10-12T09:00:00.000Z',
    messages: [
      {
        id: genId('msg_'),
        authorName: 'Apex Health Admin',
        body: 'We would like the voice assistant to pronounce "Echocardiogram" and "MRI Scan" with Indian English accent pitch.',
        createdAt: '2026-10-11T15:30:00.000Z'
      },
      {
        id: genId('msg_'),
        authorName: 'Seevora Voice Architect',
        body: 'We have updated the voice persona phoneme map in Rumik muga model. Testing outbound sample calls now.',
        createdAt: '2026-10-12T09:00:00.000Z'
      }
    ]
  },
  {
    id: 'tic_demo_03',
    tenantId: 't_nexus_realty_demo',
    createdBy: 'u_nexus_demo',
    subject: 'Adding 2nd Indian DID Phone Number for Bangalore Office',
    priority: 'normal',
    status: 'open',
    createdAt: '2026-10-13T08:45:00.000Z',
    updatedAt: '2026-10-13T08:45:00.000Z',
    messages: [
      {
        id: genId('msg_'),
        authorName: 'Nexus Realty Admin',
        body: 'Please provision a +91 80 Karnataka DID number for our second receptionist bot.',
        createdAt: '2026-10-13T08:45:00.000Z'
      }
    ]
  }
];

dummyTickets.forEach((t) => {
  if (!db.supportTickets.some((x) => x.id === t.id)) {
    db.supportTickets.push({
      id: t.id,
      tenantId: t.tenantId,
      createdBy: t.createdBy,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    });
    t.messages.forEach((m) => {
      db.supportMessages.push({
        id: m.id,
        ticketId: t.id,
        tenantId: t.tenantId,
        authorName: m.authorName,
        body: m.body,
        internal: false,
        createdAt: m.createdAt
      });
    });
  }
});

// 7. Call Recordings (Realistic Inbound & Outbound for Client Demo)
if (!db.callRecordings) db.callRecordings = [];
const dummyCalls = [
  {
    id: 'rec_client_01',
    tenantId: CLIENT_TENANT_ID,
    dograhRunId: '801201',
    phoneNumber: '+919820154321',
    callerNumber: '+919820154321',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 114,
    agentName: 'Priya - Front-Desk Receptionist',
    startedAt: '2026-10-13T10:14:00.000Z',
    summary: 'Caller inquired about teeth scaling and root canal consultation. Qualified as high-intent lead.',
    transcript: 'Agent: Hi! Thanks for calling Seevora Voice Receptionist. I am Priya, how can I help you today?\nCaller: Hello Priya, what are your clinic timings and do you have appointments today for consultation?\nAgent: We are open Monday through Saturday from 9 AM to 8 PM! We currently have a 4:30 PM slot available today with Dr. Sharma. Would you like me to book that for you?\nCaller: Yes, please book 4:30 PM under Rohan Sharma.\nAgent: Wonderful, Rohan! Your consultation is scheduled for today at 4:30 PM. I am sending you a confirmation on WhatsApp right now.',
    recordingAvailable: true
  },
  {
    id: 'rec_client_02',
    tenantId: CLIENT_TENANT_ID,
    dograhRunId: '801202',
    phoneNumber: '+919811234567',
    callerNumber: '+918071582519',
    calledNumber: '+919811234567',
    direction: 'outbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 78,
    agentName: 'Priya - Outbound Followup',
    startedAt: '2026-10-13T09:30:00.000Z',
    summary: 'Followed up on website inquiry. Shared brochure link on WhatsApp.',
    transcript: 'Agent: Hello Ananya! This is Priya calling from Seevora Voice. You requested info on our cosmetic dental packages.\nCaller: Hi Priya! Yes, can you send me the price breakdown?\nAgent: Absolutely! Our complete whitening and alignment catalog is being shared to your WhatsApp right now. Reply there anytime to book your slot.\nCaller: Thank you so much, will check!',
    recordingAvailable: true
  },
  {
    id: 'rec_client_03',
    tenantId: CLIENT_TENANT_ID,
    dograhRunId: '801203',
    phoneNumber: '+919833456789',
    callerNumber: '+919833456789',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 92,
    agentName: 'Priya - Front-Desk Receptionist',
    startedAt: '2026-10-12T16:20:00.000Z',
    summary: 'Emergency dental inquiry. Provided emergency hotline and clinic address.',
    transcript: 'Agent: Hello, welcome to Seevora! How may I assist you today?\nCaller: Hi, do you handle dental emergencies? I have severe pain in a molar.\nAgent: Yes, we accommodate same-day emergency visits. Our team is alerted. Please head to our central clinic, and Dr. Verma will attend to you immediately.\nCaller: Great, on my way.',
    recordingAvailable: true
  },
  {
    id: 'rec_client_04',
    tenantId: CLIENT_TENANT_ID,
    dograhRunId: '801204',
    phoneNumber: '+919844567890',
    callerNumber: '+918071582519',
    calledNumber: '+919844567890',
    direction: 'outbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 65,
    agentName: 'Priya - Outbound Followup',
    startedAt: '2026-10-12T14:10:00.000Z',
    summary: 'Appointment reminder call for tomorrow morning.',
    transcript: 'Agent: Hello Pooja! This is a quick friendly reminder for your appointment tomorrow at 11 AM.\nCaller: Hi Priya! Yes, I will be there on time. Thanks for the call!\nAgent: You are welcome Pooja, have a great day!',
    recordingAvailable: true
  }
];

dummyCalls.forEach((call) => {
  if (!db.callRecordings.some((x) => x.id === call.id)) {
    db.callRecordings.unshift(call);
  }
});

// 8. CRM Contacts & Leads (Populates Leads & Pipeline)
if (!db.crmContacts) db.crmContacts = [];
const dummyContacts = [
  {
    id: 'con_client_01',
    tenantId: CLIENT_TENANT_ID,
    name: 'Rohan Sharma',
    phone: '+919820154321',
    email: 'rohan.sharma@gmail.com',
    stage: 'demo_scheduled',
    pipelineStage: 'demo_scheduled',
    tags: ['new-lead', 'appointment-confirmed', 'hot-lead'],
    source: 'voice_inbound',
    notes: 'Consultation booked for today at 4:30 PM.',
    createdAt: '2026-10-13T10:14:00.000Z',
    updatedAt: '2026-10-13T10:16:00.000Z'
  },
  {
    id: 'con_client_02',
    tenantId: CLIENT_TENANT_ID,
    name: 'Ananya Iyer',
    phone: '+919811234567',
    email: 'ananya.iyer@outlook.com',
    stage: 'qualified',
    pipelineStage: 'qualified',
    tags: ['pricing-inquiry', 'brochure-sent'],
    source: 'voice_outbound',
    notes: 'Received brochure link on WhatsApp. Considering cosmetic package.',
    createdAt: '2026-10-13T09:30:00.000Z',
    updatedAt: '2026-10-13T09:32:00.000Z'
  },
  {
    id: 'con_client_03',
    tenantId: CLIENT_TENANT_ID,
    name: 'Vikram Mehta',
    phone: '+919833456789',
    email: 'vikram.m@techcorp.in',
    stage: 'customer',
    pipelineStage: 'customer',
    tags: ['vip', 'onboarded'],
    source: 'voice_inbound',
    notes: 'Visited clinic for emergency checkup, subscribed to annual dental plan.',
    createdAt: '2026-10-12T16:20:00.000Z',
    updatedAt: '2026-10-12T17:00:00.000Z'
  },
  {
    id: 'con_client_04',
    tenantId: CLIENT_TENANT_ID,
    name: 'Pooja Verma',
    phone: '+919844567890',
    email: 'pooja.verma@gmail.com',
    stage: 'customer',
    pipelineStage: 'customer',
    tags: ['active-client'],
    source: 'voice_outbound',
    notes: 'Regular checkup patient, appointment confirmed.',
    createdAt: '2026-10-12T14:10:00.000Z',
    updatedAt: '2026-10-12T14:12:00.000Z'
  },
  {
    id: 'con_client_05',
    tenantId: CLIENT_TENANT_ID,
    name: 'Kavita Nair',
    phone: '+919855678901',
    email: 'kavita.nair@yahoo.com',
    stage: 'lead',
    pipelineStage: 'lead',
    tags: ['website-form'],
    source: 'web_chat',
    notes: 'Texted on WhatsApp asking about family dental package pricing.',
    createdAt: '2026-10-13T08:15:00.000Z',
    updatedAt: '2026-10-13T08:15:00.000Z'
  }
];

dummyContacts.forEach((c) => {
  if (!db.crmContacts.some((x) => x.phone === c.phone && x.tenantId === c.tenantId)) {
    db.crmContacts.push(c);
  }
});

// 9. WhatsApp Conversations & Messages (Populates WhatsApp Inbox)
if (!db.waConversations) db.waConversations = [];
if (!db.waMessages) db.waMessages = [];

const dummyWhatsApp = [
  {
    phone: '+919820154321',
    name: 'Rohan Sharma',
    messages: [
      { direction: 'inbound', text: 'Hi, I need an appointment for today evening.' },
      { direction: 'outbound', text: 'Hi Rohan! 👋 Thank you for reaching out to Seevora. Your consultation with Dr. Sharma is booked for today at 4:30 PM. See you soon!' },
      { direction: 'inbound', text: 'Great, thanks for the quick confirmation!' }
    ]
  },
  {
    phone: '+919811234567',
    name: 'Ananya Iyer',
    messages: [
      { direction: 'outbound', text: 'Hi Ananya, as requested on your call, here is our complete cosmetic dental brochure: https://seevora.ai/brochure' },
      { direction: 'inbound', text: 'Thanks! Does the smile makeover package include cleanings?' },
      { direction: 'outbound', text: 'Yes, it includes 2 professional cleanings and complimentary whitening touch-up.' }
    ]
  },
  {
    phone: '+919855678901',
    name: 'Kavita Nair',
    messages: [
      { direction: 'inbound', text: 'price of family checkup?' },
      { direction: 'outbound', text: 'Hi Kavita! Our comprehensive family checkup starts at ₹1,499 covering up to 4 family members. Reply DEMO to book a call!' }
    ]
  }
];

dummyWhatsApp.forEach((dw) => {
  let conv = db.waConversations.find((c) => c.phone === dw.phone && c.tenantId === CLIENT_TENANT_ID);
  if (!conv) {
    conv = {
      id: genId('conv_'),
      tenantId: CLIENT_TENANT_ID,
      contactId: genId('con_'),
      phone: dw.phone,
      name: dw.name,
      unreadCount: 0,
      status: 'active',
      lastMessageText: dw.messages[dw.messages.length - 1].text.slice(0, 80),
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString()
    };
    db.waConversations.push(conv);
  }
  dw.messages.forEach((m, idx) => {
    const msgId = 'msg_demo_' + dw.phone.slice(-4) + '_' + idx;
    if (!db.waMessages.some((x) => x.id === msgId)) {
      db.waMessages.push({
        id: msgId,
        tenantId: CLIENT_TENANT_ID,
        conversationId: conv.id,
        contactId: conv.contactId,
        phone: dw.phone,
        direction: m.direction,
        type: 'text',
        text: m.text,
        status: 'delivered',
        metadata: {},
        createdAt: new Date(Date.now() - (3 - idx) * 3600000).toISOString()
      });
    }
  });
});

// 10. AI Agents for Client Demo
if (!db.agents) db.agents = [];
let clientAgent = db.agents.find((a) => a.tenantId === CLIENT_TENANT_ID);
if (!clientAgent) {
  clientAgent = {
    id: genId('ag_'),
    tenantId: CLIENT_TENANT_ID,
    name: 'Priya - AI Voice Receptionist',
    persona: 'A warm, professional front-desk medical and dental clinic receptionist who greets callers, answers FAQs, qualifies inquiries, and confirms appointments.',
    tts: { provider: 'rumik', voice: 'ira', model: 'muga' },
    greeting: 'Hi! Thank you for calling Seevora Clinic. I am Priya, your front-desk AI assistant. How can I help you today?',
    telephony: { did: '+918071582519', provider: 'vobiz' },
    status: 'active',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString()
  };
  db.agents.push(clientAgent);
}

// Save back to db.json
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('✅ Demo dummy data successfully seeded!');
console.log('- Total Tenants:', db.tenants.length);
console.log('- Total Users:', db.users.length);
console.log('- Total Invoices:', db.invoices.length);
console.log('- Total Payment Events:', db.paymentEvents.length);
console.log('- Total Support Tickets:', db.supportTickets.length);
console.log('- Total Call Recordings:', db.callRecordings.length);
console.log('- Total CRM Contacts:', db.crmContacts.length);
console.log('- Total WhatsApp Conversations:', db.waConversations.length);
console.log('- Total WhatsApp Messages:', db.waMessages.length);
console.log('- Total Usage Rows:', db.usage.length);
