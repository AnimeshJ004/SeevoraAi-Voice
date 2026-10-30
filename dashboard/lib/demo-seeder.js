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


const SEEVORA_FACTS = [
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

const COMMON_SPEECH_RULES = `
# HOW YOU SPEAK (CRITICAL FOR LIVE TELEPHONY)
- STRICT LANGUAGE MIRRORING: If caller speaks Hindi/Hinglish, reply in natural conversational Hindi/Hinglish. If English, reply in English.
- Strictly ONE or TWO short spoken sentences per turn. Never speak long essays.
- Natural spoken phrasing. No bullet points, no markdown, no emojis.
- Never write or say "/" or raw symbols. Always speak words out loud.`;

function getPreconfiguredAgents(tid, seevoraFacts) {
  const tidClean = tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const facts = seevoraFacts || SEEVORA_FACTS;

  return [
    {
      id: `ag_${tidClean}_ria`,
      tenantId: tid,
      name: 'Ria - AI Voice Receptionist & Front Desk',
      role: 'Front Desk Receptionist',
      department: 'Front Desk & Reception',
      language: 'hi-IN',
      isPrimary: true,
      voiceProvider: 'rumik',
      rumikVoice: 'ira',
      rumikModel: 'mulberry',
      rumikTone: 'happy',
      tts: {
        provider: 'rumik',
        model: 'mulberry',
        voice: 'ira',
        speaker: 'speaker_2',
        f0_up_key: -1,
        tone: 'happy',
        description: 'Warm, clear Indian-English female voice with natural conversational pacing, friendly and welcoming'
      },
      stt: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
      llm: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: "Hi! Thank you for calling! Main Ria bol rahi hoon reception desk se. How can I help you today?",
      persona: `# WHO YOU ARE
You are Ria, the virtual front-desk receptionist for Seevora. You are answering incoming phone calls with a warm, welcoming, and helpful energy.

# PRIMARY RESPONSIBILITIES
1. Greet callers cheerfully and understand the reason for their call.
2. Provide quick, accurate answers regarding office location, working hours, and available service offerings.
3. Schedule appointments and consultations swiftly, capturing caller name and callback contact.
4. If the caller needs human assistance, offer to transfer or have a senior team member call back.
${COMMON_SPEECH_RULES}`,
      knowledge: facts,
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString()
    },
    {
      id: `ag_${tidClean}_priya`,
      tenantId: tid,
      name: 'Priya - Customer Care & Client Support Specialist',
      role: 'Customer Support Specialist',
      department: 'Customer Care & Support',
      language: 'hi-IN',
      isPrimary: false,
      voiceProvider: 'rumik',
      rumikVoice: 'riya',
      rumikModel: 'mulberry',
      rumikTone: 'happy',
      tts: {
        provider: 'rumik',
        model: 'mulberry',
        voice: 'riya',
        speaker: 'speaker_1',
        f0_up_key: 1,
        tone: 'happy',
        description: 'Empathetic, patient, active listening Indian female voice ideal for resolving customer issues'
      },
      stt: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
      llm: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: "Namaste! Main Priya bol rahi hoon customer support desk se. Kripya batayein main aapki kya sahayata kar sakti hoon?",
      persona: `# WHO YOU ARE
You are Priya, a customer care and client support specialist. You are patient, deeply empathetic, and dedicated to solving caller problems.

# PRIMARY RESPONSIBILITIES
1. Listen carefully to caller issues, questions, or service feedback without interrupting.
2. Calmly acknowledge difficulties, take down details, and provide step-by-step resolution.
3. Check ticket or request status and provide clear timelines for pending deliverables.
4. Escalate critical or urgent complaints to supervisor staff immediately.
${COMMON_SPEECH_RULES}`,
      knowledge: facts,
      createdAt: new Date(Date.now() - 22 * 86400000).toISOString()
    },
    {
      id: `ag_${tidClean}_aarav`,
      tenantId: tid,
      name: 'Aarav - Inbound Sales & Lead Qualification Specialist',
      role: 'Sales & Lead Qualification',
      department: 'Sales & Business Development',
      language: 'hi-IN',
      isPrimary: false,
      voiceProvider: 'rumik',
      rumikVoice: 'arav',
      rumikModel: 'mulberry',
      rumikTone: 'neutral',
      tts: {
        provider: 'rumik',
        model: 'mulberry',
        voice: 'arav',
        speaker: 'speaker_3',
        f0_up_key: -2,
        tone: 'neutral',
        description: 'Authoritative, confident, crisp male voice for high-conversion sales and discovery'
      },
      stt: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
      llm: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: "Hello! Thank you for calling our sales team. This is Aarav. How can I assist you with your project requirements today?",
      persona: `# WHO YOU ARE
You are Aarav, an inbound sales and discovery specialist. You are sharp, knowledgeable, and focused on understanding business needs and qualification.

# PRIMARY RESPONSIBILITIES
1. Understand the caller's company goals, current bottlenecks, and target timeline.
2. Qualify lead fit (approximate call volume, budget, tech readiness).
3. Highlight high-value automation benefits without sounding pushy.
4. Lock in a dedicated 20-minute solution walkthrough or demo call with the senior solutions team.
${COMMON_SPEECH_RULES}`,
      knowledge: facts,
      createdAt: new Date(Date.now() - 20 * 86400000).toISOString()
    },
    {
      id: `ag_${tidClean}_ananya`,
      tenantId: tid,
      name: 'Ananya - Executive Relationship & VIP Billing Coordinator',
      role: 'VIP Relationship & Billing Coordinator',
      department: 'Executive Accounts & Finance',
      language: 'hi-IN',
      isPrimary: false,
      voiceProvider: 'rumik',
      rumikVoice: 'ananya',
      rumikModel: 'mulberry',
      rumikTone: 'happy',
      tts: {
        provider: 'rumik',
        model: 'mulberry',
        voice: 'ananya',
        speaker: 'speaker_2',
        f0_up_key: 0,
        tone: 'happy',
        description: 'Polished, articulate, modern Indian female voice with executive clarity'
      },
      stt: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
      llm: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: "Good day! You have reached our executive relationship desk, Ananya speaking. How may I assist with your account today?",
      persona: `# WHO YOU ARE
You are Ananya, an executive relationship and VIP billing coordinator. You speak with refined elegance, articulate diction, and high-touch attentiveness.

# PRIMARY RESPONSIBILITIES
1. Assist enterprise clients, corporate partners, and account executives with account inquiries.
2. Handle billing queries, invoice disbursements, payment receipts, and contract renewal details.
3. Coordinate priority requests with executive leadership.
4. Maintain a professional, polite, and confidential demeanor at all times.
${COMMON_SPEECH_RULES}`,
      knowledge: facts,
      createdAt: new Date(Date.now() - 18 * 86400000).toISOString()
    },
    {
      id: `ag_${tidClean}_dev`,
      tenantId: tid,
      name: 'Dev - Technical Support & Operations Helpdesk',
      role: 'Technical Support Engineer',
      department: 'Technical Support & IT Operations',
      language: 'hi-IN',
      isPrimary: false,
      voiceProvider: 'rumik',
      rumikVoice: 'dev',
      rumikModel: 'mulberry',
      rumikTone: 'neutral',
      tts: {
        provider: 'rumik',
        model: 'mulberry',
        voice: 'dev',
        speaker: 'speaker_4',
        f0_up_key: -3,
        tone: 'neutral',
        description: 'Calm, reassuring, deep male voice specialized in step-by-step technical problem solving'
      },
      stt: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
      llm: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      telephony: { provider: 'vobiz', did: '+918071582519' },
      greeting: "Namaste! Technical helpdesk par aapka swagat hai, Dev bol raha hoon. Kripya batayein aapko kis system ya service mein issue aa raha hai?",
      persona: `# WHO YOU ARE
You are Dev, a technical support and IT operations specialist. You are methodical, calm, and guide callers step-by-step through technical checks.

# PRIMARY RESPONSIBILITIES
1. Triage technical incidents, service disruptions, or integration errors systematically.
2. Ask clear, structured diagnostic questions (error codes, affected numbers, webhook payloads).
3. Walk callers through standard self-serve remedies calmly.
4. If unresolved, log a Priority-1 engineering ticket and provide a ticket reference number.
${COMMON_SPEECH_RULES}`,
      knowledge: facts,
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString()
    }
  ];
}

function getPreconfiguredFlows(tid, agents) {
  const tidClean = tid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const agentMap = {};
  (agents || []).forEach(a => {
    const n = (a.name || '').toLowerCase();
    if (n.includes('ria')) agentMap.ria = a;
    else if (n.includes('priya')) agentMap.priya = a;
    else if (n.includes('aarav') || n.includes('arav')) agentMap.aarav = a;
    else if (n.includes('ananya')) agentMap.ananya = a;
    else if (n.includes('dev')) agentMap.dev = a;
  });

  return [
    {
      id: `dfl_${tidClean}_ria`,
      tenantId: tid,
      workflowId: '13027',
      name: 'Ria - Front Desk & Inbound Reception Flow',
      kind: 'generated',
      status: 'active',
      isActive: true,
      agentId: agentMap.ria ? agentMap.ria.id : null,
      description: 'Autonomous front desk receptionist for greetings, business hours, and consultation booking',
      greeting: (agentMap.ria && agentMap.ria.greeting) || "Hi! Thank you for calling! Main Ria bol rahi hoon reception desk se. How can I help you today?",
      prompt: (agentMap.ria && agentMap.ria.persona) || "You are Ria, virtual receptionist for Seevora.",
      nodes: [
        { id: '1', type: 'greeting', title: 'Start & Greeting', prompt: 'Greet caller warmly and introduce front desk.' },
        { id: '2', type: 'triage', title: 'Query & Qualification', prompt: 'Identify caller inquiry regarding services, timings, or office location.' },
        { id: '3', type: 'booking', title: 'Action / Booking', prompt: 'Capture contact details and schedule consultation slot.' },
        { id: '4', type: 'escalation', title: 'Human Transfer', prompt: 'Transfer to staff member if caller asks or if unresolved.' }
      ],
      fallbackPhone: '+91 89822 00895',
      assignedPhone: '+91 80715 82519',
      language: 'hi-IN',
      assignedBy: 'system',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    },
    {
      id: `dfl_${tidClean}_priya`,
      tenantId: tid,
      workflowId: '13028',
      name: 'Priya - Customer Care & Client Support Flow',
      kind: 'generated',
      status: 'active',
      isActive: false,
      agentId: agentMap.priya ? agentMap.priya.id : null,
      description: 'Empathetic issue resolution, complaint handling, and ticket tracking flow',
      greeting: (agentMap.priya && agentMap.priya.greeting) || "Namaste! Main Priya bol rahi hoon customer support desk se. Kripya batayein main aapki kya sahayata kar sakti hoon?",
      prompt: (agentMap.priya && agentMap.priya.persona) || "You are Priya, customer support specialist.",
      nodes: [
        { id: '1', type: 'greeting', title: 'Empathetic Welcome', prompt: 'Welcome caller with warm, patient empathy.' },
        { id: '2', type: 'triage', title: 'Issue Intake', prompt: 'Listen actively, capture complaint or service question details.' },
        { id: '3', type: 'resolution', title: 'Resolution & Status', prompt: 'Provide status update or step-by-step solution.' },
        { id: '4', type: 'escalation', title: 'Supervisor Handoff', prompt: 'Escalate to human supervisor if unresolved.' }
      ],
      fallbackPhone: '+91 89822 00895',
      assignedPhone: '+91 80715 82519',
      language: 'hi-IN',
      assignedBy: 'system',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    },
    {
      id: `dfl_${tidClean}_aarav`,
      tenantId: tid,
      workflowId: '13029',
      name: 'Aarav - Inbound Sales & Lead Qualification Flow',
      kind: 'generated',
      status: 'active',
      isActive: false,
      agentId: agentMap.aarav ? agentMap.aarav.id : null,
      description: 'Discovery, requirement qualification, pricing triage, and strategy demo scheduling',
      greeting: (agentMap.aarav && agentMap.aarav.greeting) || "Hello! Thank you for calling our sales team. This is Aarav. How can I assist you with your project requirements today?",
      prompt: (agentMap.aarav && agentMap.aarav.persona) || "You are Aarav, sales and lead qualification specialist.",
      nodes: [
        { id: '1', type: 'greeting', title: 'Sales Welcome', prompt: 'Professional corporate greeting and icebreaker.' },
        { id: '2', type: 'triage', title: 'Qualification & Needs', prompt: 'Ask about business volume, goals, and timeline.' },
        { id: '3', type: 'booking', title: 'Demo / Call Schedule', prompt: 'Schedule executive solution walkthrough.' },
        { id: '4', type: 'escalation', title: 'Sales Lead Transfer', prompt: 'Transfer hot lead to sales director.' }
      ],
      fallbackPhone: '+91 89822 00895',
      assignedPhone: '+91 80715 82519',
      language: 'hi-IN',
      assignedBy: 'system',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    },
    {
      id: `dfl_${tidClean}_ananya`,
      tenantId: tid,
      workflowId: '13030',
      name: 'Ananya - Executive Relationship & VIP Billing Flow',
      kind: 'generated',
      status: 'active',
      isActive: false,
      agentId: agentMap.ananya ? agentMap.ananya.id : null,
      description: 'High-touch executive client concierge, contract reviews, and billing inquiries',
      greeting: (agentMap.ananya && agentMap.ananya.greeting) || "Good day! You have reached our executive relationship desk, Ananya speaking. How may I assist with your account today?",
      prompt: (agentMap.ananya && agentMap.ananya.persona) || "You are Ananya, VIP relationship manager.",
      nodes: [
        { id: '1', type: 'greeting', title: 'Concierge Greeting', prompt: 'Polite, articulate executive welcome.' },
        { id: '2', type: 'triage', title: 'Account / Billing Verification', prompt: 'Verify account name and billing query.' },
        { id: '3', type: 'action', title: 'Invoice & Payment Delivery', prompt: 'Send invoice PDF or confirm payment status.' },
        { id: '4', type: 'escalation', title: 'Finance Executive Transfer', prompt: 'Transfer to finance head for special concessions.' }
      ],
      fallbackPhone: '+91 89822 00895',
      assignedPhone: '+91 80715 82519',
      language: 'hi-IN',
      assignedBy: 'system',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    },
    {
      id: `dfl_${tidClean}_dev`,
      tenantId: tid,
      workflowId: '13031',
      name: 'Dev - Technical Support & Operations Flow',
      kind: 'generated',
      status: 'active',
      isActive: false,
      agentId: agentMap.dev ? agentMap.dev.id : null,
      description: 'Technical troubleshooting, system status diagnostic, and engineering dispatch',
      greeting: (agentMap.dev && agentMap.dev.greeting) || "Namaste! Technical helpdesk par aapka swagat hai, Dev bol raha hoon. Kripya batayein aapko kis system ya service mein issue aa raha hai?",
      prompt: (agentMap.dev && agentMap.dev.persona) || "You are Dev, technical support engineer.",
      nodes: [
        { id: '1', type: 'greeting', title: 'Helpdesk Welcome', prompt: 'Calm, technical greeting.' },
        { id: '2', type: 'triage', title: 'Diagnostic Intake', prompt: 'Identify system error, API status, or device details.' },
        { id: '3', type: 'action', title: 'Troubleshooting & Fix', prompt: 'Guide user through step-by-step fix or log ticket.' },
        { id: '4', type: 'escalation', title: 'Engineering Escalation', prompt: 'Escalate to engineering on-call engineer.' }
      ],
      fallbackPhone: '+91 89822 00895',
      assignedPhone: '+91 80715 82519',
      language: 'hi-IN',
      assignedBy: 'system',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    }
  ];
}

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

  // 2. Pre-configured AI Agents & Dograh Voice Flows
  if (!Array.isArray(d.dograhFlows)) d.dograhFlows = [];
  const preconfiguredAgents = getPreconfiguredAgents(tid, SEEVORA_FACTS);
  preconfiguredAgents.forEach((pa) => {
    let existing = d.agents.find((a) => a.tenantId === tid && (a.id === pa.id || a.name.split('-')[0].trim().toLowerCase() === pa.name.split('-')[0].trim().toLowerCase()));
    if (!existing) {
      d.agents.push(pa);
    } else {
      existing.role = pa.role;
      existing.department = pa.department;
      existing.voiceProvider = pa.voiceProvider;
      existing.rumikVoice = pa.rumikVoice;
      existing.rumikModel = pa.rumikModel;
      existing.rumikTone = pa.rumikTone;
      existing.tts = pa.tts;
      if (!existing.greeting) existing.greeting = pa.greeting;
      if (!existing.persona) existing.persona = pa.persona;
      existing.knowledge = SEEVORA_FACTS;
    }
  });

  // Ensure primary line assignment
  const tenantAgents = d.agents.filter((a) => a.tenantId === tid);
  if (!tenantAgents.some((a) => a.isPrimary) && tenantAgents.length > 0) {
    tenantAgents[0].isPrimary = true;
  }

  // Pre-configured Dograh Flows
  const preconfiguredFlows = getPreconfiguredFlows(tid, tenantAgents);
  preconfiguredFlows.forEach((pf) => {
    let existing = d.dograhFlows.find((f) => f.tenantId === tid && (f.id === pf.id || f.name === pf.name || (f.agentId && f.agentId === pf.agentId)));
    if (!existing) {
      d.dograhFlows.push(pf);
    } else {
      if (!existing.agentId) existing.agentId = pf.agentId;
      if (!existing.greeting) existing.greeting = pf.greeting;
      if (!existing.prompt) existing.prompt = pf.prompt;
    }
  });

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
        const tmplOutcomes = [
          { outcome: 'appointment_booked', outcomeLabel: 'Appointment Booked', sentiment: 'positive', score: 96, tier: 'Hot Lead', action: 'Send WhatsApp appointment calendar invite', topics: ['Appointment', 'Doctor Consult'] },
          { outcome: 'interested', outcomeLabel: 'Interested Lead', sentiment: 'positive', score: 84, tier: 'Hot Lead', action: 'Send digital pricing brochure and packages', topics: ['Pricing', 'WhatsApp Share'] },
          { outcome: 'inquiry_handled', outcomeLabel: 'Inquiry Handled', sentiment: 'positive', score: 76, tier: 'Warm Lead', action: 'Log resolution in CRM contact history', topics: ['Timings & Location'] },
          { outcome: 'appointment_booked', outcomeLabel: 'Appointment Booked', sentiment: 'positive', score: 92, tier: 'Hot Lead', action: 'Send 24h SMS & WhatsApp reminder', topics: ['Appointment', 'Follow-up'] },
          { outcome: 'interested', outcomeLabel: 'Interested Lead', sentiment: 'positive', score: 88, tier: 'Hot Lead', action: 'Connect with B2B Corporate Wellness Manager', topics: ['Corporate Wellness', 'B2B'] },
          { outcome: 'inquiry_handled', outcomeLabel: 'Inquiry Handled', sentiment: 'positive', score: 79, tier: 'Warm Lead', action: 'Collect 5-star Google review feedback', topics: ['Feedback', 'Patient Care'] },
          { outcome: 'inquiry_handled', outcomeLabel: 'Inquiry Handled', sentiment: 'neutral', score: 71, tier: 'Warm Lead', action: 'Verify TPA cashless insurance policy eligibility', topics: ['Insurance', 'TPA Cashless'] },
          { outcome: 'inquiry_handled', outcomeLabel: 'Inquiry Handled', sentiment: 'positive', score: 78, tier: 'Warm Lead', action: 'Deliver lab blood panel report PDF on WhatsApp', topics: ['Diagnostic Tests', 'Lab Report'] },
          { outcome: 'appointment_booked', outcomeLabel: 'Appointment Booked', sentiment: 'positive', score: 94, tier: 'Hot Lead', action: 'Update calendar slot to Friday 5:00 PM', topics: ['Appointment', 'Reschedule'] },
          { outcome: 'appointment_booked', outcomeLabel: 'Appointment Booked', sentiment: 'positive', score: 95, tier: 'Hot Lead', action: 'Assign phlebotomist for 8:00 AM home collection', topics: ['Diagnostic Tests', 'Home Visit'] }
        ];
        const ot = tmplOutcomes[idx % tmplOutcomes.length];
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
          recordingAvailable: true,
          sentiment: ot.sentiment,
          sentimentLabel: ot.sentiment === 'positive' ? 'Positive' : (ot.sentiment === 'neutral' ? 'Neutral' : 'Negative'),
          sentimentScore: ot.sentiment === 'positive' ? { pos: 88, neu: 9, neg: 3 } : { pos: 25, neu: 65, neg: 10 },
          outcome: ot.outcome,
          outcomeLabel: ot.outcomeLabel,
          qualityScore: ot.score,
          qualityTier: ot.tier,
          nextAction: ot.action,
          keyTopics: ot.topics
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
  CALL_TEMPLATES,
  getPreconfiguredAgents,
  getPreconfiguredFlows,
  SEEVORA_FACTS
};
