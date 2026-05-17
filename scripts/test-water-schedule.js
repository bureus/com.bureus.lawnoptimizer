'use strict';

/**
 * Manual validation script for WaterScheduleService.
 * Run: node scripts/test-water-schedule.js
 *
 * All 4 scenarios from the spec plus additional edge-case coverage.
 */

const WaterScheduleService = require('../lib/WaterScheduleService');

const svc = new WaterScheduleService();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}`);
    failed++;
  }
}

function assertEq(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertApprox(actual, expected, label, tolerance = 0.15) {
  const ok = Math.abs(actual - expected) <= tolerance;
  assert(ok, `${label}: expected ≈${expected}, got ${actual}`);
}

function run(label, params, checks) {
  console.log(`\n${label}`);
  try {
    const result = svc.calculate(params);
    checks(result);
  } catch (err) {
    console.error(`  ERROR  Unexpected exception: ${err.message}`);
    failed++;
  }
}

// ─── Scenario A ──────────────────────────────────────────────────────────────
// Weekly target 25 mm, rain this week 10 mm, irrigation 0 mm, forecast 24h 0 mm
// Expected: deficit 15 mm, watering recommended true

run('Scenario A – basic deficit, watering recommended', {
  today:                      '2026-05-12', // Monday
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      10,
  manualRainThisWeekMm:       0,
  manualIrrigationThisWeekMm: 0,
  measuredRainThisWeekMm:     0,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  soilType:                   'loam',
  shadeLevel:                 'full_sun',
  strategy:                   'balanced',
  preferredWateringDays:      'MON,WED,SAT',
  preferredWateringTime:      '06:00',
  minSoilTemp:                8,
  rootZoneTemp:               12,
}, (r) => {
  assertEq(r.waterDeficitMm, 15, 'water deficit');
  assertEq(r.wateringRecommended, true, 'watering recommended');
  assertEq(r.wateringDue, true, 'watering due');
  assert(r.nextWateringDate !== null, 'next watering date set');
  assertEq(r.rainThisWeekMm, 10, 'rain this week');
  assertEq(r.totalWaterThisWeekMm, 10, 'total water this week');
});

// ─── Scenario B ──────────────────────────────────────────────────────────────
// Weekly target 25 mm, rain this week 20 mm, forecast next 24h 10 mm
// Expected: watering delayed / not due

run('Scenario B – rain expected 24h, watering delayed', {
  today:                      '2026-05-12',
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      20,
  manualRainThisWeekMm:       0,
  manualIrrigationThisWeekMm: 0,
  measuredRainThisWeekMm:     0,
  forecastRainNext24hMm:      10,
  forecastRainNext7DaysMm:    10,
  soilType:                   'loam',
  shadeLevel:                 'full_sun',
  strategy:                   'balanced',
  minSoilTemp:                8,
  rootZoneTemp:               14,
}, (r) => {
  assertEq(r.wateringDue, false, 'watering not due');
  assertEq(r.wateringRecommended, false, 'watering not recommended');
  assert(r.reason === 'rain_expected_24h' || r.reason === 'rain_covers_deficit' || r.reason === 'target_reached',
    `reason is delay/cover: ${r.reason}`);
});

// ─── Scenario C ──────────────────────────────────────────────────────────────
// Weekly target 25 mm, rain this week 30 mm
// Expected: target reached, no watering

run('Scenario C – target exceeded, no watering needed', {
  today:                      '2026-05-14',
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      30,
  manualRainThisWeekMm:       0,
  manualIrrigationThisWeekMm: 0,
  measuredRainThisWeekMm:     0,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  rootZoneTemp:               15,
}, (r) => {
  assertEq(r.waterDeficitMm, 0, 'zero deficit');
  assertEq(r.wateringDue, false, 'watering not due');
  assertEq(r.wateringRecommended, false, 'watering not recommended');
  assertEq(r.reason, 'target_reached', 'reason: target reached');
  assert(r.status.includes('target reached') || r.status.includes('No watering'), `status: ${r.status}`);
});

// ─── Scenario D ──────────────────────────────────────────────────────────────
// Heat stress true, deficit 20 mm
// Expected: smaller watering amount (≤8 mm), due true

run('Scenario D – heat stress, reduced watering amount', {
  today:                      '2026-07-02', // Wednesday
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      5,
  manualRainThisWeekMm:       0,
  manualIrrigationThisWeekMm: 0,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  heatStressRisk:             true,
  rootZoneTemp:               30,
  maxHeatStressTemp:          28,
  soilType:                   'loam',
  strategy:                   'balanced',
  minSoilTemp:                8,
  preferredWateringDays:      'MON,WED,SAT',
}, (r) => {
  assertEq(r.wateringDue, true, 'watering due');
  assert(r.nextWateringAmountMm <= 8, `heat-stress capped amount ≤8 mm (got ${r.nextWateringAmountMm})`);
  assert(r.status.toLowerCase().includes('heat') || r.status.toLowerCase().includes('water'),
    `status mentions heat or water: ${r.status}`);
});

// ─── Scenario E – soil too cold ───────────────────────────────────────────────
run('Scenario E – soil too cold, watering blocked', {
  today:                      '2026-03-01',
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      0,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  rootZoneTemp:               4,
  minSoilTemp:                8,
}, (r) => {
  assertEq(r.wateringDue, false, 'watering not due');
  assertEq(r.reason, 'too_cold', 'reason: too cold');
});

// ─── Scenario F – strategy modifiers ─────────────────────────────────────────
run('Scenario F – conservative strategy reduces suggested amount', {
  today:                      '2026-05-19', // Monday
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      5,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  rootZoneTemp:               14,
  strategy:                   'conservative',
  preferredWateringDays:      'MON,WED,SAT',
}, (r_cons) => {
  const baseline = svc.calculate({
    today: '2026-05-19', weeklyTargetMm: 25, weatherRainThisWeekMm: 5,
    forecastRainNext24hMm: 0, forecastRainNext7DaysMm: 0, rootZoneTemp: 14, strategy: 'balanced',
    preferredWateringDays: 'MON,WED,SAT',
  });
  assert(r_cons.nextWateringAmountMm <= baseline.nextWateringAmountMm,
    `conservative (${r_cons.nextWateringAmountMm}) ≤ balanced (${baseline.nextWateringAmountMm})`);
});

// ─── Scenario G – sand soil modifier ─────────────────────────────────────────
run('Scenario G – sand soil increases effective target', {
  today:                      '2026-05-12',
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      20,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  rootZoneTemp:               14,
  soilType:                   'sand',
  strategy:                   'balanced',
  preferredWateringDays:      'MON,WED,SAT',
}, (r) => {
  // Sand target = 25 * 1.2 = 30 mm, rain 20 mm → deficit 10 mm
  assert(r.waterDeficitMm > 0, `sand soil still has deficit (${r.waterDeficitMm} mm)`);
  // Same scenario with loam: 25 - 20 = 5 mm deficit → sand deficit should be larger
  const loam = svc.calculate({
    today: '2026-05-12', weeklyTargetMm: 25, weatherRainThisWeekMm: 20,
    forecastRainNext24hMm: 0, forecastRainNext7DaysMm: 0, rootZoneTemp: 14,
    soilType: 'loam', strategy: 'balanced',
  });
  assert(r.waterDeficitMm > loam.waterDeficitMm,
    `sand deficit (${r.waterDeficitMm}) > loam deficit (${loam.waterDeficitMm})`);
});

// ─── Scenario H – preferred watering date ────────────────────────────────────
run('Scenario H – next watering date falls on a preferred day', {
  today:                      '2026-05-12', // Tuesday
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      0,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  rootZoneTemp:               14,
  strategy:                   'balanced',
  preferredWateringDays:      'MON,WED,SAT', // next preferred = Wednesday
}, (r) => {
  assert(r.wateringDue, 'watering due');
  // Preferred day from Tuesday should be Wednesday (2026-05-13)
  assert(r.nextWateringDate !== null, 'next watering date set');
  const d = new Date(r.nextWateringDate + 'T00:00:00Z');
  // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  assert([1, 3, 6].includes(d.getUTCDay()),
    `next date ${r.nextWateringDate} is on a preferred day (got UTC day ${d.getUTCDay()})`);
});

// ─── Scenario I – manual irrigation counts toward total ──────────────────────
run('Scenario I – manual irrigation reduces deficit', {
  today:                      '2026-05-12',
  weeklyTargetMm:             25,
  weatherRainThisWeekMm:      5,
  manualIrrigationThisWeekMm: 15,
  forecastRainNext24hMm:      0,
  forecastRainNext7DaysMm:    0,
  rootZoneTemp:               14,
}, (r) => {
  // 5 mm rain + 15 mm irrigation = 20 mm total → deficit 5 mm
  assertEq(r.totalWaterThisWeekMm, 20, 'total water = rain + irrigation');
  assertEq(r.waterDeficitMm, 5, 'deficit reduced by irrigation');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Some tests FAILED.');
  process.exit(1);
} else {
  console.log('All tests PASSED.');
}
