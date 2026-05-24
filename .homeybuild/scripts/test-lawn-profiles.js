'use strict';

const { calculateLawnOptimization, PROFILES } = require('../lib/LawnProfileOptimizationService');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function scenario(title, params, checks) {
  console.log(`\n── ${title} ──`);
  const result = calculateLawnOptimization(params);
  console.log(`   status: ${result.status}  height: ${result.recommendedHeightMm} mm  freq: ${result.mowingFrequencyDays} d  quality: ${result.visualQualityScore}`);
  console.log(`   reason: ${result.mowingHeightAdjustmentReason}`);
  console.log(`   recs: ${result.recommendations.join(' | ')}`);
  checks(result);
}

// ─── Scenarios ─────────────────────────────────────────────────────────────────

scenario('Heat stress — balanced profile', {
  lawnProfile:          'balanced',
  targetGrassHeightMm:  40,
  minHeightMm:          30,
  maxHeightMm:          55,
  rootZoneTemp:         30,
  growthScore:          45,
  heatStressRisk:       true,
  frostRisk:            false,
  waterDeficitMm:       5,
  grassGrowthSpeed:     'medium',
  desiredVisualQuality: 'balanced',
  soilType:             'loam',
  shadeLevel:           'full_sun',
  season:               'summer',
  mowingFrequencyStrategy: 'adaptive',
}, (r) => {
  assert(r.recommendedHeightMm > 40,        'Height raised above target during heat stress',   `got ${r.recommendedHeightMm}`);
  assert(r.mowingFrequencyDays > 7,         'Mowing interval extended during heat stress',     `got ${r.mowingFrequencyDays}`);
  assert(r.wateringAdjustmentPercent > 0,   'Watering increased during heat stress',           `got ${r.wateringAdjustmentPercent}`);
  assert(r.status === 'heat_stress_management', 'Status is heat_stress_management');
  assert(r.recommendations.some(s => s.toLowerCase().includes('heat')), 'Recommendation mentions heat');
});

scenario('Drought scenario — drought_resistant profile', {
  lawnProfile:          'drought_resistant',
  targetGrassHeightMm:  60,
  minHeightMm:          50,
  maxHeightMm:          75,
  rootZoneTemp:         26,
  growthScore:          40,
  heatStressRisk:       false,
  frostRisk:            false,
  waterDeficitMm:       18,
  grassGrowthSpeed:     'slow',
  desiredVisualQuality: 'functional',
  soilType:             'sand',
  shadeLevel:           'full_sun',
  season:               'summer',
  mowingFrequencyStrategy: 'adaptive',
}, (r) => {
  assert(r.recommendedHeightMm >= 60,         'Height at or above drought-resistant target',  `got ${r.recommendedHeightMm}`);
  assert(r.mowingFrequencyDays >= 14,         'Mowing interval extended for drought',          `got ${r.mowingFrequencyDays}`);
  assert(r.wateringAdjustmentPercent < 0,     'Watering reduced for drought-resistant profile', `got ${r.wateringAdjustmentPercent}`);
  assert(r.status === 'drought_resistant_mode' || r.status === 'slow_growth_mode',
    'Status is drought-relevant', `got ${r.status}`);
  assert(r.recommendations.some(s => s.includes('drought') || s.includes('Drought')), 'Recommendation mentions drought');
  assert(r.stressToleranceAdjustment > 0,    'Stress tolerance elevated for drought profile');
});

scenario('Premium showcase lawn — spring growth', {
  lawnProfile:          'showcase',
  targetGrassHeightMm:  25,
  minHeightMm:          20,
  maxHeightMm:          35,
  rootZoneTemp:         18,
  growthScore:          80,
  heatStressRisk:       false,
  frostRisk:            false,
  waterDeficitMm:       2,
  grassGrowthSpeed:     'fast',
  desiredVisualQuality: 'premium',
  soilType:             'loam',
  shadeLevel:           'full_sun',
  season:               'spring',
  mowingFrequencyStrategy: 'adaptive',
}, (r) => {
  assert(r.mowingFrequencyDays <= 5,          'Short mowing interval for showcase + fast growth', `got ${r.mowingFrequencyDays}`);
  assert(r.visualQualityScore >= 75,          'High visual quality score for premium showcase',   `got ${r.visualQualityScore}`);
  assert(r.wateringAdjustmentPercent > 0,     'Watering increased for showcase profile',          `got ${r.wateringAdjustmentPercent}`);
  assert(r.fertiliserAdjustmentPercent > 0,   'Fertiliser increased for showcase profile',        `got ${r.fertiliserAdjustmentPercent}`);
  assert(r.stressToleranceAdjustment < 0,     'Lower stress tolerance for showcase (acts sooner)');
  assert(r.recommendations.some(s => s.includes('Premium') || s.includes('spring')), 'Recommendation mentions premium/spring');
});

