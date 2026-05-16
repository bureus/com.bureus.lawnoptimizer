'use strict';

const Homey = require('homey');
const OpenMeteoClient    = require('../../lib/OpenMeteoClient');
const SoilTemperatureModel = require('../../lib/SoilTemperatureModel');
const LawnScoringService  = require('../../lib/LawnScoringService');

// Store keys used in Homey's persistent device store
const STORE_ROOT_ZONE      = 'previousRootZone';
const STORE_PREV_MOWING    = 'prevMowing';
const STORE_PREV_WATERING  = 'prevWatering';
const STORE_PREV_FERTILIZE = 'prevFertilizing';
const STORE_PREV_FROST     = 'prevFrost';
const STORE_PREV_HEAT      = 'prevHeat';
const STORE_PREV_STATUS    = 'prevStatus';
const STORE_PREV_SCORE     = 'prevScore';
const STORE_PREV_TEMP      = 'prevRootZoneTemp';

class LawnSoilOptimizerDevice extends Homey.Device {

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onInit() {
    this.log(`Device "${this.getName()}" initialising…`);

    this._pollTimer = null;
    this._client    = new OpenMeteoClient(this.log.bind(this));

    // Kick off the first fetch immediately, then schedule recurring polls
    await this._startPolling();

    this.log(`Device "${this.getName()}" ready.`);
  }

  async onDeleted() {
    this.log(`Device "${this.getName()}" deleted – stopping poll timer.`);
    this._stopPolling();
  }

  /**
   * React to settings changes made in the Homey app.
   * Restart the polling loop with the new interval and refresh immediately.
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys.join(', '));
    this._stopPolling();
    await this._startPolling();
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  async _startPolling() {
    // Fetch immediately so the device shows data right away
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

  /**
   * Public: can be called from Flow actions or the repair view.
   * Fetches weather, calculates temps and scores, updates all capabilities,
   * and fires relevant flow triggers.
   */
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

      // Retrieve persistent root zone from last run
      const previousRootZone = this.getStoreValue(STORE_ROOT_ZONE) ?? null;

      const temps      = model.calculate(snapshot, previousRootZone);
      const assessment = scoring.assess(temps);

      // Persist new root zone for the next calculation cycle
      await this.setStoreValue(STORE_ROOT_ZONE, temps.rootZone);

      await this._updateCapabilities(temps, assessment);
      await this._fireTriggers(temps, assessment);

