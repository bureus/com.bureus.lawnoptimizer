'use strict';

// ─── Built-in profile definitions ──────────────────────────────────────────────

const PROFILES = {
  showcase: {
    label:                    'Showcase Lawn',
    targetHeightMm:           25,
    minHeightMm:              20,
    maxHeightMm:              35,
    mowingFrequencyDays:      4,
    wateringMultiplier:       1.25,
    fertiliserMultiplier:     1.20,
    stressToleranceDelta:     -10,   // lower tolerance → acts sooner
    heatMowingHeightBump:     8,
    droughtMowingHeightBump:  5,
  },
  balanced: {
    label:                    'Balanced',
    targetHeightMm:           40,
    minHeightMm:              30,
    maxHeightMm:              55,
    mowingFrequencyDays:      7,
    wateringMultiplier:       1.00,
    fertiliserMultiplier:     1.00,
    stressToleranceDelta:     0,
    heatMowingHeightBump:     10,
    droughtMowingHeightBump:  8,
  },
  drought_resistant: {
    label:                    'Drought Resistant',
    targetHeightMm:           60,
    minHeightMm:              50,
    maxHeightMm:              75,
    mowingFrequencyDays:      14,
    wateringMultiplier:       0.70,
    fertiliserMultiplier:     0.80,
    stressToleranceDelta:     +15,  // higher tolerance → acts later
    heatMowingHeightBump:     12,
    droughtMowingHeightBump:  15,
  },
  low_maintenance: {
    label:                    'Low Maintenance',
    targetHeightMm:           70,
    minHeightMm:              60,
    maxHeightMm:              90,
    mowingFrequencyDays:      21,
    wateringMultiplier:       0.80,
    fertiliserMultiplier:     0.60,
    stressToleranceDelta:     +20,
    heatMowingHeightBump:     10,
    droughtMowingHeightBump:  10,
  },
  shade_lawn: {
    label:                    'Shade Lawn',
    targetHeightMm:           55,
    minHeightMm:              45,
    maxHeightMm:              70,
    mowingFrequencyDays:      12,
    wateringMultiplier:       0.85,
    fertiliserMultiplier:     0.90,
    stressToleranceDelta:     +5,
    heatMowingHeightBump:     10,
    droughtMowingHeightBump:  8,
  },
  custom: {
    label:                    'Custom',
    targetHeightMm:           40,
    minHeightMm:              30,
    maxHeightMm:              60,
    mowingFrequencyDays:      7,
    wateringMultiplier:       1.00,
    fertiliserMultiplier:     1.00,
    stressToleranceDelta:     0,
    heatMowingHeightBump:     10,
    droughtMowingHeightBump:  8,
  },
};

// ─── Season helpers ─────────────────────────────────────────────────────────────

const SEASON_MULTIPLIERS = {
  spring: { watering: 0.90, fertiliser: 1.10, mowingFreq: 0.80 },
  summer: { watering: 1.20, fertiliser: 1.00, mowingFreq: 1.00 },
  autumn: { watering: 0.80, fertiliser: 0.80, mowingFreq: 1.10 },
  winter: { watering: 0.40, fertiliser: 0.00, mowingFreq: 2.00 },
};

function detectSeason(month) {
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 6 && month <= 8)  return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

// ─── Growth speed multipliers ────────────────────────────────────────────────────

const GROWTH_SPEED_FREQ_MULT = { slow: 1.50, medium: 1.00, fast: 0.65 };

// ─── Visual quality score ────────────────────────────────────────────────────────

