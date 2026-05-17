'use strict';

/**
 * LawnDashboardService
 *
 * Combines outputs from all lawn services into a single dashboard state.
 * Applies priority logic to pick the most important status and action:
 *
 *   1. Frost / severe heat stress
 *   2. Watering due
 *   3. Fertiliser due
 *   4. Mowing recommended
 *   5. Recovery mode
 *   6. Healthy — no action needed
 *
 * Pure service — no side effects.
 */
class LawnDashboardService {

  /**
   * @param {object} p
   * @param {import('./LawnScoringService').LawnAssessment}   p.scoringResult
   * @param {import('./WaterScheduleService').WaterScheduleResult} p.waterResult
   * @param {import('./FertiliserScheduleService').FertiliserResult} p.fertResult
   * @param {import('./MowingWindowService').MowingWindowResult} p.mowingWindowResult
   * @param {import('./LawnStressService').StressAssessment}   p.stressResult
   * @returns {DashboardState}
   */
  compute({ scoringResult, waterResult, fertResult, mowingWindowResult, stressResult }) {
    const {
      growthScore,
      frostRisk,
      heatStressRisk,
      mowingRecommended,
    } = scoringResult;

    const {
      wateringDue,
      waterDeficitMm,
      nextWateringDate,
      nextWateringAmountMm,
      reason: waterReason,
      status: waterStatus,
    } = waterResult;

    const {
      due:           fertDue,
      nextDate:      fertNextDate,
      status:        fertStatus,
    } = fertResult;

    const { frostSeverity, heatStressSeverity, recoveryMode } = stressResult;
    const { nextMowingWindow, mowingStatus }                  = mowingWindowResult;

    // ── Priority logic ─────────────────────────────────────────────────────────

    let lawnStatus, primaryRecommendation, nextAction, nextActionDate, nextActionReason;

    if (frostSeverity !== 'none') {
      lawnStatus            = 'Frost risk';
      primaryRecommendation = `Frost detected (${frostSeverity}) — protect your lawn`;
      nextAction            = 'Avoid mowing';
      nextActionDate        = '—';
      nextActionReason      = `Frost severity: ${frostSeverity}`;

    } else if (heatStressSeverity !== 'none') {
      lawnStatus            = 'Heat stress';
      primaryRecommendation = 'Water lightly to cool the root zone';
      nextAction            = nextWateringAmountMm > 0
        ? `Water ${nextWateringAmountMm} mm`
        : 'Water lightly';
      nextActionDate        = nextWateringDate || '—';
      nextActionReason      = `Heat stress: ${heatStressSeverity}`;

    } else if (wateringDue) {
      lawnStatus            = 'Needs water';
      primaryRecommendation = `Apply ${nextWateringAmountMm} mm on next watering day`;
      nextAction            = `Water ${nextWateringAmountMm} mm`;
      nextActionDate        = nextWateringDate || '—';
      nextActionReason      = `Water deficit: ${waterDeficitMm} mm remaining this week`;

    } else if (fertDue) {
      lawnStatus            = 'Fertiliser due';
      primaryRecommendation = 'Apply fertiliser now — conditions are good';
      nextAction            = 'Apply fertiliser';
      nextActionDate        = fertNextDate || '—';
      nextActionReason      = fertStatus || 'Fertiliser interval reached';

    } else if (mowingRecommended) {
      lawnStatus            = 'Mowing window soon';
      primaryRecommendation = mowingStatus;
      nextAction            = nextMowingWindow !== '—'
        ? `Mow ${nextMowingWindow}`
        : 'Mow when ready';
      nextActionDate        = '—';
      nextActionReason      = 'Growth conditions are good for mowing';

    } else if (recoveryMode) {
      lawnStatus            = 'Recovery mode';
      primaryRecommendation = 'Lawn is recovering — avoid heavy disturbance';
      nextAction            = 'Avoid mowing';
      nextActionDate        = '—';
      nextActionReason      = 'Low growth score — grass is recovering';

    } else {
      // Healthy — check if rain is covering the watering need
      const rainCovering = waterReason === 'rain_covers_deficit' || waterReason === 'rain_expected_24h';
      lawnStatus            = 'Healthy';
      primaryRecommendation = rainCovering
        ? 'Rain expected — no watering needed'
        : 'No action needed';
      nextAction            = rainCovering ? 'Wait for rain' : 'No action needed';
      nextActionDate        = '—';
      nextActionReason      = rainCovering ? waterStatus : 'All conditions are good';
    }

    const overallScore = this._calcOverallScore(
      growthScore, waterDeficitMm, frostSeverity, heatStressSeverity, recoveryMode,
    );

    const badges = this._buildBadges({
      frostRisk, heatStressRisk, wateringDue, fertDue, mowingRecommended, recoveryMode,
    });

    return {
      overallScore,
      lawnStatus,
      primaryRecommendation,
      nextAction,
      nextActionDate,
      nextActionReason,
      badges,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _calcOverallScore(growthScore, waterDeficitMm, frostSeverity, heatStressSeverity, recoveryMode) {
    let score = growthScore;

    // Water deficit penalty
    if (waterDeficitMm > 10) score -= 10;
    if (waterDeficitMm > 20) score -= 10;

    // Frost penalty
    if (frostSeverity === 'light')    score -= 10;
    if (frostSeverity === 'moderate') score -= 20;
    if (frostSeverity === 'severe')   score -= 30;

    // Heat penalty
    if (heatStressSeverity === 'mild')     score -= 5;
    if (heatStressSeverity === 'moderate') score -= 15;
    if (heatStressSeverity === 'severe')   score -= 25;

    // Recovery mode slight penalty
    if (recoveryMode) score -= 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  _buildBadges({ frostRisk, heatStressRisk, wateringDue, fertDue, mowingRecommended, recoveryMode }) {
    const badges = [];
    if (frostRisk)         badges.push('frost');
    if (heatStressRisk)    badges.push('heat');
    if (wateringDue)       badges.push('water');
    if (fertDue)           badges.push('fertiliser');
    if (mowingRecommended) badges.push('mowing');
    if (recoveryMode)      badges.push('recovery');
    return badges;
  }
}

/**
 * @typedef {object} DashboardState
 * @property {number}   overallScore         0–100 composite lawn health score
 * @property {string}   lawnStatus           Short status label, e.g. "Healthy"
 * @property {string}   primaryRecommendation One-sentence recommendation
 * @property {string}   nextAction           Actionable string, e.g. "Water 8 mm"
 * @property {string}   nextActionDate       ISO date or "—"
 * @property {string}   nextActionReason     Why this action is needed
 * @property {string[]} badges               Active condition badges
 */

module.exports = LawnDashboardService;
