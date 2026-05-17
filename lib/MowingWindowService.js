'use strict';

const {
  parseIsoDate,
  formatIsoDate,
  addDays,
  parsePreferredWateringDays,
  parsePreferredWateringTime,
} = require('./DateHelpers');

/**
 * Pure, stateless service that calculates robot mower safety, mowing recommendations,
 * and the next optimal mowing window based on weather, soil, and growth conditions.
 *
 * Usage:
 *   const svc = new MowingWindowService();
 *   const result = svc.calculate({ today, rootZoneTemp, growthScore, ... });
 */
class MowingWindowService {

  /**
   * @param {object}       p
   * @param {Date|string}  p.today                       Current date
   * @param {number|null}  p.rootZoneTemp                Root zone temperature °C
   * @param {number}       p.growthScore                 0–100
   * @param {boolean}      p.frostRisk                   True if frost expected
   * @param {boolean}      p.heatStressRisk              True if heat stress active
   * @param {number}       p.precipitationLast24hMm      Rainfall last 24 h (mm)
   * @param {number}       p.precipitationNext24hMm      Forecast rain next 24 h (mm)
   * @param {number}       p.soilMoisture                Soil moisture percentage 0–100
   * @param {string|null}  p.lastFertiliserDate          ISO date of last fertiliser application
   * @param {string}       p.preferredMowingDays         Comma-separated codes e.g. 'TUE,FRI'
   * @param {string}       p.preferredMowingTime         'HH:mm' e.g. '14:00'
   * @param {string}       p.strategy                    'conservative' | 'balanced' | 'aggressive'
   * @param {Array}        [p.forecastByDay]             [{date:'YYYY-MM-DD', totalMm:number}]
   * @param {number|null}  [p.manualBlockUntilMs]        Unix timestamp ms until manual block expires
   * @param {number}       [p.hoursSinceLastRain]        Hours elapsed since last significant rain
   * @param {object}       p.settings                    Device settings object
   * @returns {MowingResult}
   */
  calculate({
    today,
    rootZoneTemp,
    growthScore,
    frostRisk,
    heatStressRisk,
    precipitationLast24hMm,
    precipitationNext24hMm,
    soilMoisture,
    lastFertiliserDate,
    preferredMowingDays,
    preferredMowingTime,
    strategy,
    forecastByDay       = [],
    manualBlockUntilMs  = null,
    hoursSinceLastRain  = null,
    settings            = {},
  }) {
    const {
      mowing_enabled                       = true,
      mowing_min_soil_temp                 = 8,
      mowing_max_heat_stress_temp          = 28,
      mowing_max_precipitation_next_24h_mm = 4,
      mowing_block_hours_after_rain        = 8,
      mowing_block_hours_after_fertiliser  = 48,
      mowing_min_growth_score              = 40,
      mowing_avoid_high_moisture           = true,
      mowing_allow_during_heat_stress      = false,
    } = settings;

    const effectiveStrategy = strategy || settings.mowing_strategy || 'balanced';

    // ── Resolve today ─────────────────────────────────────────────────────────
    let todayDate;
    if (today instanceof Date) {
      todayDate = today;
    } else if (typeof today === 'string') {
      todayDate = parseIsoDate(today) || new Date();
    } else {
      todayDate = new Date();
    }
    const todayStr = formatIsoDate(todayDate);

    // ── Sanitise inputs ───────────────────────────────────────────────────────
    const temp         = typeof rootZoneTemp === 'number'           ? rootZoneTemp           : 10;
    const score        = typeof growthScore  === 'number'           ? growthScore            : 50;
    const rain24h      = typeof precipitationLast24hMm === 'number' ? precipitationLast24hMm : 0;
    const rainNext24h  = typeof precipitationNext24hMm === 'number' ? precipitationNext24hMm : 0;
    const moisture     = typeof soilMoisture === 'number'           ? soilMoisture           : 50;

    const windowArgs = {
      todayStr, preferredMowingDays, preferredMowingTime,
      frostRisk, rainNext24h, settings, forecastByDay,
    };

    // ── Guard: mowing disabled ────────────────────────────────────────────────
    if (mowing_enabled === false) {
      return this._blocked('Mowing disabled in settings', 'mowing_disabled', windowArgs, true);
    }

    // ── Guard: manual temporary block ─────────────────────────────────────────
    if (manualBlockUntilMs && Date.now() < manualBlockUntilMs) {
      const hoursLeft = Math.ceil((manualBlockUntilMs - Date.now()) / 3_600_000);
      return this._blocked(
        `Manually blocked — ${hoursLeft}h remaining`,
        'manual_block',
        windowArgs,
        true,
      );
    }

    // ── Guard: frost risk ─────────────────────────────────────────────────────
    if (frostRisk === true) {
      return this._blocked('Blocked due to frost risk', 'frost_risk', windowArgs, true);
    }

    // ── Guard: soil temperature ───────────────────────────────────────────────
    if (temp < mowing_min_soil_temp) {
      return this._blocked(
        `Soil too cold — min ${mowing_min_soil_temp} °C required`,
        'soil_too_cold',
        windowArgs,
        true,
      );
    }

    // ── Guard: heavy recent rain (absolute) ───────────────────────────────────
    if (rain24h > 5) {
      return this._blocked('Blocked due to recent rain — wet grass', 'recent_rain', windowArgs, true);
    }

    // ── Guard: rain block period ──────────────────────────────────────────────
    if (mowing_block_hours_after_rain > 0 && hoursSinceLastRain !== null) {
      if (hoursSinceLastRain < mowing_block_hours_after_rain) {
        const hoursLeft = Math.ceil(mowing_block_hours_after_rain - hoursSinceLastRain);
        return this._blocked(
          `Blocked after rain — ${hoursLeft}h drying time remaining`,
          'rain_drying',
          windowArgs,
          true,
        );
      }
    }

    // ── Guard: rain forecast ──────────────────────────────────────────────────
    if (rainNext24h > mowing_max_precipitation_next_24h_mm) {
      return this._blocked(
        `Rain forecast ${rainNext24h} mm — avoid mowing`,
        'rain_forecast',
        windowArgs,
        true,
      );
    }

    // ── Guard: growth score too low ───────────────────────────────────────────
    if (score < mowing_min_growth_score) {
      return this._blocked(
        `Growth score too low (${score}) — min ${mowing_min_growth_score} required`,
        'low_growth',
        windowArgs,
        true,
      );
    }

    // ── Guard: fertiliser block ───────────────────────────────────────────────
    const fertBlock = this._checkFertiliserBlock(
      lastFertiliserDate, mowing_block_hours_after_fertiliser, todayDate,
    );
    if (fertBlock) {
      return this._blocked(
        `Blocked after fertilising — ${fertBlock.hoursRemaining}h remaining`,
        'after_fertiliser',
        windowArgs,
        true,
      );
    }

    // ── Guard: heat stress ────────────────────────────────────────────────────
    if (heatStressRisk === true && !mowing_allow_during_heat_stress) {
      return this._blocked('Heat stress detected — avoid mowing', 'heat_stress', windowArgs, true);
    }

    // Also block by raw temperature threshold regardless of heatStressRisk flag
    if (temp > mowing_max_heat_stress_temp && !mowing_allow_during_heat_stress) {
      return this._blocked(
        `Temperature ${temp} °C exceeds heat-stress limit`,
        'heat_stress',
        windowArgs,
        true,
      );
    }

    // ── Guard: high soil moisture ─────────────────────────────────────────────
    if (mowing_avoid_high_moisture) {
      const moistureLimit = effectiveStrategy === 'conservative' ? 60
        : effectiveStrategy === 'aggressive' ? 80 : 70;
      if (moisture > moistureLimit) {
        return this._blocked(
          `Soil moisture too high (${moisture}%) — grass may be wet`,
          'high_moisture',
          windowArgs,
          true,
        );
      }
    }

    // ── All guards passed: mowing is safe ─────────────────────────────────────
    const windowScore = this._calculateWindowScore({
      temp, score, frostRisk: frostRisk === true,
      heatStressRisk: heatStressRisk === true,
      rain24h, rainNext24h, moisture,
      strategy: effectiveStrategy,
    });

    const nextWindow = this._findNextMowingWindow({ ...windowArgs, skipToday: false });
    const mowingRecommended = windowScore >= 60;

    const status = mowingRecommended
      ? 'Good mowing conditions'
      : 'Mowing conditions acceptable';

    return {
      mowingSafe:        true,
      mowingRecommended,
      mowingBlocked:     false,
      mowingBlockReason: '',
      nextMowingWindow:  nextWindow || todayStr,
      mowingWindowScore: windowScore,
      status,
      reason: mowingRecommended ? 'recommended' : 'safe',
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  _blocked(reason, reasonCode, windowArgs, skipToday) {
    const nextWindow = this._findNextMowingWindow({ ...windowArgs, skipToday });
    return {
      mowingSafe:        false,
      mowingRecommended: false,
      mowingBlocked:     true,
      mowingBlockReason: reason,
      nextMowingWindow:  nextWindow || windowArgs.todayStr,
      mowingWindowScore: 0,
      status:            reason,
      reason:            reasonCode,
    };
  }

  /**
   * Returns { hoursRemaining } if still within the fertiliser block window, else null.
   */
  _checkFertiliserBlock(lastFertiliserDate, blockHours, today) {
    if (!lastFertiliserDate || !blockHours) return null;
    const lastDate = parseIsoDate(
      typeof lastFertiliserDate === 'string'
        ? lastFertiliserDate
        : formatIsoDate(lastFertiliserDate),
    );
    if (!lastDate) return null;

    const blockMs       = blockHours * 3_600_000;
    const timeSinceFert = today.getTime() - lastDate.getTime();

    if (timeSinceFert >= 0 && timeSinceFert < blockMs) {
      return { hoursRemaining: Math.ceil((blockMs - timeSinceFert) / 3_600_000) };
    }
    return null;
  }

  /**
   * Score the current conditions 0–100.
   * Higher = better mowing window.
   */
  _calculateWindowScore({ temp, score, frostRisk, heatStressRisk, rain24h, rainNext24h, moisture }) {
    let pts = 0;

    // Dry recent weather (0–25 pts)
    if      (rain24h === 0)  pts += 25;
    else if (rain24h <  1)   pts += 20;
    else if (rain24h <  3)   pts += 10;
    else if (rain24h <= 5)   pts +=  5;

    // Moderate temperature (0–25 pts)
    if      (temp >= 12 && temp <= 22) pts += 25;
    else if (temp >= 10 && temp <= 26) pts += 18;
    else if (temp >=  8 && temp <= 28) pts += 10;

    // Strong growth (0–25 pts)
    if      (score >= 70) pts += 25;
    else if (score >= 55) pts += 18;
    else if (score >= 40) pts += 10;

    // Low stress (0–20 pts)
    if (!frostRisk)      pts += 10;
    if (!heatStressRisk) pts += 10;

    // No rain forecast (0–5 pts)
    if      (rainNext24h === 0) pts += 5;
    else if (rainNext24h <   2) pts += 2;

    return Math.min(100, Math.max(0, pts));
  }

  /**
   * Find the next calendar date that:
   * - Falls on a preferred mowing day
   * - Has acceptable forecast precipitation (if forecastByDay available)
   * - Is not blocked by frost (for same-day check)
   *
   * Returns 'YYYY-MM-DD HH:MM' string or null.
   */
  _findNextMowingWindow({
    todayStr,
    preferredMowingDays,
    preferredMowingTime,
    frostRisk,
    rainNext24h,
    settings = {},
    forecastByDay = [],
    skipToday = false,
  }) {
    const { hours: prefHours, minutes: prefMinutes } = parsePreferredWateringTime(
      preferredMowingTime || '14:00',
    );
    const preferredDays = parsePreferredWateringDays(
      preferredMowingDays || 'TUE,FRI',
    );
    const maxRain      = settings.mowing_max_precipitation_next_24h_mm ?? 4;
    const todayDate    = parseIsoDate(todayStr) || new Date();
    const timeStr      = `${String(prefHours).padStart(2, '0')}:${String(prefMinutes).padStart(2, '0')}`;
    const startOffset  = skipToday ? 1 : 0;

    for (let i = startOffset; i <= 14; i++) {
      const candidate    = addDays(todayDate, i);
      const candidateStr = formatIsoDate(candidate);

      // Must fall on a preferred weekday
      if (!preferredDays.includes(candidate.getUTCDay())) continue;

      // Same-day checks: respect current blockers
      if (i === 0 && frostRisk)             continue;
      if (i === 0 && rainNext24h > maxRain) continue;

      // Future day: check per-day forecast if available
      if (i > 0 && forecastByDay.length > 0) {
        const dayData = forecastByDay.find(d => d.date === candidateStr);
        if (dayData && dayData.totalMm > maxRain) continue;
      }

      return `${candidateStr} ${timeStr}`;
    }

    return null;
  }
}

/**
 * @typedef {object} MowingResult
 * @property {boolean} mowingSafe          True when all safety checks pass
 * @property {boolean} mowingRecommended   True when safe AND score >= 60
 * @property {boolean} mowingBlocked       True when any block condition active
 * @property {string}  mowingBlockReason   Human-readable block reason
 * @property {string}  nextMowingWindow    'YYYY-MM-DD HH:MM' of next optimal window
 * @property {number}  mowingWindowScore   0–100 score for current conditions
 * @property {string}  status             Human-readable status summary
 * @property {string}  reason             Machine-readable reason code
 */

module.exports = MowingWindowService;
