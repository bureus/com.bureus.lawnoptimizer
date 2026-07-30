'use strict';

const DAY_KEYS    = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_MAX_RAIN_MM     = 5;   // fallback if caller doesn't supply
const HEAVY_PRIOR_RAIN_MM     = 12;  // previous-day rain that leaves ground too soggy
const OVERDUE_RAIN_RELAX_MULT = 2.0; // when overdue, accept days with up to N× the rain threshold

/**
 * MowingWindowService
 *
 * Finds the next suitable mowing window by scanning the weather forecast
 * for a dry day within the next 7 days. Considers days-since-last-mow so
 * an overdue lawn is prioritised even under sub-optimal conditions. Pure
 * service — no side effects.
 */
class MowingWindowService {

  /**
   * @param {object}    p
   * @param {Array}     [p.precipitationByDay]     Daily forecast from OpenMeteoClient
   * @param {number}    [p.rootZoneTemp]           Current root-zone temperature °C
   * @param {boolean}   [p.mowingRecommended]      From LawnScoringService
   * @param {number}    [p.mowingMinTemp=8]        Min root-zone temp to mow
   * @param {number}    [p.rainThresholdMm=5]      Max daily rain (mm) considered acceptable
   * @param {number|null} [p.daysSinceLastMow]     Days since last recorded mow (null if unknown)
   * @param {number}    [p.mowingFrequencyDays]    Current recommended interval (from LawnProfileOptimizationService)
   * @returns {MowingWindowResult}
   */
  findNextWindow({
    precipitationByDay,
    rootZoneTemp,
    mowingRecommended,
    mowingMinTemp = 8,
    rainThresholdMm = DEFAULT_MAX_RAIN_MM,
    daysSinceLastMow = null,
    mowingFrequencyDays = null,
    __ = null,
  }) {
    const rz = rootZoneTemp ?? 0;

    // Overdue logic: only meaningful when we know both values
    const isOverdue =
      typeof daysSinceLastMow === 'number' && typeof mowingFrequencyDays === 'number'
        ? daysSinceLastMow >= mowingFrequencyDays
        : false;
    const isSeverelyOverdue =
      typeof daysSinceLastMow === 'number' && typeof mowingFrequencyDays === 'number'
        ? daysSinceLastMow >= mowingFrequencyDays * 1.3
        : false;

    // Growth gate: keep the temperature guardrail even if overdue — cutting frozen/dormant
    // turf does more harm than waiting a few more days.
    if (!mowingRecommended) {
      const reason = rz < mowingMinTemp
        ? (__ ? __('services.mowing.too_cold') : 'Too cold to mow')
        : (__ ? __('services.mowing.not_suitable') : 'Growth conditions not suitable for mowing');
      return {
        nextMowingWindow: '—',
        mowingStatus: reason,
        daysSinceLastMow,
        isOverdue,
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const effectiveRainMax = isOverdue ? rainThresholdMm * OVERDUE_RAIN_RELAX_MULT : rainThresholdMm;

    if (Array.isArray(precipitationByDay)) {
      // Build a quick lookup so we can inspect the previous day's rain
      const byDate = new Map(precipitationByDay.map((d) => [d.date, d.totalMm ?? 0]));

      for (const { date, totalMm } of precipitationByDay) {
        if (date <= today) continue;                          // skip past/today
        const rain = totalMm ?? 0;
        if (rain > effectiveRainMax) continue;                // too wet
        // Skip days whose predecessor was drenched (soggy ground) unless overdue
        const prev = _prevDate(date);
        const prevRain = byDate.get(prev) ?? 0;
        if (!isOverdue && prevRain >= HEAVY_PRIOR_RAIN_MM) continue;

        const d       = new Date(date + 'T00:00:00Z');
        const dayIdx  = d.getUTCDay();
        const dayName = __ ? __(`services.days.${DAY_KEYS[dayIdx]}`) : DAY_NAMES_EN[dayIdx];

        let statusText;
        if (isSeverelyOverdue) {
          statusText = __ ? __('services.mowing.overdue_window', { day: dayName }) : `Overdue — mow on ${dayName}`;
        } else if (isOverdue) {
          statusText = __ ? __('services.mowing.due_window', { day: dayName }) : `Due — mow on ${dayName}`;
        } else {
          statusText = __ ? __('services.mowing.window', { day: dayName }) : `Mowing window: ${dayName}`;
        }

        return {
          nextMowingWindow: `${dayName} ${date}`,
          mowingStatus:     statusText,
          daysSinceLastMow,
          isOverdue,
        };
      }
    }

    // Mowing recommended but no acceptable day found — suggest now, more urgently if overdue
    let status;
    if (isSeverelyOverdue) {
      status = __ ? __('services.mowing.overdue_now') : 'Overdue — mow as soon as it dries out';
    } else if (isOverdue) {
      status = __ ? __('services.mowing.due_now') : 'Due — mow at the next dry moment';
    } else {
      status = __ ? __('services.mowing.recommended_now') : 'Mowing recommended now';
    }
    return {
      nextMowingWindow: __ ? __('services.mowing.today') : 'Today',
      mowingStatus:     status,
      daysSinceLastMow,
      isOverdue,
    };
  }
}

function _prevDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @typedef {object} MowingWindowResult
 * @property {string}       nextMowingWindow  Human-readable window, e.g. "Tuesday 2026-05-19" or "—"
 * @property {string}       mowingStatus     Short status phrase for the device card
 * @property {number|null}  daysSinceLastMow
 * @property {boolean}      isOverdue
 */

module.exports = MowingWindowService;
