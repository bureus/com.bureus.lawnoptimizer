'use strict';

const Homey = require('homey');
const OpenMeteoClient         = require('../../lib/OpenMeteoClient');
const SoilTemperatureModel    = require('../../lib/SoilTemperatureModel');
const LawnScoringService      = require('../../lib/LawnScoringService');
const FertiliserScheduleService = require('../../lib/FertiliserScheduleService');

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

// Reason codes that indicate a blocking condition (not "due")
const BLOCKING_REASONS = new Set([
  'soil_too_cold', 'low_growth', 'heavy_rain', 'warm_season_cool', 'outside_season',
]);

class LawnSoilOptimizerDevice extends Homey.Device {

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onInit() {
    this.log(`Device "${this.getName()}" initialising…`);

    this._pollTimer = null;
    this._client    = new OpenMeteoClient(this.log.bind(this));
    this._fertiliserService = new FertiliserScheduleService();

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

      // ── Fertiliser schedule ──────────────────────────────────────────────
      const fertResult = this._calcFertiliserSchedule(snapshot, settings, temps, assessment);

      await this._updateCapabilities(temps, assessment, fertResult);
      await this._fireTriggers(temps, assessment, fertResult);
      await this._checkFertiliserNotification(fertResult, settings);

      this.log(`Refresh complete – rootZone: ${temps.rootZone} °C, score: ${assessment.growthScore}, fertDue: ${fertResult.due}`);
    } catch (err) {
      this.error('Failed to refresh data:', err.message);
    }
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
      today:                 null,   // use current date inside service
      seasonStartMonth:      settings.fertiliser_season_start_month ?? 4,
      seasonEndMonth:        settings.fertiliser_season_end_month   ?? 10,
      minSoilTemp:           settings.fertiliser_min_soil_temp      ?? 10,
      rainWindowMin:         settings.fertiliser_rain_window_mm_min ?? 2,
      rainWindowMax:         settings.fertiliser_rain_window_mm_max ?? 15,
    });
  }

  // ─── Capability updates ────────────────────────────────────────────────────

  async _updateCapabilities(temps, assessment, fertResult) {
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
      ['watering_recommended',             assessment.wateringRecommended],
      ['fertilizing_recommended',          assessment.fertilizingRecommended],
      ['frost_risk',                       assessment.frostRisk],
      ['heat_stress_risk',                 assessment.heatStressRisk],
      ['last_updated',                     now],
      // Fertiliser capabilities
      ['fertiliser_next_date',      fertResult.nextDate ?? '—'],
      ['fertiliser_days_remaining', fertResult.daysRemaining ?? 0],
      ['fertiliser_due',            fertResult.due],
      ['fertiliser_status',         fertResult.status],
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

  async _fireTriggers(temps, assessment, fertResult) {
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
      driver.triggerWateringChanged(this, wateringRecommended);
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
    await this.setStoreValue(STORE_PREV_WATERING,  wateringRecommended);
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

    // Overdue-but-blocked = fertiliser date has passed yet a blocking condition stops it
    const isDelayed = BLOCKING_REASONS.has(reason) && (daysRemaining !== null && daysRemaining <= 0);

    // Rising edge: false → true
    if (prevFertDue === false && due === true)
      driver.triggerFertiliserDueStarted(this, nextDate);

    // Falling edge: true → false
    if (prevFertDue === true && due === false)
      driver.triggerFertiliserDueCleared(this);

    // Next date changed (ignore null→value transitions on first run)
    if (prevFertDate !== null && prevFertDate !== nextDate)
      driver.triggerFertiliserDateChanged(this, nextDate, daysRemaining);

    // Rising edge on "delayed while overdue"
    if (!prevFertDelayed && isDelayed)
      driver.triggerFertiliserDelayed(this, fertResult.status);

    await this.setStoreValue(STORE_PREV_FERT_DUE,     due);
    await this.setStoreValue(STORE_PREV_FERT_DATE,    nextDate);
    await this.setStoreValue(STORE_PREV_FERT_DELAYED, isDelayed);
  }

  // ─── Fertiliser notifications ──────────────────────────────────────────────

  async _checkFertiliserNotification(fertResult, settings) {
    if (!settings.enable_notifications) return;

    const today = new Date().toISOString().slice(0, 10);
    const { due, daysRemaining, status, reason } = fertResult;

    /**
     * Returns true (and stores today's date) only if we haven't already sent
     * this notification type today.
     */
    const shouldNotify = async (storeKey) => {
      if (this.getStoreValue(storeKey) === today) return false;
      await this.setStoreValue(storeKey, today);
      return true;
    };

    // 1. Fertiliser is due and conditions are good
    if (due) {
      if (await shouldNotify(STORE_NOTIF_DUE_DATE)) {
        await this.homey.notifications.createNotification({
          excerpt: 'Your lawn is ready for fertiliser. Soil temperature and growth conditions look good.',
        });
      }
      return;
    }

    // 2. Overdue but blocked by heavy rain
    const isOverdue = daysRemaining !== null && daysRemaining <= 0;
    if (isOverdue && reason === 'heavy_rain') {
      if (await shouldNotify(STORE_NOTIF_DELAY_DATE)) {
        await this.homey.notifications.createNotification({
          excerpt: 'Fertiliser is due, but heavy rain is expected. Consider waiting a few days.',
        });
      }
      return;
    }

    // 3. Upcoming window (1–3 days away)
    if (daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3) {
      if (await shouldNotify(STORE_NOTIF_WIN_DATE)) {
        await this.homey.notifications.createNotification({
          excerpt: `Fertiliser window is coming up in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`,
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
    const fertStatus = this.getCapabilityValue('fertiliser_status') || '';

    const message = [
      `🌱 ${name}`,
      `Root zone: ${temp} °C  |  Score: ${score}/100`,
      `Mow: ${mow}  Water: ${water}  Fertilize: ${fert}`,
      fertStatus ? `Fertiliser: ${fertStatus}` : '',
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

  /** Set the last-fertilised date and immediately recalculate. */
  async setLastFertiliserDate(dateStr) {
    const trimmed = (dateStr || '').trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new Error(`Invalid date format "${trimmed}". Expected YYYY-MM-DD.`);
    }
    await this.setSettings({ last_fertiliser_date: trimmed });
    await this.refreshData();
  }
}

module.exports = LawnSoilOptimizerDevice;
