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

const https = require('https');
const crypto = require('crypto');

/**
 * Standardize phone number into E.164 format.
 * Defaults to +91 (India) if 10 digits provided without country code.
 */
function normalizeE164(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
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
    req.setTimeout(25000, () => {
      req.destroy(new Error('Request timed out'));
    });
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
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
    const msg = (res.data && res.data.error && res.data.error.message) || 'Meta API returned error';
    throw new Error(`WhatsApp send failed (${res.status}): ${msg}`);
  }
  return res.data;
}

/**
 * Send WhatsApp Template message via Meta WhatsApp Business Cloud API.
 */
async function sendMetaTemplateMessage({ phoneId, token, to, templateName, languageCode = 'en', components = [] }) {
  const recipient = normalizeE164(to).replace(/^\+/, '');
  if (!recipient) throw new Error('Recipient phone number is required and must be valid E.164.');
  if (!phoneId || !token) throw new Error('WhatsApp Phone Number ID and Access Token are required.');

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
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

  const res = await sendHttpRequest(options, payload);
  if (res.status >= 400) {
    const msg = (res.data && res.data.error && res.data.error.message) || 'Meta API returned error';
    throw new Error(`WhatsApp template send failed (${res.status}): ${msg}`);
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

/**
 * Find or create a contact in the CRM for a tenant.
 */
function upsertContact(db, tenantId, contactData) {
  if (!db.crmContacts) db.crmContacts = [];
  const phone = normalizeE164(contactData.phone);
  if (!phone) throw new Error('Contact phone number is required.');

  let contact = db.crmContacts.find((c) => c.tenantId === tenantId && c.phone === phone);
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
    if (contactData.name && contactData.name !== contact.phone) contact.name = contactData.name;
    if (contactData.email) contact.email = contactData.email;
    if (contactData.company) contact.company = contactData.company;
    if (contactData.stage) contact.stage = contactData.stage;
    if (contactData.dealValue !== undefined) contact.dealValue = Number(contactData.dealValue);
    if (contactData.notes) contact.notes = (contact.notes ? contact.notes + '\n\n' : '') + contactData.notes;
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
 * Records call summary, updates CRM pipeline stage to 'Call Completed',
 * and optionally dispatches an automated WhatsApp follow-up.
 */
async function processVoiceCallCompletion(db, tenantId, callDetails) {
  const phone = normalizeE164(callDetails.callerNumber || callDetails.to || callDetails.from);
  if (!phone) return null;

  const now = new Date().toISOString();
  const summary = callDetails.summary || callDetails.transcript || 'AI Voice call completed.';
  const disposition = callDetails.disposition || 'completed';

  // 1. Upsert CRM contact
  const contact = upsertContact(db, tenantId, {
    phone,
    name: callDetails.callerName || undefined,
    stage: 'Call Completed',
    tags: ['ai-voice-call', `disposition:${disposition}`],
    notes: `[Voice Call ${now.slice(0, 10)}] ${summary}`
  });

  // 2. Append call summary into the WhatsApp timeline as a system event
  recordMessage(db, tenantId, {
    phone,
    direction: 'system',
    type: 'call_summary',
    text: `📞 Call Completed (${callDetails.durationSec || 0}s): ${summary}`,
    status: 'delivered',
    metadata: {
      callId: callDetails.callId,
      recordingUrl: callDetails.recordingUrl,
      disposition: disposition
    }
  });

  // 3. Check tenant WhatsApp auto-reply settings
  const config = getTenantWacrmConfig(db, tenantId);
  if (config && config.autoFollowupEnabled && config.autoFollowupMessage) {
    try {
      const replyText = config.autoFollowupMessage
        .replace(/\{\{name\}\}/gi, contact.name || 'there')
        .replace(/\{\{phone\}\}/gi, contact.phone);

      if (config.mode === 'meta_cloud' && config.metaPhoneId && config.metaToken) {
        await sendMetaWhatsAppMessage({
          phoneId: config.metaPhoneId,
          token: config.metaToken,
          to: phone,
          text: replyText
        });
        recordMessage(db, tenantId, {
          phone,
          direction: 'outbound',
          type: 'text',
          text: replyText,
          status: 'sent'
        });
      } else if (config.mode === 'wacrm_api' && config.wacrmBaseUrl && config.wacrmApiKey) {
        await sendWacrmApiMessage({
          baseUrl: config.wacrmBaseUrl,
          apiKey: config.wacrmApiKey,
          to: phone,
          text: replyText
        });
        recordMessage(db, tenantId, {
          phone,
          direction: 'outbound',
          type: 'text',
          text: replyText,
          status: 'sent'
        });
      }
    } catch (err) {
      console.error('[WACRM Auto-Followup Error]', err.message);
    }
  }

  return contact;
}

/**
 * Get tenant WhatsApp / WACRM configuration
 */
function getTenantWacrmConfig(db, tenantId) {
  if (!db.wacrmConfig) db.wacrmConfig = [];
  let cfg = db.wacrmConfig.find((c) => c.tenantId === tenantId);
  if (!cfg) {
    cfg = {
      tenantId,
      mode: 'meta_cloud', // meta_cloud | wacrm_api
      metaPhoneId: process.env.WHATSAPP_PHONE_ID || '',
      metaWabaId: process.env.WHATSAPP_WABA_ID || '',
      metaToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      wacrmBaseUrl: process.env.WACRM_BASE_URL || 'http://localhost:3000',
      wacrmApiKey: process.env.WACRM_API_KEY || '',
      autoFollowupEnabled: true,
      autoFollowupMessage: 'Hi {{name}}, thank you for speaking with our AI Receptionist at Seevora. Here is the confirmation and details discussed during the call. Please reply here if you have any questions!',
      webhookSecret: crypto.randomBytes(16).toString('hex'),
      updatedAt: new Date().toISOString()
    };
    db.wacrmConfig.push(cfg);
  } else {
    if (!cfg.metaPhoneId && process.env.WHATSAPP_PHONE_ID) cfg.metaPhoneId = process.env.WHATSAPP_PHONE_ID;
    if (!cfg.metaWabaId && process.env.WHATSAPP_WABA_ID) cfg.metaWabaId = process.env.WHATSAPP_WABA_ID;
    if (!cfg.metaToken && process.env.WHATSAPP_ACCESS_TOKEN) cfg.metaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  }
  return cfg;
}

module.exports = {
  normalizeE164,
  sendMetaWhatsAppMessage,
  sendMetaTemplateMessage,
  sendWacrmApiMessage,
  upsertContact,
  ensureConversation,
  recordMessage,
  processVoiceCallCompletion,
  getTenantWacrmConfig,
  DEFAULT_STAGES
};
