'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

function genId(prefix) {
  return (prefix || '') + crypto.randomBytes(8).toString('hex');
}

// Ensure all collections exist
const COLLECTIONS = [
  'tenants', 'users', 'agents', 'usage', 'sessions', 'wallets', 'ledger',
  'paymentIntents', 'supportTickets', 'supportMessages', 'auditEvents',
  'presets', 'byonConnections', 'hvacJobs', 'hvacSettings', 'paymentEvents', 'demoLinks',
  'invoices', 'invoiceEvents', 'integrationRequests', 'agencyPrompts',
  'clientActivities', 'tenantStatusEvents', 'callRecordings',
  'crmContacts', 'crmPipelines', 'waConversations', 'waMessages',
  'waTemplates', 'waBroadcasts', 'waAutomations', 'wacrmConfig'
];
COLLECTIONS.forEach((c) => {
  if (!Array.isArray(db[c])) db[c] = [];
});

// 1. Extra Portfolio Workspaces for Admin Panel
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
    plan: 'growth',
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
      limits: { maxAgents: 5, maxConcurrentCalls: 4, maxMinutesMonthly: 5000 }
    });
  }
});

// Master Call Templates (10 realistic calls: 5 Inbound, 5 Outbound with full transcripts)
const CALL_TEMPLATES = [
  {
    refSuffix: '01',
    phoneNumber: '+919820154321',
    callerNumber: '+919820154321',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 114,
    agentName: 'Priya - Front-Desk Receptionist',
    dayOffset: 0,
    hourOffset: 2,
    summary: 'Caller inquired about consultation slot and clinic timings. Confirmed appointment for 4:30 PM with Dr. Sharma.',
    transcript: 'Agent: Namaste! Thanks for calling Seevora AI Voice. Main Priya hoon, batayein aaj main aapki kya madad kar sakti hoon?\nCaller: Haan Priya ji, mujhe appointment book karna tha consultation ke liye. Aaj koi slot available hai kya?\nAgent: Bilkul! Aaj sham 4:30 PM aur 6:00 PM par Dr. Sharma ke slots available hain. Kaunsa time aapke liye convenient rahega?\nCaller: 4:30 PM wala slot book kar dijiye, under Rohan Sharma.\nAgent: Perfect Rohan ji! Aapka appointment 4:30 PM par confirm kar diya gaya hai. Confirmation details WhatsApp par bhej di gayi hain. Aur koi jankari chahiye?\nCaller: Nahi, thank you so much Priya ji!\nAgent: You are welcome, have a great day!'
  },
  {
    refSuffix: '02',
    phoneNumber: '+919811234567',
    callerNumber: '+918071582519',
    calledNumber: '+919811234567',
    direction: 'outbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 78,
    agentName: 'Priya - Outbound Followup',
    dayOffset: 0,
    hourOffset: 4,
    summary: 'Outbound follow-up on website enquiry. Shared digital catalog and pricing brochure via WhatsApp.',
    transcript: 'Agent: Hello Ananya! This is Priya calling from Seevora Voice following up on your website enquiry regarding our service packages.\nCaller: Hi Priya! Yes, I was looking for the pricing details and brochure.\nAgent: Wonderful! I have just dispatched our comprehensive brochure with all pricing tiers directly to your WhatsApp. Would you like me to reserve a free consultation slot?\nCaller: Let me check the brochure first, then I will reply on WhatsApp.\nAgent: Sounds great Ananya! Feel free to reply on WhatsApp anytime. Have a wonderful day!'
  },
  {
    refSuffix: '03',
    phoneNumber: '+919833456789',
    callerNumber: '+919833456789',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 92,
    agentName: 'Priya - Front-Desk Receptionist',
    dayOffset: 1,
    hourOffset: 1,
    summary: 'Inquiry regarding working hours and clinic address. Location link shared on WhatsApp.',
    transcript: 'Agent: Namaste! Seevora Voice me aapka swagat hai. Main aapki kya sahayata kar sakti hoon?\nCaller: Namaste, mujhe clinic ke working hours aur location ke baare me puchna tha.\nAgent: Hamara clinic Monday se Saturday subah 9 baje se raat 8 baje tak khula rehta hai. Address MG Road central branch par hai. Kya aapko Google Maps location WhatsApp par share kar doon?\nCaller: Haan please, is number par WhatsApp share kar dijiye.\nAgent: Done! Map location aur directions bhej diye gaye hain.\nCaller: Shukriya Priya ji!'
  },
  {
    refSuffix: '04',
    phoneNumber: '+919844567890',
    callerNumber: '+918071582519',
    calledNumber: '+919844567890',
    direction: 'outbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 65,
    agentName: 'Priya - Outbound Followup',
    dayOffset: 1,
    hourOffset: 3,
    summary: 'Appointment reminder call for tomorrow morning 11:00 AM. Attendance confirmed.',
    transcript: 'Agent: Hello Pooja ji! This is Priya from Seevora Voice with a quick reminder for your scheduled appointment tomorrow morning at 11:00 AM.\nCaller: Hello Priya! Yes, thank you for reminding me. I will be there at 11 sharp.\nAgent: Glad to hear that Pooja ji! Please let us know if you need any assistance with parking or directions. See you tomorrow!'
  },
  {
    refSuffix: '05',
    phoneNumber: '+919920384712',
    callerNumber: '+919920384712',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 142,
    agentName: 'Priya - Front-Desk Receptionist',
    dayOffset: 2,
    hourOffset: 2,
    summary: 'Corporate wellness plan inquiry for 45 team members. Escalated to B2B manager.',
    transcript: 'Agent: Namaste Vikramaditya ji! How can I assist you today?\nCaller: Hi Priya, I need details on corporate employee wellness plans.\nAgent: We offer tailored corporate plans covering preventive checkups, routine consultations, and digital health records for teams of all sizes. May I know your approximate team size?\nCaller: We have around 45 team members right now.\nAgent: Excellent! I will connect you with our corporate relations manager Rajesh. He will share custom quote proposals today by 2 PM.\nCaller: Perfect, thank you Priya.'
  },
  {
    refSuffix: '06',
    phoneNumber: '+919845012399',
    callerNumber: '+918071582519',
    calledNumber: '+919845012399',
    direction: 'outbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 86,
    agentName: 'Priya - Outbound Followup',
    dayOffset: 2,
    hourOffset: 5,
    summary: 'Post-visit feedback collection. Positive patient experience recorded.',
    transcript: 'Agent: Hello Kavita! Priya here from Seevora Voice. Calling regarding your feedback from yesterday consultation.\nCaller: Oh hi Priya! The doctor was very attentive and the front desk was super efficient.\nAgent: We are delighted to hear that Kavita! A feedback link has also been shared on your WhatsApp. We look forward to serving you again.'
  },
  {
    refSuffix: '07',
    phoneNumber: '+919702234110',
    callerNumber: '+919702234110',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 105,
    agentName: 'Priya - Front-Desk Receptionist',
    dayOffset: 3,
    hourOffset: 1,
    summary: 'Inquiry regarding cashless insurance coverage. Confirmed all major TPA tie-ups.',
    transcript: 'Agent: Hello Rahul ji! Welcome to Seevora. How may I help you?\nCaller: Hello, I wanted to inquire if medical insurance cashless facility is available at your center?\nAgent: Yes Rahul ji, we have tie-ups with all major TPA and private health insurers for seamless cashless claims. Our billing desk handles approvals directly.\nCaller: That is very helpful, thank you!\nAgent: You are welcome! Feel free to call us anytime.'
  },
  {
    refSuffix: '08',
    phoneNumber: '+919987654321',
    callerNumber: '+918071582519',
    calledNumber: '+919987654321',
    direction: 'outbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 98,
    agentName: 'Priya - Outbound Followup',
    dayOffset: 3,
    hourOffset: 4,
    summary: 'Diagnostic report delivery follow-up. PDF sent via WhatsApp.',
    transcript: 'Agent: Hello Sneha ji! This is Priya from Seevora Voice following up on your diagnostic lab report.\nCaller: Hi Priya, has the blood panel report arrived?\nAgent: Yes Sneha ji! The doctor has reviewed the report and it has been uploaded to your secure patient portal and sent on WhatsApp as a PDF.\nCaller: Excellent, I see the WhatsApp message now. Thank you!\nAgent: You are very welcome! Take care.'
  },
  {
    refSuffix: '09',
    phoneNumber: '+919811190234',
    callerNumber: '+919811190234',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 120,
    agentName: 'Priya - Front-Desk Receptionist',
    dayOffset: 4,
    hourOffset: 2,
    summary: 'Appointment reschedule request. Moved slot to Friday 5:00 PM.',
    transcript: 'Agent: Namaste Amit ji! Welcome to Seevora AI Voice. How can I assist you?\nCaller: Hi Priya, can I reschedule my appointment from Thursday to Friday 5 PM?\nAgent: Absolutely! Checking our schedule... Yes, Friday at 5:00 PM is available. I have updated your slot.\nCaller: Thank you Priya, that was very quick!\nAgent: Glad to help! You will receive the updated calendar invite shortly.'
  },
  {
    refSuffix: '10',
    phoneNumber: '+919820011223',
    callerNumber: '+919820011223',
    calledNumber: '+918071582519',
    direction: 'inbound',
    mode: 'vobiz',
    status: 'completed',
    durationSeconds: 80,
    agentName: 'Priya - Front-Desk Receptionist',
    dayOffset: 4,
    hourOffset: 6,
    summary: 'Home sample collection booked for tomorrow 8:00 AM.',
    transcript: 'Agent: Hello Deepa! Welcome to Seevora Voice. How may I assist you today?\nCaller: Hi, do you offer home sample collection for diagnostic tests?\nAgent: Yes, we provide complimentary home sample collection between 7 AM and 11 AM daily. Would you like me to book a phlebotomist visit for tomorrow?\nCaller: Yes, please book 8 AM tomorrow at Bandra West.\nAgent: All set Deepa! Our technician will arrive at 8:00 AM tomorrow. Booking confirmation sent on WhatsApp.'
  }
];

