'use strict';

const DAY_KEYS    = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Maximum daily precipitation (mm) considered acceptable for mowing
const MAX_RAIN_MM = 5;

/**
 * MowingWindowService
 *
 * Finds the next suitable mowing window by scanning the weather forecast
 * for a dry day within the next 7 days. Pure service — no side effects.
 */
class MowingWindowService {

  /**
   * @param {object}    p
   * @param {Array}     [p.precipitationByDay]  Daily forecast from OpenMeteoClient
   * @param {number}    [p.rootZoneTemp]        Current root-zone temperature °C
   * @param {boolean}   [p.mowingRecommended]   From LawnScoringService
   * @param {number}    [p.mowingMinTemp=8]     Min root-zone temp to mow
   * @returns {MowingWindowResult}
   */
  findNextWindow({ precipitationByDay, rootZoneTemp, mowingRecommended, mowingMinTemp = 8, __ = null }) {
    const rz = rootZoneTemp ?? 0;

    if (!mowingRecommended) {
      const reason = rz < mowingMinTemp
        ? (__ ? __('services.mowing.too_cold') : 'Too cold to mow')
        : (__ ? __('services.mowing.not_suitable') : 'Growth conditions not suitable for mowing');
      return { nextMowingWindow: '—', mowingStatus: reason };
    }

    const today = new Date().toISOString().slice(0, 10);

    if (Array.isArray(precipitationByDay)) {
      for (const { date, totalMm } of precipitationByDay) {
        if (date <= today) continue;                    // skip past/today
        if ((totalMm ?? 0) <= MAX_RAIN_MM) {
          const d       = new Date(date + 'T00:00:00Z');
          const dayIdx  = d.getUTCDay();
          const dayName = __ ? __(`services.days.${DAY_KEYS[dayIdx]}`) : DAY_NAMES_EN[dayIdx];
          return {
            nextMowingWindow: `${dayName} ${date}`,
            mowingStatus:     __ ? __('services.mowing.window', { day: dayName }) : `Mowing window: ${dayName}`,
          };
        }
      }
    }

    // Mowing recommended but all forecast days are rainy — suggest now
    return {
      nextMowingWindow: __ ? __('services.mowing.today') : 'Today',
      mowingStatus:     __ ? __('services.mowing.recommended_now') : 'Mowing recommended now',
    };
  }
}

/**
 * @typedef {object} MowingWindowResult
 * @property {string} nextMowingWindow  Human-readable window, e.g. "Tuesday 2026-05-19" or "—"
 * @property {string} mowingStatus     Short status phrase for the device card
 */

module.exports = MowingWindowService;
