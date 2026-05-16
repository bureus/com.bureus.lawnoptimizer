'use strict';

/**
 * LawnScoringService
 *
 * Converts soil/weather values into actionable lawn recommendations.
 * All logic is pure (no side effects) so it is easy to unit-test.
 *
 * Growth score bands (root zone temperature):
 *   < 5 °C   → dormant           (score  0–10)
 *   5–8 °C   → very slow growth  (score 11–25)
 *   8–12 °C  → early growth      (score 26–45)
 *   12–20 °C → good growth       (score 46–70)
 *   20–25 °C → strong growth     (score 71–90)
 *   > 25 °C  → high growth / heat stress risk at > 28 °C  (score 65–80)
 */
class LawnScoringService {

  /**
   * @param {object} settings  Device settings subset
   * @param {string} settings.grass_type                 'cool_season' | 'warm_season' | 'mixed'
   * @param {number} settings.preferred_mowing_min_temp
   * @param {number} settings.preferred_fertilizing_min_temp
   * @param {number} settings.watering_threshold_mm_24h
   */
  constructor(settings) {
    this._grassType            = settings.grass_type || 'cool_season';
    this._mowingMinTemp        = settings.preferred_mowing_min_temp ?? 8;
    this._fertilizingMinTemp   = settings.preferred_fertilizing_min_temp ?? 10;
    this._wateringThreshold    = settings.watering_threshold_mm_24h ?? 3;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * @param {import('./SoilTemperatureModel').SoilTemps} temps
   * @returns {LawnAssessment}
   */
  assess(temps) {
    const rootZone = temps.rootZone ?? temps.avgAirTemp24h ?? 10;

    const growthScore          = this._calcGrowthScore(rootZone);
    const frostRisk            = this._detectFrost(rootZone, temps.airTemp);
    const heatStressRisk       = this._detectHeatStress(rootZone, temps.airTemp);
    const mowingRecommended    = this._isMowingRecommended(rootZone, growthScore);
    const wateringRecommended  = this._isWateringRecommended(temps.rain24h, temps.soilMoisturePct);
    const fertilizingRecommended = this._isFertilizingRecommended(rootZone, growthScore, frostRisk);
    const statusText           = this._statusText(rootZone, growthScore, frostRisk, heatStressRisk);

    return {
      growthScore,
      frostRisk,
      heatStressRisk,
      mowingRecommended,
      wateringRecommended,
      fertilizingRecommended,
      statusText,
    };
  }

  // ─── Growth score ──────────────────────────────────────────────────────────

  _calcGrowthScore(rootZone) {
    // Warm-season grasses have a higher optimal window (+4 °C shift)
    const tempOffset = this._grassType === 'warm_season' ? 4 : 0;
    const t = rootZone - tempOffset;

    let base;
    if      (t < 0)        base = 0;
    else if (t < 5)        base = this._lerp(t, 0, 5, 0, 10);
    else if (t < 8)        base = this._lerp(t, 5, 8, 10, 25);
    else if (t < 12)       base = this._lerp(t, 8, 12, 25, 45);
    else if (t < 20)       base = this._lerp(t, 12, 20, 45, 70);
    else if (t < 25)       base = this._lerp(t, 20, 25, 70, 90);
    else if (t < 28)       base = this._lerp(t, 25, 28, 90, 75); // plateau before heat stress
    else if (t < 35)       base = this._lerp(t, 28, 35, 75, 40); // heat stress → reduced growth
    else                   base = 30; // severe heat

    // Mixed grass: average between cool and warm optimal curves
    if (this._grassType === 'mixed') {
      const warmScore = this._calcGrowthScoreForType(rootZone, 'warm_season');
      base = Math.round((base + warmScore) / 2);
    }

    return Math.max(0, Math.min(100, Math.round(base)));
  }

  _calcGrowthScoreForType(rootZone, type) {
    const orig = this._grassType;
    this._grassType = type;
    const s = this._calcGrowthScore(rootZone);
    this._grassType = orig;
    return s;
  }

  // ─── Risk detection ────────────────────────────────────────────────────────

  _detectFrost(rootZone, airTemp) {
    return rootZone <= 2 || airTemp <= 0;
  }

  _detectHeatStress(rootZone, airTemp) {
    return rootZone > 28 || airTemp > 32;
  }

  // ─── Recommendations ───────────────────────────────────────────────────────

  _isMowingRecommended(rootZone, growthScore) {
    // Only recommend mowing if grass is actively growing and conditions are safe
    return rootZone >= this._mowingMinTemp && growthScore >= 30;
  }

  _isWateringRecommended(rain24h, soilMoisturePct) {
    const lowRain     = (rain24h ?? 0) < this._wateringThreshold;
    // If we have soil moisture data, use it; otherwise rely on rain alone
    const dryMoisture = soilMoisturePct !== null
      ? soilMoisturePct < 35   // below ~35% VWC relative to field capacity
      : lowRain;

    return lowRain && dryMoisture;
  }

  _isFertilizingRecommended(rootZone, growthScore, frostRisk) {
    // Fertilize when grass is in active growth and there is no frost risk
    return !frostRisk
      && rootZone >= this._fertilizingMinTemp
      && growthScore >= 25;
  }

  // ─── Status text ───────────────────────────────────────────────────────────

  _statusText(rootZone, growthScore, frostRisk, heatStressRisk) {
    if (frostRisk)           return 'Frost risk – protect your lawn';
    if (heatStressRisk)      return 'Heat stress – consider watering';
    if (rootZone < 5)        return 'Dormant – grass is not growing';
    if (rootZone < 8)        return 'Very slow growth';
    if (rootZone < 12)       return 'Early growth – lawn is waking up';
    if (growthScore >= 70)   return 'Strong growth conditions';
    if (growthScore >= 45)   return 'Good growth conditions';
    return 'Moderate growth conditions';
  }

  // ─── Math helpers ──────────────────────────────────────────────────────────

  /** Linear interpolation between two output values across a temperature range */
  _lerp(t, tMin, tMax, vMin, vMax) {
    const fraction = (t - tMin) / (tMax - tMin);
    return vMin + fraction * (vMax - vMin);
  }
}

/**
 * @typedef {object} LawnAssessment
 * @property {number}  growthScore            0–100
 * @property {boolean} frostRisk
 * @property {boolean} heatStressRisk
 * @property {boolean} mowingRecommended
 * @property {boolean} wateringRecommended
 * @property {boolean} fertilizingRecommended
 * @property {string}  statusText
 */

module.exports = LawnScoringService;