// Target tenants to seed: All non-test tenants
const targetTenants = db.tenants.filter((t) => !t.id.startsWith('t_test_rzp_'));

console.log('Seeding demo data across ' + targetTenants.length + ' tenants...');

targetTenants.forEach((tenant) => {
  const tid = tenant.id;

  // 1. Upgrade plan to Growth if Starter (unlocks all tabs, automations, broadcasts)
  if (!tenant.plan || tenant.plan === 'starter' || tenant.plan === 'client_starter') {
    tenant.plan = 'growth';
  }
  tenant.status = 'active';

  // 2. Ensure Wallet (₹2,500)
  let w = db.wallets.find((x) => x.tenantId === tid);
  if (!w) {
    w = {
      id: genId('wal_'),
      tenantId: tid,
      currency: 'INR',
      balancePaise: 250000,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString()
    };
    db.wallets.push(w);
  } else if ((w.balancePaise || 0) < 50000) {
    w.balancePaise = 250000;
  }

  // 3. Ensure Active AI Voice Agent
  let ag = db.agents.find((x) => x.tenantId === tid);
  if (!ag) {
    ag = {
      id: 'ag_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12),
      tenantId: tid,
      name: 'Priya - AI Voice Receptionist',
      role: 'receptionist',
      language: 'hi-IN',
      tts: { provider: 'rumik', model: 'muga', voice: 'speaker_2', tone: 'warm & professional' },
      stt: { provider: 'deepgram', model: 'nova-2', language: 'hi' },
      llm: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: 'Namaste! Seevora Voice Receptionist me aapka swagat hai. Main Priya hoon, batayein main aapki kya sahayata kar sakti hoon?',
      prompt: 'You are Priya, a polite, helpful AI voice receptionist speaking natural conversational Hindi and English (Hinglish). Greet callers warmly, answer questions about timings, services, appointments, and guide them to schedule consultations.',
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString()
    };
    db.agents.push(ag);
  }

  // 4. Ensure 14 Days of Daily Usage (calls, chars, minutes, tokens, cost)
  const existingUsageDays = new Set(db.usage.filter((u) => u.tenantId === tid).map((u) => u.day));
  for (let d = 13; d >= 0; d--) {
    const dayStr = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    if (!existingUsageDays.has(dayStr)) {
      const calls = 14 + (d % 6) * 4;
      const chars = 16000 + (d % 6) * 3500;
      const minutes = 28 + (d % 6) * 8;
      const llmTokens = 22000 + (d % 6) * 4000;
      const costInr = Math.round(((chars / 1000) * 0.12 + calls * 0.9 + minutes * 1.5) * 100) / 100;
      db.usage.push({
        id: genId('usg_'),
        tenantId: tid,
        day: dayStr,
        calls,
        chars,
        minutes,
        llmTokens,
        costInr
      });
    }
  }

  // 5. Ensure Call Recordings (10 calls: 5 Inbound + 5 Outbound with full transcripts)
  const tenantCalls = db.callRecordings.filter((r) => r.tenantId === tid);
  if (tenantCalls.length < 8) {
    CALL_TEMPLATES.forEach((tmpl, idx) => {
      const callId = 'rec_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_' + tmpl.refSuffix;
      if (!db.callRecordings.some((r) => r.id === callId)) {
        const startedAt = new Date(Date.now() - (tmpl.dayOffset * 86400000 + tmpl.hourOffset * 3600000)).toISOString();
        db.callRecordings.unshift({
          id: callId,
          tenantId: tid,
          dograhRunId: '80' + (idx + 100),
          phoneNumber: tmpl.phoneNumber,
          callerNumber: tmpl.callerNumber,
          calledNumber: tmpl.calledNumber,
          direction: tmpl.direction,
          mode: tmpl.mode,
          status: tmpl.status,
          durationSeconds: tmpl.durationSeconds,
          agentName: tmpl.agentName,
          startedAt,
          summary: tmpl.summary,
          transcript: tmpl.transcript,
          recordingAvailable: true
        });
      }
    });
  }

  // 6. Ensure CRM Contacts (7 leads across all stages with deal values)
  const tenantCrm = db.crmContacts.filter((c) => c.tenantId === tid);
  if (tenantCrm.length < 5) {
    const sampleContacts = [
      { name: 'Rohan Sharma', phone: '+919820154321', stage: 'Closed Won', dealValue: 18500, notes: 'Full comprehensive consultation completed. Highly satisfied.' },
      { name: 'Ananya Roy', phone: '+919811234567', stage: 'Proposal Sent', dealValue: 35000, notes: 'Sent digital service catalog & quotation on WhatsApp.' },
      { name: 'Dr. Sameer Verma', phone: '+919833456789', stage: 'Call Completed', dealValue: 12000, notes: 'Inquired about branch address and appointment slots.' },
      { name: 'Vikramaditya Roy', phone: '+919920384712', stage: 'Qualified', dealValue: 65000, notes: 'Corporate wellness program for 45 members.' },
      { name: 'Pooja Agarwal', phone: '+919844567890', stage: 'Closed Won', dealValue: 22000, notes: 'Scheduled follow-up session. Reminder sent.' },
      { name: 'Rahul Mehra', phone: '+919702234110', stage: 'New Lead', dealValue: 8000, notes: 'Insurance cashless coverage inquiry from web widget.' },
      { name: 'Kavita Menon', phone: '+919845012399', stage: 'Call Completed', dealValue: 15000, notes: 'Positive feedback recorded for yesterday session.' }
    ];

    sampleContacts.forEach((sc, idx) => {
      const cid = 'con_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_' + (idx + 1);
      if (!db.crmContacts.some((c) => c.id === cid)) {
        db.crmContacts.push({
          id: cid,
          tenantId: tid,
          name: sc.name,
          phone: sc.phone,
          stage: sc.stage,
          dealValue: sc.dealValue,
          notes: sc.notes,
          source: 'voice_ai',
          tags: ['voice_ai', 'lead'],
          createdAt: new Date(Date.now() - (idx + 1) * 86400000).toISOString(),
          updatedAt: new Date(Date.now() - idx * 3600000).toISOString()
        });
      }
    });
  }

  // 7. Ensure WhatsApp Conversations & Messages
  const tenantConvs = db.waConversations.filter((c) => c.tenantId === tid);
  if (tenantConvs.length < 3) {
    const waThreads = [
      {
        phone: '+919820154321',
        name: 'Rohan Sharma',
        preview: 'Aapka consultation 4:30 PM confirm ho gaya hai.',
        messages: [
          { from: 'user', text: 'Hi, kya aaj 4:30 PM ka slot confirm hai?' },
          { from: 'agent', text: 'Namaste Rohan ji! Haan, aapka appointment aaj 4:30 PM par Dr. Sharma ke sath confirmed hai.' },
          { from: 'user', text: 'Thank you! Main time par aa jaunga.' }
        ]
      },
      {
        phone: '+919811234567',
        name: 'Ananya Roy',
        preview: 'Comprehensive brochure and pricing tiers dispatched.',
        messages: [
          { from: 'user', text: 'Hi Priya, can you send the price breakdown?' },
          { from: 'agent', text: 'Hello Ananya! Here is our complete service catalog and pricing package tiers: https://seevora.ai/catalog' },
          { from: 'user', text: 'Thanks! Reviewing now.' }
        ]
      },
      {
        phone: '+919833456789',
        name: 'Dr. Sameer Verma',
        preview: 'Clinic Google Maps directions link shared.',
        messages: [
          { from: 'user', text: 'Please send clinic location on Google Maps.' },
          { from: 'agent', text: 'Here is our central clinic location: https://maps.google.com/?q=SeevoraClinic' },
          { from: 'user', text: 'Got it, thank you!' }
        ]
      },
      {
        phone: '+919987654321',
        name: 'Sneha Patel',
        preview: 'Diagnostic report PDF uploaded.',
        messages: [
          { from: 'agent', text: 'Hello Sneha ji! Your diagnostic health report is ready: https://seevora.ai/reports/s_9021.pdf' },
          { from: 'user', text: 'Received the PDF, thank you so much Priya!' }
        ]
      }
    ];

    waThreads.forEach((th, idx) => {
      const convId = 'wac_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_' + (idx + 1);
      if (!db.waConversations.some((c) => c.id === convId)) {
        db.waConversations.push({
          id: convId,
          tenantId: tid,
          phoneNumber: th.phone,
          customerName: th.name,
          lastMessageText: th.preview,
          lastMessageAt: new Date(Date.now() - (idx * 3600000 + 1800000)).toISOString(),
          unreadCount: 0,
          createdAt: new Date(Date.now() - 5 * 86400000).toISOString()
        });

        th.messages.forEach((msg, mIdx) => {
          db.waMessages.push({
            id: genId('wam_'),
            conversationId: convId,
            tenantId: tid,
            sender: msg.from,
            text: msg.text,
            timestamp: new Date(Date.now() - (idx * 3600000 + (3 - mIdx) * 600000)).toISOString()
          });
        });
      }
    });
  }

  // 8. Ensure WhatsApp Automations (3 pre-built workflows)
  const tenantAutos = db.waAutomations.filter((a) => a.tenantId === tid);
  if (tenantAutos.length < 2) {
    const sampleAutomations = [
      {
        name: 'Post-Call WhatsApp Brochure & Location Follow-up',
        triggerType: 'call_completed',
        isActive: true,
        steps: [
          { type: 'send_whatsapp_template', template: 'appointment_confirmation' },
          { type: 'tag_contact', tag: 'called_lead' }
        ]
      },
      {
        name: 'Instant Inbound Greeting & Booking Auto-Responder',
        triggerType: 'message_received',
        isActive: true,
        steps: [
          { type: 'send_whatsapp_message', text: 'Namaste! Seevora AI Voice me aapka swagat hai. How can we assist you today?' }
        ]
      },
      {
        name: 'Missed Call WhatsApp Alert & Priority Callback',
        triggerType: 'call_missed',
        isActive: true,
        steps: [
          { type: 'send_whatsapp_message', text: 'Sorry we missed your voice call! Our AI receptionist will call you back in 5 minutes.' }
        ]
      }
    ];

    sampleAutomations.forEach((auto) => {
      db.waAutomations.push({
        id: genId('auto_'),
        tenantId: tid,
        name: auto.name,
        triggerType: auto.triggerType,
        isActive: auto.isActive,
        steps: auto.steps,
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString()
      });
    });
  }

  // 9. Ensure Invoices (2 invoices: 1 Paid, 1 Issued)
  const tenantInvoices = db.invoices.filter((inv) => inv.tenantId === tid);
  if (tenantInvoices.length < 2) {
    const inv1Id = 'inv_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_01';
    const inv2Id = 'inv_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_02';
    if (!db.invoices.some((x) => x.id === inv1Id)) {
      db.invoices.push({
        id: inv1Id,
        tenantId: tid,
        invoiceNumber: 'SV-2026-' + Math.floor(1000 + Math.random() * 9000),
        clientName: tenant.name || 'Workspace Client',
        clientEmail: 'billing@' + (tenant.slug || 'workspace') + '.in',
        description: 'Growth Plan Subscription (Quarterly AI Voice Receptionist + WhatsApp Suite)',
        amountPaise: 899700,
        currency: 'INR',
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        status: 'paid',
        deliveryStatus: 'sent',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-02T14:30:00.000Z',
        issuedAt: '2026-10-01T10:00:00.000Z'
      });
    }
    if (!db.invoices.some((x) => x.id === inv2Id)) {
      db.invoices.push({
        id: inv2Id,
        tenantId: tid,
        invoiceNumber: 'SV-2026-' + Math.floor(1000 + Math.random() * 9000),
        clientName: tenant.name || 'Workspace Client',
        clientEmail: 'billing@' + (tenant.slug || 'workspace') + '.in',
        description: 'Outbound Telephony Minutes Pack & WhatsApp Cloud Add-on',
        amountPaise: 250000,
        currency: 'INR',
        issueDate: '2026-10-10',
        dueDate: '2026-10-24',
        status: 'issued',
        deliveryStatus: 'sent',
        createdAt: '2026-10-10T09:15:00.000Z',
        updatedAt: '2026-10-10T09:15:00.000Z',
        issuedAt: '2026-10-10T09:15:00.000Z'
      });
    }
  }

  // 10. Ensure Support Tickets (2 tickets)
  const tenantTickets = db.supportTickets.filter((st) => st.tenantId === tid);
  if (tenantTickets.length < 2) {
    const t1Id = 'tick_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_01';
    const t2Id = 'tick_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_02';
    if (!db.supportTickets.some((x) => x.id === t1Id)) {
      db.supportTickets.push({
        id: t1Id,
        tenantId: tid,
        subject: 'Custom Hindi Tone Calibration for Voice Receptionist',
        status: 'resolved',
        priority: 'normal',
        category: 'voice_ai',
        createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 6 * 86400000).toISOString()
      });
    }
    if (!db.supportTickets.some((x) => x.id === t2Id)) {
      db.supportTickets.push({
        id: t2Id,
        tenantId: tid,
        subject: 'WhatsApp Official Green Tick Verification Guidance',
        status: 'open',
        priority: 'high',
        category: 'whatsapp',
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString()
      });
    }
  }
});

// Atomic write to db.json
const tmpPath = dbPath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
fs.renameSync(tmpPath, dbPath);

console.log('✓ Successfully seeded demo data across all workspaces in db.json!');
