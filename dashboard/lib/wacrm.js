/**
 * RapidX Voice / Seevora AI Voice Receptionist
 * WACRM & WhatsApp Business Cloud Integration Adapter.
 *
 * Zero-dependency pure Node implementation of:
 *   - WhatsApp Cloud API & WACRM API client (Text, Templates, Media)
 *   - CRM Contacts, Deals, and Pipelines
 *   - WhatsApp Shared Inbox & Message Threading
 *   - Automated Voice Call -> WhatsApp Follow-up & CRM Lead capture
 *
 * No em dashes anywhere. Commas and periods only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const logger = require('./logger');

/**
 * Standardize phone number into E.164 format.
 * Defaults to +91 (India) if 10 digits provided without country code.
 */
function normalizeE164(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10) return '+91' + cleaned;
  if (cleaned.length === 12 && cleaned.startsWith('91')) return '+' + cleaned;
  return '+' + cleaned;
}

/**
 * Send HTTPS request (helper without external dependencies)
 */
function sendHttpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        const str = Buffer.concat(parts).toString('utf8');
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(str) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: str });
        }
      });
    });
    req.on('error', reject);
    const timeoutMs = Number(options.timeout || 4000);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function formatMetaError(res, recipient) {
  const errorObj = (res.data && res.data.error) || {};
  const code = errorObj.code;
  let rawMsg = errorObj.message || 'Meta API returned error';

  if (code === 190) {
    return 'Meta Access Token Expired (code 190): Please renew your WhatsApp Access Token in WhatsApp Settings or generate a Permanent System User Token.';
  }
  if (code === 131047) {
    return 'Meta 24-Hour Window Restriction (code 131047): More than 24 hours have passed since the customer last messaged. WhatsApp requires an approved Template message to re-engage.';
  }
  if (code === 131030) {
    return `Recipient Not In Allowed List (code 131030): For Meta sandbox/test numbers, you must add '${recipient || 'this number'}' to the To recipient list in Meta Developer Portal -> WhatsApp -> API Setup.`;
  }
  if (code === 131026) {
    return 'Message Undeliverable (code 131026): The phone number cannot receive WhatsApp messages.';
  }
  return `Meta WhatsApp send failed (${res.status}): ${rawMsg}`;
}

/**
 * Send WhatsApp text message via Meta WhatsApp Business Cloud API.
 */
async function sendMetaWhatsAppMessage({ phoneId, token, to, text, previewUrl = false }) {
  const recipient = normalizeE164(to).replace(/^\+/, '');
  if (!recipient) throw new Error('Recipient phone number is required and must be valid E.164.');
  if (!phoneId || !token) throw new Error('WhatsApp Phone Number ID and Access Token are required.');

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: { preview_url: previewUrl, body: text }
  };

  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${phoneId}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  const res = await sendHttpRequest(options, payload);
  if (res.status >= 400) {
    const msg = formatMetaError(res, recipient);
    const err = new Error(msg);
    err.metaCode = res.data && res.data.error && res.data.error.code;
    throw err;
  }
  return res.data;
}

/**
 * Send WhatsApp Template message via Meta WhatsApp Business Cloud API.
 */
async function sendMetaTemplateMessage({ phoneId, token, to, templateName, languageCode = 'en_US', components = [] }) {
  const recipient = normalizeE164(to).replace(/^\+/, '');
  if (!recipient) throw new Error('Recipient phone number is required and must be valid E.164.');
  if (!phoneId || !token) throw new Error('WhatsApp Phone Number ID and Access Token are required.');

  // Normalize language: Meta standard templates are typically registered under en_US
  let lang = languageCode || 'en_US';
  if (lang === 'en' && (templateName === 'hello_world' || templateName.startsWith('jaspers_market'))) {
    lang = 'en_US';
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
      components: components
    }
  };

  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${phoneId}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  let res = await sendHttpRequest(options, payload);
  if (res.status >= 400 && res.data && res.data.error && res.data.error.code === 132001) {
    // Retry with complementary language (en_US <-> en)
    const fallbackLang = lang === 'en_US' ? 'en' : 'en_US';
    payload.template.language.code = fallbackLang;
    res = await sendHttpRequest(options, payload);
  }

  if (res.status >= 400) {
    const msg = formatMetaError(res, recipient);
    const err = new Error(msg);
    err.metaCode = res.data && res.data.error && res.data.error.code;
    throw err;
  }
  return res.data;
}

/**
 * Send WhatsApp message via an external WACRM REST API instance (/api/v1/messages).
 */