scenario('Shade lawn — partial shade', {
  lawnProfile:          'shade_lawn',
  targetGrassHeightMm:  55,
  minHeightMm:          45,
  maxHeightMm:          70,
  rootZoneTemp:         15,
  growthScore:          50,
  heatStressRisk:       false,
  frostRisk:            false,
  waterDeficitMm:       0,
  grassGrowthSpeed:     'slow',
  desiredVisualQuality: 'balanced',
  soilType:             'clay',
  shadeLevel:           'partial_shade',
  season:               'summer',
  mowingFrequencyStrategy: 'adaptive',
}, (r) => {
  assert(r.recommendedHeightMm >= 55,         'Height at or above shade-lawn target',           `got ${r.recommendedHeightMm}`);
  assert(r.mowingFrequencyDays >= 12,         'Mowing interval extended for shade lawn',        `got ${r.mowingFrequencyDays}`);
  assert(r.wateringAdjustmentPercent < 0,     'Watering reduced for shaded lawn',               `got ${r.wateringAdjustmentPercent}`);
  assert(r.recommendations.some(s => s.includes('shade') || s.includes('slow')), 'Recommendation reflects shade/slow');
});

scenario('Low maintenance lawn — winter', {
  lawnProfile:          'low_maintenance',
  targetGrassHeightMm:  70,
  minHeightMm:          60,
  maxHeightMm:          90,
  rootZoneTemp:         4,
  growthScore:          10,
  heatStressRisk:       false,
  frostRisk:            true,
  waterDeficitMm:       0,
  grassGrowthSpeed:     'slow',
  desiredVisualQuality: 'functional',
  soilType:             'loam',
  shadeLevel:           'full_sun',
  season:               'winter',
  mowingFrequencyStrategy: 'fixed',
}, (r) => {
  assert(r.fertiliserAdjustmentPercent === -100, 'Fertiliser blocked in winter/frost');
  assert(r.mowingFrequencyDays >= 21,         'Long mowing interval for low maintenance',       `got ${r.mowingFrequencyDays}`);
  assert(r.status === 'frost_protection',     'Frost protection status');
  assert(r.wateringAdjustmentPercent < 0,     'Watering reduced in winter');
});

scenario('Custom profile — user-defined heights', {
  lawnProfile:          'custom',
  targetGrassHeightMm:  45,
  minHeightMm:          35,
  maxHeightMm:          55,
  rootZoneTemp:         20,
  growthScore:          65,
  heatStressRisk:       false,
  frostRisk:            false,
  waterDeficitMm:       3,
  grassGrowthSpeed:     'medium',
  desiredVisualQuality: 'balanced',
  soilType:             'loam',
  shadeLevel:           'full_sun',
  season:               'summer',
  mowingFrequencyStrategy: 'adaptive',
}, (r) => {
  assert(r.recommendedHeightMm >= 35 && r.recommendedHeightMm <= 55,
    'Custom profile respects user height bounds', `got ${r.recommendedHeightMm}`);
  assert(r.status === 'normal', 'Normal status for mild conditions', `got ${r.status}`);
});

// ─── Profile constant checks ───────────────────────────────────────────────────

console.log('\n── Profile definition checks ──');
for (const [id, def] of Object.entries(PROFILES)) {
  assert(typeof def.targetHeightMm === 'number', `${id}: targetHeightMm is number`);
  assert(def.minHeightMm <= def.targetHeightMm,  `${id}: min ≤ target`);
  assert(def.targetHeightMm <= def.maxHeightMm,  `${id}: target ≤ max`);
  assert(def.mowingFrequencyDays >= 2,           `${id}: mowingFrequencyDays ≥ 2`);
  assert(def.wateringMultiplier > 0,             `${id}: wateringMultiplier > 0`);
  assert(def.fertiliserMultiplier >= 0,          `${id}: fertiliserMultiplier ≥ 0`);
}

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
