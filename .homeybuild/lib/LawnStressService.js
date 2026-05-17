'use strict';

/**
 * LawnStressService
 *
 * Assesses frost severity, heat stress severity, and whether the lawn
 * is in recovery mode. Pure service — no side effects.
 *
 * Frost severity levels:
 *   none     → root zone > 2 °C and air temp > 2 °C
 *   light    → min temp 0–2 °C
 *   moderate → min temp −3–0 °C
 *   severe   → min temp < −3 °C
 *
 * Heat stress severity levels:
 *   none     → root zone ≤ 28 °C and air ≤ 32 °C
 *   mild     → root zone 28–30 °C or air 32–35 °C
 *   moderate → root zone 30–33 °C or air 35–38 °C
 *   severe   → root zone > 33 °C or air > 38 °C
 *
 * Recovery mode: growth score low but not dormant, no active stress.
 */
class LawnStressService {

  /**
   * @param {object} p
   * @param {number} p.rootZoneTemp  Root-zone temperature in °C
   * @param {number} p.airTemp       Air temperature in °C
   * @param {number} p.growthScore   Current growth score 0–100
   * @returns {StressAssessment}
   */
  assess({ rootZoneTemp, airTemp, growthScore }) {
    const rz = rootZoneTemp ?? 15;
    const at = airTemp ?? 15;
    const gs = growthScore ?? 50;

    const frostSeverity      = this._frostSeverity(rz, at);
    const heatStressSeverity = this._heatStressSeverity(rz, at);
    const recoveryMode       = this._isRecoveryMode(gs, frostSeverity, heatStressSeverity);

    return { frostSeverity, heatStressSeverity, recoveryMode };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _frostSeverity(rz, at) {
    const minTemp = Math.min(rz, at);
    if (minTemp > 2)  return 'none';
    if (minTemp > 0)  return 'light';
    if (minTemp > -3) return 'moderate';
    return 'severe';
  }

  _heatStressSeverity(rz, at) {
    if (rz <= 28 && at <= 32) return 'none';
    if (rz <= 30 && at <= 35) return 'mild';
    if (rz <= 33 && at <= 38) return 'moderate';
    return 'severe';
  }

  _isRecoveryMode(growthScore, frostSeverity, heatStressSeverity) {
    // Recovery: grass has some growth potential but score is depressed,
    // and there is no active frost or heat stress suppressing it.
    return growthScore > 5
      && growthScore < 30
      && frostSeverity      === 'none'
      && heatStressSeverity === 'none';
  }
}

/**
 * @typedef {object} StressAssessment
 * @property {'none'|'light'|'moderate'|'severe'} frostSeverity
 * @property {'none'|'mild'|'moderate'|'severe'}  heatStressSeverity
 * @property {boolean}                             recoveryMode
 */

module.exports = LawnStressService;
