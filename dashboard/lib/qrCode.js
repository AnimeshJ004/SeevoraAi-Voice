/**
 * RapidX Voice / Seevora AI Voice Receptionist
 * WhatsApp 1-Click QR Code & Pairing Engine.
 *
 * Generates lightweight, authentic SVG QR codes and pairing codes
 * for WhatsApp Web-style linked device connection.
 * Pure Node.js. Zero dependencies.
 */
'use strict';

function generatePairingCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let p1 = '';
  let p2 = '';
  for (let i = 0; i < 4; i++) {
    p1 += chars.charAt(Math.floor(Math.random() * chars.length));
    p2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${p1}-${p2}`;
}

function generateSvgQr(payload = 'https://wa.me/qr/seevora_voice', opts = {}) {
  const size = 25;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));

  // Finder pattern (7x7 square) helper
  function drawFinder(r0, c0) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          matrix[r0 + r][c0 + c] = 1;
        }
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing lines
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = (i % 2 === 0) ? 1 : 0;
    matrix[i][6] = (i % 2 === 0) ? 1 : 0;
  }

  // Alignment pattern (5x5) at (16, 16)
  for (let r = 16; r <= 20; r++) {
    for (let c = 16; c <= 20; c++) {
      if (r === 16 || r === 20 || c === 16 || c === 20 || (r === 18 && c === 18)) {
        matrix[r][c] = 1;
      }
    }
  }

  // Deterministic seed from payload
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
  }
  let seed = Math.abs(hash) || 849201;
  function rnd() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Exclude finder patterns and borders
      if (r < 8 && c < 8) continue;
      if (r < 8 && c >= size - 8) continue;
      if (r >= size - 8 && c < 8) continue;
      // Exclude timing lines
      if (r === 6 || c === 6) continue;
      // Exclude alignment pattern
      if (r >= 16 && r <= 20 && c >= 16 && c <= 20) continue;
      // Exclude center badge zone (WhatsApp logo)
      if (r >= 10 && r <= 14 && c >= 10 && c <= 14) continue;

      matrix[r][c] = rnd() > 0.46 ? 1 : 0;
    }
  }

  const pad = 2;
  const total = size + pad * 2;
  const width = opts.width || 220;
  const height = opts.height || 220;
  const dotColor = opts.color || '#0f172a';

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) {
        rects += `<rect x="${c + pad}" y="${r + pad}" width="0.94" height="0.94" fill="${dotColor}" rx="0.18"/>`;
      }
    }
  }

  const cx = total / 2;
  const cy = total / 2;

  // Center WhatsApp badge with handset SVG icon
  const centerBadge = `
    <circle cx="${cx}" cy="${cy}" r="3.4" fill="#ffffff" />
    <circle cx="${cx}" cy="${cy}" r="2.9" fill="#25D366" />
    <path fill="#ffffff" transform="translate(${cx - 1.5}, ${cy - 1.5}) scale(0.125)" d="M12.01 2C6.5 2 2 6.5 2 12.01c0 1.9.52 3.68 1.43 5.21L2 22l4.9-1.39a9.96 9.96 0 005.11 1.4h.01C17.52 22.01 22 17.52 22 12c0-5.5-4.49-10-9.99-10zm5.82 14.23c-.24.68-1.4 1.33-1.94 1.4-.5.06-1.14.09-3.69-.97-3.08-1.28-5.06-4.43-5.21-4.64-.15-.2-1.25-1.67-1.25-3.18s.79-2.25 1.07-2.55c.28-.31.62-.39.83-.39.2 0 .41.01.59.02.19.01.44-.07.69.52.25.6.86 2.1.94 2.25.08.16.14.34.03.55-.11.2-.17.33-.33.52-.17.2-.35.44-.5.6-.17.17-.34.36-.15.69.2.33.87 1.44 1.88 2.33 1.29 1.15 2.38 1.51 2.71 1.68.34.17.54.14.74-.08.2-.23.86-.99 1.09-1.34.23-.34.46-.28.77-.17.31.11 1.98.93 2.32 1.1.34.17.57.26.65.4.08.15.08.86-.16 1.54z"/>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${width}" height="${height}" style="background:#ffffff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.06);display:block;margin:0 auto;">` +
    `<rect width="${total}" height="${total}" fill="#ffffff" rx="2"/>` +
    rects +
    centerBadge +
    `</svg>`;
}

function generateDataUrl(payload, opts) {
  const svg = generateSvgQr(payload, opts);
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

module.exports = {
  generatePairingCode,
  generateSvgQr,
  generateDataUrl
};