async function sendWacrmApiMessage({ baseUrl, apiKey, to, text, type = 'text', template = null }) {
  const e164 = normalizeE164(to);
  if (!e164) throw new Error('Valid E.164 phone number required.');
  const parsed = new URL(baseUrl);

  const payload = { to: e164, type, text };
  if (template) payload.template = template;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: '/api/v1/messages',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  };

  const res = await sendHttpRequest(options, payload);
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'WACRM API error';
    throw new Error(`WACRM message send failed (${res.status}): ${err}`);
  }
  return res.data;
}

/* ==========================================================================
   CRM Primitives & Local Storage Helpers (Tenant Scoped)
   ========================================================================== */

const DEFAULT_STAGES = Object.freeze([
  'New Lead',
  'Call Completed',
  'Qualified',
  'Proposal Sent',
  'Closed Won',
  'Closed Lost'
]);

const LEAD_STOP_WORDS = new Set([
  'calling', 'looking', 'interested', 'inquiring', 'checking', 'wondering',
  'here', 'there', 'please', 'thanks', 'thank', 'hello', 'namaste', 'hi',
  'hey', 'urgent', 'available', 'needed', 'confirming', 'sure', 'yes', 'no',
  'fine', 'good', 'well', 'great', 'okay', 'agent', 'caller', 'user', 'receptionist',
  'and', 'or', 'from', 'with', 'at', 'for', 'about'
]);

const LEAD_HONORIFICS = new Set(['ji', 'sir', 'madam', 'bhai', 'sahab', 'saab', 'shri', 'smt', 'mr', 'ms', 'mrs', 'dr']);

function isLeadStopWord(w) {
  return !w || LEAD_STOP_WORDS.has(String(w).toLowerCase().trim());
}

