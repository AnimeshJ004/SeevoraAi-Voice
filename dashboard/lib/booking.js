/**
 * lib/booking.js - Native Slot Booking with Atomic Locking (Vaaad AI Clone)
 *
 * Production-grade appointment booking engine:
 *   - Availability computation from tenant schedule configs
 *   - Slot duration (15/30/45/60 min) with configurable buffer time
 *   - Maximum bookings per day ceiling & blocked dates enforcement
 *   - Atomic slot reservation with strict concurrency control (zero double bookings)
 *   - In-call conversational tools (check_availability & book_appointment)
 *   - Per-tenant per-agent booking isolation
 *   - Booking confirmation, reschedule, and cancellation
 *   - ICS calendar event generation for email attachments
 *   - Status: pending | confirmed | cancelled | no_show
 *
 * Zero external npm dependencies. Pure Node crypto/Date.
 */
'use strict';

const crypto = require('crypto');

// --- Constants -----------------------------------------------------------------

const SLOT_DURATION_MIN_DEFAULT = 30;
const SLOT_BUFFER_MIN_DEFAULT   = 10;    // 10 min gap between slots
const MAX_ADVANCE_DAYS          = 60;    // how far ahead to show slots
const MIN_ADVANCE_MIN           = 15;    // at least 15 min from now
const DEFAULT_TIMEZONE          = 'Asia/Kolkata';
const DEFAULT_MAX_BOOKINGS_DAY  = 16;
const BOOKING_STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'no_show']);
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// --- Helpers --------------------------------------------------------------------

function genBookingId()  { return 'bk_' + crypto.randomBytes(8).toString('hex'); }
function genScheduleId() { return 'bsched_' + crypto.randomBytes(6).toString('hex'); }

/** Format a Date as YYYY-MM-DD in UTC */
function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

