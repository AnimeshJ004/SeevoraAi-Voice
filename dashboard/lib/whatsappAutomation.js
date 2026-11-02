/**
 * RapidX Voice / Seevora AI Voice Receptionist
 * WhatsApp Automation & Intent-Driven Trigger Engine.
 *
 * Handles:
 *  - Automated keyword and intent classification:
 *      * High Interest -> Dispatches automated Voice AI phone call
 *      * Not Interested / Decline Call -> Suppresses calls, sends polite text messages only
 *      * Greeting -> Dispatches automated welcome message
 *  - Real-time customer communication preference tracking (Prefers WhatsApp / Do Not Call / Not Interested)
 *  - Autonomous activation of the Voice AI agent for high-intent leads
 *  - Continuation of conversation over WhatsApp when calls are declined or customer is not interested
 *  - Seamless recording of message threads in CRM shared inbox
 *
 * No external dependencies. Pure Node.
 */
'use strict';

const wacrm = require('./wacrm');
const autocall = require('./autocall');
const logger = require('./logger');

// Multi-lingual keyword sets (English & Hinglish)
const GREETING_KEYWORDS = [
  'hi', 'hello', 'hey', 'namaste', 'namaskar', 'good morning',
  'good afternoon', 'good evening', 'start', 'shuru', 'hola', 'pranam'
];

const NOT_INTERESTED_KEYWORDS = [
  'not interested', 'not intrested', 'not intersred', 'no interest',
  'not looking', 'dont want', "don't want", 'do not want', 'no thanks',
  'no thank you', 'nahi chahiye', 'koi interest nahi', 'interest nahi',
  'nahi chaiye', 'stop', 'unsubscribe', 'cancel', 'not for me', 'no need',
  'dont need', "don't need", 'not required', 'never call', 'wrong number',
  'spam', 'bekaar hai', 'kuch nahi chahiye'
];

const DECLINE_CALL_KEYWORDS = [
  'dont call', "don't call", 'no call', 'cannot call', "can't talk", "cant talk",
  'busy', 'later', 'not now', 'prefer text', 'prefer whatsapp',
  'whatsapp only', 'text only', 'chat only', 'message only',
  'leave a message', 'fon mat karo', 'call mat karo', 'abhi busy hu',
  'in a meeting', 'meeting me hu', 'driving', 'call mat kijiye'
];

const INTEREST_KEYWORDS = [
  'interested', 'call me', 'call back', 'want to know', 'tell me more',
  'details', 'price', 'pricing', 'quote', 'quotation', 'cost', 'demo',
  'book demo', 'appointment', 'schedule', 'talk to agent', 'speak to someone',
  'speak with someone', 'connect call', 'urgent', 'buy', 'purchase',
  'trial', 'package', 'kya rate hai', 'baat karni hai', 'fon karo', 'call karo'
];

/**
 * Classifies customer intent from incoming message text.
 * Prioritizes negative intent (not interested / decline call) to guarantee no unwanted calls are placed.
 * @param {string} text - Inbound message body
 * @returns {{ intent: 'greeting'|'high_interest'|'not_interested'|'decline_call'|'general_query'|'unknown', matchedKeyword: string|null, confidence: number }}
 */
