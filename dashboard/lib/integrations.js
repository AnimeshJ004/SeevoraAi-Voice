/**
 * lib/integrations.js - Connected Apps & CRM Integrations Engine
 *
 * Production-grade integration dispatch engine for:
 *   - Google Calendar  (Apps Script webhook or direct OAuth API)
 *   - Google Sheets    (Apps Script Web App POST)
 *   - Zoho CRM         (OAuth2 Refresh Token, Zoho India)
 *   - HubSpot CRM      (Private App Token, Contacts + Deals API v3)
 *   - Slack            (Incoming Webhook Block Kit)
 *   - Email / Gmail    (SMTP via lib/mailer.js)
 *   - WhatsApp         (Meta Cloud API or VoBiz WhatsApp Gateway)
 *   - Razorpay         (Payment Link dispatch after booking)
 *
 * Zero npm dependencies except lib/mailer.js (also zero-dep).
 * DB shape: tenants[].crmIntegrations  (flat on tenant object)
 * All dispatchers run in parallel via Promise.allSettled.
 * Each dispatcher never throws — always returns { ok, error?, body? }.
 */
'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------
const CHANNELS = [
  'googleCalendar',
  'googleSheets',
  'zohoCrm',
  'hubspot',
  'slack',
  'email',
  'whatsapp',
  'razorpay',
];

const DEFAULT_INTEGRATIONS = {
  googleCalendar: { enabled: false, webhookUrl: '', calendarId: 'primary', defaultDurationMin: 30, status: 'not_connected', lastSyncAt: null, lastError: null },
  googleSheets:   { enabled: false, webhookUrl: '', sheetName: 'Leads',    status: 'not_connected', lastSyncAt: null, lastError: null },
  zohoCrm:        { enabled: false, clientId: '', clientSecret: '', refreshToken: '', apiDomain: 'https://www.zohoapis.in', zohoAccessToken: null, zohoTokenExpiresAt: null, status: 'not_connected', lastSyncAt: null, lastError: null },
  hubspot:        { enabled: false, accessToken: '', portalId: '', status: 'not_connected', lastSyncAt: null, lastError: null },
  slack:          { enabled: false, webhookUrl: '', channel: '#leads', status: 'not_connected', lastSyncAt: null, lastError: null },
  email:          { enabled: false, senderEmail: '', appPassword: '', recipientEmail: '', smtpHost: 'smtp.gmail.com', smtpPort: 465, status: 'not_connected', lastSyncAt: null, lastError: null },
  whatsapp:       { enabled: false, metaToken: '', metaPhoneId: '', senderNumber: '', status: 'not_connected', lastSyncAt: null, lastError: null },
  razorpay:       { enabled: false, keyId: '', keySecret: '', amountPaise: 50000, currency: 'INR', description: 'AI Voice Booking Deposit', status: 'not_connected', lastSyncAt: null, lastError: null },
};

const REQUEST_TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function httpsPost(urlStr, bodyObj, extraHeaders) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return resolve({ ok: false, status: 0, body: 'Invalid URL: ' + e.message }); }
    const bodyBuf = Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': String(bodyBuf.length), 'User-Agent': 'Seevora-Integrations/2.0' }, extraHeaders || {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 1000) }));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.write(bodyBuf);
    req.end();
  });
}

function httpsGet(urlStr, extraHeaders) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return resolve({ ok: false, status: 0, body: 'Invalid URL' }); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: Object.assign({ 'User-Agent': 'Seevora-Integrations/2.0' }, extraHeaders || {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000) }));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.end();
  });
}

