/**
 * lib/analytics.js - Vaaad AI Speech & Telephony Analytics Engine
 *
 * Implements platform and tenant-level telecalling analytics:
 *   - ASR (Answer Seizure Ratio % = connected / dialed)
 *   - ACD (Average Call Duration in seconds)
 *   - Lead-to-Booking Conversion Rate %
 *   - Sentiment Distribution (positive, neutral, negative)
 *   - Wholesale vs Retail Profit Margins (INR)
 *   - Hourly traffic distribution
 */
'use strict';

function getTenantAnalytics(db, tenantId) {
  const calls = (db.calls || []).filter((c) => c.tenantId === tenantId);
  const totalCalls = calls.length;
  const connectedCalls = calls.filter((c) => c.durationSec && c.durationSec > 0);
  const totalConnected = connectedCalls.length;

  const asrPercent = totalCalls > 0 ? Math.round((totalConnected / totalCalls) * 1000) / 10 : 0;
  const totalDurationSec = connectedCalls.reduce((sum, c) => sum + (c.durationSec || 0), 0);
  const acdSeconds = totalConnected > 0 ? Math.round(totalDurationSec / totalConnected) : 0;

  // Sentiment Breakdown
  let positive = 0, neutral = 0, negative = 0;
  for (const c of calls) {
    const s = String(c.sentiment || '').toLowerCase();
    if (s === 'positive') positive++;
    else if (s === 'negative') negative++;
    else neutral++;
  }

  // Bookings / Conversions
  const bookings = (db.bookings || []).filter((b) => b.tenantId === tenantId && b.status !== 'cancelled');
  const conversionRate = totalCalls > 0 ? Math.round((bookings.length / totalCalls) * 1000) / 10 : 0;

  // Financials
  const totalCostPaise = calls.reduce((sum, c) => sum + (c.costPaise || 0), 0);
  const totalSpendInr = Math.round((totalCostPaise / 100) * 100) / 100;

  return {
    totalCalls,
    connectedCalls: totalConnected,
    failedCalls: totalCalls - totalConnected,
    asrPercent,
    totalDurationSeconds: totalDurationSec,
    totalDurationMinutes: Math.round((totalDurationSec / 60) * 10) / 10,
    acdSeconds,
    conversionRate,
    totalBookings: bookings.length,
    totalSpendInr,
    sentiment: {
      positive,
      neutral,
      negative,
      positivePercent: totalCalls > 0 ? Math.round((positive / totalCalls) * 100) : 0
    }
  };
}

function getSuperAdminMargins(db) {
  const calls = db.calls || [];
  let totalBilledPaise = 0;
  let totalMinutes = 0;

  for (const c of calls) {
    const durSec = c.durationSec || 0;
    if (durSec > 0) {
      const mins = Math.ceil(durSec / 60);
      totalMinutes += mins;
      totalBilledPaise += (c.costPaise || mins * 500); // Rs 5.00/min
    }
  }

  const retailRevenueInr = totalBilledPaise / 100;
  // Wholesale COGS: Rs 1.80 carrier + 0.35 STT + 0.50 TTS + 0.30 LLM + 0.05 storage = Rs 3.00/min
  const wholesaleCogsInr = totalMinutes * 3.00;
  const grossProfitInr = Math.max(0, retailRevenueInr - wholesaleCogsInr);
  const grossMarginPercent = retailRevenueInr > 0 ? Math.round((grossProfitInr / retailRevenueInr) * 1000) / 10 : 60.0;

  return {
    totalMinutes,
    retailRevenueInr,
    wholesaleCogsInr,
    grossProfitInr,
    grossMarginPercent,
    unitEconomics: {
      retailRatePerMin: 5.00,
      carrierCogsPerMin: 1.80,
      sttCogsPerMin: 0.35,
      ttsCogsPerMin: 0.50,
      llmCogsPerMin: 0.30,
      storagePerMin: 0.05,
      netMarginPerMin: 2.00
    }
  };
}

module.exports = {
  getTenantAnalytics,
  getSuperAdminMargins
};
