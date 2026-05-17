'use strict';

const Homey = require('homey');
const OpenMeteoClient           = require('../../lib/OpenMeteoClient');
const SoilTemperatureModel      = require('../../lib/SoilTemperatureModel');
const LawnScoringService        = require('../../lib/LawnScoringService');
const FertiliserScheduleService = require('../../lib/FertiliserScheduleService');
const WaterScheduleService      = require('../../lib/WaterScheduleService');
const { getWeekStartDate, formatIsoDate, parseIsoDate } = require('../../lib/DateHelpers');

// ── Persistent store keys ──────────────────────────────────────────────────────
const STORE_ROOT_ZONE      = 'previousRootZone';
const STORE_PREV_MOWING    = 'prevMowing';
const STORE_PREV_WATERING  = 'prevWatering';
const STORE_PREV_FERTILIZE = 'prevFertilizing';
const STORE_PREV_FROST     = 'prevFrost';
const STORE_PREV_HEAT      = 'prevHeat';
const STORE_PREV_STATUS    = 'prevStatus';
const STORE_PREV_SCORE     = 'prevScore';
const STORE_PREV_TEMP      = 'prevRootZoneTemp';

// Fertiliser scheduling store keys
const STORE_PREV_FERT_DUE     = 'prevFertiliserDue';
const STORE_PREV_FERT_DATE    = 'prevFertiliserNextDate';
const STORE_PREV_FERT_DELAYED = 'prevFertiliserDelayed';
const STORE_NOTIF_DUE_DATE    = 'fertiliserNotifDueDate';
const STORE_NOTIF_DELAY_DATE  = 'fertiliserNotifDelayedDate';
const STORE_NOTIF_WIN_DATE    = 'fertiliserNotifWindowDate';

// Water schedule store keys
const STORE_WATER_WEEK_START  = 'waterWeekStartDate';
const STORE_PREV_WATERING_DUE = 'prevWateringDue';
const STORE_PREV_WATER_STATUS = 'prevWaterStatus';
const STORE_PREV_DEFICIT      = 'prevWaterDeficit';
const STORE_WATER_FORECAST_24H  = 'waterForecastNext24h';
const STORE_WATER_FORECAST_7D   = 'waterForecastNext7Days';
const STORE_NOTIF_WATERING_DATE = 'waterNotifDate';

// Reason codes that indicate a blocking condition (not "due") for fertiliser
const BLOCKING_REASONS = new Set([
  'soil_too_cold', 'low_growth', 'heavy_rain', 'warm_season_cool', 'outside_season',
]);

// Water schedule reasons where watering is delayed due to forecast rain
const WATER_RAIN_DELAY_REASONS = new Set([
  'rain_expected_24h', 'rain_covers_deficit',
]);

class LawnSoilOptimizerDevice extends Homey.Device {

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onInit() {
    this.log(`Device "${this.getName()}" initialising…`);

    this._pollTimer      = null;
    this._client         = new OpenMeteoClient(this.log.bind(this));
    this._fertiliserService = new FertiliserScheduleService();
    this._waterService      = new WaterScheduleService();

    await this._startPolling();

    this.log(`Device "${this.getName()}" ready.`);
  }

  async onDeleted() {
    this.log(`Device "${this.getName()}" deleted – stopping poll timer.`);
    this._stopPolling();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys.join(', '));
    this._stopPolling();
    await this._startPolling();
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  async _startPolling() {
    await this.refreshData();

    const intervalMinutes = this.getSetting('update_interval_minutes') || 60;
    const intervalMs      = intervalMinutes * 60 * 1000;

    this._pollTimer = this.homey.setInterval(async () => {
      await this.refreshData();
    }, intervalMs);

    this.log(`Polling started – interval: ${intervalMinutes} min`);
  }