function cleanLeadName(raw) {
  if (!raw) return '';
  const tokens = String(raw).trim().split(/\s+/);
  const result = [];
  for (const t of tokens) {
    const cleanToken = t.replace(/[^a-zA-Z'-]/g, '');
    const lower = cleanToken.toLowerCase();
    if (!cleanToken || isLeadStopWord(cleanToken) || LEAD_HONORIFICS.has(lower)) break;
    // Must be capitalized name token (e.g. Vikramaditya, Malhotra)
    if (!/^[A-Z][a-zA-Z'-]*$/.test(cleanToken)) break;
    result.push(cleanToken);
  }
  return result.join(' ');
}

function parseMoneyValue(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).replace(/,/g, '').trim();
  const numMatch = str.match(/([\d.]+)\s*(crores?|cr|lakhs?|lacs?|k)?\b/i);
  if (!numMatch) return 0;
  let num = parseFloat(numMatch[1]);
  if (isNaN(num)) return 0;
  const unit = (numMatch[2] || '').toLowerCase();
  if (unit.startsWith('cr')) num *= 10000000;
  else if (unit.startsWith('lak') || unit.startsWith('lac')) num *= 100000;
  else if (unit === 'k') num *= 1000;
  return Math.round(num);
}

function extractMoneyFromText(text) {
  if (!text) return 0;
  // 1. Match explicit currency symbol: ₹ / Rs / INR / $
  const currMatch = text.match(/(?:₹|rs\.?|inr|\$)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|k)?\b/i);
  if (currMatch) {
    const rawNum = currMatch[1].replace(/,/g, '');
    let num = parseFloat(rawNum);
    const unit = (currMatch[2] || '').toLowerCase();
    if (unit.startsWith('cr')) num *= 10000000;
    else if (unit.startsWith('lak') || unit.startsWith('lac')) num *= 100000;
    else if (unit === 'k') num *= 1000;
    if (!isNaN(num) && num > 0) return Math.round(num);
  }

  // 2. Match phrases with keywords: budget, deal value, price, worth, etc.
  const phraseMatch = text.match(/(?:budget|deal\s*value|price|worth|value|quote|investment|fee|cost|package|amount)(?:\s*(?:is|of|around|approx|approximately|near|about|upto|at|:)){1,3}\s*(?:₹|rs\.?|inr|\$)?\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|k)?\b/i);
  if (phraseMatch) {
    const rawNum = phraseMatch[1].replace(/,/g, '');
    let num = parseFloat(rawNum);
    const unit = (phraseMatch[2] || '').toLowerCase();
    if (unit.startsWith('cr')) num *= 10000000;
    else if (unit.startsWith('lak') || unit.startsWith('lac')) num *= 100000;
    else if (unit === 'k') num *= 1000;
    if (!isNaN(num) && num > 0) return Math.round(num);
  }

  // 3. Match standalone "X Lakhs" or "X Crores"
  const unitMatch = text.match(/\b([\d,]+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?)\b/i);
  if (unitMatch) {
    const rawNum = unitMatch[1].replace(/,/g, '');
    let num = parseFloat(rawNum);
    const unit = unitMatch[2].toLowerCase();
    if (unit.startsWith('cr')) num *= 10000000;
    else if (unit.startsWith('lak') || unit.startsWith('lac')) num *= 100000;
    if (!isNaN(num) && num > 0) return Math.round(num);
  }

  return 0;
}

/**
 * Extracts real caller information (name, email, company, budget/deal value,
 * service requirement, appointment slot, and disposition) from call logs,
 * gathered context, and transcript.
 */
function extractLeadDataFromCall(callDetails = {}) {
  const gathered = callDetails.gathered_context || callDetails.gatheredContext || {};
  const transcript = String(callDetails.transcript || '').trim();
  const summary = String(callDetails.summary || callDetails.call_summary || '').trim();

  // 1. Phone number
  const phone = callDetails.callerNumber ||
    callDetails.phoneNumber ||
    callDetails.customerPhone ||
    callDetails.to ||
    callDetails.from ||
    gathered.phone ||
    gathered.phoneNumber || '';

  // 2. Caller Name
  let name = gathered.name || gathered.caller_name || gathered.customer_name || gathered.lead_name || gathered.user_name || gathered.contact_name || callDetails.callerName || callDetails.customerName || '';

  if (name) {
    name = cleanLeadName(name) || name;
  }

  if (!name && transcript) {
    const candidates = [];

    // A) Agent greeting caller: "Agent: Hello Deepa! / Namaste Amit Sharma ji! / Hi Priya,"
    for (const m of transcript.matchAll(/(?:Agent|Receptionist|Bot|AI):\s*(?:Hello|Hi|Namaste|Good\s+(?:morning|afternoon|evening))\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Za-z'-]+){0,2}?)(?:\s+ji|\s*ji|[!,.]|$)/gi)) {
      const clean = cleanLeadName(m[1]);
      if (clean) {
        const parts = clean.split(/\s+/);
        candidates.push({ name: clean, weight: parts.length > 1 ? 12 : 8 });
      }
    }

    // B) Agent acknowledging / confirming caller name: "Achha, Animesh Jain! / Got it, Rohan Sharma! / Perfect, Priya Nair"
    for (const m of transcript.matchAll(/(?:Agent|Receptionist|Bot|AI):\s*(?:Achha|Acha|Great|Super|Got it|Understood|Perfect|Okay|Theek hai|Bilkul)[,!]?\s*([A-Z][a-zA-Z'-]+(?:\s+[A-Za-z'-]+){0,2})[!,]/gi)) {
      const clean = cleanLeadName(m[1]);
      if (clean) {
        const parts = clean.split(/\s+/);
        candidates.push({ name: clean, weight: parts.length > 1 ? 12 : 6 });
      }
    }

    // C) Direct name introduction: "my name is Animesh Jain" / "mera naam Animesh Jain hai" / "myself Vikramaditya Malhotra"
    for (const m of transcript.matchAll(/(?:my name is|i am|this is|i'm|myself|name's|mera naam(?: hai)?)\s+(?:(?:Dr|Mr|Mrs|Ms|Shri|Smt)\.?\s+)?([A-Z][a-zA-Z'-]+(?:\s+[A-Za-z'-]+){0,3})\b/gi)) {
      const clean = cleanLeadName(m[1]);
      if (clean) {
        const parts = clean.split(/\s+/);
        candidates.push({ name: clean, weight: parts.length > 1 ? 10 : 5 });
      }
    }

    // D) Agent addressing caller with ji: "Theek hai Animesh ji" or "Animesh ji, aapki..."
    for (const m of transcript.matchAll(/(?:Agent|Receptionist|Bot|AI):[^.\n!]*?\b([A-Z][a-zA-Z'-]+(?:\s+[A-Za-z'-]+){0,2})\s+ji\b/gi)) {
      const clean = cleanLeadName(m[1]);
      if (clean && !isLeadStopWord(clean)) {
        const parts = clean.split(/\s+/);
        candidates.push({ name: clean, weight: parts.length > 1 ? 9 : 6 });
      }
    }

    // E) Caller introducing self with single name: "Caller: Hi, Priya here." or "Caller: Rajesh here"
    for (const m of transcript.matchAll(/(?:Caller|User):\s*(?:Hi|Hello|Namaste|Hey)?\s*(?:this is|i am|it's)?\s*([A-Z][a-zA-Z'-]+)\s+here\b/gi)) {
      const clean = cleanLeadName(m[1]);
      if (clean && !isLeadStopWord(clean)) {
        candidates.push({ name: clean, weight: 4 });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aTokens = a.name.split(/\s+/).length;
        const bTokens = b.name.split(/\s+/).length;
        return (b.weight + bTokens * 2) - (a.weight + aTokens * 2);
      });
      name = candidates[0].name;
    }
  }

  // 3. Email
  let email = gathered.email || gathered.customer_email || gathered.user_email || callDetails.email || '';
  if (!email && transcript) {
    const emailMatch = transcript.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    if (emailMatch) {
      email = emailMatch[1].toLowerCase();
    }
  }

  // 4. Deal Value / Budget
  let dealValue = 0;
  if (gathered.deal_value || gathered.dealValue || gathered.budget || gathered.amount || gathered.value || gathered.estimated_value) {
    dealValue = parseMoneyValue(gathered.deal_value || gathered.dealValue || gathered.budget || gathered.amount || gathered.value || gathered.estimated_value);
  }
  if (!dealValue && (transcript || summary)) {
    dealValue = extractMoneyFromText(transcript + ' ' + summary);
  }

  // 5. Company
  let company = gathered.company || gathered.organization || gathered.company_name || callDetails.company || '';
  if (!company && transcript) {
    const compMatch = transcript.match(/(?:from|with|at|representing)\s+([A-Z][A-Za-z0-9\s&]{2,30}?(?:\s+(?:Technologies|Enterprises|Solutions|Services|Logistics|Corp|Inc|Ltd|LLP|Pvt|Hospital|Clinic|Associates)))\b/i);
    if (compMatch) {
      company = compMatch[1].trim();
    }
  }

  // 6. Service / Requirement / Appointment
  let requirement = gathered.requirement || gathered.service || gathered.inquiry || gathered.intent || gathered.purpose || '';
  let appointment = gathered.appointment || gathered.slot || gathered.booking_time || gathered.booking_date || '';

  if (!appointment && (transcript || summary)) {
    const combined = transcript + '\n' + summary;
    const apptMatch = combined.match(/(?:booked|confirmed|scheduled|rescheduled|slot to|visit for)\s+([A-Za-z0-9\s,:-]+?(?:AM|PM|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+[A-Za-z0-9\s]+)?)/i);
    if (apptMatch) {
      appointment = apptMatch[1].trim().replace(/\s+/g, ' ').replace(/[.?]+$/, '');
    } else if (/appointment/i.test(combined)) {
      appointment = 'Appointment Requested';
    }
  }

  if (!requirement && (summary || transcript)) {
    if (summary) {
      requirement = summary.replace(/\s+/g, ' ').slice(0, 150);
    } else {
      const intentMatch = transcript.match(/(?:we need|looking for|interested in|inquire about|inquiry about|require)\s+([^\n.]+?)(?:\.|\n|!|;)/i);
      if (intentMatch) {
        requirement = intentMatch[1].trim();
      } else if (/services? ke baare mein/i.test(transcript) || /services inquiry/i.test(transcript)) {
        requirement = 'Seevora AI Services Consultation';
      } else {
        const callerTurn = transcript.match(/(?:Caller|User):\s*([^\n]+)/i);
        if (callerTurn) {
          requirement = callerTurn[1].replace(/^(?:Hi|Hello|Namaste|Hey)[,.]?\s*/i, '').trim().slice(0, 150);
        }
      }
    }
  }

  // 7. Stage / Disposition
  let stage = callDetails.stage || gathered.stage;
  const disposition = String(callDetails.disposition || gathered.call_disposition || gathered.disposition || '').toLowerCase();
  if (!stage) {
    if (disposition === 'closed_won' || disposition === 'sale_made') {
      stage = 'Closed Won';
    } else if (disposition === 'proposal_sent' || disposition === 'quote_sent') {
      stage = 'Proposal Sent';
    } else if (appointment || (dealValue > 0 && dealValue >= 20000) || disposition === 'appointment_booked' || disposition === 'qualified') {
      stage = 'Qualified';
    } else {
      stage = 'Call Completed';
    }
  }

  // 8. Clean structured notes
  const notesParts = [];
  if (requirement) notesParts.push(`Inquiry: ${requirement}`);
  if (appointment) notesParts.push(`Appointment / Booking: ${appointment}`);
  if (company) notesParts.push(`Company: ${company}`);
  if (dealValue > 0) notesParts.push(`Estimated Deal: ₹${dealValue.toLocaleString('en-IN')}`);
  if (summary && summary !== requirement) notesParts.push(`Summary: ${summary}`);

  const structuredNotes = notesParts.length > 0 ? notesParts.join(' • ') : (summary || 'AI Voice call completed');

  return {
    phone,
    name: name || undefined,
    email: email || undefined,
    company: company || undefined,
    dealValue: dealValue || 0,
    stage,
    requirement,
    appointment,
    structuredNotes,
    disposition: disposition || 'completed',
    tags: [
      'voice-lead',
      `disposition:${disposition || 'completed'}`,
      appointment ? 'appointment-booked' : null,
      dealValue > 0 ? 'budget-qualified' : null
    ].filter(Boolean)
  };
}

