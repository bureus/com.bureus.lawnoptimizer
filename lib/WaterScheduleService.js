'use strict';

const {
  parseIsoDate,
  formatIsoDate,
  parsePreferredWateringDays,
  parsePreferredWateringTime,
  getNextPreferredWateringDate,
} = require('./DateHelpers');

// Day name keys for locale lookup (index matches Date.getUTCDay())
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Pure service — no side effects — that calculates the weekly watering schedule
 * for a lawn based on rainfall inputs, forecast data, and lawn profile.
 *
 * Independent of FertiliserScheduleService and device state.
 */
class WaterScheduleService {

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * @param {object}       p
   * @param {Date|string|null} [p.today]                  Override today's date (for testing)
   * @param {number}       [p.weeklyTargetMm=25]          Target water per week (mm)
   * @param {number}       [p.manualRainThisWeekMm=0]     User-entered rain this week
   * @param {number}       [p.manualIrrigationThisWeekMm=0]  User-entered irrigation this week
   * @param {number}       [p.measuredRainThisWeekMm=0]   Rain sensor measurement this week
   * @param {number}       [p.weatherRainThisWeekMm=0]    Weather API rain this week
   * @param {number}       [p.forecastRainNext24hMm=0]    Forecast precipitation next 24 h
   * @param {number}       [p.forecastRainNext7DaysMm=0]  Forecast precipitation next 7 days
   * @param {number|null}  [p.rootZoneTemp]               Current root-zone temperature °C
   * @param {boolean}      [p.heatStressRisk=false]       Heat stress flag from LawnScoringService
   * @param {string}       [p.grassType='cool_season']    'cool_season' | 'warm_season' | 'mixed'
   * @param {string}       [p.soilType='loam']            'sand' | 'loam' | 'clay'
   * @param {string}       [p.shadeLevel='full_sun']      'full_sun' | 'partial_shade' | 'shade'
   * @param {string}       [p.strategy='balanced']        'conservative' | 'balanced' | 'aggressive'
   * @param {string}       [p.preferredWateringDays='MON,WED,SAT']  Comma-separated weekday codes
   * @param {string}       [p.preferredWateringTime='06:00']        HH:mm preferred start time
   * @param {number}       [p.minSoilTemp=8]              Min root-zone temp for watering (°C)
   * @param {number}       [p.maxHeatStressTemp=28]       Temp above which heat-stress mode kicks in
   * @param {string}       [p.resetWaterWeekday='MON']    Week-reset day (ignored here, for reference)
   * @returns {WaterScheduleResult}
   */
  calculate({
    today                       = null,
    weeklyTargetMm              = 25,
    manualRainThisWeekMm        = 0,
    manualIrrigationThisWeekMm  = 0,
    measuredRainThisWeekMm      = 0,
    weatherRainThisWeekMm       = 0,
    forecastRainNext24hMm       = 0,
    forecastRainNext7DaysMm     = 0,
    rootZoneTemp                = null,
    heatStressRisk              = false,
    grassType                   = 'cool_season',
    soilType                    = 'loam',
    shadeLevel                  = 'full_sun',
    strategy                    = 'balanced',
    preferredWateringDays       = 'MON,WED,SAT',
    preferredWateringTime       = '06:00',
    minSoilTemp                 = 8,
    maxHeatStressTemp           = 28,
    __                          = null,
  }) {
    // ── 1. Resolve today ───────────────────────────────────────────────────────
    let todayDate;
    if (today instanceof Date) {
      todayDate = parseIsoDate(formatIsoDate(today)) || today;
    } else if (today && typeof today === 'string') {
      todayDate = parseIsoDate(today);
    }
    if (!todayDate) {
      todayDate = parseIsoDate(new Date().toISOString().slice(0, 10));
    }

    // ── 2. Sanitize numeric inputs ─────────────────────────────────────────────
    const safeMm = (v, max = 9999) => Math.max(0, Math.min(max, Number(v) || 0));
    weeklyTargetMm              = safeMm(weeklyTargetMm, 200);
    manualRainThisWeekMm        = safeMm(manualRainThisWeekMm, 200);
    manualIrrigationThisWeekMm  = safeMm(manualIrrigationThisWeekMm, 200);
    measuredRainThisWeekMm      = safeMm(measuredRainThisWeekMm, 200);
    weatherRainThisWeekMm       = safeMm(weatherRainThisWeekMm, 200);
    forecastRainNext24hMm       = safeMm(forecastRainNext24hMm, 200);
    forecastRainNext7DaysMm     = safeMm(forecastRainNext7DaysMm, 200);
    minSoilTemp                 = Number(minSoilTemp) || 8;
    maxHeatStressTemp           = Number(maxHeatStressTemp) || 28;

    // ── 3. Adjust effective weekly target ──────────────────────────────────────

    let effectiveTarget = weeklyTargetMm;

    // Soil modifier: sand needs more water (drains fast), clay needs less
    const soilMultipliers = { sand: 1.2, loam: 1.0, clay: 0.9 };
    effectiveTarget *= (soilMultipliers[soilType] ?? 1.0);

    // Shade modifier: shaded lawns need less water
    const shadeMultipliers = { full_sun: 1.0, partial_shade: 0.9, shade: 0.8 };
    effectiveTarget *= (shadeMultipliers[shadeLevel] ?? 1.0);

    // Warm-season grass needs more during hot weather
    if (grassType === 'warm_season' && rootZoneTemp !== null && rootZoneTemp > 20) {
      effectiveTarget *= 1.1;
    }

    effectiveTarget = Math.round(effectiveTarget * 10) / 10;

    // ── 4. Compute totals ──────────────────────────────────────────────────────
    const rainThisWeekMm       = round1(weatherRainThisWeekMm + manualRainThisWeekMm + measuredRainThisWeekMm);
    const irrigationThisWeekMm = round1(manualIrrigationThisWeekMm);
    const totalWaterThisWeekMm = round1(rainThisWeekMm + irrigationThisWeekMm);
    const waterDeficitMm       = Math.max(0, round1(effectiveTarget - totalWaterThisWeekMm));

    // ── 5. Blocking conditions ─────────────────────────────────────────────────

    // 5a. Soil too cold
    const effectiveTemp = rootZoneTemp ?? null;
    if (effectiveTemp !== null && effectiveTemp < minSoilTemp) {
      return this._result({
        rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm,
        recommended: false, due: false, nextDate: null, amount: 0,
        status: __ ? __('services.water.too_cold') : 'Too cold for watering',
        reason: 'too_cold',
      });
    }

    // 5b. Target already reached
    if (waterDeficitMm === 0) {
      return this._result({
        rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm: 0,
        recommended: false, due: false, nextDate: null, amount: 0,
        status: __ ? __('services.water.target_reached') : 'No watering needed — rainfall target reached',
        reason: 'target_reached',
      });
    }

    // 5c. Next 7 days of forecast rain covers the deficit
    if (forecastRainNext7DaysMm >= waterDeficitMm) {
      return this._result({
        rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm,
        recommended: false, due: false, nextDate: null, amount: 0,
        status: __ ? __('services.water.rain_covers_deficit') : 'No watering needed — enough rain expected this week',
        reason: 'rain_covers_deficit',
      });
    }

    // 5d. Enough rain within 24 h to cover deficit — delay
    if (forecastRainNext24hMm >= waterDeficitMm) {
      return this._result({
        rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm,
        recommended: false, due: false, nextDate: null, amount: 0,
        status: __ ? __('services.water.rain_expected_24h') : 'Delay watering — rain expected tomorrow',
        reason: 'rain_expected_24h',
      });
    }

    // ── 6. Calculate suggested watering amount ─────────────────────────────────

    let suggestedAmount = waterDeficitMm;

    // Strategy modifier
    const strategyMultipliers = { conservative: 0.8, balanced: 1.0, aggressive: 1.2 };
    suggestedAmount *= (strategyMultipliers[strategy] ?? 1.0);

    // Heat stress: water lightly but more often
    const isHeatStress = heatStressRisk || (effectiveTemp !== null && effectiveTemp > maxHeatStressTemp);
    if (isHeatStress) {
      suggestedAmount = Math.min(suggestedAmount, 8);
    }

    // Cap per session (unless aggressive strategy)
    if (strategy !== 'aggressive') {
      suggestedAmount = Math.min(suggestedAmount, 15);
    }

    suggestedAmount = round1(suggestedAmount);

    // Minimum actionable amount: 3 mm — below this don't bother
    if (suggestedAmount < 3) {
      return this._result({
        rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm,
        recommended: false, due: false, nextDate: null, amount: suggestedAmount,
        status: __ ? __('services.water.below_minimum', { amount: waterDeficitMm }) : `Water deficit ${waterDeficitMm} mm — below minimum actionable amount`,
        reason: 'below_minimum',
      });
    }

    // ── 7. Next preferred watering date ───────────────────────────────────────
    const preferredIndices = parsePreferredWateringDays(preferredWateringDays);
    const nextWateringDate = getNextPreferredWateringDate(todayDate, preferredIndices);
    const timeStr          = preferredWateringTime || '06:00';

    // ── 8. Build status message ────────────────────────────────────────────────
    let status;
    if (isHeatStress) {
      status = __ ? __('services.water.heat_stress', { amount: suggestedAmount }) : `Watering recommended: ${suggestedAmount} mm — heat stress, water lightly and repeat`;
    } else if (nextWateringDate) {
      const d       = parseIsoDate(nextWateringDate);
      const dayIdx  = d ? d.getUTCDay() : -1;
      const dayName = __ && dayIdx >= 0 ? __(`services.days.${DAY_KEYS[dayIdx]}`) : (d ? DAY_NAMES_EN[dayIdx] : nextWateringDate);
      status = __ ? __('services.water.window', { day: dayName, time: timeStr }) : `Watering window: ${dayName} ${timeStr}`;
    } else {
      status = __ ? __('services.water.recommended', { amount: suggestedAmount }) : `Watering recommended: ${suggestedAmount} mm needed this week`;
    }

    return this._result({
      rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm,
      recommended: true, due: true,
      nextDate: nextWateringDate,
      amount: suggestedAmount,
      status,
      reason: 'watering_due',
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _result({ rainThisWeekMm, irrigationThisWeekMm, totalWaterThisWeekMm, waterDeficitMm,
             recommended, due, nextDate, amount, status, reason }) {
    return {
      rainThisWeekMm,
      irrigationThisWeekMm,
      totalWaterThisWeekMm,
      waterDeficitMm,
      wateringRecommended:    recommended,
      wateringDue:            due,
      nextWateringDate:       nextDate,
      nextWateringAmountMm:   amount,
      status,
      reason,
    };
  }
}

/** Round to 1 decimal place */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * @typedef {object} WaterScheduleResult
 * @property {number}       rainThisWeekMm         Total rain this week (weather + manual + sensor)
 * @property {number}       irrigationThisWeekMm   Total irrigation applied this week
 * @property {number}       totalWaterThisWeekMm   Rain + irrigation combined
 * @property {number}       waterDeficitMm         How much more water is needed (never negative)
 * @property {boolean}      wateringRecommended    True when the lawn needs water this week
 * @property {boolean}      wateringDue            True when watering should happen today/next preferred day
 * @property {string|null}  nextWateringDate       ISO date of next preferred watering day
 * @property {number}       nextWateringAmountMm   Suggested amount for next session (mm)
 * @property {string}       status                 Human-readable status message
 * @property {string}       reason                 Machine-readable reason code
 */

module.exports = WaterScheduleService;