      this.log(`Refresh complete – rootZone: ${temps.rootZone} °C, score: ${assessment.growthScore}`);
    } catch (err) {
      // Never crash the app on a failed fetch – log and move on
      this.error('Failed to refresh data:', err.message);
    }
  }

  // ─── Capability updates ────────────────────────────────────────────────────

  async _updateCapabilities(temps, assessment) {
    const now = new Date().toLocaleString('sv-SE', { hour12: false }); // ISO-like local time

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

  async _fireTriggers(temps, assessment) {
    const driver = this.driver;

    // ── Boolean state change triggers ──────────────────────────────────────

    const prevMowing    = this.getStoreValue(STORE_PREV_MOWING);
    const prevWatering  = this.getStoreValue(STORE_PREV_WATERING);
    const prevFertilize = this.getStoreValue(STORE_PREV_FERTILIZE);
    const prevFrost     = this.getStoreValue(STORE_PREV_FROST);
    const prevHeat      = this.getStoreValue(STORE_PREV_HEAT);
    const prevStatus    = this.getStoreValue(STORE_PREV_STATUS);
    const prevScore     = this.getStoreValue(STORE_PREV_SCORE) ?? 0;
    const prevTemp      = this.getStoreValue(STORE_PREV_TEMP) ?? null;

    const { growthScore, mowingRecommended, wateringRecommended,
            fertilizingRecommended, frostRisk, heatStressRisk, statusText } = assessment;
    const rootZone = temps.rootZone;

    if (prevMowing !== null && prevMowing !== mowingRecommended) {
      driver.triggerMowingChanged(this, mowingRecommended);
    }
    if (prevWatering !== null && prevWatering !== wateringRecommended) {
      driver.triggerWateringChanged(this, wateringRecommended);
    }
    if (prevFertilize !== null && prevFertilize !== fertilizingRecommended) {
      driver.triggerFertilizingChanged(this, fertilizingRecommended);
    }

    // ── Threshold edge triggers (fires once on crossing) ──────────────────

    // Frost: fire only on the rising edge (false → true)
    if (!prevFrost && frostRisk) {
      driver.triggerFrostRiskStarted(this);
    }
    // Heat stress: fire only on the rising edge
    if (!prevHeat && heatStressRisk) {
      driver.triggerHeatStressStarted(this);
    }

    // soil_temp_above / soil_temp_below – fire on every update; the run
    // listener in app.js decides whether each individual flow matches.
    driver.triggerSoilTempAbove(this, rootZone);
    driver.triggerSoilTempBelow(this, rootZone);

    // growth_score_above – same pattern
    driver.triggerGrowthScoreAbove(this, growthScore);

    // Status text change
    if (prevStatus !== null && prevStatus !== statusText) {
      driver.triggerLawnStatusChanged(this, statusText);
    }

    // Persist current state for next comparison
    await this.setStoreValue(STORE_PREV_MOWING,    mowingRecommended);
    await this.setStoreValue(STORE_PREV_WATERING,  wateringRecommended);
    await this.setStoreValue(STORE_PREV_FERTILIZE, fertilizingRecommended);
    await this.setStoreValue(STORE_PREV_FROST,     frostRisk);
    await this.setStoreValue(STORE_PREV_HEAT,      heatStressRisk);
    await this.setStoreValue(STORE_PREV_STATUS,    statusText);
    await this.setStoreValue(STORE_PREV_SCORE,     growthScore);
    await this.setStoreValue(STORE_PREV_TEMP,      rootZone);
  }

  // ─── Flow action handlers ──────────────────────────────────────────────────

  /**
   * Send a Homey notification with the current lawn status.
   * Only fires if enable_notifications is true in settings.
   */
  async sendLawnAdviceNotification() {
    const settings = this.getSettings();
    if (!settings.enable_notifications) return;

    const name   = settings.lawn_name || this.getName();
    const score  = this.getCapabilityValue('lawn_growth_score') ?? '–';
    const temp   = this.getCapabilityValue('measure_temperature.root_zone') ?? '–';
    const mow    = this.getCapabilityValue('mowing_recommended')    ? '✓' : '✗';
    const water  = this.getCapabilityValue('watering_recommended')  ? '✓' : '✗';
    const fert   = this.getCapabilityValue('fertilizing_recommended') ? '✓' : '✗';
    const frost  = this.getCapabilityValue('frost_risk')            ? '⚠ FROST RISK' : '';
    const heat   = this.getCapabilityValue('heat_stress_risk')      ? '⚠ HEAT STRESS' : '';

    const message = [
      `🌱 ${name}`,
      `Root zone: ${temp} °C  |  Score: ${score}/100`,
      `Mow: ${mow}  Water: ${water}  Fertilize: ${fert}`,
      frost, heat,
    ].filter(Boolean).join('\n');

    // Homey SDK v3: this.homey.notifications.createNotification
    await this.homey.notifications.createNotification({ excerpt: message });
  }

  /**
   * Clears the persisted root zone temperature so the model starts fresh.
   * Useful after relocating the device or extreme weather events.
   */
  async resetModelMemory() {
    this.log('Resetting soil model memory');
    await this.setStoreValue(STORE_ROOT_ZONE,      null);
    await this.setStoreValue(STORE_PREV_TEMP,      null);
    await this.setStoreValue(STORE_PREV_SCORE,     null);
    await this.setStoreValue(STORE_PREV_MOWING,    null);
    await this.setStoreValue(STORE_PREV_WATERING,  null);
    await this.setStoreValue(STORE_PREV_FERTILIZE, null);
    await this.setStoreValue(STORE_PREV_FROST,     null);
    await this.setStoreValue(STORE_PREV_HEAT,      null);
    await this.setStoreValue(STORE_PREV_STATUS,    null);
    // Trigger an immediate refresh with the cleared state
    await this.refreshData();
  }
}

module.exports = LawnSoilOptimizerDevice;