/**
 * Find or create a contact in the CRM for a tenant.
 */
function upsertContact(db, tenantId, contactData) {
  if (!db.crmContacts) db.crmContacts = [];
  let phone = normalizeE164(contactData.phone);
  if (!phone) {
    if (contactData.name) {
      const existingByName = db.crmContacts.find((c) => c.tenantId === tenantId && c.name && c.name.toLowerCase() === contactData.name.toLowerCase());
      if (existingByName) {
        phone = existingByName.phone;
      } else {
        const randDigits = Math.floor(100000000 + Math.random() * 900000000);
        phone = '+919' + randDigits;
      }
    } else {
      throw new Error('Contact phone number is required.');
    }
  }

  let contact = db.crmContacts.find((c) => c.tenantId === tenantId && c.phone === phone);
  if (!contact && contactData.name) {
    contact = db.crmContacts.find((c) => c.tenantId === tenantId && c.name && c.name.toLowerCase() === contactData.name.toLowerCase());
  }
  const now = new Date().toISOString();

  if (!contact) {
    contact = {
      id: 'ct_' + crypto.randomBytes(8).toString('hex'),
      tenantId,
      phone,
      name: contactData.name || `Lead ${phone.slice(-4)}`,
      email: contactData.email || '',
      company: contactData.company || '',
      stage: contactData.stage || 'New Lead',
      dealValue: Number(contactData.dealValue || 0),
      tags: Array.isArray(contactData.tags) ? [...new Set(contactData.tags)] : ['voice-lead'],
      notes: contactData.notes || '',
      customFields: contactData.customFields || {},
      lastContactedAt: now,
      createdAt: now,
      updatedAt: now
    };
    db.crmContacts.unshift(contact);
  } else {
    // If contact has a placeholder or phone as name, update with real name
    if (contactData.name && (contact.name === contact.phone || contact.name.startsWith('Lead ') || contactData.name !== contact.phone)) {
      contact.name = contactData.name;
    }
    if (contactData.email) contact.email = contactData.email;
    if (contactData.company) contact.company = contactData.company;
    if (contactData.stage) contact.stage = contactData.stage;
    if (contactData.dealValue !== undefined && Number(contactData.dealValue) > 0) {
      contact.dealValue = Number(contactData.dealValue);
    }
    if (contactData.notes) {
      if (!contact.notes) {
        contact.notes = contactData.notes;
      } else if (!contact.notes.includes(contactData.notes)) {
        contact.notes = contact.notes + '\n\n' + contactData.notes;
      }
    }
    if (Array.isArray(contactData.tags)) {
      contact.tags = [...new Set([...(contact.tags || []), ...contactData.tags])];
    }
    contact.lastContactedAt = now;
    contact.updatedAt = now;
  }

  // Ensure contact exists in conversation list
  ensureConversation(db, tenantId, contact);

  return contact;
}

