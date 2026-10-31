/**
 * Seevora AI Assistant. Pure-Node, zero-dependency chatbot engine.
 *
 * Classifies a user message into one of seven intents and executes the
 * matching action. Handles thread persistence, daily chat limits, credit
 * deduction, and the confirmation gate for destructive actions.
 *
 * Exported helpers are called from the assistant API routes in server.js.
 * No em dashes anywhere. Commas and periods only.
 */
'use strict';

const crypto = require('crypto');

// ---- intent labels (keep in sync with frontend) --------------------------
const INTENTS = Object.freeze({
  BUILD_AGENT: 'build_agent',
  TRAIN_AGENT: 'train_agent',
  EDIT_AGENT: 'edit_agent',
  ADD_KNOWLEDGE: 'add_knowledge',
  CONNECT_INTEGRATION: 'connect_integration',
  CREATE_CAMPAIGN: 'create_campaign',
  BROADCAST_MESSAGE: 'broadcast_message',
  SEND_EMAIL: 'send_email',
  CONFIGURE_GMAIL: 'configure_gmail',
  EMAIL_TROUBLESHOOT: 'email_troubleshoot',
  SCHEDULE_CALENDAR: 'schedule_calendar',
  SEND_WHATSAPP: 'send_whatsapp',
  CRM_CREATE_LEAD: 'crm_create_lead',
  ASK_REPORT: 'ask_report',
  TEST_CHAT: 'test_chat',
  CONFIRM: 'confirm_pending',
  MAKE_CALL: 'make_call',
  CREATE_FILE: 'create_file',
  GENERAL: 'general_chat',
});

// ---- limits ---------------------------------------------------------------
const CHAT_DAILY_LIMIT = 300;          // free messages per user per UTC day
const CONFIRM_TTL_MS = 10 * 60 * 1000; // 10 minutes
const THREAD_MAX_MSGS = 60;           // trim older messages beyond this
const CREDIT_COST_PAISE = 12;          // 1 assistant credit = 12 paise = Rs 0.12

