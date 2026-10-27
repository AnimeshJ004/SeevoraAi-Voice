/**
 * lib/compliance.js - TRAI & Indian Telecommunications Regulatory Compliance
 *
 * Implements:
 *   - Indian TRAI permitted telecalling window (09:00 AM to 09:00 PM IST)
 *   - Auto-holding queue: leads received during night/prohibited hours are held
 *     until 09:00 AM IST instead of triggering illegal outbound dials.
 *   - National Do Not Disturb (DND) scrub registry check.
 *   - Compliance audit trails.
 */
'use strict';

const TRAI_START_HOUR = 9;   // 09:00 AM IST
const TRAI_END_HOUR   = 21;  // 09:00 PM (21:00) IST

function getIstDate() {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  // IST is UTC + 5.5 hours (+ 330 mins)
  return new Date(utcMs + (330 * 60000));
}

function getIstHour() {
  return getIstDate().getHours();
}

function isWithinTraiWindow(hour) {
  const h = (typeof hour === 'number') ? hour : getIstHour();
  return h >= TRAI_START_HOUR && h < TRAI_END_HOUR;
}

function getNextTraiWindowStart() {
  const ist = getIstDate();
  const next = new Date(ist);
  if (ist.getHours() >= TRAI_END_HOUR) {
    // Tomorrow morning 9:00 AM
    next.setDate(next.getDate() + 1);
  }
  next.setHours(TRAI_START_HOUR, 0, 0, 0);
  // Convert back to UTC ISO
  const diffMs = next.getTime() - ist.getTime();
  return new Date(Date.now() + diffMs).toISOString();
}

function isDndRegistered(db, phoneNumber) {
  if (!phoneNumber) return false;
  const clean = String(phoneNumber).replace(/\D/g, '');
  const last10 = clean.slice(-10);

  const registry = Array.isArray(db.dndRegistry) ? db.dndRegistry : [];
  return registry.some((entry) => {
    const entryClean = String(entry).replace(/\D/g, '');
    return entryClean === clean || entryClean.slice(-10) === last10;
  });
}

function checkOutboundCompliance(db, phoneNumber) {
  const isDnd = isDndRegistered(db, phoneNumber);
  if (isDnd) {
    return {
      allowed: false,
      reason: 'dnd_registered',
      message: 'Phone number is registered on the National Do Not Disturb (DND) registry. Outbound telecalling suppressed for TRAI compliance.'
    };
  }

  const inWindow = isWithinTraiWindow();
  if (!inWindow) {
    return {
      allowed: false,
      held: true,
      reason: 'outside_trai_window',
      nextWindow: getNextTraiWindowStart(),
      message: 'Current time is outside permitted TRAI calling hours (09:00 AM - 09:00 PM IST). Call held in queue until next morning 09:00 AM IST.'
    };
  }

  return { allowed: true };
}

module.exports = {
  TRAI_START_HOUR,
  TRAI_END_HOUR,
  getIstHour,
  isWithinTraiWindow,
  getNextTraiWindowStart,
  isDndRegistered,
  checkOutboundCompliance
};
