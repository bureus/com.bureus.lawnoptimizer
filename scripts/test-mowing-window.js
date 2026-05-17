'use strict';

/**
 * Validation script for MowingWindowService.
 *
 * Run from project root:
 *   node scripts/test-mowing-window.js
 */

const MowingWindowService = require('../lib/MowingWindowService');

const svc = new MowingWindowService();

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function runScenario(name, params, checks) {
  console.log(`\n── ${name} ──`);
  const result = svc.calculate(params);
  console.log(`   status: "${result.status}"`);
  console.log(`   reason: "${result.reason}"  score: ${result.mowingWindowScore}`);
  console.log(`   safe: ${result.mowingSafe}  recommended: ${result.mowingRecommended}  blocked: ${result.mowingBlocked}`);
  console.log(`   nextWindow: ${result.nextMowingWindow}`);
  checks(result);
}

const BASE_SETTINGS = {
  mowing_enabled:                        true,
  mowing_min_soil_temp:                  8,
  mowing_max_heat_stress_temp:           28,
  mowing_max_precipitation_next_24h_mm:  4,
  mowing_block_hours_after_rain:         8,
  mowing_block_hours_after_fertiliser:   48,
  mowing_min_growth_score:               40,
  mowing_avoid_high_moisture:            true,
  mowing_allow_during_heat_stress:       false,
};

// ── Scenario 1: Frost Risk ────────────────────────────────────────────────────
runScenario('Scenario 1: Frost Risk', {
  today:                   '2026-04-15',
  rootZoneTemp:            2,
  growthScore:             30,
  frostRisk:               true,
  heatStressRisk:          false,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            55,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                BASE_SETTINGS,
}, (r) => {
  assert('mowingSafe is false',    r.mowingSafe === false,    `got ${r.mowingSafe}`);
  assert('mowingBlocked is true',  r.mowingBlocked === true,  `got ${r.mowingBlocked}`);
  assert('reason is frost_risk',   r.reason === 'frost_risk', `got ${r.reason}`);
  assert('windowScore is 0',       r.mowingWindowScore === 0, `got ${r.mowingWindowScore}`);
  assert('nextWindow is set',      !!r.nextMowingWindow,      `got ${r.nextMowingWindow}`);
});

// ── Scenario 2: Wet Grass (heavy recent rain) ─────────────────────────────────
runScenario('Scenario 2: Wet Grass — Heavy Recent Rain', {
  today:                   '2026-05-10',
  rootZoneTemp:            14,
  growthScore:             65,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  18,
  precipitationNext24hMm:  2,
  soilMoisture:            85,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                BASE_SETTINGS,
}, (r) => {
  assert('mowingSafe is false',        r.mowingSafe === false,      `got ${r.mowingSafe}`);
  assert('mowingBlocked is true',      r.mowingBlocked === true,    `got ${r.mowingBlocked}`);
  assert('reason is recent_rain',      r.reason === 'recent_rain',  `got ${r.reason}`);
  assert('mowingRecommended is false', r.mowingRecommended === false);
});

// ── Scenario 3: Ideal Spring Mowing ──────────────────────────────────────────
runScenario('Scenario 3: Ideal Spring Mowing', {
  today:                   '2026-05-19',  // Tuesday (May 19, 2026 = TUE)
  rootZoneTemp:            16,
  growthScore:             75,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            45,
  lastFertiliserDate:      '2026-03-01',  // Long ago — no block
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                BASE_SETTINGS,
}, (r) => {
  assert('mowingSafe is true',          r.mowingSafe === true,          `got ${r.mowingSafe}`);
  assert('mowingRecommended is true',   r.mowingRecommended === true,   `got ${r.mowingRecommended}`);
  assert('mowingBlocked is false',      r.mowingBlocked === false,      `got ${r.mowingBlocked}`);
  assert('windowScore >= 60',           r.mowingWindowScore >= 60,      `got ${r.mowingWindowScore}`);
  assert('nextWindow includes 14:00',   r.nextMowingWindow.includes('14:00'), `got ${r.nextMowingWindow}`);
  assert('nextWindow is today (TUE)',   r.nextMowingWindow.startsWith('2026-05-19'), `got ${r.nextMowingWindow}`);
});

// ── Scenario 4: Heat Stress ───────────────────────────────────────────────────
runScenario('Scenario 4: Heat Stress', {
  today:                   '2026-07-15',
  rootZoneTemp:            31,
  growthScore:             55,
  frostRisk:               false,
  heatStressRisk:          true,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            30,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                { ...BASE_SETTINGS, mowing_allow_during_heat_stress: false },
}, (r) => {
  assert('mowingSafe is false',       r.mowingSafe === false,      `got ${r.mowingSafe}`);
  assert('mowingBlocked is true',     r.mowingBlocked === true,    `got ${r.mowingBlocked}`);
  assert('reason is heat_stress',     r.reason === 'heat_stress',  `got ${r.reason}`);
});

