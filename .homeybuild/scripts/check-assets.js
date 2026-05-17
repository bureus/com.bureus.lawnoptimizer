'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Asset manifest ────────────────────────────────────────────────────────────
// Each entry: { file, required, note }
//   required = true  → failure if missing
//   required = false → warning only (generated assets, store-only)

const ASSETS = [

  // ── App icons (always required by Homey SDK) ──────────────────────────────
  { file: 'assets/icon.svg',  required: true,  note: 'App SVG icon (Homey SDK default)' },
  { file: 'assets/icon.png',  required: false, note: 'App PNG icon — export from icon.svg at 512×512' },

  // ── Driver icons ──────────────────────────────────────────────────────────
  {
    file: 'drivers/lawn_soil_optimizer/assets/icon.svg',
    required: true,
    note: 'Driver SVG icon (Homey SDK default)',
  },
  {
    file: 'drivers/lawn_soil_optimizer/assets/icon.png',
    required: false,
    note: 'Driver PNG icon — export at 512×512',
  },
  {
    file: 'drivers/lawn_soil_optimizer/assets/device.png',
    required: false,
    note: 'Device illustration — export at 512×512',
  },

  // ── Capability icons ──────────────────────────────────────────────────────
  { file: 'assets/icons/lawn_growth_score.svg', required: true, note: 'Growth score capability icon' },
  { file: 'assets/icons/frost_risk.svg',     required: true,  note: 'Frost risk capability icon' },
  { file: 'assets/icons/heat_stress.svg',    required: true,  note: 'Heat stress capability icon' },
  { file: 'assets/icons/watering.svg',       required: true,  note: 'Watering recommendation icon' },
  { file: 'assets/icons/mowing.svg',         required: true,  note: 'Mowing recommendation icon' },
  { file: 'assets/icons/fertilizing.svg',    required: true,  note: 'Fertilizing recommendation icon' },
  { file: 'assets/icons/fertiliser_due.svg', required: true,  note: 'Fertiliser due capability icon' },

  // ── Marketing / store images (optional during development) ───────────────
  {
    file: 'assets/images/pairing-hero.png',
    required: false,
    note: 'Pairing UI hero image — 1280×720 px — see docs/image-prompts/pairing-hero.md',
  },
  {
    file: 'assets/images/soil-temperature-cutaway.png',
    required: false,
    note: 'Soil cutaway diagram — 1200×800 px — see docs/image-prompts/soil-temperature-cutaway.md',
  },
  {
    file: 'assets/images/store-banner.png',
    required: false,
    note: 'Source banner for store screenshots — 1920×1080 px — see docs/image-prompts/store-banner.md',
  },

  // ── Homey store screenshot slots (only needed for App Store submission) ───
  {
    file: 'assets/images/small.png',
    required: false,
    note: 'Store screenshot small — 500×350 px (add "images" block to app.json when ready)',
  },
  {
    file: 'assets/images/large.png',
    required: false,
    note: 'Store screenshot large — 1000×700 px',
  },
  {
    file: 'assets/images/xlarge.png',
    required: false,
    note: 'Store screenshot xlarge — 1920×1080 px',
  },
  {
    file: 'drivers/lawn_soil_optimizer/assets/small.png',
    required: false,
    note: 'Driver store screenshot small — 500×350 px',
  },
  {
    file: 'drivers/lawn_soil_optimizer/assets/large.png',
    required: false,
    note: 'Driver store screenshot large — 1000×700 px',
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

function check() {
  let missing   = 0;
  let warnings  = 0;
  let ok        = 0;

  const missingRequired = [];
  const missingOptional = [];

  for (const asset of ASSETS) {
    const abs = path.join(ROOT, asset.file);
    if (fs.existsSync(abs)) {
      console.log(`  ✔  ${asset.file}`);
      ok++;
    } else if (asset.required) {
      console.log(`  ✘  ${asset.file}  [REQUIRED]`);
      console.log(`       → ${asset.note}`);
      missingRequired.push(asset);
      missing++;
    } else {
      console.log(`  ⚠  ${asset.file}  [optional]`);
      console.log(`       → ${asset.note}`);
      missingOptional.push(asset);
      warnings++;
    }
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log(`  ${ok} present   ${missing} required missing   ${warnings} optional missing`);
  console.log('─'.repeat(60));

  if (missingRequired.length > 0) {
    console.log('');
    console.log('ACTION REQUIRED — add these files before running the app:');
    for (const a of missingRequired) {
      console.log(`  • ${a.file}`);
    }
    process.exitCode = 1;
  }

  if (missingOptional.length > 0) {
    console.log('');
    console.log('Optional assets not yet generated (app will still run):');
    for (const a of missingOptional) {
      console.log(`  • ${a.file}`);
      console.log(`    ${a.note}`);
    }
  }

  if (missing === 0 && warnings === 0) {
    console.log('');
    console.log('All assets present. Ready to publish.');
  }
}

console.log('');
console.log('Lawn Soil Optimizer — Asset Check');
console.log('─'.repeat(60));
check();