function calcVisualQualityScore({
  lawnProfile,
  recommendedHeightMm,
  targetHeightMm,
  heatStressRisk,
  frostRisk,
  growthScore,
  desiredVisualQuality,
}) {
  let score = growthScore ?? 50;

  // Penalise height deviation from target
  const heightDelta = Math.abs(recommendedHeightMm - targetHeightMm);
  score -= Math.min(20, heightDelta * 0.5);

  // Stress penalty
  if (heatStressRisk) score -= 15;
  if (frostRisk)      score -= 20;

  // Profile bonus / penalty
  if (lawnProfile === 'showcase')  score += 10;
  if (lawnProfile === 'low_maintenance') score -= 5;

  // Visual quality target adjustment
  if (desiredVisualQuality === 'premium')    score = Math.min(100, score + 8);
  if (desiredVisualQuality === 'functional') score = Math.max(0,   score - 8);

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─── Main export ──────────────────────────────────────────────────────────────────

/**
 * calculateLawnOptimization
 *
 * Pure function. Computes recommended mowing height, watering/fertiliser
 * adjustments, mowing frequency, and a status summary based on the active
 * lawn profile and current environmental conditions.
 *
 * @param {object} params
 * @param {string}  params.lawnProfile          - showcase | balanced | drought_resistant | low_maintenance | shade_lawn | custom
 * @param {number}  params.targetGrassHeightMm  - user-configured target height (mm)
 * @param {number}  params.minHeightMm          - user-configured minimum height (mm)
 * @param {number}  params.maxHeightMm          - user-configured maximum height (mm)
 * @param {number}  params.rootZoneTemp         - current root-zone temperature (°C)
 * @param {number}  params.growthScore          - 0–100 growth score
 * @param {boolean} params.heatStressRisk       - heat stress flag
 * @param {boolean} params.frostRisk            - frost flag
 * @param {number}  params.waterDeficitMm       - current water deficit (mm)
 * @param {string}  params.grassGrowthSpeed     - slow | medium | fast
 * @param {string}  params.desiredVisualQuality - premium | balanced | functional
 * @param {string}  params.soilType             - sand | loam | clay
 * @param {string}  params.shadeLevel           - full_sun | partial_shade | shade
 * @param {string}  params.season               - spring | summer | autumn | winter (optional; auto-detected if omitted)
 * @param {string}  params.mowingFrequencyStrategy - adaptive | fixed
 * @returns {object} optimization result
 */
function calculateLawnOptimization({
  lawnProfile           = 'balanced',
  targetGrassHeightMm   = 40,
  minHeightMm           = 30,
  maxHeightMm           = 60,
  rootZoneTemp          = 12,
  growthScore           = 50,
  heatStressRisk        = false,
  frostRisk             = false,
  waterDeficitMm        = 0,
  grassGrowthSpeed      = 'medium',
  desiredVisualQuality  = 'balanced',
  soilType              = 'loam',
  shadeLevel            = 'full_sun',
  season                = null,
  mowingFrequencyStrategy = 'adaptive',
}) {
  const profile = PROFILES[lawnProfile] ?? PROFILES.balanced;

  // For 'custom' profile the user-supplied heights take priority
  const baseTargetMm = lawnProfile === 'custom' ? targetGrassHeightMm : profile.targetHeightMm;
  const baseMinMm    = lawnProfile === 'custom' ? minHeightMm         : profile.minHeightMm;
  const baseMaxMm    = lawnProfile === 'custom' ? maxHeightMm         : profile.maxHeightMm;

  const resolvedSeason = season ?? detectSeason(new Date().getUTCMonth() + 1);
  const seasonMult     = SEASON_MULTIPLIERS[resolvedSeason] ?? SEASON_MULTIPLIERS.summer;

  // ── Recommended mowing height ──────────────────────────────────────────────

  let recommendedHeightMm = baseTargetMm;
  const reasons           = [];

  if (heatStressRisk) {
    recommendedHeightMm += profile.heatMowingHeightBump;
    reasons.push(`Increase mowing height during heat stress`);
  }

  if (frostRisk) {
    recommendedHeightMm = Math.max(recommendedHeightMm, baseMaxMm);
    reasons.push('Maintain maximum height during frost');
  }

  if (waterDeficitMm > 10) {
    recommendedHeightMm += profile.droughtMowingHeightBump;
    reasons.push('Delay mowing to improve drought resistance');
  }

  if (growthScore >= 70 && resolvedSeason === 'spring') {
    recommendedHeightMm = Math.max(baseMinMm, recommendedHeightMm - 5);
    reasons.push('Lower mowing height gradually for spring growth');
  }

  if (shadeLevel === 'shade' || shadeLevel === 'partial_shade') {
    recommendedHeightMm = Math.max(recommendedHeightMm, baseTargetMm + 8);
    reasons.push('Maintain higher grass height for shade');
  }

  recommendedHeightMm = Math.round(Math.max(baseMinMm, Math.min(baseMaxMm, recommendedHeightMm)));

  const mowingHeightAdjustmentReason = reasons.length > 0
    ? reasons.join('. ')
    : `${profile.label} mode active`;

  // ── Mowing frequency ───────────────────────────────────────────────────────

  let mowingFrequencyDays = profile.mowingFrequencyDays;

  if (mowingFrequencyStrategy === 'adaptive') {
    // Growth speed adjustment
    const growthMult = GROWTH_SPEED_FREQ_MULT[grassGrowthSpeed] ?? 1.0;
    mowingFrequencyDays = mowingFrequencyDays * growthMult;

    // Season adjustment
    mowingFrequencyDays = mowingFrequencyDays * (seasonMult.mowingFreq ?? 1.0);

    // Stress adjustments
    if (heatStressRisk)  mowingFrequencyDays *= 1.35;
    if (frostRisk)       mowingFrequencyDays *= 2.00;
    if (waterDeficitMm > 10) mowingFrequencyDays *= 1.25;

    // Low growth score → extend interval
    if (growthScore < 30) mowingFrequencyDays *= 1.50;
  }

  mowingFrequencyDays = Math.round(Math.max(2, Math.min(60, mowingFrequencyDays)));

  // ── Watering adjustment ────────────────────────────────────────────────────

  let wateringAdjustmentPercent = Math.round((profile.wateringMultiplier * seasonMult.watering - 1) * 100);

  if (heatStressRisk)       wateringAdjustmentPercent += 20;
  if (waterDeficitMm > 10)  wateringAdjustmentPercent += 10;
  if (frostRisk)            wateringAdjustmentPercent = Math.min(wateringAdjustmentPercent, -30);
  if (shadeLevel === 'shade' || shadeLevel === 'partial_shade') wateringAdjustmentPercent -= 10;

  wateringAdjustmentPercent = Math.round(Math.max(-60, Math.min(60, wateringAdjustmentPercent)));

  // ── Fertiliser adjustment ──────────────────────────────────────────────────

  let fertiliserAdjustmentPercent = Math.round((profile.fertiliserMultiplier * seasonMult.fertiliser - 1) * 100);

  if (frostRisk)                     fertiliserAdjustmentPercent = -100; // block
  if (resolvedSeason === 'winter')   fertiliserAdjustmentPercent = -100; // block
  if (growthScore < 30)              fertiliserAdjustmentPercent -= 20;

  fertiliserAdjustmentPercent = Math.round(Math.max(-100, Math.min(50, fertiliserAdjustmentPercent)));

  // ── Stress tolerance adjustment ────────────────────────────────────────────

  const stressToleranceAdjustment = profile.stressToleranceDelta;

  // ── Visual quality score ───────────────────────────────────────────────────

  const visualQualityScore = calcVisualQualityScore({
    lawnProfile,
    recommendedHeightMm,
    targetHeightMm: baseTargetMm,
    heatStressRisk,
    frostRisk,
    growthScore,
    desiredVisualQuality,
  });

  // ── Status summary ─────────────────────────────────────────────────────────

  let status;
  if (frostRisk) {
    status = 'frost_protection';
  } else if (heatStressRisk && waterDeficitMm > 10) {
    status = 'drought_protection';
  } else if (heatStressRisk) {
    status = 'heat_stress_management';
  } else if (lawnProfile === 'showcase' && growthScore >= 60) {
    status = 'premium_growth_mode';
  } else if (lawnProfile === 'drought_resistant') {
    status = 'drought_resistant_mode';
  } else if (lawnProfile === 'low_maintenance') {
    status = 'low_maintenance_mode';
  } else if (growthScore >= 70 && resolvedSeason === 'spring') {
    status = 'spring_growth_mode';
  } else if (growthScore < 30) {
    status = 'slow_growth_mode';
  } else {
    status = 'normal';
  }

  // ── Human-readable recommendations ────────────────────────────────────────

  const recommendations = _buildRecommendations({
    status,
    lawnProfile,
    recommendedHeightMm,
    mowingFrequencyDays,
    wateringAdjustmentPercent,
    fertiliserAdjustmentPercent,
    heatStressRisk,
    frostRisk,
    waterDeficitMm,
    growthScore,
    resolvedSeason,
    grassGrowthSpeed,
  });

  return {
    recommendedHeightMm,
    mowingFrequencyDays,
    wateringAdjustmentPercent,
    fertiliserAdjustmentPercent,
    stressToleranceAdjustment,
    visualQualityScore,
    status,
    mowingHeightAdjustmentReason,
    profileLabel: profile.label,
    recommendations,
  };
}

// ─── Recommendation text builder ───────────────────────────────────────────────

function _buildRecommendations({
  status,
  lawnProfile,
  recommendedHeightMm,
  mowingFrequencyDays,
  wateringAdjustmentPercent,
  fertiliserAdjustmentPercent,
  heatStressRisk,
  frostRisk,
  waterDeficitMm,
  growthScore,
  resolvedSeason,
  grassGrowthSpeed,
}) {
  const recs = [];

  if (frostRisk) {
    recs.push(`Frost protection mode — avoid mowing. Raise mower to ${recommendedHeightMm} mm.`);
  } else if (heatStressRisk && waterDeficitMm > 10) {
    recs.push(`Heat stress detected — raise mowing height to ${recommendedHeightMm} mm.`);
    recs.push('Drought protection mode active — reduce mowing frequency.');
    recs.push(`Increase watering by ${wateringAdjustmentPercent > 0 ? '+' : ''}${wateringAdjustmentPercent}%.`);
  } else if (heatStressRisk) {
    recs.push(`Heat stress detected — raise mowing height to ${recommendedHeightMm} mm.`);
  } else if (waterDeficitMm > 10) {
    recs.push(`Drought risk — delay mowing to improve drought resistance.`);
  }

  if (status === 'spring_growth_mode') {
    recs.push(`Spring growth accelerating — lower mowing height gradually to ${recommendedHeightMm} mm.`);
    recs.push(`Increase mowing frequency to every ${mowingFrequencyDays} days.`);
  }

  if (lawnProfile === 'showcase' && !heatStressRisk && !frostRisk) {
    recs.push(`Premium growth mode active — maintain mowing height at ${recommendedHeightMm} mm.`);
  }

  if (lawnProfile === 'drought_resistant') {
    recs.push(`Drought resistant mode active — mow every ${mowingFrequencyDays} days at ${recommendedHeightMm} mm.`);
  }

  if (lawnProfile === 'low_maintenance') {
    recs.push(`Low maintenance mode — mow every ${mowingFrequencyDays} days.`);
  }

  if (grassGrowthSpeed === 'slow' && !heatStressRisk && !frostRisk) {
    recs.push(`Reduce mowing frequency due to slow growth — next mow in ${mowingFrequencyDays} days.`);
  }

  if (fertiliserAdjustmentPercent === -100) {
    recs.push('Fertiliser blocked — conditions not suitable.');
  } else if (fertiliserAdjustmentPercent > 0) {
    recs.push(`Increase fertiliser application by ${fertiliserAdjustmentPercent}%.`);
  } else if (fertiliserAdjustmentPercent < -20) {
    recs.push(`Reduce fertiliser application by ${Math.abs(fertiliserAdjustmentPercent)}%.`);
  }

  if (recs.length === 0) {
    recs.push(`${PROFILES[lawnProfile]?.label ?? 'Balanced'} — conditions nominal.`);
  }

  return recs;
}

// ─── Notification text helper ────────────────────────────────────────────────────

/**
 * Returns a short notification string based on optimization status.
 * Returns null when no notification is warranted.
 */
function buildProfileNotification(optimizationResult, prevStatus) {
  const { status, recommendedHeightMm, lawnProfile } = optimizationResult;

  if (status === prevStatus) return null;

  const msgs = {
    heat_stress_management: `Heat stress detected — raise mowing height to ${recommendedHeightMm} mm.`,
    drought_protection:     `Drought protection mode active. Raise mowing height to ${recommendedHeightMm} mm.`,
    frost_protection:       `Frost risk — avoid mowing. Mower height set to ${recommendedHeightMm} mm.`,
    premium_growth_mode:    'Premium growth mode active.',
    drought_resistant_mode: 'Drought resistant mode active.',
    spring_growth_mode:     `Spring growth accelerating — lower mowing height gradually to ${recommendedHeightMm} mm.`,
    slow_growth_mode:       'Slow growth — reducing mowing frequency.',
  };

  return msgs[status] ?? null;
}

module.exports = { calculateLawnOptimization, buildProfileNotification, PROFILES };