// ── Scenario 4b: Heat Stress — Allow Enabled ─────────────────────────────────
runScenario('Scenario 4b: Heat Stress — Allow Enabled', {
  today:                   '2026-07-15',  // Tuesday
  rootZoneTemp:            29,
  growthScore:             55,
  frostRisk:               false,
  heatStressRisk:          true,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            40,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'aggressive',
  settings:                { ...BASE_SETTINGS, mowing_allow_during_heat_stress: true, mowing_avoid_high_moisture: true },
}, (r) => {
  assert('mowingSafe is true',      r.mowingSafe === true,    `got ${r.mowingSafe}`);
  assert('mowingBlocked is false',  r.mowingBlocked === false, `got ${r.mowingBlocked}`);
});

// ── Scenario 5: Fertiliser Block ─────────────────────────────────────────────
runScenario('Scenario 5: Fertiliser Block', {
  today:                   '2026-05-17',  // 1 day after fertilising
  rootZoneTemp:            15,
  growthScore:             70,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  1,
  soilMoisture:            50,
  lastFertiliserDate:      '2026-05-16',  // Yesterday — within 48h block
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                BASE_SETTINGS,
}, (r) => {
  assert('mowingSafe is false',          r.mowingSafe === false,          `got ${r.mowingSafe}`);
  assert('mowingBlocked is true',        r.mowingBlocked === true,        `got ${r.mowingBlocked}`);
  assert('reason is after_fertiliser',   r.reason === 'after_fertiliser', `got ${r.reason}`);
  assert('block reason mentions hours',  r.mowingBlockReason.includes('h'), `got "${r.mowingBlockReason}"`);
  // Next window should be after the block (skip today and tomorrow — TUE is next week)
  assert('nextWindow is in the future',  r.nextMowingWindow > '2026-05-17', `got ${r.nextMowingWindow}`);
});

// ── Scenario 6: Rain Drying Block (hoursSinceLastRain) ───────────────────────
runScenario('Scenario 6: Rain Drying Block', {
  today:                   '2026-05-21',  // Wednesday
  rootZoneTemp:            14,
  growthScore:             60,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  3,
  precipitationNext24hMm:  0,
  soilMoisture:            65,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  hoursSinceLastRain:      4,  // Only 4h since rain stopped (block = 8h)
  settings:                BASE_SETTINGS,
}, (r) => {
  assert('mowingSafe is false',       r.mowingSafe === false,    `got ${r.mowingSafe}`);
  assert('reason is rain_drying',     r.reason === 'rain_drying', `got ${r.reason}`);
});

// ── Scenario 7: Conservative Strategy — High Moisture ────────────────────────
runScenario('Scenario 7: Conservative Strategy — Moisture Block', {
  today:                   '2026-05-22',  // Friday
  rootZoneTemp:            14,
  growthScore:             65,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  1,
  precipitationNext24hMm:  0,
  soilMoisture:            65,  // Above conservative threshold of 60%
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'conservative',
  settings:                { ...BASE_SETTINGS, mowing_avoid_high_moisture: true },
}, (r) => {
  assert('mowingSafe is false',         r.mowingSafe === false,      `got ${r.mowingSafe}`);
  assert('reason is high_moisture',     r.reason === 'high_moisture', `got ${r.reason}`);
});

// ── Scenario 7b: Aggressive Strategy — Same Moisture Allowed ─────────────────
runScenario('Scenario 7b: Aggressive Strategy — Moisture Allowed', {
  today:                   '2026-05-22',  // Friday
  rootZoneTemp:            14,
  growthScore:             65,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            65,  // Below aggressive threshold of 80%
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'aggressive',
  settings:                { ...BASE_SETTINGS, mowing_avoid_high_moisture: true },
}, (r) => {
  assert('mowingSafe is true',       r.mowingSafe === true,     `got ${r.mowingSafe}`);
  assert('mowingBlocked is false',   r.mowingBlocked === false, `got ${r.mowingBlocked}`);
});

// ── Scenario 8: Low Growth Score ─────────────────────────────────────────────
runScenario('Scenario 8: Low Growth Score (early spring)', {
  today:                   '2026-03-20',
  rootZoneTemp:            9,
  growthScore:             25,  // Below minimum of 40
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            50,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                BASE_SETTINGS,
}, (r) => {
  assert('mowingBlocked is true',   r.mowingBlocked === true,  `got ${r.mowingBlocked}`);
  assert('reason is low_growth',    r.reason === 'low_growth', `got ${r.reason}`);
});

// ── Scenario 9: Mowing disabled ──────────────────────────────────────────────
runScenario('Scenario 9: Mowing Disabled', {
  today:                   '2026-05-20',
  rootZoneTemp:            16,
  growthScore:             75,
  frostRisk:               false,
  heatStressRisk:          false,
  precipitationLast24hMm:  0,
  precipitationNext24hMm:  0,
  soilMoisture:            45,
  lastFertiliserDate:      null,
  preferredMowingDays:     'TUE,FRI',
  preferredMowingTime:     '14:00',
  strategy:                'balanced',
  settings:                { ...BASE_SETTINGS, mowing_enabled: false },
}, (r) => {
  assert('mowingBlocked is true',          r.mowingBlocked === true,          `got ${r.mowingBlocked}`);
  assert('reason is mowing_disabled',      r.reason === 'mowing_disabled',    `got ${r.reason}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('All tests passed.');
}
