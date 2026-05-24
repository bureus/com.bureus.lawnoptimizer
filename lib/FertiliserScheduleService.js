'use strict';

// ── ISO date helpers (UTC-only, no locale dependency) ─────────────────────────

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
 * True when `month` (1–12) falls within [startMonth, endMonth].
 * Handles year-wrapping (e.g. Nov–Mar in Southern Hemisphere) when start > end.
 */
function isMonthInSeason(month, startMonth, endMonth) {
  if (startMonth <= endMonth) {
    return month >= startMonth && month <= endMonth;
  }
  // Wraps around year-end
  return month >= startMonth || month <= endMonth;
}

// ── FertiliserScheduleService ─────────────────────────────────────────────────

/**
 * Pure service – no side effects – that calculates the next recommended
 * fertiliser date for a lawn based on interval rules, weather and conditions.
 *
 * Usage:
 *   const svc = new FertiliserScheduleService();
 *   const result = svc.calculate({ lastFertiliserDate, intervalDays, ... });
 */
class FertiliserScheduleService {

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * @param {object}      p
   * @param {string|null} p.lastFertiliserDate    ISO date 'YYYY-MM-DD' or null/empty
   * @param {number}      [p.intervalDays=42]     Base interval between applications
   * @param {string}      [p.strategy='balanced'] 'conservative' | 'balanced' | 'aggressive'
   * @param {string}      [p.grassType='cool_season'] 'cool_season' | 'warm_season' | 'mixed'
   * @param {string}      [p.soilType='loam']     'sand' | 'loam' | 'clay'
   * @param {number|null} [p.rootZoneTemp]        Current root-zone temperature °C
   * @param {number}      [p.growthScore=50]      Current growth score 0–100
   * @param {number}      [p.precipitationNext48h=0]  Forecast precipitation (mm)
   * @param {number}      [p.precipitationLast24h=0]  Recent 24 h rainfall (mm)
   * @param {string|Date|null} [p.today]          Override today's date (for testing)
   * @param {number}      [p.seasonStartMonth=4]  First month of fertilising season (1–12)
   * @param {number}      [p.seasonEndMonth=10]   Last month of fertilising season (1–12)
   * @param {number}      [p.minSoilTemp=10]      Minimum root-zone temp to apply fertiliser (°C)
   * @param {number}      [p.rainWindowMin=2]     Rain (mm) above which fertilising is ideal
   * @param {number}      [p.rainWindowMax=15]    Rain (mm) above which fertilising is delayed
   * @returns {FertiliserResult}
   */
  calculate({
    lastFertiliserDate,
    intervalDays        = 42,
    strategy            = 'balanced',
    grassType           = 'cool_season',
    soilType            = 'loam',
    rootZoneTemp        = null,
    growthScore         = 50,
    precipitationNext48h = 0,
    precipitationLast24h = 0,
    today               = null,
    seasonStartMonth    = 4,
    seasonEndMonth      = 10,
    minSoilTemp         = 10,
    rainWindowMin       = 2,
    rainWindowMax       = 15,
    __                  = null,
  }) {
    // ── 1. No last date set ────────────────────────────────────────────────────
    const lastDate = parseIsoDate(lastFertiliserDate);
    if (!lastDate) {
      return {
        nextDate:      null,
        daysRemaining: null,
        due:           false,
        status:        __ ? __('services.fertiliser.no_date') : 'Set last fertiliser date to enable scheduling.',
        reason:        'no_date',
      };
    }

    // ── 2. Resolve today ───────────────────────────────────────────────────────
    let todayDate;
    if (today instanceof Date) {
      // Normalise to UTC midnight
      todayDate = parseIsoDate(formatIsoDate(today)) || today;
    } else if (today && typeof today === 'string') {
      todayDate = parseIsoDate(today);
    }
    if (!todayDate) {
      // Use current UTC date
      todayDate = parseIsoDate(new Date().toISOString().slice(0, 10));
    }

    // ── 3. Base next date = last + interval ────────────────────────────────────
    let nextDate = addDays(lastDate, Number(intervalDays) || 42);

    // ── 4. Strategy modifier ───────────────────────────────────────────────────
    const strategyOffsets = { conservative: +14, balanced: 0, aggressive: -7 };
    nextDate = addDays(nextDate, strategyOffsets[strategy] ?? 0);

    // ── 5. Soil type modifier ──────────────────────────────────────────────────
    const soilOffsets = { sand: -7, loam: 0, clay: +7 };
    nextDate = addDays(nextDate, soilOffsets[soilType] ?? 0);

    // ── 6. Days remaining (negative = overdue) ─────────────────────────────────
    const daysRemaining = differenceInDays(nextDate, todayDate);
    const overdue       = daysRemaining <= 0;
    const nextDateStr   = formatIsoDate(nextDate);

    // ── 7. Blocking conditions (checked in priority order) ────────────────────

    // 7a. Outside season
    const currentMonth = todayDate.getUTCMonth() + 1; // 1–12
    if (!isMonthInSeason(currentMonth, seasonStartMonth, seasonEndMonth)) {
      return {
        nextDate: nextDateStr,
        daysRemaining,
        due:   false,
        status: __ ? __('services.fertiliser.outside_season') : 'Outside fertiliser season',
        reason: 'outside_season',
      };
    }

    // 7b. Soil too cold
    const effectiveTemp = rootZoneTemp ?? 15;
    if (effectiveTemp < minSoilTemp) {
      return {
        nextDate: nextDateStr,
        daysRemaining,
        due:   false,
        status: overdue
          ? (__ ? __('services.fertiliser.soil_too_cold_overdue', { minTemp: minSoilTemp }) : `Due, but delayed — soil temperature below ${minSoilTemp} °C`)
          : (__ ? __('services.fertiliser.soil_too_cold', { minTemp: minSoilTemp }) : `Too early — soil temperature below ${minSoilTemp} °C`),
        reason: 'soil_too_cold',
      };
    }

    // 7c. Growth score too low to benefit from fertilising
    if ((growthScore ?? 50) < 35) {
      return {
        nextDate: nextDateStr,
        daysRemaining,
        due:   false,
        status: overdue
          ? (__ ? __('services.fertiliser.low_growth_overdue') : 'Due, but delayed — lawn not growing actively enough')
          : (__ ? __('services.fertiliser.low_growth') : 'Too early — lawn not growing actively enough'),
        reason: 'low_growth',
      };
    }

    // 7d. Warm-season grass in cool soil
    if (grassType === 'warm_season' && effectiveTemp < 14) {
      return {
        nextDate: nextDateStr,
        daysRemaining,
        due:   false,
        status: overdue
          ? (__ ? __('services.fertiliser.warm_season_cool_overdue') : 'Due, but delayed — soil too cool for warm-season grass')
          : (__ ? __('services.fertiliser.warm_season_cool') : 'Waiting — soil too cool for warm-season grass'),
        reason: 'warm_season_cool',
      };
    }

    // 7e. Heavy rain expected in the next 48 h → delay
    const rain48h = precipitationNext48h ?? 0;
    if (rain48h > rainWindowMax) {
      return {
        nextDate: nextDateStr,
        daysRemaining,
        due:   false,
        status: overdue
          ? (__ ? __('services.fertiliser.heavy_rain_overdue') : 'Due, but delayed — heavy rain expected')
          : (__ ? __('services.fertiliser.heavy_rain') : 'Delay — heavy rain expected'),
        reason: 'heavy_rain',
      };
    }

    // ── 8. All conditions satisfied ────────────────────────────────────────────
    const due = overdue;

    let status;
    if (due) {
      if (rain48h >= rainWindowMin && rain48h <= rainWindowMax) {
        status = __ ? __('services.fertiliser.due_light_rain') : 'Due now — light rain expected, ideal timing';
      } else if (rain48h === 0) {
        status = __ ? __('services.fertiliser.due_no_rain') : 'Due now — no rain expected, water after applying';
      } else {
        status = __ ? __('services.fertiliser.due_good') : 'Due now — conditions look good';
      }
    } else if (daysRemaining === 1) {
      status = __ ? __('services.fertiliser.due_tomorrow') : 'Due tomorrow';
    } else if (daysRemaining <= 7) {
      status = __ ? __('services.fertiliser.recommended_in_days', { days: daysRemaining }) : `Recommended in ${daysRemaining} days`;
    } else if (daysRemaining <= 14) {
      status = __ ? __('services.fertiliser.next_in_days', { days: daysRemaining }) : `Next fertiliser in ${daysRemaining} days`;
    } else {
      status = __ ? __('services.fertiliser.next_date', { date: nextDateStr }) : `Next fertiliser date: ${nextDateStr}`;
    }

    return {
      nextDate:      nextDateStr,
      daysRemaining,
      due,
      status,
      reason: due ? 'due' : 'scheduled',
    };
  }
}

/**
 * @typedef {object} FertiliserResult
 * @property {string|null} nextDate       ISO date string or null if no date configured
 * @property {number|null} daysRemaining  Days until (or since) the next date; negative = overdue
 * @property {boolean}     due            True when today >= nextDate AND all conditions OK
 * @property {string}      status         Human-readable status message
 * @property {string}      reason         Machine-readable reason code
 */

// Export helpers for use in tests and app.js conditions
FertiliserScheduleService.parseIsoDate    = parseIsoDate;
FertiliserScheduleService.formatIsoDate   = formatIsoDate;
FertiliserScheduleService.addDays         = addDays;
FertiliserScheduleService.differenceInDays = differenceInDays;
FertiliserScheduleService.isMonthInSeason  = isMonthInSeason;

module.exports = FertiliserScheduleService;