/**
 * Ensure a conversation thread exists for this contact.
 */
function ensureConversation(db, tenantId, contact) {
  if (!db.waConversations) db.waConversations = [];
  let conv = db.waConversations.find((c) => c.tenantId === tenantId && c.contactId === contact.id);
  const now = new Date().toISOString();

  if (!conv) {
    conv = {
      id: 'conv_' + crypto.randomBytes(8).toString('hex'),
      tenantId,
      contactId: contact.id,
      phone: contact.phone,
      name: contact.name,
      unreadCount: 0,
      status: 'open', // open, pending, resolved
      lastMessageText: 'Conversation started',
      lastMessageAt: now,
      createdAt: now
    };
    db.waConversations.unshift(conv);
  } else {
    conv.name = contact.name;
    conv.phone = contact.phone;
  }
  return conv;
}

/**
 * Record a message (inbound, outbound, or call system log) in the conversation thread.
 */
function recordMessage(db, tenantId, { phone, direction, type = 'text', text, status = 'delivered', metadata = {} }) {
  if (!db.waMessages) db.waMessages = [];
  const normalizedPhone = normalizeE164(phone);
  const contact = upsertContact(db, tenantId, { phone: normalizedPhone });
  const conv = ensureConversation(db, tenantId, contact);
  const now = new Date().toISOString();

  const msg = {
    id: 'msg_' + crypto.randomBytes(8).toString('hex'),
    tenantId,
    conversationId: conv.id,
    contactId: contact.id,
    phone: normalizedPhone,
    direction: direction || 'outbound', // inbound, outbound, system
    type, // text, template, audio, call_summary
    text: text || '',
    status, // sent, delivered, read, failed
    metadata,
    createdAt: now
  };

  db.waMessages.push(msg);

  conv.lastMessageText = text.slice(0, 80);
  conv.lastMessageAt = now;
  if (direction === 'inbound') {
    conv.unreadCount = (conv.unreadCount || 0) + 1;
    conv.status = 'open';
  }

  return msg;
}

