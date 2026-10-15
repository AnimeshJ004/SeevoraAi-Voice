'use strict';

const crypto = require('crypto');

function genId(prefix) {
  return (prefix || '') + crypto.randomBytes(8).toString('hex');
}

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

function seedTenantDataIfEmpty(d, tid, tenantName) {
  if (!d || !tid) return;

  // Collections defensive check
  ['wallets', 'agents', 'usage', 'callRecordings', 'crmContacts', 'waConversations', 'waMessages', 'waAutomations', 'invoices', 'supportTickets'].forEach((k) => {
    if (!Array.isArray(d[k])) d[k] = [];
  });

  // 1. Wallet
  let w = d.wallets.find((x) => x.tenantId === tid);
  if (!w) {
    d.wallets.push({
      id: genId('wal_'),
      tenantId: tid,
      currency: 'INR',
      balancePaise: 250000,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString()
    });
  } else if ((w.balancePaise || 0) < 50000) {
    w.balancePaise = 250000;
  }

  // 2. Active Agent
  const seevoraFacts = [
    'Company name: Seevora',
    'Website: seevora.in',
    'Location: Indore, Madhya Pradesh, India',
    'Founder and CEO: Chaitanya Panwar',
    'What Seevora does: Seevora builds custom AI automation solutions for Indian businesses.',
    'Services Seevora offers:',
    '1. Twenty-four seven AI Voice Receptionists that answer business phone calls round the clock',
    '2. Lead Qualification and Follow-up Automation for customer engagement',
    '3. CRM Integrations to connect AI automation with existing business tools',
    '4. Custom AI Chatbots for websites and mobile apps',
    '5. Lead Qualification through automated voice and chat conversations',
    '6. Appointment Booking automation',
    '7. E-commerce Automation for order updates, queries, and customer support',
    'Phone: +91 8071582519',
    'Working Hours: Monday to Saturday, 9:00 AM to 8:00 PM IST.',
    'Pricing: Custom pricing based on business requirements and call volume. Offer a free callback from the team.'
  ].join('\n');

  const dograhPrompt = `# WHO YOU ARE
You are Ria, the AI receptionist for Seevora. You are on a live phone call.

# SEEVORA COMPANY FACTS (answer ONLY from these, never guess or invent)
Company name: Seevora
Website: seevora.in
Location: Indore, Madhya Pradesh, India
Founder and CEO: Chaitanya Panwar
What Seevora does: Seevora builds custom AI automation solutions for Indian businesses.
Services Seevora offers:
1. Twenty-four seven AI Voice Receptionists that answer business phone calls round the clock
2. Lead Qualification and Follow-up Automation for customer engagement
3. CRM Integrations to connect AI automation with existing business tools
4. Custom AI Chatbots for websites and mobile apps
5. Lead Qualification through automated voice and chat conversations
6. Appointment Booking automation
7. E-commerce Automation for order updates, queries, and customer support

If asked about pricing: say it depends on the specific use case and offer to have the Seevora team call back with a quote.
If asked anything not covered above: say honestly you will have the team follow up, and do not make up any answer.

# HOW YOU SPEAK, THIS MATTERS MORE THAN ANYTHING
- STRICT LANGUAGE MIRRORING (CRITICAL): You MUST ALWAYS reply in the exact language the caller speaks!
  * If the caller speaks Hindi or Hinglish (e.g. "Seevora ke baare me batao", "Aap kya karte ho?", "Founder kaun hai?"): YOU MUST REPLY IN NATURAL CONVERSATIONAL HINDI / HINGLISH. NEVER reply in English to a Hindi question!
  * If the caller speaks English (e.g. "Tell me about Seevora", "Who is the CEO?"): Reply in natural English.
  * Always mirror the caller's language dynamically from turn to turn.
- ONE or TWO short spoken sentences per turn. Never more. This is a phone call, not an essay.
- Natural spoken phrasing. No bullet points, no lists, no markdown, no emoji.
- Warm, quick, confident. Like a sharp receptionist who genuinely wants to help.
- NEVER say "sorry, I didn't catch that" repeatedly. Roll with remarks and steer back to how you can assist.`;

  let agent = d.agents.find((a) => a.tenantId === tid);
  if (!agent) {
    agent = {
      id: 'ag_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12),
      tenantId: tid,
      name: 'Ria - Seevora AI Voice Receptionist',
      role: 'receptionist',
      language: 'hi-IN',
      tts: { provider: 'rumik', model: 'muga', voice: 'ira', speaker: 'speaker_2', tone: 'neutral', description: 'a warm, clear Indian-English female voice with a natural conversational tone, friendly and professional' },
      stt: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
      llm: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: "Hi! Thank you for calling Seevora! I'm your AI assistant. How can I help you today?",
      persona: dograhPrompt,
      knowledge: seevoraFacts,
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString()
    };
    d.agents.push(agent);
  } else {
    // Keep agent synced with Seevora facts
    agent.name = 'Ria - Seevora AI Voice Receptionist';
    agent.persona = dograhPrompt;
    agent.knowledge = seevoraFacts;
    agent.greeting = "Hi! Thank you for calling Seevora! I'm your AI assistant. How can I help you today?";
    agent.llm = { provider: 'groq', model: 'qwen/qwen3.8-27b' };
    agent.tts = { provider: 'rumik', model: 'muga', voice: 'ira', speaker: 'speaker_2', tone: 'neutral', description: 'a warm, clear Indian-English female voice with a natural conversational tone, friendly and professional' };
  }

  // 3. 14 Days Usage
  const existingDays = new Set(d.usage.filter((u) => u.tenantId === tid).map((u) => u.day));
  for (let dayIdx = 13; dayIdx >= 0; dayIdx--) {
    const dayStr = new Date(Date.now() - dayIdx * 86400000).toISOString().slice(0, 10);
    if (!existingDays.has(dayStr)) {
      const calls = 14 + (dayIdx % 6) * 4;
      const chars = 16000 + (dayIdx % 6) * 3500;
      const minutes = 28 + (dayIdx % 6) * 8;
      const llmTokens = 22000 + (dayIdx % 6) * 4000;
      const costInr = Math.round(((chars / 1000) * 0.12 + calls * 0.9 + minutes * 1.5) * 100) / 100;
      d.usage.push({
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

  // 4. Call Recordings
  const tenantCalls = d.callRecordings.filter((r) => r.tenantId === tid);
  if (tenantCalls.length < 8) {
    CALL_TEMPLATES.forEach((tmpl, idx) => {
      const callId = 'rec_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_' + tmpl.refSuffix;
      if (!d.callRecordings.some((r) => r.id === callId)) {
        const startedAt = new Date(Date.now() - (tmpl.dayOffset * 86400000 + tmpl.hourOffset * 3600000)).toISOString();
        d.callRecordings.unshift({
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

  // 5. CRM Contacts
  const tenantCrm = d.crmContacts.filter((c) => c.tenantId === tid);
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
      if (!d.crmContacts.some((c) => c.id === cid)) {
        d.crmContacts.push({
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

  // 6. Invoices
  const tenantInvoices = d.invoices.filter((inv) => inv.tenantId === tid);
  if (tenantInvoices.length < 2) {
    const inv1Id = 'inv_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_01';
    const inv2Id = 'inv_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_02';
    if (!d.invoices.some((x) => x.id === inv1Id)) {
      d.invoices.push({
        id: inv1Id,
        tenantId: tid,
        invoiceNumber: 'SV-2026-' + Math.floor(1000 + Math.random() * 9000),
        clientName: tenantName || 'Workspace Client',
        clientEmail: 'billing@workspace.in',
        description: 'Growth Plan Subscription (Quarterly AI Voice Receptionist)',
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
    if (!d.invoices.some((x) => x.id === inv2Id)) {
      d.invoices.push({
        id: inv2Id,
        tenantId: tid,
        invoiceNumber: 'SV-2026-' + Math.floor(1000 + Math.random() * 9000),
        clientName: tenantName || 'Workspace Client',
        clientEmail: 'billing@workspace.in',
        description: 'Outbound Telephony Minutes Pack & Priority Support',
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

  // 7. Support Tickets
  const tenantTickets = d.supportTickets.filter((st) => st.tenantId === tid);
  if (tenantTickets.length < 1) {
    const t1Id = 'tick_' + tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + '_01';
    if (!d.supportTickets.some((x) => x.id === t1Id)) {
      d.supportTickets.push({
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
  }
}

function seedAllTenants(d) {
  if (!d || !Array.isArray(d.tenants)) return;
  if (process.env.RAPIDX_DB_FILE) return;

  // Extra portfolio workspaces
  const extraTenants = [
    { id: 't_apex_diag_demo', name: 'Apex Health & Diagnostics', slug: 'apex-health', plan: 'growth' },
    { id: 't_nexus_realty_demo', name: 'Nexus Prime Real Estate', slug: 'nexus-realty', plan: 'agency' },
    { id: 't_starlight_auto_demo', name: 'Starlight Motors Sales & Service', slug: 'starlight-motors', plan: 'growth' },
    { id: 't_horizon_law_demo', name: 'Horizon Advisory & Corporate Law', slug: 'horizon-law', plan: 'studio' }
  ];

  extraTenants.forEach((et) => {
    let ex = d.tenants.find((t) => t.id === et.id);
    if (!ex) {
      d.tenants.push({
        id: et.id,
        name: et.name,
        slug: et.slug,
        plan: et.plan,
        status: 'active',
        privacyMode: 'standard',
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        providers: { stt: 'deepgram', tts: 'rumik', llm: 'groq', telephony: 'vobiz' }
      });
    }
  });

  d.tenants.forEach((t) => {
    if (t.id.startsWith('t_test_rzp_')) return;
    if (!t.plan || t.plan === 'starter' || t.plan === 'client_starter') t.plan = 'growth';
    t.status = 'active';
    seedTenantDataIfEmpty(d, t.id, t.name);
  });
}

module.exports = {
  seedTenantDataIfEmpty,
  seedAllTenants,
  CALL_TEMPLATES
};