/** Parse "HH:MM" into minutes since midnight */
function parseTime(timeStr) {
  const [h, m] = String(timeStr || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Pad n to 2 digits */
function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Generate all available slot start-times for a single day given a schedule.
 * Returns array of ISO strings (UTC).
 */
function generateDaySlots(dateStr, schedule, nowMs) {
  const dayOfWeek = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  const dayName   = DAY_NAMES[dayOfWeek];

  // Check if this day of week is enabled
  const availDays = schedule.availableDays || ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (!availDays.includes(dayName)) return [];

  // Check explicit date overrides (blocked dates)
  const blocked = schedule.blockedDates || [];
  if (blocked.includes(dateStr)) return [];

  const startMin = parseTime(schedule.startTime || '09:00');
  const endMin   = parseTime(schedule.endTime   || '18:00');
  const slotDur  = schedule.slotDurationMin     || SLOT_DURATION_MIN_DEFAULT;
  const slotBuf  = schedule.slotBufferMin !== undefined ? schedule.slotBufferMin : SLOT_BUFFER_MIN_DEFAULT;
  const step     = slotDur + slotBuf;

  const slots = [];
  for (let m = startMin; m + slotDur <= endMin; m += step) {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const iso = `${dateStr}T${pad2(hh)}:${pad2(mm)}:00.000Z`;
    const slotMs = new Date(iso).getTime();
    if (slotMs >= nowMs + MIN_ADVANCE_MIN * 60000) {
      slots.push({
        start: iso,
        end: new Date(slotMs + slotDur * 60000).toISOString(),
        durationMin: slotDur,
      });
    }
  }
  return slots;
}

// --- DB helpers ----------------------------------------------------------------

function ensureCollections(d) {
  if (!Array.isArray(d.bookingSchedules)) d.bookingSchedules = [];
  if (!Array.isArray(d.bookings))         d.bookings         = [];
}

// --- Schedule CRUD -------------------------------------------------------------

function defaultSchedule(tenantId, agentId, createdBy) {
  return {
    id: genScheduleId(),
    tenantId,
    agentId: agentId || null,
    label: 'Default Business Schedule',
    timezone: DEFAULT_TIMEZONE,
    availableDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '09:30',
    endTime:   '18:30',
    slotDurationMin: SLOT_DURATION_MIN_DEFAULT,
    slotBufferMin:   SLOT_BUFFER_MIN_DEFAULT,
    maxBookingsPerDay: DEFAULT_MAX_BOOKINGS_DAY,
    blockedDates: [],
    active: true,
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function upsertSchedule(db_mutate, tenantId, agentId, updates, userId, genId) {
  let schedule = null;
  await db_mutate((d) => {
    ensureCollections(d);
    let existing = d.bookingSchedules.find(
      (s) => s.tenantId === tenantId && s.agentId === (agentId || null)
    );
    if (!existing) {
      existing = defaultSchedule(tenantId, agentId, userId);
      d.bookingSchedules.push(existing);
    }
    const EDITABLE = [
      'label', 'timezone', 'availableDays', 'startTime', 'endTime',
      'slotDurationMin', 'slotBufferMin', 'maxBookingsPerDay', 'blockedDates', 'active',
    ];
    for (const k of EDITABLE) {
      if (updates[k] !== undefined) existing[k] = updates[k];
    }
    existing.updatedAt = new Date().toISOString();
    schedule = { ...existing };
  });
  return schedule;
}

function getSchedule(db, tenantId, agentId) {
  return (db.bookingSchedules || []).find(
    (s) => s.tenantId === tenantId && s.agentId === (agentId || null)
  ) || (db.bookingSchedules || []).find(
    (s) => s.tenantId === tenantId && s.agentId === null
  ) || null;
}

// --- Availability --------------------------------------------------------------

/**
 * Compute available slots for the next `days` days.
 * Removes already-booked (confirmed|pending) slots and enforces daily caps.
 */
function getAvailableSlots(db, tenantId, agentId, { days = 7, startDate } = {}) {
  let schedule = getSchedule(db, tenantId, agentId);
  if (!schedule) {
    // If no schedule yet, return default preview schedule
    schedule = defaultSchedule(tenantId, agentId, null);
  }

  const nowMs    = Date.now();
  const fromDate = startDate ? new Date(startDate) : new Date();
  const maxDate  = new Date(fromDate.getTime() + Math.min(days, MAX_ADVANCE_DAYS) * 86400000);

  // Group active bookings by day and start time
  const dayCounts = {};
  const bookedSlots = new Set();
  for (const b of (db.bookings || [])) {
    if (b.tenantId === tenantId && (!agentId || b.agentId === agentId) && ['pending', 'confirmed'].includes(b.status)) {
      bookedSlots.add(b.startTime);
      const day = b.startTime.slice(0, 10);
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
  }

  const maxPerDay = schedule.maxBookingsPerDay || DEFAULT_MAX_BOOKINGS_DAY;
  const slots = [];
  let cur = new Date(fromDate);
  cur.setUTCHours(0, 0, 0, 0);

  while (cur < maxDate) {
    const dateStr = toDateStr(cur);
    // Skip if day booking cap is already reached
    if ((dayCounts[dateStr] || 0) < maxPerDay) {
      const daySlots = generateDaySlots(dateStr, schedule, nowMs);
      for (const slot of daySlots) {
        if (!bookedSlots.has(slot.start)) {
          slots.push(slot);
        }
      }
    }
    cur = new Date(cur.getTime() + 86400000);
  }

  return {
    slots,
    schedule: {
      id: schedule.id,
      label: schedule.label,
      timezone: schedule.timezone || DEFAULT_TIMEZONE,
      slotDurationMin: schedule.slotDurationMin || SLOT_DURATION_MIN_DEFAULT,
      maxBookingsPerDay: maxPerDay,
    },
  };
}

// --- Reservation (Atomic with strict anti-double-booking) ---------------------

async function reserveSlot(db_mutate, db_read, tenantId, agentId, {
  startTime, callerName, callerPhone, callerEmail,
  notes, source, metadata, createdBy,
}) {
  const start = new Date(startTime);
  if (isNaN(start.getTime())) {
    return { ok: false, error: 'startTime must be a valid ISO 8601 datetime', code: 'bad_start' };
  }

  if (start.getTime() < Date.now() + MIN_ADVANCE_MIN * 60000) {
    return { ok: false, error: `Booking must be at least ${MIN_ADVANCE_MIN} minutes in the future`, code: 'too_soon' };
  }

  if (!callerPhone) {
    return { ok: false, error: 'callerPhone is required to confirm an appointment', code: 'missing_phone' };
  }

  let schedule = getSchedule(db_read, tenantId, agentId);
  if (!schedule) {
    schedule = defaultSchedule(tenantId, agentId, createdBy);
  }

  const slotDur  = schedule.slotDurationMin || SLOT_DURATION_MIN_DEFAULT;
  const endTime  = new Date(start.getTime() + slotDur * 60000).toISOString();
  const startIso = start.toISOString();
  const dateStr  = startIso.slice(0, 10);

  let booking = null;
  let conflictError = null;

  // ATOMIC SECTION: Executes inside serial write lock via core.mutate
  await db_mutate((d) => {
    ensureCollections(d);

    // 1. Strict Double-Booking Guard
    const conflict = d.bookings.find(
      (b) => b.tenantId === tenantId
          && (!agentId || b.agentId === agentId)
          && b.startTime === startIso
          && ['pending', 'confirmed'].includes(b.status)
    );
    if (conflict) {
      conflictError = {
        ok: false,
        error: 'This appointment slot was just taken. Please choose another open time.',
        code: 'slot_taken',
        conflictId: conflict.id,
      };
      return;
    }

    // 2. Daily capacity ceiling guard
    const maxPerDay = schedule.maxBookingsPerDay || DEFAULT_MAX_BOOKINGS_DAY;
    const bookedOnDate = d.bookings.filter(
      (b) => b.tenantId === tenantId
          && (!agentId || b.agentId === agentId)
          && b.startTime.startsWith(dateStr)
          && ['pending', 'confirmed'].includes(b.status)
    ).length;

    if (bookedOnDate >= maxPerDay) {
      conflictError = {
        ok: false,
        error: `Daily appointment capacity of ${maxPerDay} bookings reached for ${dateStr}. Please select another date.`,
        code: 'day_full',
      };
      return;
    }

    const now = new Date().toISOString();
    booking = {
      id: genBookingId(),
      tenantId,
      agentId: agentId || null,
      scheduleId: schedule.id,
      startTime: startIso,
      endTime,
      durationMin: slotDur,
      callerName:  String(callerName  || '').trim().slice(0, 120),
      callerPhone: String(callerPhone || '').trim().slice(0, 40),
      callerEmail: String(callerEmail || '').trim().toLowerCase().slice(0, 200),
      notes:    String(notes    || '').trim().slice(0, 2000),
      source:   String(source   || 'manual').slice(0, 80),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      status: 'confirmed',
      confirmationCode: 'BK-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    };
    d.bookings.push(booking);
  });

  if (conflictError) return conflictError;
  return { ok: true, booking: publicBooking(booking) };
}

// --- In-Call / Chat Tools for Live Voice Agents --------------------------------

function checkAvailabilityTool(db, tenantId, agentId, { days = 3 } = {}) {
  const result = getAvailableSlots(db, tenantId, agentId, { days });
  if (!result.slots || !result.slots.length) {
    return 'Currently there are no open slots in the next 3 days. Would you like me to request our team to reach out to you directly?';
  }
  const sample = result.slots.slice(0, 4).map((s) => {
    const d = new Date(s.start);
    const dateFormatted = d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
    const timeFormatted = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    return `${dateFormatted} at ${timeFormatted}`;
  });
  return `We have open appointment slots on: ${sample.join(', ')}. Which time suits you best?`;
}

async function bookAppointmentTool(db_mutate, db_read, tenantId, agentId, params) {
  const res = await reserveSlot(db_mutate, db_read, tenantId, agentId, {
    ...params,
    source: 'in_call_voice_agent',
  });
  if (!res.ok) {
    return `I apologize, but ${res.error}. Would you like to try another time?`;
  }
  const d = new Date(res.booking.startTime);
  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const dateStr = d.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
  return `Haanji! Your appointment has been confirmed for ${dateStr} at ${timeStr}. Your confirmation code is ${res.booking.confirmationCode}. We look forward to speaking with you!`;
}

// --- Booking Management & Status -----------------------------------------------

function publicBooking(b) {
  return {
    id: b.id,
    tenantId: b.tenantId,
    agentId: b.agentId,
    startTime: b.startTime,
    endTime: b.endTime,
    durationMin: b.durationMin,
    callerName: b.callerName,
    callerPhone: b.callerPhone,
    callerEmail: b.callerEmail,
    notes: b.notes,
    source: b.source,
    status: b.status,
    confirmationCode: b.confirmationCode,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function listBookings(db, tenantId, agentId, { page = 1, pageSize = 50, status, from, to } = {}) {
  let bookings = (db.bookings || []).filter(
    (b) => b.tenantId === tenantId && (!agentId || b.agentId === agentId)
  );
  if (status) bookings = bookings.filter((b) => b.status === status);
  if (from)   bookings = bookings.filter((b) => b.startTime >= from);
  if (to)     bookings = bookings.filter((b) => b.startTime <= to);
  bookings = bookings.slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
  const total = bookings.length;
  const start = (page - 1) * pageSize;
  return { bookings: bookings.slice(start, start + pageSize).map(publicBooking), total, page, pageSize };
}

async function updateBookingStatus(db_mutate, tenantId, bookingId, status, notes) {
  if (!BOOKING_STATUSES.has(status)) {
    return { ok: false, error: 'Invalid status. Must be one of: ' + [...BOOKING_STATUSES].join(', ') };
  }

  let updated = null;
  await db_mutate((d) => {
    ensureCollections(d);
    const bk = (d.bookings || []).find((b) => b.id === bookingId && b.tenantId === tenantId);
    if (!bk) return;
    bk.status = status;
    if (notes) bk.notes = (bk.notes ? bk.notes + '\n' : '') + String(notes).slice(0, 500);
    bk.updatedAt = new Date().toISOString();
    updated = { ...bk };
  });

  if (!updated) return { ok: false, error: 'Booking not found', code: 'not_found' };
  return { ok: true, booking: publicBooking(updated) };
}

async function rescheduleBooking(db_mutate, db_read, tenantId, bookingId, newStartTime) {
  const existing = (db_read.bookings || []).find((b) => b.id === bookingId && b.tenantId === tenantId);
  if (!existing) return { ok: false, error: 'Booking not found', code: 'not_found' };
  if (existing.status === 'cancelled') return { ok: false, error: 'Cannot reschedule a cancelled booking', code: 'already_cancelled' };

  // Cancel old booking
  const cancelResult = await updateBookingStatus(db_mutate, tenantId, bookingId, 'cancelled', 'Rescheduled by user');
  if (!cancelResult.ok) return cancelResult;

  // Reserve new booking
  return reserveSlot(db_mutate, db_read, tenantId, existing.agentId, {
    startTime: newStartTime,
    callerName: existing.callerName,
    callerPhone: existing.callerPhone,
    callerEmail: existing.callerEmail,
    notes: existing.notes,
    source: 'reschedule',
    metadata: existing.metadata,
    createdBy: existing.createdBy,
  });
}

function generateICS(booking, agentName, organizerEmail) {
  const dtStart = booking.startTime.replace(/[-:]/g, '').replace('.000', '');
  const dtEnd   = booking.endTime.replace(/[-:]/g, '').replace('.000', '');
  const now     = new Date().toISOString().replace(/[-:]/g, '').replace('.000', '');
  const uid     = `${booking.id}@seevora.ai`;
  const summary = `Appointment with ${agentName || 'Seevora AI Assistant'}`;
  const desc    = `Confirmation Code: ${booking.confirmationCode}\\nPhone: ${booking.callerPhone}\\nNotes: ${(booking.notes || '').replace(/\n/g, '\\n')}`;
  const organizer = organizerEmail ? `ORGANIZER;CN=${agentName || 'Seevora'}:mailto:${organizerEmail}\r\n` : '';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Seevora AI//Booking Engine//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    organizer.trim(),
    `ATTENDEE;CN=${booking.callerName || 'Guest'}:mailto:${booking.callerEmail || 'guest@example.com'}`,
    `STATUS:CONFIRMED`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

module.exports = {
  upsertSchedule,
  getSchedule,
  getAvailableSlots,
  reserveSlot,
  publicBooking,
  listBookings,
  updateBookingStatus,
  rescheduleBooking,
  checkAvailabilityTool,
  bookAppointmentTool,
  generateICS,
  ensureCollections,
  defaultSchedule,
  SLOT_DURATION_MIN_DEFAULT,
  MAX_ADVANCE_DAYS,
};