/**
 * Hook triggered when a voice call completes.
 * Extracts real caller information from transcript and gathered context,
 * records call summary, updates CRM pipeline stage and deal value,
 * and optionally dispatches an automated WhatsApp follow-up.
 */
async function processVoiceCallCompletion(db, tenantId, callDetails) {
  const extracted = extractLeadDataFromCall(callDetails);
  const phone = normalizeE164(
    extracted.phone ||
    callDetails.callerNumber ||
    callDetails.phoneNumber ||
    callDetails.to ||
    callDetails.from
  );
  if (!phone) return null;

  const now = new Date().toISOString();
  const summary = callDetails.summary || callDetails.transcript || extracted.requirement || 'AI Voice call completed.';
  const disposition = callDetails.disposition || extracted.disposition || 'completed';

  // Pipeline stage: explicit parameter takes precedence, else 'Call Completed'
  const stage = callDetails.stage || 'Call Completed';

  // 1. Upsert CRM contact with real gathered information
  const contact = upsertContact(db, tenantId, {
    phone,
    name: callDetails.callerName || extracted.name || undefined,
    email: callDetails.email || extracted.email || undefined,
    company: callDetails.company || extracted.company || undefined,
    dealValue: (callDetails.dealValue !== undefined) ? Number(callDetails.dealValue) : (extracted.dealValue || 0),
    stage,
    tags: ['ai-voice-call', ...(extracted.tags || []), `disposition:${disposition}`],
    notes: `[Voice Call ${now.slice(0, 10)}] ${extracted.structuredNotes || summary}`
  });

  // 2. Append call summary into the WhatsApp timeline as a system event
  recordMessage(db, tenantId, {
    phone,
    direction: 'system',
    type: 'call_summary',
    text: `📞 Call Completed (${callDetails.durationSec || callDetails.durationSeconds || 0}s): ${summary}`,
    status: 'delivered',
    metadata: {
      callId: callDetails.callId || callDetails.dograhRunId || callDetails.id,
      recordingUrl: callDetails.recordingUrl,
      disposition: disposition,
      extracted: {
        name: extracted.name,
        dealValue: extracted.dealValue,
        requirement: extracted.requirement,
        appointment: extracted.appointment
      }
    }
  });
  return contact;
}

/**
 * Get tenant WhatsApp / WACRM configuration
 */
