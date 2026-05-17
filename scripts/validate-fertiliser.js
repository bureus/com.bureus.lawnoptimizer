'use strict';

/**
 * Lawn Soil Optimizer — Fertiliser Schedule Validation Script
 *
 * Exercises FertiliserScheduleService with representative scenarios and
 * prints a pass / FAIL summary to stdout.
 *
 * Run:  node scripts/validate-fertiliser.js
 */

const FertiliserScheduleService = require('../lib/FertiliserScheduleService');

const svc = new FertiliserScheduleService();

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✔  ${label}`);
    passed++;
  } else {
    console.log(`  ✘  ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual  : ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertApprox(label, actual, expectedMin, expectedMax) {
  const ok = typeof actual === 'number' && actual >= expectedMin && actual <= expectedMax;
  if (ok) {
    console.log(`  ✔  ${label}  (${actual})`);
    passed++;
  } else {
    console.log(`  ✘  ${label}`);
    console.log(`       expected range: [${expectedMin}, ${expectedMax}]`);
    console.log(`       actual        : ${actual}`);
    failed++;
  }
}

function section(title) {
  console.log('');
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`);
}

// ─── Test cases ────────────────────────────────────────────────────────────────

section('No date configured');
{
  const r = svc.calculate({ lastFertiliserDate: null, today: '2026-06-15' });
  assert('due = false',             r.due,    false);
  assert('nextDate = null',         r.nextDate, null);
  assert('reason = no_date',        r.reason, 'no_date');
  assert('status mentions "Set"',   r.status.startsWith('Set'), true);
}

section('Basic scenario – task spec example');
{
  // lastFertiliserDate: 2026-05-11, intervalDays: 42, strategy: balanced
  // soilType: loam → offset 0 → nextDate = 2026-05-11 + 42 = 2026-06-22
  // today: 2026-06-15 → daysRemaining = 7, due = false
  const r = svc.calculate({
    lastFertiliserDate:   '2026-05-11',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         13,
    growthScore:          70,
    precipitationNext48h: 0,
    today:                '2026-06-15',
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('nextDate = 2026-06-22',   r.nextDate,      '2026-06-22');
  assert('due = false',             r.due,            false);
  assertApprox('daysRemaining ≈ 7', r.daysRemaining,  6, 8);
  assert('reason = scheduled',      r.reason,         'scheduled');
}

section('Due – all conditions met');
{
  const r = svc.calculate({
    lastFertiliserDate:   '2026-04-01',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         15,
    growthScore:          65,
    precipitationNext48h: 0,
    today:                '2026-05-20',   // 49 days after = 7 days overdue
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('due = true',  r.due,   true);
  assert('reason = due', r.reason, 'due');
}

section('Due with ideal rain');
{
  const r = svc.calculate({
    lastFertiliserDate:   '2026-04-01',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         15,
    growthScore:          65,
    precipitationNext48h: 6,   // between min(2) and max(15)
    today:                '2026-05-20',
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('due = true',                        r.due,  true);
  assert('status mentions "light rain"',      r.status.includes('light rain'), true);
}

section('Blocked – heavy rain');
{
  const r = svc.calculate({
    lastFertiliserDate:   '2026-04-01',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         15,
    growthScore:          65,
    precipitationNext48h: 20,  // > max(15)
    today:                '2026-05-20',
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('due = false',             r.due,   false);
  assert('reason = heavy_rain',     r.reason, 'heavy_rain');
  assert('status mentions "rain"',  r.status.toLowerCase().includes('rain'), true);
}

section('Blocked – soil too cold');
{
  const r = svc.calculate({
    lastFertiliserDate:   '2026-04-01',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         7,   // < minSoilTemp(10)
    growthScore:          60,
    precipitationNext48h: 0,
    today:                '2026-05-20',
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('due = false',              r.due,   false);
  assert('reason = soil_too_cold',   r.reason, 'soil_too_cold');
}

section('Blocked – outside season');
{
  const r = svc.calculate({
    lastFertiliserDate:   '2026-09-01',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         15,
    growthScore:          60,
    precipitationNext48h: 0,
    today:                '2026-11-20',  // November, outside Apr–Oct
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('due = false',                r.due,   false);
  assert('reason = outside_season',    r.reason, 'outside_season');
  assert('status = Outside…',          r.status, 'Outside fertiliser season');
}

section('Strategy modifiers');
{
  // baseline: 2026-05-11 + 42 = 2026-06-22 (balanced, loam)
  const base = svc.calculate({
    lastFertiliserDate: '2026-05-11', intervalDays: 42, strategy: 'balanced',
    soilType: 'loam', rootZoneTemp: 15, growthScore: 60,
    precipitationNext48h: 0, today: '2026-05-12',
    seasonStartMonth: 4, seasonEndMonth: 10, minSoilTemp: 10, rainWindowMin: 2, rainWindowMax: 15,
  });
  const cons = svc.calculate({
    lastFertiliserDate: '2026-05-11', intervalDays: 42, strategy: 'conservative',
    soilType: 'loam', rootZoneTemp: 15, growthScore: 60,
    precipitationNext48h: 0, today: '2026-05-12',
    seasonStartMonth: 4, seasonEndMonth: 10, minSoilTemp: 10, rainWindowMin: 2, rainWindowMax: 15,
  });
  const aggr = svc.calculate({
    lastFertiliserDate: '2026-05-11', intervalDays: 42, strategy: 'aggressive',
    soilType: 'loam', rootZoneTemp: 15, growthScore: 60,
    precipitationNext48h: 0, today: '2026-05-12',
    seasonStartMonth: 4, seasonEndMonth: 10, minSoilTemp: 10, rainWindowMin: 2, rainWindowMax: 15,
  });
  assert('balanced  nextDate = 2026-06-22', base.nextDate, '2026-06-22');
  assert('conserv.  nextDate = 2026-07-06', cons.nextDate, '2026-07-06'); // +14
  assert('aggressive nextDate = 2026-06-15', aggr.nextDate, '2026-06-15'); // -7
}

section('Soil type modifiers');
{
  const sand = svc.calculate({
    lastFertiliserDate: '2026-05-11', intervalDays: 42, strategy: 'balanced',
    soilType: 'sand', rootZoneTemp: 15, growthScore: 60,
    precipitationNext48h: 0, today: '2026-05-12',
    seasonStartMonth: 4, seasonEndMonth: 10, minSoilTemp: 10, rainWindowMin: 2, rainWindowMax: 15,
  });
  const clay = svc.calculate({
    lastFertiliserDate: '2026-05-11', intervalDays: 42, strategy: 'balanced',
    soilType: 'clay', rootZoneTemp: 15, growthScore: 60,
    precipitationNext48h: 0, today: '2026-05-12',
    seasonStartMonth: 4, seasonEndMonth: 10, minSoilTemp: 10, rainWindowMin: 2, rainWindowMax: 15,
  });
  assert('sand nextDate = 2026-06-15', sand.nextDate, '2026-06-15'); // -7
  assert('clay nextDate = 2026-06-29', clay.nextDate, '2026-06-29'); // +7
}

section('Overdue + blocked (status says "Due, but delayed")');
{
  const r = svc.calculate({
    lastFertiliserDate:   '2026-04-01',
    intervalDays:         42,
    strategy:             'balanced',
    soilType:             'loam',
    rootZoneTemp:         7,   // cold – blocks
    growthScore:          60,
    precipitationNext48h: 0,
    today:                '2026-06-01',   // 61 days → overdue by 19 days
    seasonStartMonth:     4,
    seasonEndMonth:       10,
    minSoilTemp:          10,
    rainWindowMin:        2,
    rainWindowMax:        15,
  });
  assert('due = false',                        r.due,   false);
  assert('status contains "Due, but delayed"', r.status.includes('Due, but delayed'), true);
}

section('Date helper: addDays / differenceInDays / parseIsoDate / formatIsoDate');
{
  const { parseIsoDate, formatIsoDate, addDays, differenceInDays } = FertiliserScheduleService;

  assert('parseIsoDate null for empty',      parseIsoDate(''), null);
  assert('parseIsoDate null for bad format', parseIsoDate('20260511'), null);
  const d = parseIsoDate('2026-05-11');
  assert('parseIsoDate returns Date',        d instanceof Date, true);
  assert('formatIsoDate round-trips',        formatIsoDate(d), '2026-05-11');

  const d2 = addDays(d, 42);
  assert('addDays(2026-05-11, 42) = 2026-06-22', formatIsoDate(d2), '2026-06-22');

  const diff = differenceInDays(d2, d);
  assert('differenceInDays = 42', diff, 42);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log('─'.repeat(60));
console.log(`  ${passed + failed} tests   ${passed} passed   ${failed} failed`);
console.log('─'.repeat(60));

if (failed > 0) process.exitCode = 1;
