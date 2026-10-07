/**
 * Seevora AI - Batch Outbound Lead Dialer
 * 
 * Automatically dials a list of phone numbers one by one using
 * Seevora AI Voice Receptionist on VoBiz telephony.
 * 
 * Usage:
 *   node scripts/batch-outbound-dialer.js leads.csv
 *   node scripts/batch-outbound-dialer.js leads.csv --delay 45
 *   node scripts/batch-outbound-dialer.js leads.csv --dry-run
 */

'use strict';

const fs = require('fs');
const path = require('path');

// 1. Load environment variables from .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const API_KEY = env.DOGRAH_API_KEY;
const BASE_URL = (env.DOGRAH_BASE_URL || 'https://app.dograh.com').replace(/\/$/, '');
const WORKFLOW_ID = parseInt(env.DOGRAH_WORKFLOW_ID || '13027', 10);
const TELEPHONY_CONFIG_ID = parseInt(env.DOGRAH_TELEPHONY_CONFIG_ID || '4325', 10);
const FROM_PHONE_ID = parseInt(env.DOGRAH_PHONE_NUMBER_ID || '1810', 10);
const CALLER_NUMBER = env.VOBIZ_NUMBER || '+918071582519';

if (!API_KEY) {
  console.error('\x1b[31mError: DOGRAH_API_KEY is missing from .env\x1b[0m');
  process.exit(1);
}

// 2. Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const delayIdx = args.indexOf('--delay');
const delaySeconds = delayIdx !== -1 && args[delayIdx + 1] ? parseInt(args[delayIdx + 1], 10) : 45;

const fileArg = args.find(a => !a.startsWith('--') && a !== String(delaySeconds));

if (!fileArg) {
  console.log(`
\x1b[1m\x1b[36m=== Seevora AI - Batch Outbound Dialer ===\x1b[0m

Usage:
  node scripts/batch-outbound-dialer.js <file_path> [--delay <seconds>] [--dry-run]

Examples:
  node scripts/batch-outbound-dialer.js leads.csv
  node scripts/batch-outbound-dialer.js leads.txt --delay 60
  node scripts/batch-outbound-dialer.js leads.csv --dry-run

File Formats Supported:
  1. CSV file (with "phone" or "number" column, optional "name" column)
  2. TXT file (one phone number per line)
`);
  process.exit(0);
}

// 3. Normalize phone number to +91XXXXXXXXXX
function normalizeNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length > 10 && digits.startsWith('0')) return '+91' + digits.slice(1);
  return null;
}

// 4. Read Leads from file
function parseLeads(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\x1b[31mFile not found: ${filePath}\x1b[0m`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const leads = [];

  if (filePath.endsWith('.csv')) {
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    let phoneIdx = header.findIndex(h => h.includes('phone') || h.includes('number') || h.includes('mobile'));
    if (phoneIdx === -1) phoneIdx = 0; // default to first column
    const nameIdx = header.findIndex(h => h.includes('name'));

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
      const rawNum = parts[phoneIdx];
      const validNum = normalizeNumber(rawNum);
      if (validNum) {
        leads.push({
          name: nameIdx !== -1 && parts[nameIdx] ? parts[nameIdx] : `Lead #${i}`,
          phone: validNum,
          raw: lines[i]
        });
      }
    }
  } else {
    // Plain text: one number per line
    lines.forEach((line, idx) => {
      const validNum = normalizeNumber(line);
      if (validNum) {
        leads.push({
          name: `Lead #${idx + 1}`,
          phone: validNum,
          raw: line
        });
      }
    });
  }

  return leads;
}

// 5. Dial a single number via Dograh
async function placeCall(lead) {
  const url = `${BASE_URL}/api/v1/telephony/initiate-call`;
  const payload = {
    workflow_id: WORKFLOW_ID,
    telephony_configuration_id: TELEPHONY_CONFIG_ID,
    from_phone_number_id: FROM_PHONE_ID,
    phone_number: lead.phone,
    context_variables: {
      lead_name: lead.name,
      campaign_source: 'seevora_batch_dialer'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body };
}

// 6. Sleep helper
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// 7. Main Runner
async function main() {
  const leads = parseLeads(fileArg);

  console.log('\n\x1b[1m\x1b[32m====================================================\x1b[0m');
  console.log(`\x1b[1m📞 Seevora AI - Batch Outbound Dialer\x1b[0m`);
  console.log(`\x1b[32m====================================================\x1b[0m`);
  console.log(`Caller ID (From):    \x1b[33m${CALLER_NUMBER}\x1b[0m`);
  console.log(`Agent Workflow:      \x1b[33mSeevora AI Voice Receptionist (ID: ${WORKFLOW_ID})\x1b[0m`);
  console.log(`Total Leads Found:   \x1b[36m${leads.length}\x1b[0m`);
  console.log(`Interval Between Calls: \x1b[36m${delaySeconds} seconds\x1b[0m`);
  if (isDryRun) {
    console.log(`Mode:                \x1b[35m[DRY RUN - No real calls will be placed]\x1b[0m`);
  }
  console.log(`----------------------------------------------------\n`);

  if (leads.length === 0) {
    console.log('No valid 10-digit Indian phone numbers found in file.');
    return;
  }

  const results = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const indexStr = `[${i + 1}/${leads.length}]`;

    console.log(`\x1b[1m${indexStr} Dialing ${lead.name} (${lead.phone})...\x1b[0m`);

    if (isDryRun) {
      console.log(`   \x1b[35m[DRY RUN]\x1b[0m Would dial ${lead.phone} via ${CALLER_NUMBER}\n`);
      results.push({ lead, status: 'dry_run_success', timestamp: new Date().toISOString() });
      continue;
    }

    try {
      const result = await placeCall(lead);
      if (result.ok) {
        console.log(`   \x1b[32m✔ CALL PLACED SUCCESSFULLY!\x1b[0m (Call Run ID: ${result.data.workflow_run_id || result.data.id || 'ok'})`);
        results.push({ lead, status: 'initiated', data: result.data, timestamp: new Date().toISOString() });
      } else {
        console.log(`   \x1b[31m✖ CALL FAILED (${result.status}):\x1b[0m ${JSON.stringify(result.data.detail || result.data)}`);
        results.push({ lead, status: 'failed', error: result.data, timestamp: new Date().toISOString() });
      }
    } catch (err) {
      console.log(`   \x1b[31m✖ Network/Server Error:\x1b[0m ${err.message}`);
      results.push({ lead, status: 'error', error: err.message, timestamp: new Date().toISOString() });
    }

    // Wait before next call if not the last lead
    if (i < leads.length - 1) {
      console.log(`   ⏳ Waiting ${delaySeconds}s before dialing next lead...\n`);
      await sleep(delaySeconds * 1000);
    }
  }

  // Save report
  const logFile = path.resolve(__dirname, '..', 'outbound-dial-report.json');
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n\x1b[32m✔ Completed! Detailed call log saved to: ${logFile}\x1b[0m\n`);
}

main().catch(console.error);