  _stopPolling() {
    if (this._pollTimer) {
      this.homey.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ─── Core data refresh ─────────────────────────────────────────────────────

  async refreshData() {
    const settings = this.getSettings();
    const { latitude, longitude } = settings;

    if (!latitude || !longitude) {
      this.log('No location set – skipping refresh');
      return;
    }

    try {
      this.log(`Fetching weather for (${latitude}, ${longitude})…`);

      const snapshot = await this._client.fetchCurrentConditions(latitude, longitude);

      const model   = new SoilTemperatureModel(settings);
      const scoring = new LawnScoringService(settings);

      const previousRootZone = this.getStoreValue(STORE_ROOT_ZONE) ?? null;

      const temps      = model.calculate(snapshot, previousRootZone);
      const assessment = scoring.assess(temps);

      await this.setStoreValue(STORE_ROOT_ZONE, temps.rootZone);

      // ── Weekly water reset check ─────────────────────────────────────────────
      await this._checkWeeklyWaterReset(settings);

      // ── Fertiliser schedule ──────────────────────────────────────────────────
      const fertResult = this._calcFertiliserSchedule(snapshot, settings, temps, assessment);

      // ── Water schedule ───────────────────────────────────────────────────────
      const waterResult = this._calcWaterSchedule(snapshot, settings, temps, assessment);

      await this._updateCapabilities(temps, assessment, fertResult, waterResult);
      await this._fireTriggers(temps, assessment, fertResult, waterResult);
      await this._checkFertiliserNotification(fertResult, settings);
      await this._checkWaterNotification(waterResult, settings);

      this.log(`Refresh complete – rootZone: ${temps.rootZone} °C, score: ${assessment.growthScore}, fertDue: ${fertResult.due}, waterDue: ${waterResult.wateringDue}`);
    } catch (err) {
      this.error('Failed to refresh data:', err.message);
    }
  }

  // ─── Weekly water reset ────────────────────────────────────────────────────

  async _checkWeeklyWaterReset(settings) {
    const resetWeekday   = settings.reset_water_weekday || 'MON';
    const todayDate      = parseIsoDate(new Date().toISOString().slice(0, 10));
    const weekStart      = getWeekStartDate(todayDate, resetWeekday);
    const weekStartStr   = formatIsoDate(weekStart);
    const storedWeekStart = this.getStoreValue(STORE_WATER_WEEK_START);

    if (storedWeekStart !== weekStartStr) {
      const prevManualRain  = settings.manual_rain_this_week_mm  ?? 0;
      const prevIrrigation  = settings.manual_irrigation_this_week_mm ?? 0;

      this.log(`Weekly water tracking reset: week started ${weekStartStr} (was ${storedWeekStart ?? 'not set'}). Resetting manual rain (${prevManualRain} mm) and irrigation (${prevIrrigation} mm).`);

      await this.setSettings({
        manual_rain_this_week_mm:        0,
        manual_irrigation_this_week_mm:  0,
      });
      await this.setStoreValue(STORE_WATER_WEEK_START, weekStartStr);

      // Fire weekly reset trigger only if we previously had a week start (not cold start)
      if (storedWeekStart) {
        this.driver.triggerWeeklyWaterReset(this);
      }
    }
  }

  // ─── Water schedule calculation ────────────────────────────────────────────

  _calcWaterSchedule(snapshot, settings, temps, assessment) {
    const today       = new Date().toISOString().slice(0, 10);
    const resetWeekday = settings.reset_water_weekday || 'MON';

    // Calculate weather rain this week from daily data
    let weatherRainThisWeekMm = 0;
    if (settings.use_weather_forecast_rain !== false && Array.isArray(snapshot.precipitationByDay)) {
      const todayDate  = parseIsoDate(today);
      const weekStart  = getWeekStartDate(todayDate, resetWeekday);
      const weekStartStr = formatIsoDate(weekStart);
      for (const { date, totalMm } of snapshot.precipitationByDay) {
        if (date >= weekStartStr && date <= today) {
          weatherRainThisWeekMm += totalMm;
        }
      }
      weatherRainThisWeekMm = Math.round(weatherRainThisWeekMm * 10) / 10;
    }

    const forecastRainNext24hMm  = snapshot.precipitationNext24h  ?? 0;
    const forecastRainNext7DaysMm = snapshot.precipitationNext7Days ?? 0;

    // Store forecast values for use in flow conditions
    this.setStoreValue(STORE_WATER_FORECAST_24H, forecastRainNext24hMm).catch(() => {});
    this.setStoreValue(STORE_WATER_FORECAST_7D,  forecastRainNext7DaysMm).catch(() => {});

    const manualRainMm       = settings.use_manual_rain_input !== false
      ? (settings.manual_rain_this_week_mm        ?? 0) : 0;
    const manualIrrigationMm = settings.use_manual_rain_input !== false
      ? (settings.manual_irrigation_this_week_mm  ?? 0) : 0;
    const measuredRainMm     = settings.use_rain_sensor_input === true
      ? 0 : 0; // rain sensor data comes via flow actions into manual_rain

    return this._waterService.calculate({
      today,
      weeklyTargetMm:             settings.weekly_water_target_mm        ?? 25,
      manualRainThisWeekMm:       manualRainMm,
      manualIrrigationThisWeekMm: manualIrrigationMm,
      measuredRainThisWeekMm:     measuredRainMm,
      weatherRainThisWeekMm,
      forecastRainNext24hMm,
      forecastRainNext7DaysMm,
      rootZoneTemp:               temps.rootZone,
      heatStressRisk:             assessment.heatStressRisk,
      grassType:                  settings.grass_type   || 'cool_season',
      soilType:                   settings.soil_type    || 'loam',
      shadeLevel:                 settings.shade_level  || 'full_sun',
      strategy:                   settings.water_schedule_strategy || 'balanced',
      preferredWateringDays:      settings.preferred_watering_days || 'MON,WED,SAT',
      preferredWateringTime:      settings.preferred_watering_time || '06:00',
      minSoilTemp:                settings.watering_min_soil_temp      ?? 8,
      maxHeatStressTemp:          settings.watering_max_heat_stress_temp ?? 28,
      resetWaterWeekday:          resetWeekday,
    });
  }

  // ─── Fertiliser schedule calculation ──────────────────────────────────────

  _calcFertiliserSchedule(snapshot, settings, temps, assessment) {
    return this._fertiliserService.calculate({
      lastFertiliserDate:    settings.last_fertiliser_date || null,
      intervalDays:          settings.fertiliser_interval_days    ?? 42,
      strategy:              settings.fertiliser_strategy         || 'balanced',
      grassType:             settings.grass_type                  || 'cool_season',
      soilType:              settings.soil_type                   || 'loam',
      rootZoneTemp:          temps.rootZone,
      growthScore:           assessment.growthScore,
      precipitationNext48h:  snapshot.precipitationNext48h        ?? 0,
      precipitationLast24h:  temps.rain24h                        ?? 0,
      today:                 null,
      seasonStartMonth:      settings.fertiliser_season_start_month ?? 4,
      seasonEndMonth:        settings.fertiliser_season_end_month   ?? 10,
      minSoilTemp:           settings.fertiliser_min_soil_temp      ?? 10,
      rainWindowMin:         settings.fertiliser_rain_window_mm_min ?? 2,
      rainWindowMax:         settings.fertiliser_rain_window_mm_max ?? 15,
    });
  }

  // ─── Capability updates ────────────────────────────────────────────────────

  async _updateCapabilities(temps, assessment, fertResult, waterResult) {
    const now = new Date().toLocaleString('sv-SE', { hour12: false });

    const updates = [
      ['measure_temperature.soil_surface', temps.soilSurface],
      ['measure_temperature.soil_6cm',     temps.soil6cm],
      ['measure_temperature.root_zone',    temps.rootZone],
      ['measure_temperature.air',          temps.airTemp],
      ['measure_humidity.soil',            temps.soilMoisturePct],
      ['measure_rain',                     temps.rain24h],
      ['lawn_growth_score',                assessment.growthScore],
      ['mowing_recommended',               assessment.mowingRecommended],
      // watering_recommended now driven by water schedule
      ['watering_recommended',             waterResult.wateringRecommended],
      ['fertilizing_recommended',          assessment.fertilizingRecommended],
      ['frost_risk',                       assessment.frostRisk],
      ['heat_stress_risk',                 assessment.heatStressRisk],
      ['last_updated',                     now],
      // Fertiliser capabilities
      ['fertiliser_next_date',      fertResult.nextDate ?? '—'],
      ['fertiliser_days_remaining', fertResult.daysRemaining ?? 0],
      ['fertiliser_due',            fertResult.due],
      ['fertiliser_status',         fertResult.status],
      // Water schedule capabilities
      ['weekly_water_target_mm',    this.getSetting('weekly_water_target_mm') ?? 25],
      ['rain_this_week_mm',         waterResult.rainThisWeekMm],
      ['irrigation_this_week_mm',   waterResult.irrigationThisWeekMm],
      ['total_water_this_week_mm',  waterResult.totalWaterThisWeekMm],
      ['water_deficit_mm',          waterResult.waterDeficitMm],
      ['watering_due',              waterResult.wateringDue],
      ['next_watering_date',        waterResult.nextWateringDate ?? '—'],
      ['next_watering_amount_mm',   waterResult.nextWateringAmountMm],
      ['water_schedule_status',     waterResult.status],
    ];

    for (const [cap, value] of updates) {
      if (value === null || value === undefined) continue;
      try {
        await this.setCapabilityValue(cap, value);
      } catch (err) {
        this.error(`Failed to set capability "${cap}":`, err.message);
      }
    }
  }

  // ─── Flow trigger logic ────────────────────────────────────────────────────

  async _fireTriggers(temps, assessment, fertResult, waterResult) {
    const driver = this.driver;

    // ── Existing lawn triggers ─────────────────────────────────────────────

    const prevMowing    = this.getStoreValue(STORE_PREV_MOWING);
    const prevWatering  = this.getStoreValue(STORE_PREV_WATERING);
    const prevFertilize = this.getStoreValue(STORE_PREV_FERTILIZE);
    const prevFrost     = this.getStoreValue(STORE_PREV_FROST);
    const prevHeat      = this.getStoreValue(STORE_PREV_HEAT);
    const prevStatus    = this.getStoreValue(STORE_PREV_STATUS);

    const { growthScore, mowingRecommended, wateringRecommended,
            fertilizingRecommended, frostRisk, heatStressRisk, statusText } = assessment;
    const rootZone = temps.rootZone;

    if (prevMowing !== null && prevMowing !== mowingRecommended)
      driver.triggerMowingChanged(this, mowingRecommended);
    if (prevWatering !== null && prevWatering !== wateringRecommended)
      driver.triggerWateringChanged(this, waterResult.wateringRecommended);
    if (prevFertilize !== null && prevFertilize !== fertilizingRecommended)
      driver.triggerFertilizingChanged(this, fertilizingRecommended);

    if (!prevFrost && frostRisk)      driver.triggerFrostRiskStarted(this);
    if (!prevHeat  && heatStressRisk) driver.triggerHeatStressStarted(this);

    driver.triggerSoilTempAbove(this, rootZone);
    driver.triggerSoilTempBelow(this, rootZone);
    driver.triggerGrowthScoreAbove(this, growthScore);

    if (prevStatus !== null && prevStatus !== statusText)
      driver.triggerLawnStatusChanged(this, statusText);

    await this.setStoreValue(STORE_PREV_MOWING,    mowingRecommended);
    await this.setStoreValue(STORE_PREV_WATERING,  waterResult.wateringRecommended);
    await this.setStoreValue(STORE_PREV_FERTILIZE, fertilizingRecommended);
    await this.setStoreValue(STORE_PREV_FROST,     frostRisk);
    await this.setStoreValue(STORE_PREV_HEAT,      heatStressRisk);
    await this.setStoreValue(STORE_PREV_STATUS,    statusText);
    await this.setStoreValue(STORE_PREV_SCORE,     growthScore);
    await this.setStoreValue(STORE_PREV_TEMP,      rootZone);

    // ── Fertiliser triggers ────────────────────────────────────────────────

    const prevFertDue     = this.getStoreValue(STORE_PREV_FERT_DUE);
    const prevFertDate    = this.getStoreValue(STORE_PREV_FERT_DATE);
    const prevFertDelayed = this.getStoreValue(STORE_PREV_FERT_DELAYED);

    const { due, nextDate, daysRemaining, reason } = fertResult;
    const isDelayed = BLOCKING_REASONS.has(reason) && (daysRemaining !== null && daysRemaining <= 0);

    if (prevFertDue === false && due === true)
      driver.triggerFertiliserDueStarted(this, nextDate);
    if (prevFertDue === true && due === false)
      driver.triggerFertiliserDueCleared(this);
    if (prevFertDate !== null && prevFertDate !== nextDate)
      driver.triggerFertiliserDateChanged(this, nextDate, daysRemaining);
    if (!prevFertDelayed && isDelayed)
      driver.triggerFertiliserDelayed(this, fertResult.status);

    await this.setStoreValue(STORE_PREV_FERT_DUE,     due);
    await this.setStoreValue(STORE_PREV_FERT_DATE,    nextDate);
    await this.setStoreValue(STORE_PREV_FERT_DELAYED, isDelayed);

    // ── Water schedule triggers ────────────────────────────────────────────

    const prevWateringDue  = this.getStoreValue(STORE_PREV_WATERING_DUE);
    const prevWaterStatus  = this.getStoreValue(STORE_PREV_WATER_STATUS);
    const prevDeficit      = this.getStoreValue(STORE_PREV_DEFICIT);

    const { wateringDue, waterDeficitMm, status: waterStatus, reason: waterReason } = waterResult;

    // Rising/falling edge on watering_due
    if (prevWateringDue === false && wateringDue === true)
      driver.triggerWateringDueStarted(this);
    if (prevWateringDue === true && wateringDue === false)
      driver.triggerWateringDueCleared(this);

    // Target reached (deficit crossed from > 0 to 0)
    if (prevDeficit !== null && prevDeficit > 0 && waterDeficitMm === 0)
      driver.triggerWeeklyWaterTargetReached(this);

    // Deficit threshold trigger
    if (waterDeficitMm > 0)
      driver.triggerWaterDeficitAbove(this, waterDeficitMm);

    // Watering delayed due to rain (rising edge)
    if (prevWaterStatus !== null && !WATER_RAIN_DELAY_REASONS.has(prevWaterStatus) && WATER_RAIN_DELAY_REASONS.has(waterReason))
      driver.triggerWateringDelayedDueToRain(this);

    // Status changed
    if (prevWaterStatus !== null && prevWaterStatus !== waterStatus)
      driver.triggerWaterScheduleChanged(this, waterStatus);

    await this.setStoreValue(STORE_PREV_WATERING_DUE, wateringDue);
    await this.setStoreValue(STORE_PREV_WATER_STATUS, waterReason);
    await this.setStoreValue(STORE_PREV_DEFICIT,      waterDeficitMm);
  }

  // ─── Fertiliser notifications ──────────────────────────────────────────────

  async _checkFertiliserNotification(fertResult, settings) {
    if (!settings.enable_notifications) return;

    const today = new Date().toISOString().slice(0, 10);
    const { due, daysRemaining, status, reason } = fertResult;

    const shouldNotify = async (storeKey) => {
      if (this.getStoreValue(storeKey) === today) return false;
      await this.setStoreValue(storeKey, today);
      return true;
    };

    if (due) {
      if (await shouldNotify(STORE_NOTIF_DUE_DATE)) {
        await this.homey.notifications.createNotification({
          excerpt: 'Your lawn is ready for fertiliser. Soil temperature and growth conditions look good.',
        });
      }
      return;
    }

    const isOverdue = daysRemaining !== null && daysRemaining <= 0;
    if (isOverdue && reason === 'heavy_rain') {
      if (await shouldNotify(STORE_NOTIF_DELAY_DATE)) {
        await this.homey.notifications.createNotification({
          excerpt: 'Fertiliser is due, but heavy rain is expected. Consider waiting a few days.',
        });
      }
      return;
    }

    if (daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3) {
      if (await shouldNotify(STORE_NOTIF_WIN_DATE)) {
        await this.homey.notifications.createNotification({
          excerpt: `Fertiliser window is coming up in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`,
        });
      }
    }
  }

  // ─── Water schedule notifications ─────────────────────────────────────────

  async _checkWaterNotification(waterResult, settings) {
    if (!settings.enable_notifications) return;

    const today = new Date().toISOString().slice(0, 10);
    const { wateringDue, waterDeficitMm, reason } = waterResult;

    const shouldNotify = async () => {
      if (this.getStoreValue(STORE_NOTIF_WATERING_DATE) === today) return false;
      await this.setStoreValue(STORE_NOTIF_WATERING_DATE, today);
      return true;
    };

    if (wateringDue && waterDeficitMm > 0) {
      if (await shouldNotify()) {
        await this.homey.notifications.createNotification({
          excerpt: `Your lawn needs water: ${waterDeficitMm} mm remaining this week.`,
        });
      }
      return;
    }

    if (reason === 'rain_expected_24h') {
      if (await shouldNotify()) {
        await this.homey.notifications.createNotification({
          excerpt: 'Watering delayed — rain expected within 24 hours.',
        });
      }
      return;
    }

    if (reason === 'target_reached') {
      if (await shouldNotify()) {
        await this.homey.notifications.createNotification({
          excerpt: 'Weekly water target reached. No watering needed.',
        });
      }
    }
  }

  // ─── Flow action handlers ──────────────────────────────────────────────────

  async sendLawnAdviceNotification() {
    const settings = this.getSettings();
    if (!settings.enable_notifications) return;

    const name  = settings.lawn_name || this.getName();
    const score = this.getCapabilityValue('lawn_growth_score') ?? '–';
    const temp  = this.getCapabilityValue('measure_temperature.root_zone') ?? '–';
    const mow   = this.getCapabilityValue('mowing_recommended')      ? '✓' : '✗';
    const water = this.getCapabilityValue('watering_recommended')     ? '✓' : '✗';
    const fert  = this.getCapabilityValue('fertilizing_recommended')  ? '✓' : '✗';
    const frost = this.getCapabilityValue('frost_risk')               ? '⚠ FROST RISK' : '';
    const heat  = this.getCapabilityValue('heat_stress_risk')         ? '⚠ HEAT STRESS' : '';
    const fertStatus  = this.getCapabilityValue('fertiliser_status') || '';
    const waterStatus = this.getCapabilityValue('water_schedule_status') || '';

    const message = [
      `🌱 ${name}`,
      `Root zone: ${temp} °C  |  Score: ${score}/100`,
      `Mow: ${mow}  Water: ${water}  Fertilize: ${fert}`,
      fertStatus  ? `Fertiliser: ${fertStatus}`   : '',
      waterStatus ? `Water schedule: ${waterStatus}` : '',
      frost, heat,
    ].filter(Boolean).join('\n');

    await this.homey.notifications.createNotification({ excerpt: message });
  }

  async resetModelMemory() {
    this.log('Resetting soil model memory');
    const keys = [
      STORE_ROOT_ZONE, STORE_PREV_TEMP, STORE_PREV_SCORE,
      STORE_PREV_MOWING, STORE_PREV_WATERING, STORE_PREV_FERTILIZE,
      STORE_PREV_FROST, STORE_PREV_HEAT, STORE_PREV_STATUS,
    ];
    for (const k of keys) await this.setStoreValue(k, null);
    await this.refreshData();
  }

  async setLastFertiliserDate(dateStr) {
    const trimmed = (dateStr || '').trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new Error(`Invalid date format "${trimmed}". Expected YYYY-MM-DD.`);
    }
    await this.setSettings({ last_fertiliser_date: trimmed });
    await this.refreshData();
  }

  // ── Water schedule action handlers ──────────────────────────────────────────

  async addManualRain(amountMm) {
    const amount = Math.max(0, Number(amountMm) || 0);
    const current = this.getSetting('manual_rain_this_week_mm') ?? 0;
    const newValue = Math.round((current + amount) * 10) / 10;
    this.log(`Manual rain: adding ${amount} mm (total this week: ${newValue} mm)`);
    await this.setSettings({ manual_rain_this_week_mm: newValue });
    await this.refreshData();
  }

  async setManualRain(amountMm) {
    const amount = Math.max(0, Number(amountMm) || 0);
    this.log(`Manual rain: set to ${amount} mm this week`);
    await this.setSettings({ manual_rain_this_week_mm: amount });
    await this.refreshData();
  }

  async addManualIrrigation(amountMm) {
    const amount = Math.max(0, Number(amountMm) || 0);
    const current = this.getSetting('manual_irrigation_this_week_mm') ?? 0;
    const newValue = Math.round((current + amount) * 10) / 10;
    this.log(`Manual irrigation: adding ${amount} mm (total this week: ${newValue} mm)`);
    await this.setSettings({ manual_irrigation_this_week_mm: newValue });
    await this.refreshData();
  }

  async setManualIrrigation(amountMm) {
    const amount = Math.max(0, Number(amountMm) || 0);
    this.log(`Manual irrigation: set to ${amount} mm this week`);
    await this.setSettings({ manual_irrigation_this_week_mm: amount });
    await this.refreshData();
  }

  async resetWeeklyWaterTracking() {
    const settings = this.getSettings();
    this.log(`Manual weekly water tracking reset. Clearing manual rain (${settings.manual_rain_this_week_mm ?? 0} mm) and irrigation (${settings.manual_irrigation_this_week_mm ?? 0} mm).`);
    const resetWeekday = settings.reset_water_weekday || 'MON';
    const todayDate    = parseIsoDate(new Date().toISOString().slice(0, 10));
    const weekStart    = getWeekStartDate(todayDate, resetWeekday);
    await this.setSettings({
      manual_rain_this_week_mm:       0,
      manual_irrigation_this_week_mm: 0,
    });
    await this.setStoreValue(STORE_WATER_WEEK_START, formatIsoDate(weekStart));
    this.driver.triggerWeeklyWaterReset(this);
    await this.refreshData();
  }
}

module.exports = LawnSoilOptimizerDevice;
