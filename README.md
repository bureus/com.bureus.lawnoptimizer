# Lawn Soil Optimizer — Homey App

A Homey virtual device that **estimates and tracks soil temperature** for grass and lawn
optimisation. It fetches hourly weather data from the free
[Open-Meteo](https://open-meteo.com/) API, runs a weighted soil-temperature model, and
surfaces actionable recommendations directly in Homey — with full Flow support.

---

## What the app does

| Capability | Description |
|---|---|
| **Soil Surface Temp** | 0 cm soil temperature (real or estimated) |
| **Soil Temp (6 cm)** | 6 cm depth (real or estimated) |
| **Root Zone Temp** | Weighted root-zone estimate used for scoring |
| **Air Temperature** | 2 m air temperature from Open-Meteo |
| **Soil Moisture** | Volumetric water content converted to 0–100 % |
| **Rain (24 h)** | Accumulated precipitation over the last 24 hours |
| **Growth Score** | 0–100 score based on root zone temperature and grass type |
| **Mowing Recommended** | Boolean: conditions are suitable for mowing |
| **Watering Recommended** | Boolean: soil is dry and rain has been low |
| **Fertilizing Recommended** | Boolean: grass is in active growth |
| **Frost Risk** | Boolean: root zone ≤ 2 °C or air temp ≤ 0 °C |
| **Heat Stress Risk** | Boolean: root zone > 28 °C or air temp > 32 °C |
| **Last Updated** | Timestamp of the last successful data fetch |

Data refreshes every hour by default (configurable down to 15 minutes).

---

## Requirements

- Homey Pro (any generation running Homey ≥ 5.0)  
- [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started) installed  
- Internet access (open-meteo.com is a free API, no key required)

---

## Installing locally with Homey CLI

```bash
# 1. Install the Homey CLI globally (once)
npm install -g homey

# 2. Log in
homey login

# 3. Clone / open the project folder
cd com.bureus.lawnoptimizer

# 4. Run the app on your Homey (hot-reload mode)
homey app run

# Or install permanently
homey app install
```

---

## Pairing a device

1. In the Homey app go to **Devices → + → Lawn Soil Optimizer**.  
2. The **setup screen** appears.  
   - Tap **"Use Homey's location"** to auto-fill lat/lon from your Homey, **or**  
   - Enter latitude and longitude manually (decimal degrees).  
3. Fill in the lawn name, grass type, soil type, shade level, and root depth.  
4. Tap **Next →** → confirm the device name → **Add**.

You can pair multiple devices if you have more than one lawn or garden area.

---

## Device settings (post-pairing)

All settings can be changed in **Device → Settings** without re-pairing:

| Setting | Default | Notes |
|---|---|---|
| Latitude / Longitude | from pairing | Decimal degrees |
| Lawn Name | My Lawn | Display label |
| Grass Type | Cool Season | Affects score thresholds |
| Soil Type | Loam | Sandy = faster reaction, Clay = slower |
| Shade Level | Full Sun | Reduces solar warming contribution |
| Root Depth (cm) | 6 | 5–10 cm typical for lawns |
| Update Interval (min) | 60 | Min 15, max 360 |
| Enable Notifications | off | Sends a Homey notification on each refresh |
| Min. Temp for Mowing | 8 °C | Mowing not recommended below this |
| Min. Temp for Fertilizing | 10 °C | Fertilizing not recommended below this |
| Watering Threshold (24 h rain) | 3 mm | If rain < threshold → consider watering |

---

## The soil temperature model

Open-Meteo provides measured soil temperatures at 0 cm, 6 cm, and 18 cm when
available. When they are present the app uses them directly. When they are missing
(some locations or older API responses) the model falls back to a weighted estimate.

### With API soil data (preferred path)

```
rootZone = 0.65 × soilTemp_6cm
         + 0.25 × avgAirTemp_24h
         + 0.10 × solarAdjustedSurfaceTemp
```

### Without API soil data (fallback)

```
rootZone = 0.70 × previousRootZone   (persistence / thermal inertia)
         + 0.25 × avgAirTemp_24h
         + 0.05 × currentAirTemp
```

Cold-start (no previous value): `rootZone = avgAirTemp_24h`

### Modifiers

| Factor | Effect |
|---|---|
| Sandy soil | Higher weight on new readings (reacts fast) |
| Clay soil | Higher weight on previous reading (thermal inertia) |
| Partial shade | Solar warming contribution × 0.6 |
| Full shade | Solar warming contribution × 0.2 |

The `previousRootZone` value is stored in Homey's device store and persists
across app restarts. Use the **"Reset soil model memory"** Flow action to clear it.

---

## Growth score bands

| Root zone temp | Growth state | Score range |
|---|---|---|
| < 0 °C | No growth | 0 |
| 0–5 °C | Dormant | 0–10 |
| 5–8 °C | Very slow | 10–25 |
| 8–12 °C | Early growth | 25–45 |
| 12–20 °C | Good growth | 45–70 |
| 20–25 °C | Strong growth | 70–90 |
| 25–28 °C | Plateau | 75–90 |
| > 28 °C | Heat stress | 40–75 |

Warm-season grasses (Bermuda, Zoysia…) have their optimal window shifted +4 °C.  
Mixed grass uses the average of cool-season and warm-season scores.

---

## Flow card examples

### Trigger: Start irrigation when root zone drops below 5 °C

```
WHEN  Root zone temperature drops below [5] °C  (device: My Lawn)
THEN  Turn on zone valve
```

### Trigger: Send notification when mowing is recommended

```
WHEN  Mowing recommendation changed  (device: My Lawn)
AND   Mowing is recommended          (device: My Lawn)
THEN  Send push notification "Time to mow!"
```

### Condition: Block robot mower during frost

```
WHEN  Mower dock button pressed
AND   Frost risk is NOT active  (device: My Lawn)
THEN  Send mower out
```

### Action: Seasonal profile switch

```
WHEN  Date is October 1
THEN  Set lawn profile – grass: Cool Season, soil: Loam  (device: My Lawn)
```

### Action: Force refresh after a rain shower

```
WHEN  Rain sensor detects rain stops
THEN  Refresh weather data now  (device: My Lawn)
```

---

## Fertiliser Scheduling

The app includes a built-in fertiliser calendar that tells you **when your next
application is due** and flags conditions that would make fertilising harmful or wasteful.

### How it works

1. **Set the last fertiliser date** — enter it during pairing, change it in device
   settings, or use the *"Mark fertilised today"* / *"Set last fertiliser date"* Flow
   actions at any time.
2. **The service calculates the next date** by adding the configured interval (default
   42 days / 6 weeks) to the last date, then applies two optional offset modifiers:

   | Setting | Effect on next date |
   |---|---|
   | Strategy: Conservative | + 14 days |
   | Strategy: Balanced (default) | ± 0 days |
   | Strategy: Aggressive | − 7 days |
   | Soil type: Sand | − 7 days (nutrients leach faster) |
   | Soil type: Loam (default) | ± 0 days |
   | Soil type: Clay | + 7 days (nutrients held longer) |

3. **Blocking conditions** — even when the date has passed, fertilising may be flagged
   as unsafe. Conditions are checked in priority order:

   | Reason code | When triggered |
   |---|---|
   | `no_date` | No last fertiliser date has been set |
   | `outside_season` | Today is outside the configured season window (default Apr–Oct) |
   | `soil_too_cold` | Root-zone temp < min soil temp (default 10 °C) |
   | `low_growth` | Growth score < 40 (grass is dormant or stressed) |
   | `warm_season_cool` | Warm-season grass and root zone < 18 °C |
   | `heavy_rain` | > 15 mm forecast in the next 48 h (fertiliser would wash away) |

4. **Ideal rain window** — if 2–15 mm is forecast in the next 48 h the status message
   mentions *"light rain expected"*, since a small amount of rain helps activate granular
   fertiliser without leaching it.

### Capabilities added

| Capability | Type | Description |
|---|---|---|
| `fertiliser_next_date` | string | ISO date of the next scheduled application |
| `fertiliser_days_remaining` | number | Days until (positive) or since (negative) that date |
| `fertiliser_due` | boolean | `true` when due date has passed and no blocking condition applies |
| `fertiliser_status` | string | Human-readable one-line summary |

### Example Homey Flows

**Notify when fertiliser is due and soil is warm enough:**
```
WHEN  Fertiliser due started         (device: My Lawn)
THEN  Send push notification "Time to fertilise!"
```

**Mark done from a virtual button:**
```
WHEN  Virtual button pressed
THEN  Mark fertilised today          (device: My Lawn)
```

**Pause irrigation after fertilising:**
```
WHEN  Last fertiliser date changed   (device: My Lawn)
THEN  Pause irrigation controller for 2 hours
```

**Warn when overdue but blocked by rain:**
```
WHEN  Fertiliser delayed             (device: My Lawn)
THEN  Send notification with reason token
```

**Conditional: skip mowing flow if fertiliser was just applied:**
```
WHEN  Mowing recommended changed     (device: My Lawn)
AND   Fertiliser days remaining > 3  (i.e. not freshly applied)
THEN  Send "Ready to mow" notification
```

### Validating the service logic

A self-contained validation script exercises the scheduling service against
representative scenarios:

```bash
npm run validate:fertiliser
```

It runs ~30 assertions (spec example, strategy offsets, soil modifiers, blocking
conditions, date helpers) and exits with code 0 on full pass.

---

## Limitations

- **No real soil sensor** — temperatures are estimated from weather data + the model.
  Accuracy depends on how well Open-Meteo covers your microclimate.
- **Single virtual device** — each device represents one lawn location. Pair additional
  devices for multiple areas.
- **No offline mode** — if Open-Meteo is unreachable the app logs the error and retries
  on the next poll. Capabilities retain their last known values.
- **Homey widgets** — the Homey SDK v3 does not expose a custom dashboard widget API
  for third-party apps. All data is visible on the device tile and in Homey Insights.
  A repair/settings view is available via Device → Settings.
- **Image assets** — placeholder 1×1 transparent PNGs exist for all paths.
  Run `npm run check:assets` to verify all slots are filled, then replace placeholders
  with production images before submitting to the Homey App Store.

---

## Image Assets

### Directory layout

```
assets/
├── icon.svg                        # App icon — SVG source (Homey SDK default)
├── icon.png                        # App icon — PNG export 512×512 px  ← PLACEHOLDER
├── icons/
│   ├── frost_risk.svg              # Capability icon (wired in app.json)
│   ├── heat_stress.svg             # Capability icon
│   ├── watering.svg                # Capability icon
│   ├── mowing.svg                  # Capability icon
│   └── fertilizing.svg             # Capability icon
└── images/
    ├── pairing-hero.png            # Pairing UI hero — 1280×720 px  ← PLACEHOLDER
    ├── soil-temperature-cutaway.png# Documentation diagram           ← PLACEHOLDER
    ├── store-banner.png            # Source for store screenshots    ← PLACEHOLDER
    ├── small.png                   # Homey store screenshot 500×350  ← PLACEHOLDER
    ├── large.png                   # Homey store screenshot 1000×700 ← PLACEHOLDER
    └── xlarge.png                  # Homey store screenshot 1920×1080← PLACEHOLDER

drivers/lawn_soil_optimizer/assets/
├── icon.svg                        # Driver icon — SVG source
├── icon.png                        # Driver icon — PNG 512×512       ← PLACEHOLDER
├── device.png                      # Device illustration 512×512     ← PLACEHOLDER
├── small.png                       # Driver store screenshot         ← PLACEHOLDER
└── large.png                       # Driver store screenshot         ← PLACEHOLDER
```

### Required sizes

| Asset | Size | Notes |
|---|---|---|
| `assets/icon.svg` | vector | Already present — SVG preferred |
| `assets/icon.png` | 512 × 512 px | Export from icon.svg |
| `assets/icons/*.svg` | vector (100×100 viewBox) | Already present — capability icons |
| `drivers/.../icon.svg` | vector | Already present |
| `drivers/.../icon.png` | 512 × 512 px | Export from driver icon.svg |
| `drivers/.../device.png` | 512 × 512 px | Device detail illustration |
| `assets/images/pairing-hero.png` | 1280 × 720 px | Pairing screen hero |
| `assets/images/store-banner.png` | 1920 × 1080 px | Source for store screenshots |
| `assets/images/small.png` | 500 × 350 px | Homey store (add `images` block to app.json) |
| `assets/images/large.png` | 1000 × 700 px | Homey store |
| `assets/images/xlarge.png` | 1920 × 1080 px | Homey store |

### Replacing placeholders

All `← PLACEHOLDER` files are valid 1×1 transparent PNGs that keep the app functional
during development. Replace them with real artwork before publishing:

1. Generate images using the prompts in [`docs/image-prompts/`](docs/image-prompts/)
2. Export as **PNG with transparent background** (PNG-24 + alpha)
3. Drop the file at the path shown in the table above
4. Run `npm run check:assets` — all lines should show ✔

### Enabling Homey store screenshots

The `images` block is intentionally absent from `app.json` during development
(Homey CLI validates that referenced files are present and correctly sized at install time).

Once real images are ready, add to the **root** of `app.json`:

```json
"images": {
  "small":  "./assets/images/small.png",
  "large":  "./assets/images/large.png",
  "xlarge": "./assets/images/xlarge.png"
}
```

And to the **driver** object:

```json
"images": {
  "small": "./drivers/lawn_soil_optimizer/assets/small.png",
  "large": "./drivers/lawn_soil_optimizer/assets/large.png"
}
```

### Asset validation

```bash
npm run check:assets
```

Prints a report of present (✔), required-missing (✘) and optional-missing (⚠) assets.
The script is at [`scripts/check-assets.js`](scripts/check-assets.js).

### Transparent PNG export tips

- Use **PNG-24** (not PNG-8) for icons with soft edges or anti-aliasing
- In Figma: *Export → PNG → 2× → include background colour: off*
- In Photoshop: *Save for Web → PNG-24 → Transparency: on*
- CLI: `pngquant --quality=80-95 --strip -- file.png`
- Verify transparency: `identify -verbose file.png | grep Alpha`

---

## Future improvements

- **Real soil sensor integration** — pair with a Bluetooth or Zigbee soil moisture/
  temperature probe for ground-truth readings; the model would switch to "correction mode".
- **Mower integration** — connect to Husqvarna Automower, Gardena, or Worx via their
  Homey apps; automatically pause/resume based on soil conditions.
- **Irrigation integration** — link to Rachio, Hunter, or Gardena water controllers;
  auto-schedule watering based on the soil moisture capability.
- **Homey Insights charts** — Growth Score, Root Zone Temp, and Soil Moisture are marked
  `insights: true` in `app.json` so they already appear in the Homey Insights timeline.
- **Push alerts** — the `enable_notifications` setting sends a Homey notification;
  a future version could send per-event alerts (frost warning, ideal mow window, etc.).
- **Multi-depth model** — expand to 18 cm and 54 cm layers for a more accurate picture of
  deep-root species like tall fescue.
- **Weather station integration** — prefer local temperature readings from a paired
  Netatmo / Davis / Oregon Scientific weather station over the Open-Meteo grid value.

---

## File structure

```
com.bureus.lawnoptimizer/
├── app.js                                   Main app – registers all flow cards
├── app.json                                 Manifest: capabilities, driver, flow cards
├── package.json
├── .homeyignore
├── locales/
│   └── en.json
├── assets/
│   ├── icon.svg                             App icon
│   └── images/                             ← add small/large/xlarge PNG here
├── lib/
│   ├── OpenMeteoClient.js                   HTTP client with retry/timeout
│   ├── SoilTemperatureModel.js              Weighted soil temp model
│   ├── LawnScoringService.js               Pure scoring / recommendation logic
│   ├── FertiliserScheduleService.js         Fertiliser calendar & blocking logic
│   ├── WaterScheduleService.js              Weekly water schedule (standalone)
│   └── DateHelpers.js                       ISO date utilities (shared)
├── scripts/
│   ├── check-assets.js                      Asset manifest validator
│   ├── validate-fertiliser.js               Fertiliser service regression tests
│   └── test-water-schedule.js               Water schedule validation scenarios
└── drivers/
    └── lawn_soil_optimizer/
        ├── driver.js                        Pairing + flow trigger helpers
        ├── device.js                        Polling, capability updates, store
        ├── assets/
        │   └── icon.svg                     Driver icon
        └── pair/
            └── start.html                   Custom pairing form
```

---

## Weekly water scheduling

The app tracks how much water your lawn receives each week and tells you when and how much to irrigate.

### How it works

The scheduler combines three sources of water into a weekly total:

| Source | How it enters |
|---|---|
| Weather forecast rain | Automatically from Open-Meteo (if **Use Weather Forecast Rain** is enabled) |
| Manual rain | Entered via Flow action **Add manual rain** or device setting |
| Manual irrigation | Entered via Flow action **Add manual irrigation** or **Mark lawn as watered** |

Every time the app refreshes it calculates:

```
totalWaterThisWeek = weatherRain + manualRain + manualIrrigation
waterDeficit       = weeklyTarget − totalWaterThisWeek   (minimum 0)
```

### Weekly target (mm)

The default target is **25 mm per week**. This is adjusted automatically for:

- **Soil type** — Sandy soil drains faster (+20 % effective target). Clay holds water longer (−10 %).
- **Shade** — Shaded lawns need less water: Partial shade −10 %, Full shade −20 %.
- **Grass type** — Warm-season grass gets a 10 % boost during hot weather.

### Watering strategy

| Strategy | Effect |
|---|---|
| Conservative | Suggests 20 % less than the calculated deficit per session |
| Balanced | Suggests exactly the deficit |
| Aggressive | Suggests 20 % more (may exceed single-session cap) |

Single-session maximum is 15 mm (except Aggressive strategy). Minimum actionable amount is 3 mm.

### Weather rules

- If forecast rain in the next 24 hours covers the deficit → watering is **delayed**.
- If forecast rain over the next 7 days covers the deficit → watering is **not recommended**.
- If root zone temperature is below `watering_min_soil_temp` (default 8 °C) → watering **blocked**.
- If heat stress is active or root zone > `watering_max_heat_stress_temp` (default 28 °C) → lighter watering (max 8 mm per session) with status suggesting repeat sessions.

### Weekly reset

Manual rain and irrigation counters reset automatically at the start of the week (configurable via **Weekly Reset Day**, default Monday). Historical values are logged before reset. You can also reset manually via the Flow action **Reset weekly water tracking**.

### Using a rain sensor

Homey cannot read another device's capability directly without a flow. Wire your rain sensor using a flow:

**Example 1 — Rain sensor feeds manual rain:**
```
WHEN  rain sensor detects rain
THEN  Add manual rain 5 mm  →  Lawn Soil Optimizer
```

**Example 2 — Notify when watering is due:**
```
WHEN  Watering became due
AND   Rain is not expected in the next 24 hours
THEN  Send notification "Time to water the lawn"
```

**Example 3 — Log irrigation after sprinkler runs:**
```
WHEN  Sprinkler zone completes
THEN  Add manual irrigation 8 mm  →  Lawn Soil Optimizer
```

### New capabilities

| Capability | Type | Description |
|---|---|---|
| `weekly_water_target_mm` | number | Effective weekly target (adjusted for soil/shade) |
| `rain_this_week_mm` | number | Total rain this week (weather + manual + sensor) |
| `irrigation_this_week_mm` | number | Irrigation applied this week |
| `total_water_this_week_mm` | number | Rain + irrigation combined |
| `water_deficit_mm` | number | Remaining water needed this week |
| `watering_due` | boolean | True when watering should happen today/next preferred day |
| `next_watering_date` | string | ISO date of next scheduled watering |
| `next_watering_amount_mm` | number | Suggested amount for next session |
| `water_schedule_status` | string | Human-readable schedule status |

### New flow cards

**Triggers:**
- Watering became due
- Watering is no longer due
- Water deficit rises above _N_ mm
- Weekly water target reached
- Water schedule status changed
- Watering delayed due to rain forecast
- Weekly water tracking reset

**Conditions:**
- Watering is/is not due
- Water deficit is/is not above _N_ mm
- Weekly water target is/is not reached
- Rain is/is not expected in the next 24 hours
- Enough rain is/is not forecast to cover weekly deficit

**Actions:**
- Add manual rain _N_ mm
- Set manual rain this week to _N_ mm
- Add manual irrigation _N_ mm
- Set manual irrigation this week to _N_ mm
- Reset weekly water tracking
- Mark lawn as watered now (_N_ mm)
- Refresh water schedule

### Running the validation script

```bash
node scripts/test-water-schedule.js
```

This runs 9 scenarios covering basic deficit, rain delay, target reached, heat stress, soil modifiers, and more.

---

## Mowing recommendations and robot mower safety

The **MowingWindowService** calculates whether it is currently safe and recommended to mow, and estimates the next optimal mowing window. It integrates with soil temperature, growth score, weather, soil moisture, fertiliser timing, and frost/heat logic.

### New capabilities

| Capability | Type | Description |
|---|---|---|
| **Mowing Safe** | boolean | All safety conditions currently pass |
| **Mowing Blocked** | boolean | A blocking condition is active |
| **Mowing Block Reason** | string | Human-readable explanation of the block |
| **Next Mowing Window** | string | Next preferred day/time with acceptable conditions, e.g. `2026-05-22 14:00` |
| **Mowing Window Score** | number (0–100) | Quality score for current mowing conditions |
| **Mowing Status** | string | Summary message, e.g. `Good mowing conditions` |

The existing **Mowing Recommended** capability is now driven by the window service (safe AND score ≥ 60).

### Blocking conditions

Mowing is blocked when **any** of the following apply:

| Condition | Setting |
|---|---|
| Frost risk active | — |
| Root zone temp below minimum | `mowing_min_soil_temp` (default 8 °C) |
| Precipitation last 24 h > 5 mm | — |
| Rain drying period not yet elapsed | `mowing_block_hours_after_rain` (default 8 h) |
| Forecast rain next 24 h too high | `mowing_max_precipitation_next_24h_mm` (default 4 mm) |
| Growth score too low | `mowing_min_growth_score` (default 40) |
| Fertiliser applied recently | `mowing_block_hours_after_fertiliser` (default 48 h) |
| Heat stress AND allow-heat-stress disabled | `mowing_allow_during_heat_stress` |
| Soil moisture too high for strategy | `mowing_avoid_high_moisture` |
| Manual block active | via flow action |

### Mowing strategy

| Strategy | Moisture limit | Behaviour |
|---|---|---|
| **Conservative** | 60 % | Prefers dry weather and strong growth |
| **Balanced** | 70 % | Standard thresholds (default) |
| **Aggressive** | 80 % | Allows mowing sooner, in wetter conditions |

### Window scoring (0–100)

| Factor | Max pts |
|---|---|
| No/low precipitation last 24 h | 25 |
| Moderate soil temperature (12–22 °C optimal) | 25 |
| Strong growth score | 25 |
| No frost risk | 10 |
| No heat stress | 10 |
| No rain forecast | 5 |

### Flow cards

**Triggers:**
- Mowing became safe
- Mowing is no longer safe
- Optimal mowing window started *(token: `window`)*
- Mowing was blocked *(token: `reason`)*
- Mowing block was removed
- Mowing recommendation state changed *(token: `recommended`)*

**Conditions:**
- Mowing is/is not safe
- Mowing is/is not blocked
- Mowing window score is/is not above _N_

**Actions:**
- Refresh mowing schedule
- Mark lawn as mowed now
- Block mowing for _N_ hours
- Clear mowing block

### Flow examples

```
WHEN mowing becomes unsafe THEN pause robot mower
WHEN ideal mowing window starts THEN notify user
WHEN fertiliser applied THEN block mowing for 48 h
WHEN mowing safe AND window score above 70 THEN start robot mower
WHEN frost risk detected THEN send notification "Avoid mowing tonight"
```

### Robot mower integration

`lib/RobotMowerIntegrationService.js` provides `pauseRobotMower()` and `resumeRobotMower()` as an abstraction layer. Currently a **mock implementation** — actual vendor API calls are marked with `// TODO` comments.

Planned integrations:
- **Husqvarna** Automower Connect API
- **Gardena** Smart System API
- **Mammotion** LUBA / YUKA cloud API
- **Worx** Landroid cloud API
- **Homey device integration** via `homey.devices`

Use the flow actions to manually control mowing and wire them to any smart device via Homey flows.

### Running the validation script

```bash
node scripts/test-mowing-window.js
```

Covers 9 scenarios: frost, heavy rain, ideal spring, heat stress, heat-stress-allowed, fertiliser block, rain drying, conservative/aggressive moisture, low growth, and mowing-disabled.

---

## License

MIT — see [LICENSE](LICENSE) for details.