function getTenantWacrmConfig(db, tenantId) {
  if (!db.wacrmConfig) db.wacrmConfig = [];
  let cfg = db.wacrmConfig.find((c) => c.tenantId === tenantId);

  // Dynamically re-read .env to ensure fresh credentials are used without server restarts
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env')
  ];
  for (const envFile of candidates) {
    try {
      if (fs.existsSync(envFile)) {
        const txt = fs.readFileSync(envFile, 'utf8');
        for (const line of txt.split('\n')) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
          if (m && m[1].startsWith('WHATSAPP_')) {
            process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
          }
        }
        break;
      }
    } catch (_) {}
  }

  const envPhoneId = process.env.WHATSAPP_PHONE_ID || '';
  const envWabaId = process.env.WHATSAPP_WABA_ID || '';
  const envToken = process.env.WHATSAPP_ACCESS_TOKEN || '';

  if (!cfg) {
    cfg = {
      tenantId,
      mode: 'meta_cloud', // meta_cloud | wacrm_api
      metaPhoneId: envPhoneId,
      metaWabaId: envWabaId,
      metaToken: envToken,
      wacrmBaseUrl: process.env.WACRM_BASE_URL || 'http://localhost:3000',
      wacrmApiKey: process.env.WACRM_API_KEY || '',
      autoFollowupEnabled: true,
      autoFollowupMessage: 'Hi {{name}}, thank you for speaking with our AI Receptionist at Seevora. Here is the confirmation and details discussed during the call. Please reply here if you have any questions!',
      webhookSecret: crypto.randomBytes(16).toString('hex'),
      updatedAt: new Date().toISOString()
    };
    db.wacrmConfig.push(cfg);
  } else {
    // Only use global .env as fallback if tenant has not explicitly disconnected and has not configured their own
    if (!cfg.disconnected) {
      if (!cfg.metaPhoneId && envPhoneId) cfg.metaPhoneId = envPhoneId;
      if (!cfg.metaWabaId && envWabaId) cfg.metaWabaId = envWabaId;
      if (!cfg.metaToken && envToken) cfg.metaToken = envToken;
    }
  }
  return cfg;
}

/**
 * Automatically subscribe Seevora app to client's WABA for webhook message events.
 * Endpoint: POST https://graph.facebook.com/v21.0/{waba_id}/subscribed_apps
 */
async function subscribeWabaWebhook({ wabaId, token }) {
  if (!wabaId || !token) throw new Error('WABA ID and Access Token are required to subscribe webhook.');
  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${encodeURIComponent(wabaId)}/subscribed_apps`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  const res = await sendHttpRequest(options, {});
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'Failed to subscribe webhook';
    throw new Error(`Meta Webhook Subscription Failed (${res.status}): ${err}`);
  }
  return { ok: true, success: res.data && res.data.success !== false };
}

/**
 * Register phone number with Meta WhatsApp Cloud API so it can send & receive messages.
 * Endpoint: POST https://graph.facebook.com/v21.0/{phone_number_id}/register
 */
async function registerPhoneNumber({ phoneId, token, pin = '123456' }) {
  if (!phoneId || !token) throw new Error('Phone Number ID and Access Token are required.');
  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${encodeURIComponent(phoneId)}/register`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  const payload = {
    messaging_product: 'whatsapp',
    pin: String(pin || '123456')
  };
  const res = await sendHttpRequest(options, payload);
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'Registration failed';
    throw new Error(`Meta Phone Number Registration Failed (${res.status}): ${err}`);
  }
  return { ok: true, result: res.data };
}

/**
 * Request SMS or VOICE verification code (OTP) for phone number from Meta Cloud API.
 * Endpoint: POST https://graph.facebook.com/v21.0/{phone_number_id}/request_code
 */
async function requestVerificationCode({ phoneId, token, codeMethod = 'SMS', language = 'en' }) {
  if (!phoneId || !token) throw new Error('Phone Number ID and Access Token are required.');
  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${encodeURIComponent(phoneId)}/request_code`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  const payload = {
    code_method: String(codeMethod || 'SMS').toUpperCase(),
    language: String(language || 'en')
  };
  const res = await sendHttpRequest(options, payload);
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'Request code failed';
    throw new Error(`Meta OTP Request Failed (${res.status}): ${err}`);
  }
  return { ok: true, result: res.data };
}

/**
 * Verify 6-digit verification code with Meta Cloud API.
 * Endpoint: POST https://graph.facebook.com/v21.0/{phone_number_id}/verify_code
 */
async function verifyPhoneCode({ phoneId, token, code }) {
  if (!phoneId || !token || !code) throw new Error('Phone ID, Token, and 6-digit Code are required.');
  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${encodeURIComponent(phoneId)}/verify_code`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  const payload = { code: String(code).trim() };
  const res = await sendHttpRequest(options, payload);
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'Verification failed';
    throw new Error(`Meta Code Verification Failed (${res.status}): ${err}`);
  }
  return { ok: true, result: res.data };
}

/**
 * Fetch all registered phone numbers under a WABA.
 * Endpoint: GET https://graph.facebook.com/v21.0/{waba_id}/phone_numbers
 */
async function fetchWabaPhoneNumbers({ wabaId, token }) {
  if (!wabaId || !token) throw new Error('WABA ID and Access Token are required.');
  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };
  const res = await sendHttpRequest(options);
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'Failed to fetch phone numbers';
    throw new Error(`Meta Phone Numbers Fetch Failed (${res.status}): ${err}`);
  }
  return { ok: true, numbers: (res.data && res.data.data) || [] };
}