function classifyCustomerIntent(text = '') {
  const clean = String(text || '').toLowerCase().trim();
  if (!clean) return { intent: 'unknown', matchedKeyword: null, confidence: 0 };

  // 1. Check for explicit NOT INTERESTED / opt-out first (takes priority over substring "interested")
  for (const kw of NOT_INTERESTED_KEYWORDS) {
    if (clean.includes(kw)) {
      return { intent: 'not_interested', matchedKeyword: kw, confidence: 0.98 };
    }
  }

  // Check for negation + interest variations (e.g. "not really interested", "am not interested")
  if (/(not|no|never|dont|don't|nahi)\s+(at\s+all\s+|really\s+)?(interested|intrested|intersred)/i.test(clean)) {
    return { intent: 'not_interested', matchedKeyword: 'negated_interest', confidence: 0.98 };
  }

  // 2. Check for explicit call decline or preference for WhatsApp/text
  for (const kw of DECLINE_CALL_KEYWORDS) {
    if (clean.includes(kw)) {
      return { intent: 'decline_call', matchedKeyword: kw, confidence: 0.95 };
    }
  }

  // 3. Check for high interest or direct request to talk
  for (const kw of INTEREST_KEYWORDS) {
    if (clean.includes(kw)) {
      return { intent: 'high_interest', matchedKeyword: kw, confidence: 0.9 };
    }
  }

  // 4. Check for greetings
  const tokens = clean.split(/[\s,!.?]+/);
  for (const kw of GREETING_KEYWORDS) {
    if (tokens.includes(kw) || clean === kw) {
      return { intent: 'greeting', matchedKeyword: kw, confidence: 0.85 };
    }
  }

  return { intent: 'general_query', matchedKeyword: null, confidence: 0.5 };
}

/**
 * Dispatches an automated WhatsApp reply message via Meta Cloud API or mock fallback,
 * and records it into the database thread.
 */
async function sendAutomatedWhatsAppReply({ db, db_mutate, tenantId, toPhone, text, metadata = {} }) {
  const normalizedPhone = wacrm.normalizeE164(toPhone);
  if (!normalizedPhone || !text) return null;

  // 1. Record outbound message in DB conversation thread
  let recordedMsg = null;
  await db_mutate((d) => {
    recordedMsg = wacrm.recordMessage(d, tenantId, {
      phone: normalizedPhone,
      direction: 'outbound',
      type: 'text',
      text,
      status: 'sent',
      metadata: { automated: true, ...metadata }
    });
  });

  // 2. Dispatch via Meta Cloud API if configured
  const waConfig = wacrm.getTenantWacrmConfig(db, tenantId);
  let metaResult = null;
  if (waConfig && waConfig.accessToken && waConfig.phoneNumberId) {
    try {
      metaResult = await wacrm.sendMetaWhatsAppMessage({
        phoneId: waConfig.phoneNumberId,
        token: waConfig.accessToken,
        to: normalizedPhone,
        text
      });
    } catch (err) {
      logger.warn('Meta WhatsApp automated message delivery notice: ' + err.message);
    }
  }

  return { recordedMsg, metaResult };
}

/**
 * Main incoming WhatsApp message processor and automation router.
 * - If client is interested: automatically dispatches Voice AI phone call (unless previously opted out).
 * - If client is NOT interested or declines call: sends polite WhatsApp text message only and suppresses phone calls.
 */
async function processIncomingWhatsAppMessage({ db, db_mutate, tenantId, fromPhone, text, senderName, providers, genId }) {
  const normalizedPhone = wacrm.normalizeE164(fromPhone);
  if (!normalizedPhone) return null;

  const nowIso = new Date().toISOString();
  let contact = null;

  // 1. Upsert contact in crmContacts and record inbound message
  await db_mutate((d) => {
    if (!Array.isArray(d.crmContacts)) d.crmContacts = [];
    contact = d.crmContacts.find((c) => c.tenantId === tenantId && c.phone === normalizedPhone);

    if (!contact) {
      contact = {
        id: 'con_' + genId(),
        tenantId,
        phone: normalizedPhone,
        name: senderName || 'WhatsApp Contact',
        email: '',
        company: '',
        type: 'lead',
        stage: 'New Lead',
        dealValue: 0,
        communicationPreference: {
          prefersWhatsApp: false,
          doNotCall: false,
          isInterested: true,
          lastContactChannel: 'whatsapp',
          voiceCallAttempts: 0
        },
        tags: ['whatsapp_inbound'],
        notes: `[WhatsApp ${nowIso.slice(0, 10)}] Inbound message: "${text}"`,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      d.crmContacts.unshift(contact);
    } else {
      contact.updatedAt = nowIso;
      if (senderName && (!contact.name || contact.name.startsWith('WhatsApp Contact'))) {
        contact.name = senderName;
      }
      if (!contact.communicationPreference) {
        contact.communicationPreference = {
          prefersWhatsApp: false,
          doNotCall: false,
          isInterested: true,
          lastContactChannel: 'whatsapp',
          voiceCallAttempts: 0
        };
      }
      contact.communicationPreference.lastContactChannel = 'whatsapp';
    }

    // Record incoming WhatsApp message in conversation timeline
    wacrm.recordMessage(d, tenantId, {
      phone: normalizedPhone,
      direction: 'inbound',
      type: 'text',
      text,
      status: 'received',
      metadata: { senderName, source: 'whatsapp_webhook' }
    });
  });

  // 2. Classify customer intent
  const analysis = classifyCustomerIntent(text);
  const pref = (contact && contact.communicationPreference) || { prefersWhatsApp: false, doNotCall: false };

  // 3. Execute Workflow Branch
  switch (analysis.intent) {
    case 'greeting': {
      const greetingReply = `Namaste ${contact.name && !contact.name.startsWith('WhatsApp') ? contact.name : ''}! Welcome to Seevora AI. How can we help you today? Would you like a live demo of our Voice AI agent, or do you have a specific requirement?`;
      await sendAutomatedWhatsAppReply({
        db,
        db_mutate,
        tenantId,
        toPhone: normalizedPhone,
        text: greetingReply,
        metadata: { intent: 'greeting' }
      });
      break;
    }

    case 'high_interest': {
      // If user previously opted out or declined phone calls, respect text preference
      if (pref.doNotCall || pref.prefersWhatsApp || pref.isInterested === false) {
        const textOnlyReply = `Thank you for your interest! Since you prefer WhatsApp communication, our AI team is ready to assist you right here. What details or pricing information can we share with you?`;
        await sendAutomatedWhatsAppReply({
          db,
          db_mutate,
          tenantId,
          toPhone: normalizedPhone,
          text: textOnlyReply,
          metadata: { intent: 'high_interest', channel: 'whatsapp_only' }
        });
        break;
      }

      // Customer is interested and open to calls -> Automatically trigger Voice AI Call
      // 1. Send immediate WhatsApp confirmation
      const callAlertMsg = `Thank you for your interest! Our AI Voice Specialist is placing a quick call to you right now on ${normalizedPhone} to discuss your requirements.`;
      await sendAutomatedWhatsAppReply({
        db,
        db_mutate,
        tenantId,
        toPhone: normalizedPhone,
        text: callAlertMsg,
        metadata: { intent: 'high_interest', action: 'voice_ai_triggered' }
      });

      // 2. Find primary agent or default agent for this tenant
      const agent = (db.agents || []).find((a) => a.tenantId === tenantId && a.isPrimary) ||
                    (db.agents || []).find((a) => a.tenantId === tenantId) ||
                    null;

      const leadPayload = {
        name: contact.name,
        phone: normalizedPhone,
        email: contact.email,
        notes: `High-intent lead from WhatsApp: "${text}". Voice AI agent triggered immediately.`,
        priority: 'high',
        metadata: { source: 'whatsapp_automation', originalText: text }
      };

      const webhookRow = {
        id: 'wh_wa_auto_trigger',
        tenantId,
        label: 'WhatsApp High-Intent Auto-Call'
      };

      try {
        await autocall.dispatchOutboundCall({
          leadId: contact.id,
          callId: 'call_' + genId(),
          lead: leadPayload,
          agent,
          webhookRow,
          db_mutate,
          providers,
          genId,
          logger
        });

        // Update contact pipeline stage & tags
        await db_mutate((d) => {
          const c = (d.crmContacts || []).find((ct) => ct.id === contact.id);
          if (c) {
            c.stage = 'Call Completed';
            c.tags = [...new Set([...(c.tags || []), 'voice_ai_triggered', 'high_intent'])];
            if (!c.communicationPreference) c.communicationPreference = {};
            c.communicationPreference.voiceCallAttempts = (c.communicationPreference.voiceCallAttempts || 0) + 1;
            c.updatedAt = new Date().toISOString();
          }
        });
      } catch (callErr) {
        logger.error('Failed to dispatch Voice AI call from WhatsApp automation: ' + callErr.message);
      }
      break;
    }

    case 'not_interested': {
      // Customer is NOT interested: DO NOT CALL. Send polite WhatsApp message only.
      await db_mutate((d) => {
        const c = (d.crmContacts || []).find((ct) => ct.id === contact.id);
        if (c) {
          c.stage = 'Closed / Lost';
          c.communicationPreference = {
            ...(c.communicationPreference || {}),
            prefersWhatsApp: true,
            doNotCall: true,
            isInterested: false,
            lastUpdated: nowIso
          };
          c.tags = [...new Set([...(c.tags || []), 'not_interested', 'do_not_call'])];
          c.notes = (c.notes || '') + `\n[Preference ${nowIso.slice(0, 10)}] Customer stated: Not interested ("${text}"). No calls will be placed.`;
          c.updatedAt = nowIso;
        }
      });

      const notInterestedReply = `Thank you for letting us know! We have noted that you are not interested at this time and will not call you. If your requirements change in the future, feel free to message us here anytime. Have a great day!`;
      await sendAutomatedWhatsAppReply({
        db,
        db_mutate,
        tenantId,
        toPhone: normalizedPhone,
        text: notInterestedReply,
        metadata: { intent: 'not_interested', action: 'message_only' }
      });
      break;
    }

    case 'decline_call': {
      // Customer prefers text or is busy: DO NOT CALL. Send WhatsApp message only.
      await db_mutate((d) => {
        const c = (d.crmContacts || []).find((ct) => ct.id === contact.id);
        if (c) {
          c.communicationPreference = {
            ...(c.communicationPreference || {}),
            prefersWhatsApp: true,
            doNotCall: true,
            lastUpdated: nowIso
          };
          c.tags = [...new Set([...(c.tags || []), 'prefers_whatsapp', 'do_not_call'])];
          c.notes = (c.notes || '') + `\n[Preference ${nowIso.slice(0, 10)}] Customer declined calls / prefers WhatsApp ("${text}").`;
          c.updatedAt = nowIso;
        }
      });

      const declineReply = `Understood completely! We have noted that you prefer WhatsApp. No voice calls will be placed. How may we assist you here in chat?`;
      await sendAutomatedWhatsAppReply({
        db,
        db_mutate,
        tenantId,
        toPhone: normalizedPhone,
        text: declineReply,
        metadata: { intent: 'decline_call', preferenceSet: 'whatsapp_only' }
      });
      break;
    }

    default: {
      const generalReply = `Thank you for reaching out! We received your message: "${text}". Our team is reviewing it, or you can reply "call me" anytime to speak with our Voice AI specialist.`;
      await sendAutomatedWhatsAppReply({
        db,
        db_mutate,
        tenantId,
        toPhone: normalizedPhone,
        text: generalReply,
        metadata: { intent: 'general_query' }
      });
      break;
    }
  }

  return { intent: analysis.intent, contactId: contact.id };
}

module.exports = {
  classifyCustomerIntent,
  sendAutomatedWhatsAppReply,
  processIncomingWhatsAppMessage,
  GREETING_KEYWORDS,
  INTEREST_KEYWORDS,
  NOT_INTERESTED_KEYWORDS,
  DECLINE_CALL_KEYWORDS
};