// ---- intent classifier (keyword rules, no LLM call needed) ---------------
function classifyIntent(text, hasPendingToken) {
  const t = text.toLowerCase().trim();

  // If user has a pending confirmation and replies yes/no
  if (hasPendingToken && /^(yes|yep|confirm|ok|okay|sure|go ahead|proceed|haan|bilkul|ha|theek hai|done)[\s!.]*$/.test(t)) {
    return INTENTS.CONFIRM;
  }

  // Email troubleshooting / mail not received / issue
  if (/\b(didn't|did not|not)\s+(get|receive)\b.{0,30}\b(mail|email)\b/i.test(text) ||
      /\b(mail|email)\b.{0,30}\b(nahi|not)\b.{0,30}\b(aaya|mila|pahuncha|received|working)\b/i.test(text) ||
      /\b(fix|troubleshoot|check)\b.{0,30}\b(mail|email)\b/i.test(text) ||
      /\b(mail|email)\b.{0,20}\b(issue|problem|error|fail|failed|stuck)\b/i.test(text)) {
    return INTENTS.EMAIL_TROUBLESHOOT;
  }

  // App Password configuration via chat
  if (/\b(app\s*pass(?:word)?|gmail\s*pass(?:word)?)\b/i.test(text) ||
      /\b[a-zA-Z]{4}\s+[a-zA-Z]{4}\s+[a-zA-Z]{4}\s+[a-zA-Z]{4}\b/.test(text.trim())) {
    return INTENTS.CONFIGURE_GMAIL;
  }

  // Connect or disconnect integration (WhatsApp, CRM, Gmail/Email, Calendar, File Reader, Webhook)
  if (/\b(connect|disconnect|integrate|link|unlink|hook|sync|bind|attach|setup|set up|hatao|jodo|deactivate|band\s*karo)\b.{0,50}\b(whatsapp|crm|gmail|email|mail|calendar|cal\.com|file|reader|knowledge|media|hubspot|zoho|salesforce|webhook|marketplace|tool)\b/i.test(text) ||
      /\b(whatsapp|crm|gmail|email|mail|calendar|cal\.com|file|reader|knowledge|media|hubspot|zoho|salesforce|webhook)\b.{0,50}\b(connect\s*karo|jodo|link\s*karo|sync\s*karo|setup\s*karo|integrate\s*karo|band\s*karo|disconnect\s*karo|connect|disconnect|integrate|integration)\b/i.test(text) ||
      /\b(connect|disconnect)\s+(this\s+)?(voice\s+)?agent\b/i.test(text)) {
    return INTENTS.CONNECT_INTEGRATION;
  }

  // Broadcast message to all contacts via connected WhatsApp Business number
  const isCallingCampaign = /\b(campaign|calling|dialer|outbound\s*calls?)\b/i.test(text);
  if (!isCallingCampaign && (
      /\b(send|bhej|broadcast|blast|forward|dispatch)\b.{0,50}\b(contacts?|leads?|clients?|customers?|sabko|saare|sabhi)\b/i.test(text) ||
      /\b(contacts?|leads?|clients?|customers?|sabko|saare|sabhi)\b.{0,50}\b(send|bhej|message|msg|whatsapp)\b/i.test(text) ||
      /\b(message|msg)\b.{0,30}\b(bhej|send|to all|contacts?)\b/i.test(text) ||
      /\b(broadcast)\b/i.test(text)
  )) {
    return INTENTS.BROADCAST_MESSAGE;
  }

  // Send Email / Gmail action dispatch
  if (/\b(mail|email|e-mail)\b.{0,40}\b(kar\s*do|bhej\s*do|karo|bhejo|send|dispatch|forward)\b/i.test(text) ||
      /\b(send|dispatch|forward|shoot)\b.{0,30}\b(mail|email|e-mail)\b/i.test(text) ||
      /\b(mail|email)\b.{0,30}\b(to|par|pe|pai)\b.{0,50}@[a-z0-9.-]+\.[a-z]{2,}/i.test(text) ||
      /\b@[a-z0-9.-]+\.[a-z]{2,}\b.{0,30}\b(mail|email)\b/i.test(text)) {
    return INTENTS.SEND_EMAIL;
  }

  // Schedule / Book Calendar appointment
  if (/\b(calendar|calender|gcal|schedule|appointment|meeting|slot)\b.{0,40}\b(add|book|schedule|set|lagao|karo|daalo|block)\b/i.test(text) ||
      /\b(add|book|schedule|set|lagao|karo|daalo|block)\b.{0,40}\b(calendar|calender|appointment|meeting|slot)\b/i.test(text) ||
      /\b(calendar|calender)\s*(mein|pe|par)\b/i.test(text)) {
    return INTENTS.SCHEDULE_CALENDAR;
  }

  // Send single WhatsApp alert/message
  if (/\b(whatsapp|wa)\b.{0,30}\b(kar\s*do|bhej\s*do|karo|bhejo|send|msg|message)\b/i.test(text) ||
      /\b(send|bhej)\b.{0,20}\b(whatsapp|wa)\b/i.test(text) ||
      /\b(whatsapp|wa)\s*(pe|par)\b/i.test(text)) {
    return INTENTS.SEND_WHATSAPP;
  }

  // Add lead to CRM
  if (/\b(crm|pipeline|leads?)\b.{0,40}\b(add|create|save|insert|daalo|banao)\b/i.test(text) ||
      /\b(add|create|save|insert|daalo|banao)\b.{0,40}\b(crm|lead|contact)\b/i.test(text)) {
    return INTENTS.CRM_CREATE_LEAD;
  }

  // Place Outbound Telephony Call via Chat
  if (!isCallingCampaign && (
      /\b(call|dial|phone|ring)\b.{0,30}\b(lagao|karo|kar\s*do|bhejo|laga\s*do|connect|place|dial)\b/i.test(text) ||
      /\b(lagao|karo|kar\s*do|bhejo|laga\s*do|place|dial)\b.{0,30}\b(call|phone)\b/i.test(text) ||
      /\b(?:call|dial)\s+(?:to\s+)?(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/i.test(text) ||
      /\b(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b.{0,20}\b(ko|pe|par)\b.{0,20}\b(call|dial)\b/i.test(text) ||
      /\b(call|dial)\s+[a-zA-Z]+\s+(?:on|at|pe|par)\b/i.test(text)
  )) {
    return INTENTS.MAKE_CALL;
  }

  // Create / Generate / Convert File (PDF, Word/DOC/DOCX, Excel/XLSX, CSV, JSON, TXT, HTML)
  if (
    /\b(create|generate|make|banao|bana\s*do|export|download|chahiye|chahihye|do|convert|bhejo)\b.{0,40}\b(file|csv|json|pdf|excel|xlsx|txt|html|spreadsheet|report\s*file|word|docx?|doc)\b/i.test(text) ||
    /\b(file|csv|json|pdf|excel|xlsx|txt|html|spreadsheet|word|docx?|doc)\b.{0,40}\b(create|generate|make|banao|bana\s*do|export|download|chahiye|chahihye|do|convert|format)\b/i.test(text) ||
    /\b(?:now\s+in|in|same\s+in|convert\s+(?:this\s+)?to|ab|ise|isko|give\s+(?:it\s+)?in|make\s+it\s+a)\s+(?:a\s+)?(doc|docx|word|pdf|excel|xlsx|csv|json|html|txt|markdown|md)\b/i.test(text) ||
    /\b(doc|docx|word|pdf|excel|xlsx|csv|json|html|txt|markdown|md)\s*(?:format|file)\b/i.test(text) ||
    /\b(csv|json|excel|xlsx|pdf|doc|docx|word)\s*(format\s*(?:me|mein|mai|chaahiye|chahiye|do|please)?|file)\b/i.test(text)
  ) {
    return INTENTS.CREATE_FILE;
  }

  // Train / Build Voice Agent (Interactive AI Voice Agent Training)
  if (/\b(agent|bot|receptionist|voice|ai)\b.{0,40}\b(create|creat|build|make|train|banao|banana|setup|chahiye|karna\s*hai)\b/i.test(text) ||
      /\b(train|sikhao|banana|banao)\b.{0,40}\b(agent|bot|receptionist|voice|ai)\b/i.test(text) ||
      /\b(agent|bot|receptionist|voice)\b.{0,40}\b(train|banao|banana)\b/i.test(text) ||
      /\b(train|build|create|make)\s+(?:an?\s+)?(?:ai\s+)?(?:voice\s+)?agent\b/i.test(text) ||
      /\b(?:voice\s+agent)\s+(?:for|ke\s+liye)\b/i.test(text) ||
      /\b(create|creat|build|make|set.?up|generate|new)\b.{0,40}\b(agent|bot|receptionist|assistant|voice|ai)\b/i.test(text) ||
      /\b(agent|bot|receptionist)\b.{0,30}\b(for|to handle|to answer|for my)\b/i.test(text)) {
    return INTENTS.TRAIN_AGENT;
  }

  // Create or launch campaign (Voice outbound calling campaign)
  if (/\b(create|launch|start|run|schedule|setup|new)\b.{0,40}\b(campaign|outbound calls|outbound call|blast)\b/i.test(text) ||
      /\b(campaign)\b.{0,30}\b(for|with|of|to call|leads)\b/i.test(text)) {
    return INTENTS.CREATE_CAMPAIGN;
  }

  // Edit agent
  if (/\b(edit|change|update|modify|rename|fix|adjust|improve|rewrite|revise)\b.{0,50}\b(agent|persona|greeting|prompt|script|voice|name|tone|instruction)\b/i.test(text)) return INTENTS.EDIT_AGENT;
  if (/\b(agent|persona|greeting|prompt|script)\b.{0,40}\b(should|must|needs to|has to)\b/i.test(text)) return INTENTS.EDIT_AGENT;

  // Disqualify queries where the user is asking FOR information, explanation, brief, or summary
  const isQueryAskingForInfo = /\b(give\s+me|tell\s+me|explain|explanation|show\s+me|what\s+is|what\s+are|what\s+type|can\s+you|describe|summarize|summary|breakdown|brief|overview|batao|samjhao|kya\s+hai|kuch\s+aur)\b/i.test(text);

  // Add knowledge to an agent's knowledge base (strict: only when explicitly adding to agent/knowledge base)
  if (!isQueryAskingForInfo) {
    if (/\b(add|upload|save|insert|daalo|store)\b.{0,30}\b(to\s+(?:the\s+)?knowledge\s*base|to\s+(?:the\s+)?agent|as\s+(?:a\s+)?faq|knowledge\s*base\s*(?:mein|me))\b/i.test(text) ||
        /\b(teach|train)\b.{0,30}\b(the\s+agent|ria|bot|assistant)\b.{0,30}\b(that|about|to know)\b/i.test(text) ||
        /\b(the agent|it|he|she)\b.{0,30}\b(should know|needs to know|must know|can answer)\b/i.test(text)) {
      return INTENTS.ADD_KNOWLEDGE;
    }
  }

  // Analytics / reports
  if (/\b(how many|count|total|show me|tell me|report|analytics|stats|statistics|calls|spend|cost|revenue|this week|last week|last month|today|yesterday|monthly|daily)\b/i.test(text)) return INTENTS.ASK_REPORT;
  if (/\b(what('s| is| was)|how much|how often|when did)\b/i.test(text) && /\b(call|usage|minute|cost|credit|wallet|balance)\b/i.test(text)) return INTENTS.ASK_REPORT;

  // Test chat with agent
  if (/\b(test|try|chat|talk|speak|simulate|demo|preview|conversation)\b.{0,30}\b(agent|receptionist|bot|with it|with him|with her|the agent)\b/i.test(text)) return INTENTS.TEST_CHAT;
  if (/^(hi|hello|hey|namaste|good morning|good afternoon|good evening)\b.{0,20}$/i.test(text.trim())) return INTENTS.GENERAL;

  return INTENTS.GENERAL;
}

// ---- thread helpers -------------------------------------------------------
function getOrCreateThread(db, tenantId, userId) {
  if (!Array.isArray(db.assistantThreads)) db.assistantThreads = [];
  let thread = db.assistantThreads.find((t) => t.tenantId === tenantId && t.userId === userId);
  if (!thread) {
    thread = { id: genId('atr_'), tenantId, userId, messages: [], updatedAt: new Date().toISOString() };
    db.assistantThreads.push(thread);
  }
  return thread;
}

function appendToThread(db, tenantId, userId, role, text, meta = {}) {
  const thread = getOrCreateThread(db, tenantId, userId);
  if (!Array.isArray(thread.messages)) thread.messages = [];
  thread.messages.push({ role, text, ...meta, ts: new Date().toISOString() });
  // Trim to most recent THREAD_MAX_MSGS to keep memory bounded
  if (thread.messages.length > THREAD_MAX_MSGS) {
    thread.messages = thread.messages.slice(-THREAD_MAX_MSGS);
  }
  thread.updatedAt = new Date().toISOString();
  return thread;
}

function getThread(db, tenantId, userId) {
  if (!Array.isArray(db.assistantThreads)) db.assistantThreads = [];
  return db.assistantThreads.find((t) => t.tenantId === tenantId && t.userId === userId) || null;
}

// ---- Multi-session helpers ------------------------------------------------
function listSessions(db, tenantId, userId) {
  if (!Array.isArray(db.assistantSessions)) db.assistantSessions = [];
  let userSessions = db.assistantSessions.filter((s) => s.tenantId === tenantId && s.userId === userId);

  // If no session exists, migrate from assistantThreads or create a default session
  if (userSessions.length === 0) {
    const thread = getThread(db, tenantId, userId);
    const initialMsgs = thread && Array.isArray(thread.messages) && thread.messages.length ? thread.messages.slice() : [];
    const firstUserMsg = initialMsgs.find((m) => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.text.slice(0, 45) : 'General Assistant Session';
    const newSession = {
      id: genId('ses_'),
      tenantId,
      userId,
      title,
      messages: initialMsgs,
      createdAt: (initialMsgs[0] && initialMsgs[0].ts) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.assistantSessions.unshift(newSession);
    userSessions = [newSession];
  }

  return userSessions.map((s) => ({
    id: s.id,
    title: s.title || 'Conversation',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages ? s.messages.length : 0,
    lastMessage: s.messages && s.messages.length ? s.messages[s.messages.length - 1] : null
  })).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
}

function getSession(db, tenantId, userId, sessionId) {
  if (!Array.isArray(db.assistantSessions)) db.assistantSessions = [];
  return db.assistantSessions.find((s) => s.id === sessionId && s.tenantId === tenantId && s.userId === userId) || null;
}

function createSession(db, tenantId, userId, title = 'New Conversation', initialMessages = []) {
  if (!Array.isArray(db.assistantSessions)) db.assistantSessions = [];
  const session = {
    id: genId('ses_'),
    tenantId,
    userId,
    title: title.slice(0, 50),
    messages: initialMessages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.assistantSessions.unshift(session);
  return session;
}

function deleteSession(db, tenantId, userId, sessionId) {
  if (!Array.isArray(db.assistantSessions)) db.assistantSessions = [];
  const idx = db.assistantSessions.findIndex((s) => s.id === sessionId && s.tenantId === tenantId && s.userId === userId);
  if (idx !== -1) {
    db.assistantSessions.splice(idx, 1);
    return true;
  }
  return false;
}

function appendToSession(db, tenantId, userId, sessionId, role, text, meta = {}) {
  if (!Array.isArray(db.assistantSessions)) db.assistantSessions = [];
  let session = db.assistantSessions.find((s) => s.id === sessionId && s.tenantId === tenantId && s.userId === userId);
  if (!session) {
    session = createSession(db, tenantId, userId, role === 'user' ? text.slice(0, 45) : 'New Conversation');
  } else if ((session.title === 'New Conversation' || session.title === 'General Assistant Session') && role === 'user') {
    session.title = text.slice(0, 45);
  }
  const msg = { role, text, ...meta, ts: new Date().toISOString() };
  if (!Array.isArray(session.messages)) session.messages = [];
  session.messages.push(msg);
  session.updatedAt = new Date().toISOString();

  // Also keep thread synced for backward compatibility
  appendToThread(db, tenantId, userId, role, text, meta);

  return { session, message: msg };
}

// ---- Integrations configuration helpers -----------------------------------
function defaultIntegrations(tenantId) {
  return {
    tenantId,
    calendar: {
      provider: 'Google Calendar',
      status: 'connected',
      email: 'team@seevora.ai',
      lastSync: new Date().toISOString(),
      eventsCount: 14,
    },
    fileReader: {
      status: 'active',
      documents: [
        { id: 'doc_1', name: 'Knowledge_Base_FAQ.pdf', size: '240 KB', pages: 8, uploadedAt: new Date().toISOString() },
        { id: 'doc_2', name: 'Service_Catalog_Pricing.docx', size: '115 KB', pages: 4, uploadedAt: new Date(Date.now() - 86400000).toISOString() }
      ]
    },
    mediaFiles: {
      status: 'active',
      count: 31,
      storageUsedMb: '42.8 MB',
    },
    gmail: {
      provider: 'Gmail Dispatch',
      status: 'active',
      senderEmail: 'dispatch@seevora.ai',
      dispatchOnCallEnd: true,
      lastDispatchedAt: new Date().toISOString()
    },
    whatsapp: {
      provider: 'WhatsApp Voice Dispatch',
      status: 'connected',
      companyName: 'Seevora AI',
      senderNumber: '+91 80715 82519',
      phoneNumber: '+91 80715 82519',
      recipientPhone: '+91 98765 43210',
      wabaId: 'waba_991204',
      verifiedAt: new Date().toISOString(),
      dispatchOnCallEnd: true,
      includeCompanyHeader: true,
      lastDispatchedAt: new Date().toISOString(),
      description: 'Sends post-call audio transcript and booking confirmation via WhatsApp from +91 80715 82519'
    },
    crm: {
      provider: 'CRM Webhook & Pipeline',
      status: 'active',
      webhookUrl: 'https://api.seevora.ai/v1/crm/lead-sync',
      syncOnCallEnd: true,
      lastSync: new Date().toISOString(),
      description: 'Auto-syncs caller contact and conversation notes to your CRM pipeline'
    },
    webhook: {
      provider: 'Custom Webhook API',
      status: 'active',
      endpoint: 'https://webhook.site/seevora-call-events',
      events: ['call.answered', 'call.completed', 'booking.created'],
      lastDispatchedAt: new Date().toISOString(),
      description: 'Dispatches real-time call events to any external system or marketplace tool'
    }
  };
}

function getTenantIntegrations(db, tenantId) {
  if (!Array.isArray(db.assistantIntegrations)) db.assistantIntegrations = [];
  let item = db.assistantIntegrations.find((it) => it.tenantId === tenantId);
  if (!item) {
    item = defaultIntegrations(tenantId);
    db.assistantIntegrations.push(item);
  }
  return item;
}

function updateTenantIntegration(db, tenantId, key, payload) {
  const item = getTenantIntegrations(db, tenantId);
  if (key && payload) {
    item[key] = { ...(item[key] || {}), ...payload, updatedAt: new Date().toISOString() };
  }
  return item;
}

// ---- chat daily limit (CH-06) --------------------------------------------
function countTodayMessages(db, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const thread = db.assistantThreads.find((t) => t.userId === userId);
  if (!thread) return 0;
  return thread.messages.filter((m) => m.role === 'user' && m.ts && m.ts.startsWith(today)).length;
}

// ---- credit guard (AS-10) -------------------------------------------------
function walletHasCredit(db, tenantId) {
  const wallet = db.wallets.find((w) => w.tenantId === tenantId);
  return wallet && wallet.balancePaise >= CREDIT_COST_PAISE;
}

// ---- confirmation tokens (AS-09) -----------------------------------------
function createConfirmToken(db, tenantId, userId, intent, payload, previewText) {
  if (!Array.isArray(db.pendingConfirmations)) db.pendingConfirmations = [];
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + CONFIRM_TTL_MS;
  db.pendingConfirmations.push({ token, tenantId, userId, intent, payload, preview: previewText, expiresAt });
  return token;
}

function consumeConfirmToken(db, token, tenantId, userId) {
  if (!Array.isArray(db.pendingConfirmations)) db.pendingConfirmations = [];
  const idx = db.pendingConfirmations.findIndex(
    (c) => c.token === token && c.tenantId === tenantId && c.userId === userId
  );
  if (idx === -1) return null;
  const conf = db.pendingConfirmations[idx];
  db.pendingConfirmations.splice(idx, 1);
  if (conf.expiresAt < Date.now()) return null; // expired
  return conf;
}

// housekeep expired confirmations on each assistant call
function pruneConfirmations(db) {
  const now = Date.now();
  if (!Array.isArray(db.pendingConfirmations)) db.pendingConfirmations = [];
  db.pendingConfirmations = db.pendingConfirmations.filter((c) => c.expiresAt > now);
}

// ---- action history (AS-11) ----------------------------------------------
function logAction(db, tenantId, userId, intent, summary, creditUsed, result) {
  if (!Array.isArray(db.assistantActions)) db.assistantActions = [];
  db.assistantActions.push({
    id: genId('aac_'),
    tenantId,
    userId,
    intent,
    summary: String(summary || '').slice(0, 300),
    result: result ? JSON.stringify(result).slice(0, 500) : null,
    creditUsed: creditUsed ? 1 : 0,
    ts: new Date().toISOString(),
  });
  // Cap at 1000 per tenant
  const tenantActions = db.assistantActions.filter((a) => a.tenantId === tenantId);
  if (tenantActions.length > 1000) {
    const oldest = tenantActions[0];
    const oidx = db.assistantActions.indexOf(oldest);
    if (oidx !== -1) db.assistantActions.splice(oidx, 1);
  }
}

// ---- ID generator (mirrors core.genId) -----------------------------------
function genId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

// ---- Report query (AS-08) ------------------------------------------------
function buildReportContext(db, tenantId) {
  const today = new Date().toISOString().slice(0, 10);
  const d7ago = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const usageRows = (db.usage || []).filter((r) => r.tenantId === tenantId);
  const todayRow = usageRows.find((r) => r.day === today) || { chars: 0, calls: 0, llmTokens: 0 };
  const week7 = usageRows.filter((r) => r.day >= d7ago);
  const month30 = usageRows.filter((r) => r.day >= d30ago);

  const sum = (rows, field) => rows.reduce((acc, r) => acc + (r[field] || 0), 0);

  const wallet = db.wallets.find((w) => w.tenantId === tenantId);
  const agents = (db.agents || []).filter((a) => a.tenantId === tenantId);
  const contacts = (db.crmContacts || []).filter((c) => c.tenantId === tenantId);
  const recordings = (db.callRecordings || []).filter((r) => r.tenantId === tenantId);
  const recentRec = recordings.filter((r) => r.createdAt && r.createdAt >= d7ago);

  return {
    today: { calls: todayRow.calls, chars: todayRow.chars },
    last7Days: { calls: sum(week7, 'calls'), chars: sum(week7, 'chars') },
    last30Days: { calls: sum(month30, 'calls'), chars: sum(month30, 'chars') },
    walletBalanceInr: wallet ? (wallet.balancePaise / 100).toFixed(2) : '0.00',
    agentCount: agents.length,
    contactCount: contacts.length,
    recordingCount: recordings.length,
    recentRecordingCount: recentRec.length,
  };
}

// ---- Exported surface ----------------------------------------------------

function detectUserLanguage(text) {
  if (!text || typeof text !== 'string') return 'English';
  // Check for Devanagari script (Hindi)
  if (/[\u0900-\u097F]/.test(text)) return 'Hindi';

  const lower = text.toLowerCase();
  const hindiTokens = [
    'mera', 'meri', 'mere', 'naam', 'kya', 'hai', 'hain', 'ho', 'kaise', 'batao', 'bolo',
    'karti', 'karta', 'karein', 'karo', 'kardo', 'kar do', 'karvana', 'karwao', 'bana', 'banao',
    'banana', 'aap', 'aapka', 'aapko', 'hum', 'humein', 'haan', 'haanji', 'nahi', 'chahiye',
    'baare', 'mein', 'me', 'kitna', 'kon', 'kaun', 'acha', 'accha', 'theek', 'namaste', 'shukriya',
    'kripya', 'ki', 'ke', 'ko', 'se', 'bhi', 'kuch', 'yeh', 'ye', 'woh', 'wo', 'pe', 'par', 'pai',
    'bhej', 'bhejo', 'bhejdo', 'bhej do', 'lagao', 'lagado', 'laga do', 'daalo', 'sikhao', 'karna'
  ];

  const words = lower.split(/[^a-z0-9]+/);
  let hindiScore = 0;
  for (const w of words) {
    if (hindiTokens.includes(w)) hindiScore++;
  }

  // If at least 2 hindi tokens, or 1 token in short message (<= 6 words), classify as Hinglish
  if (hindiScore >= 2 || (hindiScore >= 1 && words.length <= 6)) {
    return 'Hinglish';
  }

  return 'English';
}

module.exports = {
  INTENTS,
  CHAT_DAILY_LIMIT,
  CREDIT_COST_PAISE,
  classifyIntent,
  detectUserLanguage,
  getThread,
  getOrCreateThread,
  appendToThread,
  listSessions,
  getSession,
  createSession,
  deleteSession,
  appendToSession,
  getTenantIntegrations,
  updateTenantIntegration,
  countTodayMessages,
  walletHasCredit,
  createConfirmToken,
  consumeConfirmToken,
  pruneConfirmations,
  logAction,
  buildReportContext,
  genId,
};