function httpsFormPost(urlStr, params) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return resolve({ ok: false, status: 0, body: 'Invalid URL', json: null }); }
    const payload = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const bodyBuf = Buffer.from(payload, 'utf8');
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(bodyBuf.length) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: raw, json });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message, json: null }));
    req.write(bodyBuf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// DB helpers — works with the server's db.json flat-array store
// ---------------------------------------------------------------------------

function ensureCrmIntegrations(d, tenantId) {
  const tenant = (d.tenants || []).find((t) => t.id === tenantId);
  if (!tenant) return null;
  if (!tenant.crmIntegrations) tenant.crmIntegrations = {};
  return tenant.crmIntegrations;
}

function getIntegrations(db, tenantId) {
  const tenant = (db.tenants || []).find((t) => t.id === tenantId);
  const stored = (tenant && tenant.crmIntegrations) ? tenant.crmIntegrations : {};
  const merged = {};
  for (const ch of CHANNELS) {
    merged[ch] = Object.assign({}, DEFAULT_INTEGRATIONS[ch], stored[ch] || {});
  }
  return merged;
}

async function saveIntegration(mutate, tenantId, channel, config) {
  if (!CHANNELS.includes(channel)) throw new Error('Unknown channel: ' + channel);
  await mutate((d) => {
    const cfg = ensureCrmIntegrations(d, tenantId);
    if (!cfg) return;
    if (!cfg[channel]) cfg[channel] = Object.assign({}, DEFAULT_INTEGRATIONS[channel] || {});
    // Never overwrite masked values
    Object.keys(config).forEach((k) => {
      const v = config[k];
      if (v !== undefined && v !== '••••••••') cfg[channel][k] = v;
    });
    cfg[channel].updatedAt = new Date().toISOString();
  });
}

async function toggleIntegration(mutate, tenantId, channel, enabled) {
  if (!CHANNELS.includes(channel)) throw new Error('Unknown channel: ' + channel);
  await mutate((d) => {
    const cfg = ensureCrmIntegrations(d, tenantId);
    if (!cfg) return;
    if (!cfg[channel]) cfg[channel] = Object.assign({}, DEFAULT_INTEGRATIONS[channel] || {});
    cfg[channel].enabled = Boolean(enabled);
  });
}

// ---------------------------------------------------------------------------
// Test payload
// ---------------------------------------------------------------------------

function buildTestPayload() {
  return {
    name: 'Test Lead — Seevora AI',
    phone: '+91 98765 43210',
    outcome: 'appointment_booked',
    summary: 'Test AI call completed. Caller expressed strong interest in booking a product demo.',
    sentiment: 'positive',
    appointmentDate: new Date().toISOString().slice(0, 10),
    appointmentTime: '14:00',
    duration: 47,
    recordingUrl: 'https://demo.seevora.ai/calls/test/audio',
    callerEmail: 'testlead@seevora.ai',
    transcript: 'Agent: Namaste! How can I help today?\nCaller: Hi, I want to book a demo.\nAgent: Perfect, noted Thursday 4 PM.'
  };
}

// ---------------------------------------------------------------------------
// 1. Google Calendar dispatcher
// ---------------------------------------------------------------------------

async function dispatchGoogleCalendar(config, leadPayload) {
  if (!config || !config.webhookUrl) return { ok: false, error: 'Google Calendar webhook URL not configured' };
  const durationMin = parseInt(config.defaultDurationMin || 30, 10);
  const startDate = leadPayload.appointmentDate || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const startTime = (leadPayload.appointmentTime || '10:00').slice(0, 5);
  const [sh, sm] = startTime.split(':').map(Number);
  const endMins = sh * 60 + sm + durationMin;
  const endTime = String(Math.floor(endMins / 60) % 24).padStart(2, '0') + ':' + String(endMins % 60).padStart(2, '0');

  const result = await httpsPost(config.webhookUrl, {
    action: 'create_event',
    summary: 'AI Booking: ' + (leadPayload.name || 'Customer') + ' — ' + (leadPayload.phone || ''),
    description: 'Outcome: ' + (leadPayload.outcome || '') + '\nSentiment: ' + (leadPayload.sentiment || '') + '\n\n' + (leadPayload.summary || ''),
    startDateTime: startDate + 'T' + startTime + ':00',
    endDateTime: startDate + 'T' + endTime + ':00',
    attendeeEmail: leadPayload.callerEmail || '',
    calendarId: config.calendarId || 'primary',
  });

  return result.ok ? { ok: true } : { ok: false, error: 'HTTP ' + result.status + ': ' + result.body.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 2. Google Sheets dispatcher
// ---------------------------------------------------------------------------

async function dispatchGoogleSheets(config, leadPayload) {
  if (!config || !config.webhookUrl) return { ok: false, error: 'Google Sheets webhook URL not configured' };
  const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const result = await httpsPost(config.webhookUrl, {
    action: 'append_row',
    sheetName: config.sheetName || 'Leads',
    values: [
      ts,
      leadPayload.name || '',
      leadPayload.phone || '',
      leadPayload.callerEmail || '',
      String(leadPayload.duration || 0) + 's',
      leadPayload.sentiment || '',
      leadPayload.outcome || '',
      (leadPayload.summary || '').slice(0, 500),
      leadPayload.recordingUrl || '',
    ],
  });
  return result.ok ? { ok: true } : { ok: false, error: 'HTTP ' + result.status + ': ' + result.body.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 3. Zoho CRM dispatcher
// ---------------------------------------------------------------------------

async function _getZohoToken(config) {
  const now = Date.now();
  if (config.zohoAccessToken && config.zohoTokenExpiresAt && now < config.zohoTokenExpiresAt - 60000) {
    return { ok: true, token: config.zohoAccessToken };
  }
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    return { ok: false, error: 'Zoho credentials incomplete (clientId, clientSecret, refreshToken required)' };
  }
  const res = await httpsFormPost('https://accounts.zoho.in/oauth/v2/token', {
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });
  if (!res.ok || !res.json || !res.json.access_token) {
    return { ok: false, error: 'Zoho token refresh failed: ' + (res.body || '').slice(0, 200) };
  }
  config.zohoAccessToken = res.json.access_token;
  config.zohoTokenExpiresAt = now + (res.json.expires_in || 3600) * 1000;
  return { ok: true, token: config.zohoAccessToken };
}

async function dispatchZohoCrm(config, leadPayload) {
  if (!config) return { ok: false, error: 'Zoho CRM config missing' };
  const tok = await _getZohoToken(config);
  if (!tok.ok) return { ok: false, error: tok.error };
  const parts = (leadPayload.name || 'Customer').trim().split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
  const lastName  = parts.length > 1 ? parts[parts.length - 1] : 'Lead';
  const apiDomain = (config.apiDomain || 'https://www.zohoapis.in').replace(/\/$/, '');
  const result = await httpsPost(apiDomain + '/crm/v3/Leads', {
    data: [{
      First_Name: firstName,
      Last_Name: lastName,
      Phone: leadPayload.phone || '',
      Email: leadPayload.callerEmail || '',
      Lead_Source: 'Seevora AI Voice',
      Lead_Status: 'New',
      Description: 'Outcome: ' + (leadPayload.outcome || '') + '\nSentiment: ' + (leadPayload.sentiment || '') + '\n\n' + (leadPayload.summary || ''),
    }],
  }, { Authorization: 'Zoho-oauthtoken ' + tok.token });
  return result.ok ? { ok: true } : { ok: false, error: 'HTTP ' + result.status + ': ' + result.body.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 4. HubSpot CRM dispatcher (Private App Token)
// ---------------------------------------------------------------------------

async function dispatchHubspot(config, leadPayload) {
  if (!config || !config.accessToken) return { ok: false, error: 'HubSpot Access Token not configured' };

  const nameParts = (leadPayload.name || 'Customer').trim().split(/\s+/);
  const firstName = nameParts[0] || 'Customer';
  const lastName  = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Lead';
  const headers   = { Authorization: 'Bearer ' + config.accessToken };

  // 1. Create / upsert Contact
  const contactRes = await httpsPost('https://api.hubapi.com/crm/v3/objects/contacts', {
    properties: {
      firstname: firstName,
      lastname: lastName,
      phone: leadPayload.phone || '',
      email: leadPayload.callerEmail || '',
      hs_lead_status: 'NEW',
      lifecyclestage: 'lead',
      lead_source: 'Seevora AI Voice',
    },
  }, headers);

  if (!contactRes.ok) {
    // If duplicate (409), try to get existing contact by phone and still create note
    if (contactRes.status !== 409) {
      return { ok: false, error: 'HubSpot Contact: HTTP ' + contactRes.status + ' ' + contactRes.body.slice(0, 200) };
    }
  }

  // 2. Create a Note with call summary
  await httpsPost('https://api.hubapi.com/crm/v3/objects/notes', {
    properties: {
      hs_note_body: [
        'Seevora AI Call Summary',
        'Outcome: ' + (leadPayload.outcome || 'call_completed'),
        'Sentiment: ' + (leadPayload.sentiment || 'neutral'),
        'Duration: ' + (leadPayload.duration || 0) + 's',
        '',
        leadPayload.summary || '',
        '',
        leadPayload.recordingUrl ? 'Recording: ' + leadPayload.recordingUrl : '',
      ].join('\n'),
      hs_timestamp: new Date().toISOString(),
    },
  }, headers);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 5. Slack dispatcher
// ---------------------------------------------------------------------------

async function dispatchSlack(config, leadPayload) {
  if (!config || !config.webhookUrl) return { ok: false, error: 'Slack webhook URL not configured' };
  const result = await httpsPost(config.webhookUrl, {
    text: 'New AI Voice Lead: ' + (leadPayload.name || 'Customer') + ' - ' + (leadPayload.phone || ''),
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'New AI Voice Lead - Seevora' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*Name:*\n' + (leadPayload.name || 'Customer') },
          { type: 'mrkdwn', text: '*Phone:*\n' + (leadPayload.phone || 'N/A') },
          { type: 'mrkdwn', text: '*Outcome:*\n' + (leadPayload.outcome || '').replace(/_/g, ' ') },
          { type: 'mrkdwn', text: '*Sentiment:*\n' + (leadPayload.sentiment || 'neutral') },
        ],
      },
      ...(leadPayload.summary ? [{ type: 'section', text: { type: 'mrkdwn', text: '*Summary:*\n' + leadPayload.summary.slice(0, 400) } }] : []),
      ...(leadPayload.recordingUrl ? [{
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Listen to Recording' }, url: leadPayload.recordingUrl, style: 'primary' }],
      }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Seevora AI Voice · ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) }] },
    ],
  });
  return result.ok ? { ok: true } : { ok: false, error: 'HTTP ' + result.status + ': ' + result.body.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 6. Email dispatcher (via SMTP using mailer.js)
// ---------------------------------------------------------------------------

async function dispatchEmail(config, leadPayload) {
  if (!config || !config.senderEmail || !config.appPassword || !config.recipientEmail) {
    return { ok: false, error: 'Email: senderEmail, appPassword and recipientEmail are required' };
  }
  try {
    const mailer = require('./mailer');
    const subject = 'AI Call Lead: ' + (leadPayload.name || 'Customer') + ' — ' + (leadPayload.outcome || 'call completed');
    const html = [
      '<html><body style="font-family:Inter,sans-serif;color:#14221c;padding:20px;">',
      '<h2 style="color:#0d5d41;">New AI Voice Lead</h2>',
      '<table style="width:100%;border-collapse:collapse;">',
      '<tr><td style="padding:8px 0;font-weight:700;width:140px;">Name</td><td>' + (leadPayload.name || 'Customer') + '</td></tr>',
      '<tr><td style="padding:8px 0;font-weight:700;">Phone</td><td>' + (leadPayload.phone || '') + '</td></tr>',
      '<tr><td style="padding:8px 0;font-weight:700;">Outcome</td><td>' + (leadPayload.outcome || '') + '</td></tr>',
      '<tr><td style="padding:8px 0;font-weight:700;">Sentiment</td><td>' + (leadPayload.sentiment || '') + '</td></tr>',
      '<tr><td style="padding:8px 0;font-weight:700;">Duration</td><td>' + (leadPayload.duration || 0) + 's</td></tr>',
      '</table>',
      '<hr style="border:1px solid #e5e7eb;margin:16px 0;" />',
      '<h3 style="color:#0d5d41;">Call Summary</h3>',
      '<p>' + (leadPayload.summary || 'No summary available.').replace(/\n/g, '<br>') + '</p>',
      leadPayload.recordingUrl ? '<p><a href="' + leadPayload.recordingUrl + '" style="color:#0d5d41;">Listen to Recording</a></p>' : '',
      '<hr style="border:1px solid #e5e7eb;margin:16px 0;" />',
      '<p style="color:#5d7468;font-size:12px;">Dispatched by Seevora AI Voice — ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + '</p>',
      '</body></html>',
    ].join('');
    const text = 'New AI Voice Lead: ' + (leadPayload.name || 'Customer') + '\nPhone: ' + (leadPayload.phone || '') + '\nOutcome: ' + (leadPayload.outcome || '') + '\n\n' + (leadPayload.summary || '');
    await mailer.sendMail({ from: config.senderEmail, to: config.recipientEmail, subject, text, html, pass: config.appPassword, host: config.smtpHost || 'smtp.gmail.com', port: parseInt(config.smtpPort || '465', 10) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 7. WhatsApp dispatcher (Meta Cloud API)
// ---------------------------------------------------------------------------

async function dispatchWhatsApp(config, leadPayload) {
  if (!config) return { ok: false, error: 'WhatsApp config missing' };
  if (!leadPayload.phone) return { ok: false, error: 'No recipient phone number' };

  const recipientDigits = (leadPayload.phone || '').replace(/\D/g, '').slice(-10);
  if (recipientDigits.length < 10) return { ok: false, error: 'Invalid recipient phone number' };
  const recipientIntl = '91' + recipientDigits;

  const companyName = config.companyName || 'Seevora AI Voice';
  const senderDigits = (config.senderNumber || '8071582519').replace(/\D/g, '').slice(-10);

  const message = [
    '*' + companyName + ' — AI Voice Update*',
    '──────────────────',
    '*Name:* ' + (leadPayload.name || 'Customer'),
    '*Call Outcome:* ' + (leadPayload.outcome || 'call_completed').replace(/_/g, ' '),
    '',
    (leadPayload.summary || '').slice(0, 300),
    '',
    leadPayload.appointmentDate ? '*Appointment:* ' + leadPayload.appointmentDate + ' at ' + (leadPayload.appointmentTime || '10:00') : '',
    '──────────────────',
    '_Sent by ' + companyName + ' AI Receptionist_',
  ].filter((l) => l !== '').join('\n');

  // Try Meta Cloud API first
  const metaToken   = config.metaToken || process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN || '';
  const metaPhoneId = config.metaPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';

  if (metaToken && metaPhoneId) {
    const result = await httpsPost('https://graph.facebook.com/v19.0/' + metaPhoneId + '/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientIntl,
      type: 'text',
      text: { preview_url: false, body: message },
    }, { Authorization: 'Bearer ' + metaToken });
    return result.ok ? { ok: true, via: 'meta_cloud' } : { ok: false, error: 'Meta API HTTP ' + result.status + ': ' + result.body.slice(0, 200) };
  }

  // Fallback: VoBiz WhatsApp Gateway
  const vobizId    = config.vobizAuthId    || process.env.VOBIZ_AUTH_ID    || '';
  const vobizToken = config.vobizAuthToken || process.env.VOBIZ_AUTH_TOKEN || '';
  if (vobizId && vobizToken) {
    const authHeader = 'Basic ' + Buffer.from(vobizId + ':' + vobizToken).toString('base64');
    const result = await httpsPost('https://api.vobiz.ai/api/v1/Account/' + encodeURIComponent(vobizId) + '/Message/', {
      src: '+91' + senderDigits,
      dst: '+' + recipientIntl,
      text: message,
      channel: 'whatsapp',
    }, { Authorization: authHeader, 'X-Auth-ID': vobizId, 'X-Auth-Token': vobizToken });
    return result.ok ? { ok: true, via: 'vobiz' } : { ok: false, error: 'VoBiz HTTP ' + result.status + ': ' + result.body.slice(0, 200) };
  }

  return { ok: false, error: 'WhatsApp: neither Meta Cloud API credentials nor VoBiz credentials configured' };
}

// ---------------------------------------------------------------------------
// 8. Razorpay Payment Link dispatcher
// ---------------------------------------------------------------------------

async function dispatchRazorpay(config, leadPayload) {
  if (!config || !config.keyId || !config.keySecret) return { ok: false, error: 'Razorpay Key ID and Key Secret are required' };

  const amountPaise = parseInt(config.amountPaise || 50000, 10);
  const currency    = config.currency || 'INR';
  const description = config.description || 'AI Voice Booking Deposit';
  const auth        = 'Basic ' + Buffer.from(config.keyId + ':' + config.keySecret).toString('base64');

  // Create Payment Link via Razorpay API
  const result = await httpsPost('https://api.razorpay.com/v1/payment_links', {
    amount: amountPaise,
    currency,
    description,
    customer: {
      name: leadPayload.name || 'Customer',
      contact: (leadPayload.phone || '').replace(/\D/g, '').replace(/^0+/, ''),
      email: leadPayload.callerEmail || '',
    },
    notify: { sms: true, email: Boolean(leadPayload.callerEmail) },
    reminder_enable: true,
    notes: {
      lead_source: 'Seevora AI Voice',
      call_outcome: leadPayload.outcome || '',
      ai_summary: (leadPayload.summary || '').slice(0, 200),
    },
    callback_url: config.callbackUrl || '',
    callback_method: 'get',
  }, { Authorization: auth });

  if (!result.ok) return { ok: false, error: 'Razorpay HTTP ' + result.status + ': ' + result.body.slice(0, 200) };

  let paymentLink = '';
  try { paymentLink = JSON.parse(result.body).short_url || ''; } catch (_) {}
  return { ok: true, paymentLink };
}

// ---------------------------------------------------------------------------
// testIntegration
// ---------------------------------------------------------------------------

async function testIntegration(db, mutate, tenantId, channel) {
  if (!CHANNELS.includes(channel)) return { ok: false, message: 'Unknown channel: ' + channel };
  const allConfig = getIntegrations(db, tenantId);
  const config    = allConfig[channel];
  const payload   = buildTestPayload();

  let result;
  try {
    if      (channel === 'googleCalendar') result = await dispatchGoogleCalendar(config, payload);
    else if (channel === 'googleSheets')   result = await dispatchGoogleSheets(config, payload);
    else if (channel === 'zohoCrm')        result = await dispatchZohoCrm(config, payload);
    else if (channel === 'hubspot')        result = await dispatchHubspot(config, payload);
    else if (channel === 'slack')          result = await dispatchSlack(config, payload);
    else if (channel === 'email')          result = await dispatchEmail(config, payload);
    else if (channel === 'whatsapp')       result = await dispatchWhatsApp(config, payload);
    else if (channel === 'razorpay')       result = await dispatchRazorpay(config, payload);
    else return { ok: false, message: 'No dispatcher for: ' + channel };
  } catch (e) {
    result = { ok: false, error: e.message };
  }

  // Persist status
  if (mutate) {
    await mutate((d) => {
      const cfg = ensureCrmIntegrations(d, tenantId);
      if (cfg && cfg[channel]) {
        cfg[channel].status    = result.ok ? 'connected' : 'error';
        cfg[channel].lastSyncAt = result.ok ? new Date().toISOString() : cfg[channel].lastSyncAt;
        cfg[channel].lastError  = result.ok ? null : (result.error || 'test failed').slice(0, 300);
      }
    }).catch(() => {});
  }

  return {
    ok: result.ok,
    message: result.ok
      ? channel + ' integration test successful.'
      : 'Test failed: ' + (result.error || 'unknown error'),
  };
}

// ---------------------------------------------------------------------------
// dispatchAll — runs ALL enabled dispatchers in parallel after call end
// ---------------------------------------------------------------------------

async function dispatchAll(db, mutate, tenantId, leadPayload) {
  const allConfig = getIntegrations(db, tenantId);
  const now       = new Date().toISOString();

  const tasks = CHANNELS
    .filter((ch) => allConfig[ch] && allConfig[ch].enabled)
    .map((ch) => {
      let dispatchPromise;
      if      (ch === 'googleCalendar') dispatchPromise = dispatchGoogleCalendar(allConfig[ch], leadPayload);
      else if (ch === 'googleSheets')   dispatchPromise = dispatchGoogleSheets(allConfig[ch], leadPayload);
      else if (ch === 'zohoCrm')        dispatchPromise = dispatchZohoCrm(allConfig[ch], leadPayload);
      else if (ch === 'hubspot')        dispatchPromise = dispatchHubspot(allConfig[ch], leadPayload);
      else if (ch === 'slack')          dispatchPromise = dispatchSlack(allConfig[ch], leadPayload);
      else if (ch === 'email')          dispatchPromise = dispatchEmail(allConfig[ch], leadPayload);
      else if (ch === 'whatsapp')       dispatchPromise = dispatchWhatsApp(allConfig[ch], leadPayload);
      else if (ch === 'razorpay')       dispatchPromise = dispatchRazorpay(allConfig[ch], leadPayload);
      else return null;

      return dispatchPromise
        .catch((e) => ({ ok: false, error: e.message }))
        .then((result) => ({ channel: ch, result }));
    })
    .filter(Boolean);

  if (!tasks.length) return [];

  const settled = await Promise.allSettled(tasks);

  // Update status in DB
  if (mutate) {
    await mutate((d) => {
      const cfg = ensureCrmIntegrations(d, tenantId);
      if (!cfg) return;
      settled.forEach((s) => {
        if (s.status !== 'fulfilled') return;
        const { channel, result } = s.value;
        if (!cfg[channel]) return;
        cfg[channel].lastSyncAt = now;
        cfg[channel].lastError  = result.ok ? null : (result.error || 'dispatch failed').slice(0, 300);
        if (result.ok)    cfg[channel].status = 'connected';
        if (!result.ok && cfg[channel].status === 'connected') cfg[channel].status = 'error';
      });
    }).catch(() => {});
  }

  return settled.map((s) => s.status === 'fulfilled' ? s.value : { channel: 'unknown', result: { ok: false } });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  CHANNELS,
  getIntegrations,
  saveIntegration,
  toggleIntegration,
  testIntegration,
  dispatchAll,
  // Individual dispatchers (usable directly from other server-side code)
  dispatchGoogleCalendar,
  dispatchGoogleSheets,
  dispatchZohoCrm,
  dispatchHubspot,
  dispatchSlack,
  dispatchEmail,
  dispatchWhatsApp,
  dispatchRazorpay,
};