/**
 * Exchange OAuth authorization code for Meta Access Token.
 * Endpoint: GET https://graph.facebook.com/v21.0/oauth/access_token
 */
async function exchangeMetaOAuthCode({ appId, appSecret, code, redirectUri }) {
  if (!appId || !appSecret || !code) throw new Error('Meta App ID, App Secret, and Code are required.');
  const q = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code: code
  });
  if (redirectUri) q.append('redirect_uri', redirectUri);

  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/oauth/access_token?${q.toString()}`,
    method: 'GET'
  };
  const res = await sendHttpRequest(options);
  if (res.status >= 400) {
    const err = (res.data && res.data.error && res.data.error.message) || 'Token exchange failed';
    throw new Error(`Meta OAuth Exchange Failed (${res.status}): ${err}`);
  }
  return {
    ok: true,
    accessToken: res.data.access_token,
    tokenType: res.data.token_type || 'bearer',
    expiresIn: res.data.expires_in
  };
}

/**
 * Verify Meta Cloud API connection and token validity.
 */
async function testMetaConnection({ phoneId, token }) {
  if (!phoneId || !token) {
    return { ok: false, error: 'WhatsApp Phone Number ID and Access Token are required.' };
  }
  const options = {
    hostname: 'graph.facebook.com',
    port: 443,
    path: `/v21.0/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };
  try {
    const res = await sendHttpRequest(options);
    if (res.status === 200 && res.data && res.data.id) {
      return {
        ok: true,
        phoneId: res.data.id,
        displayPhoneNumber: res.data.display_phone_number || '',
        verifiedName: res.data.verified_name || '',
        qualityRating: res.data.quality_rating || 'UNKNOWN'
      };
    }
    const errMsg = formatMetaError(res);
    return {
      ok: false,
      error: errMsg,
      code: res.data && res.data.error && res.data.error.code,
      subcode: res.data && res.data.error && res.data.error.error_subcode
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Automatically synchronizes call recordings into CRM leads for a tenant,
 * extracting real names, deal values, and structured notes from transcripts.
 */
function syncCallRecordingsToCrm(db, tenantId) {
  if (!db || !Array.isArray(db.callRecordings)) return [];
  const recs = db.callRecordings.filter((r) => r.tenantId === tenantId && (r.phoneNumber || r.callerNumber || r.calledNumber));
  const synced = [];
  for (const r of recs) {
    const phone = normalizeE164(r.phoneNumber || (r.direction === 'inbound' ? r.callerNumber : r.calledNumber));
    if (!phone) continue;

    const existing = (db.crmContacts || []).find((c) => c.tenantId === tenantId && c.phone === phone);
    const hasPlaceholderName = !existing || !existing.name || existing.name === phone || existing.name.startsWith('Lead ');
    const hasMissingDealValue = !existing || !existing.dealValue || existing.dealValue === 0;
    const hasMissingNotes = !existing || !existing.notes;

    if (!existing || hasPlaceholderName || hasMissingDealValue || hasMissingNotes) {
      const extracted = extractLeadDataFromCall(r);
      const contact = upsertContact(db, tenantId, {
        phone,
        name: extracted.name || (existing && existing.name && !existing.name.startsWith('Lead ') ? existing.name : undefined),
        email: extracted.email || (existing && existing.email ? existing.email : undefined),
        company: extracted.company || (existing && existing.company ? existing.company : undefined),
        dealValue: extracted.dealValue > 0 ? extracted.dealValue : (existing ? existing.dealValue : 0),
        stage: existing ? existing.stage : (extracted.stage || 'Call Completed'),
        tags: [...new Set([...(existing ? existing.tags || [] : []), ...(extracted.tags || ['voice-lead'])])],
        notes: extracted.structuredNotes || r.summary || (existing ? existing.notes : '')
      });
      synced.push(contact);
    }
  }
  return synced;
}

module.exports = {
  normalizeE164,
  sendMetaWhatsAppMessage,
  sendMetaTemplateMessage,
  sendWacrmApiMessage,
  testMetaConnection,
  formatMetaError,
  upsertContact,
  ensureConversation,
  recordMessage,
  processVoiceCallCompletion,
  getTenantWacrmConfig,
  extractLeadDataFromCall,
  syncCallRecordingsToCrm,
  extractMoneyFromText,
  subscribeWabaWebhook,
  registerPhoneNumber,
  requestVerificationCode,
  verifyPhoneCode,
  fetchWabaPhoneNumbers,
  exchangeMetaOAuthCode,
  DEFAULT_STAGES
};

