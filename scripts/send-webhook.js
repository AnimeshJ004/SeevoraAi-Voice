/**
 * Seevora AI - Send Webhook Tester
 * Sends a real HTTP POST request to the local server's WhatsApp webhook.
 *
 * Usage:
 *   node scripts/send-webhook.js interested
 *   node scripts/send-webhook.js "not interested"
 *   node scripts/send-webhook.js hi
 *   node scripts/send-webhook.js "custom message"
 */
'use strict';

const http = require('http');

const type = (process.argv[2] || 'interested').toLowerCase();
const phone = process.argv[3] || '919876543210';
const name = process.argv[4] || 'Vikas Patel';

let messageBody = '';
if (type === 'interested' || type === 'call') {
  messageBody = 'I am interested in voice AI, please call me for demo';
} else if (type === 'not_interested' || type === 'not interested' || type === 'no') {
  messageBody = 'I am not interested, please do not call';
} else if (type === 'hi' || type === 'hello') {
  messageBody = 'Hi';
} else if (type === 'busy' || type === 'whatsapp') {
  messageBody = 'Busy right now, please text only on whatsapp';
} else {
  messageBody = process.argv[2];
}

const payload = {
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: phone,
          type: 'text',
          text: { body: messageBody }
        }],
        contacts: [{
          wa_id: phone,
          profile: { name: name }
        }]
      }
    }]
  }]
};

const data = JSON.stringify(payload);

const options = {
  hostname: 'localhost',
  port: 8787,
  path: '/api/whatsapp/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

console.log(`Sending WhatsApp webhook to http://localhost:8787/api/whatsapp/webhook ...`);
console.log(`From:    ${name} (${phone})`);
console.log(`Message: "${messageBody}"\n`);

const req = http.request(options, (res) => {
  let resData = '';
  res.on('data', (chunk) => { resData += chunk; });
  res.on('end', () => {
    console.log(`Response Status: ${res.statusCode} ${res.statusMessage}`);
    try {
      console.log('Response Body:  ', JSON.stringify(JSON.parse(resData), null, 2));
    } catch (_) {
      console.log('Response Body:  ', resData);
    }
    console.log('\nCheck your terminal where "node server.js" is running or open http://localhost:8787/#contacts to see the updated lead!');
  });
});

req.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.error('ERROR: Could not connect to localhost:8787. Make sure your server is running!');
    console.error('Run: "cd dashboard && node server.js" in another terminal first.');
  } else {
    console.error('Request error:', err.message);
  }
});

req.write(data);
req.end();

