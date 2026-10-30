/**
 * Pure Node.js SMTP Mailer for Seevora Voice AI
 * Zero external dependencies. Uses Node core tls and net modules.
 * Connects directly to Gmail SMTP (smtp.gmail.com:465) or custom SMTP servers.
 */
'use strict';

const tls = require('tls');
const net = require('net');
const crypto = require('crypto');

function encodeSubject(subject) {
  return '=?UTF-8?B?' + Buffer.from(subject || '', 'utf8').toString('base64') + '?=';
}

function buildRfc2822Message({ from, to, subject, text, html }) {
  const boundary = '----=_Part_' + crypto.randomBytes(8).toString('hex');
  const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@seevora.ai>`;
  const dateStr = new Date().toUTCString();

  const headers = [
    `From: Seevora Voice AI <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${dateStr}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
  ];

  if (html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const bodyParts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text || '', 'utf8').toString('base64'),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html, 'utf8').toString('base64'),
      '',
      `--${boundary}--`
    ];
    return headers.join('\r\n') + '\r\n\r\n' + bodyParts.join('\r\n') + '\r\n';
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: base64');
    return headers.join('\r\n') + '\r\n\r\n' + Buffer.from(text || '', 'utf8').toString('base64') + '\r\n';
  }
}

/**
 * Send an email via SMTP (SSL on port 465 or STARTTLS on port 587)
 */
function sendMail(opts = {}) {
  const host = opts.host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(opts.port || process.env.SMTP_PORT || '465', 10);
  const user = opts.user || opts.from || process.env.GMAIL_USER || process.env.SMTP_USER || process.env.DOGRAH_EMAIL || 'seevorapvtltd@gmail.com';
  const rawPass = opts.pass || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '';
  const pass = String(rawPass).replace(/\s+/g, ''); // strip spaces from Google app passwords
  const to = opts.to;
  const from = opts.from || user;
  const subject = opts.subject || 'Update from Seevora Voice AI';
  const text = opts.text || opts.body || '';
  const html = opts.html || null;

  if (!to) {
    return Promise.reject(new Error('Recipient email (to) is required.'));
  }
  if (!pass) {
    return Promise.reject(new Error('Gmail App Password or SMTP password is not configured.'));
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    let step = 0;
    const conversationLog = [];

    const socket = tls.connect(port, host, {
      rejectUnauthorized: false
    }, () => {
      conversationLog.push(`[CONNECTED] ${host}:${port}`);
    });

    socket.setTimeout(15000, () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`SMTP connection timed out after 15s (${host}:${port})`));
      }
    });

    const rawMessage = buildRfc2822Message({ from, to, subject, text, html });

    socket.on('data', (data) => {
      const chunk = data.toString();
      conversationLog.push('S: ' + chunk.trim());
      const lines = chunk.split('\r\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';
      const code = lastLine.slice(0, 3);

      // Handle multiline replies (e.g. 250-SIZE, 250 OK)
      const isComplete = lastLine.length >= 4 && lastLine.charAt(3) === ' ';

      if (code === '220' && isComplete) {
        socket.write(`EHLO seevora.ai\r\n`);
      } else if (code === '250' && isComplete && step === 0) {
        step = 1;
        socket.write('AUTH LOGIN\r\n');
      } else if (code === '334' && isComplete && step === 1) {
        step = 2; // Username prompt
        socket.write(Buffer.from(user).toString('base64') + '\r\n');
      } else if (code === '334' && isComplete && step === 2) {
        step = 3; // Password prompt
        socket.write(Buffer.from(pass).toString('base64') + '\r\n');
      } else if (code === '235' && isComplete && step === 3) {
        step = 4; // Authenticated
        socket.write(`MAIL FROM:<${from}>\r\n`);
      } else if (code === '250' && isComplete && step === 4) {
        step = 5;
        socket.write(`RCPT TO:<${to}>\r\n`);
      } else if (code === '250' && isComplete && step === 5) {
        step = 6;
        socket.write('DATA\r\n');
      } else if (code === '354' && isComplete && step === 6) {
        step = 7;
        socket.write(rawMessage + '\r\n.\r\n');
      } else if (code === '250' && isComplete && step === 7) {
        step = 8;
        if (!resolved) {
          resolved = true;
          socket.write('QUIT\r\n');
          resolve({
            success: true,
            messageId: lastLine,
            host,
            port,
            from,
            to,
            subject,
            deliveredAt: new Date().toISOString()
          });
        }
      } else if (code === '221') {
        socket.end();
      } else if ((code.startsWith('4') || code.startsWith('5')) && isComplete) {
        if (!resolved) {
          resolved = true;
          socket.write('QUIT\r\n');
          const isAuthErr = code === '535' || chunk.includes('BadCredentials') || chunk.includes('Username and Password not accepted');
          const cleanMsg = isAuthErr
            ? 'Gmail rejected login credentials. A 16-character Google App Password is required.'
            : chunk.trim();
          const err = new Error(cleanMsg);
          err.code = code;
          err.isAuthError = isAuthErr;
          err.smtpLog = conversationLog;
          reject(err);
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    socket.on('end', () => {
      if (!resolved) {
        resolved = true;
        reject(new Error('SMTP socket closed prematurely by server.'));
      }
    });
  });
}

/**
 * Verify SMTP credentials with a handshake + AUTH check without sending email
 */
function verifySmtp(opts = {}) {
  const host = opts.host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(opts.port || process.env.SMTP_PORT || '465', 10);
  const user = opts.user || opts.from || process.env.GMAIL_USER || process.env.SMTP_USER || process.env.DOGRAH_EMAIL || 'seevorapvtltd@gmail.com';
  const rawPass = opts.pass || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '';
  const pass = String(rawPass).replace(/\s+/g, '');

  if (!pass) {
    return Promise.resolve({ ok: false, error: 'App Password is empty' });
  }

  return new Promise((resolve) => {
    let step = 0;
    const socket = tls.connect(port, host, { rejectUnauthorized: false }, () => {});

    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve({ ok: false, error: 'Connection timed out' });
    });

    socket.on('data', (d) => {
      const chunk = d.toString();
      const lines = chunk.split('\r\n').filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';
      const code = lastLine.slice(0, 3);
      const isComplete = lastLine.length >= 4 && lastLine.charAt(3) === ' ';

      if (code === '220' && isComplete) {
        socket.write('EHLO seevora.ai\r\n');
      } else if (code === '250' && isComplete && step === 0) {
        step = 1;
        socket.write('AUTH LOGIN\r\n');
      } else if (code === '334' && isComplete && step === 1) {
        step = 2;
        socket.write(Buffer.from(user).toString('base64') + '\r\n');
      } else if (code === '334' && isComplete && step === 2) {
        step = 3;
        socket.write(Buffer.from(pass).toString('base64') + '\r\n');
      } else if (code === '235' && isComplete) {
        socket.end('QUIT\r\n');
        resolve({ ok: true, user, host });
      } else if (code.startsWith('5') || code.startsWith('4')) {
        socket.end('QUIT\r\n');
        resolve({
          ok: false,
          code,
          error: code === '535' ? 'Invalid Gmail App Password. Please check the 16-character code.' : chunk.trim()
        });
      }
    });

    socket.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

module.exports = {
  sendMail,
  verifySmtp
};
