'use strict';

// ISO date helpers (UTC only, no locale dependency).
// Standalone module — safe to import from any service without coupling.

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Parse a YYYY-MM-DD string to a UTC midnight Date.
 * Returns null for anything that is not a valid ISO date string.
 */
function parseIsoDate(str) {
  if (!str || typeof str !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str.trim())) return null;
  const d = new Date(str.trim() + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as YYYY-MM-DD using UTC fields. */
function formatIsoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Return a new Date shifted by `days` calendar days (positive or negative). */
function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Return (a − b) expressed as whole days (positive if a is later than b).
 * Uses rounding to handle DST boundary edge-cases.
 */
function differenceInDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Return the UTC date of the most recent occurrence of `resetWeekday` on or
 * before `date`. For example, if resetWeekday='MON' and today is Wednesday,
 * returns the Monday of this week.
 *
 * @param {Date}   date           Reference date (UTC midnight)
 * @param {string} resetWeekday   'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
 * @returns {Date}
 */
function getWeekStartDate(date, resetWeekday) {
  const targetDay = WEEKDAYS.indexOf((resetWeekday || 'MON').toUpperCase());
  const safeTarget = targetDay < 0 ? 1 : targetDay; // default MON (index 1)
  const currentDay = date.getUTCDay(); // 0=Sun … 6=Sat
  let diff = currentDay - safeTarget;
  if (diff < 0) diff += 7;
  return addDays(date, -diff);
}

/**
 * Parse a comma-separated list of weekday codes like 'MON,WED,SAT'.
 * Returns an array of day indices using JS convention (0=Sun … 6=Sat).
 * Falls back to [1, 3, 6] (Mon, Wed, Sat) on empty/invalid input.
 */
function parsePreferredWateringDays(str) {
  if (!str || typeof str !== 'string') return [1, 3, 6];
  const parsed = str.split(',')
    .map(s => WEEKDAYS.indexOf(s.trim().toUpperCase()))
    .filter(d => d >= 0);
  return parsed.length > 0 ? parsed : [1, 3, 6];
}

/**
 * Parse 'HH:mm' into { hours, minutes }.
 * Returns { hours: 6, minutes: 0 } on invalid input.
 */
function parsePreferredWateringTime(str) {
  if (!str || typeof str !== 'string') return { hours: 6, minutes: 0 };
  const parts = str.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const hours   = Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 6;
  const minutes = Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0;
  return { hours, minutes };
}

/**
 * Find the next watering date on or after `afterDate` that falls on one of the
 * `preferredDayIndices` (0=Sun … 6=Sat). Scans at most `maxDaysAhead` days.
 * Returns an ISO date string, or today's date string as fallback.
 *
 * @param {Date}     afterDate           Scan from this date (inclusive)
 * @param {number[]} preferredDayIndices  Day indices (0-based JS convention)
 * @param {number}   [maxDaysAhead=14]
 * @returns {string}  ISO date 'YYYY-MM-DD'
 */
function getNextPreferredWateringDate(afterDate, preferredDayIndices, maxDaysAhead = 14) {
  if (!preferredDayIndices || preferredDayIndices.length === 0) {
    return formatIsoDate(afterDate);
  }
  for (let i = 0; i <= maxDaysAhead; i++) {
    const d = addDays(afterDate, i);
    if (preferredDayIndices.includes(d.getUTCDay())) {
      return formatIsoDate(d);
    }
  }
  return formatIsoDate(afterDate);
}

module.exports = {
  parseIsoDate,
  formatIsoDate,
  addDays,
  differenceInDays,
  getWeekStartDate,
  getNextPreferredWateringDate,
  parsePreferredWateringDays,
  parsePreferredWateringTime,
};
