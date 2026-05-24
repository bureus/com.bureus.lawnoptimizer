'use strict';

const Homey = require('homey');
const { isMonthInSeason } = require('./lib/FertiliserScheduleService');

class LawnSoilOptimizerApp extends Homey.App {

  async onInit() {
    this.log('Lawn Soil Optimizer app is initialising…');
    this._registerFlowCards();
    this.log('Lawn Soil Optimizer app is ready.');
  }

  // ─── Flow card registration ──────────────────────────────────────────────

  _registerFlowCards() {
    this._registerTriggers();
    this._registerConditions();
    this._registerActions();
  }

  _registerTriggers() {
    // Threshold triggers — run listener filters by user-set value
    this.homey.flow.getDeviceTriggerCard('soil_temp_above')
      .registerRunListener(async (args, state) => state.temperature > args.temperature);

    this.homey.flow.getDeviceTriggerCard('soil_temp_below')
      .registerRunListener(async (args, state) => state.temperature < args.temperature);

    this.homey.flow.getDeviceTriggerCard('growth_score_above')
      .registerRunListener(async (args, state) => state.score > args.score);

    // Lawn profile optimization triggers
    this.homey.flow.getDeviceTriggerCard('mowing_height_adjustment_recommended');
    this.homey.flow.getDeviceTriggerCard('lawn_profile_changed');
    this.homey.flow.getDeviceTriggerCard('mowing_frequency_changed');

    // Edge triggers — no run listener (fire unconditionally on each call)
    this.homey.flow.getDeviceTriggerCard('mowing_recommended_changed');
    this.homey.flow.getDeviceTriggerCard('watering_recommended_changed');
    this.homey.flow.getDeviceTriggerCard('fertilizing_recommended_changed');
    this.homey.flow.getDeviceTriggerCard('frost_risk_started');
    this.homey.flow.getDeviceTriggerCard('heat_stress_started');
    this.homey.flow.getDeviceTriggerCard('lawn_status_changed');

    // Fertiliser triggers
    this.homey.flow.getDeviceTriggerCard('fertiliser_due_started');
    this.homey.flow.getDeviceTriggerCard('fertiliser_due_cleared');
    this.homey.flow.getDeviceTriggerCard('fertiliser_date_changed');
    this.homey.flow.getDeviceTriggerCard('fertiliser_delayed');

    // ── Water schedule triggers ────────────────────────────────────────────────
    this.homey.flow.getDeviceTriggerCard('watering_due_started');
    this.homey.flow.getDeviceTriggerCard('watering_due_cleared');
    this.homey.flow.getDeviceTriggerCard('water_deficit_above')
      .registerRunListener(async (args, state) => state.deficit > args.deficit_mm);
    this.homey.flow.getDeviceTriggerCard('weekly_water_target_reached');
    this.homey.flow.getDeviceTriggerCard('water_schedule_changed');
    this.homey.flow.getDeviceTriggerCard('watering_delayed_due_to_rain');
    this.homey.flow.getDeviceTriggerCard('weekly_water_reset');
  }

  _registerConditions() {
    this.homey.flow.getConditionCard('soil_temp_is_above')
      .registerRunListener(async (args) => {
        const temp = args.device.getCapabilityValue('measure_temperature.root_zone');
        return typeof temp === 'number' && temp > args.temperature;
      });

    this.homey.flow.getConditionCard('soil_temp_is_below')
      .registerRunListener(async (args) => {
        const temp = args.device.getCapabilityValue('measure_temperature.root_zone');
        return typeof temp === 'number' && temp < args.temperature;
      });

    this.homey.flow.getConditionCard('growth_score_is_above')
      .registerRunListener(async (args) => {
        const score = args.device.getCapabilityValue('lawn_growth_score');
        return typeof score === 'number' && score > args.score;
      });

    this.homey.flow.getConditionCard('mowing_is_recommended')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('mowing_recommended') === true);

    this.homey.flow.getConditionCard('watering_is_recommended')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('watering_recommended') === true);

    this.homey.flow.getConditionCard('fertilizing_is_recommended')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('fertilizing_recommended') === true);

    this.homey.flow.getConditionCard('frost_risk_is_active')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('frost_risk') === true);

    this.homey.flow.getConditionCard('heat_stress_is_active')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('heat_stress_risk') === true);

    // Lawn profile optimization conditions
    this.homey.flow.getConditionCard('lawn_profile_is')
      .registerRunListener(async (args) => {
        const profile = args.device.getSetting('lawn_optimization_profile') ?? 'balanced';
        return profile === args.profile;
      });

    this.homey.flow.getConditionCard('mowing_height_above')
      .registerRunListener(async (args) => {
        const h = args.device.getCapabilityValue('recommended_mowing_height_mm');
        return typeof h === 'number' && h > args.height_mm;
      });

    this.homey.flow.getConditionCard('mowing_height_below')
      .registerRunListener(async (args) => {
        const h = args.device.getCapabilityValue('recommended_mowing_height_mm');
        return typeof h === 'number' && h < args.height_mm;
      });

    // ── Water schedule conditions ──────────────────────────────────────────────

    this.homey.flow.getConditionCard('watering_is_due')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('watering_due') === true);

    this.homey.flow.getConditionCard('water_deficit_is_above')
      .registerRunListener(async (args) => {
        const deficit = args.device.getCapabilityValue('water_deficit_mm');
        return typeof deficit === 'number' && deficit > args.deficit_mm;
      });

    this.homey.flow.getConditionCard('weekly_water_target_is_reached')
      .registerRunListener(async (args) => {
        const deficit = args.device.getCapabilityValue('water_deficit_mm');
        return typeof deficit === 'number' && deficit === 0;
      });

    this.homey.flow.getConditionCard('rain_expected_next_24h')
      .registerRunListener(async (args) => {
        const mm = args.device.getStoreValue('waterForecastNext24h') ?? 0;
        return mm > 1;
      });

    this.homey.flow.getConditionCard('enough_rain_expected_this_week')
      .registerRunListener(async (args) => {
        const forecast = args.device.getStoreValue('waterForecastNext7Days') ?? 0;
        const deficit  = args.device.getCapabilityValue('water_deficit_mm') ?? 0;
        return deficit > 0 && forecast >= deficit;
      });

    // ── Fertiliser conditions ──────────────────────────────────────────────

    this.homey.flow.getConditionCard('fertiliser_is_due')
      .registerRunListener(async (args) =>
        args.device.getCapabilityValue('fertiliser_due') === true);

    this.homey.flow.getConditionCard('fertiliser_days_remaining_less_than')
      .registerRunListener(async (args) => {
        const days = args.device.getCapabilityValue('fertiliser_days_remaining');
        return typeof days === 'number' && days < args.days;
      });

    this.homey.flow.getConditionCard('fertiliser_is_in_season')
      .registerRunListener(async (args) => {
        const s       = args.device.getSettings();
        const start   = s.fertiliser_season_start_month ?? 4;
        const end     = s.fertiliser_season_end_month   ?? 10;
        const month   = new Date().getUTCMonth() + 1; // 1–12
        return isMonthInSeason(month, start, end);
      });
  }

  _registerActions() {
    this.homey.flow.getActionCard('refresh_now')
      .registerRunListener(async (args) => args.device.refreshData());

    this.homey.flow.getActionCard('set_lawn_profile')
      .registerRunListener(async (args) => {
        await args.device.setSettings({
          grass_type: args.grass_type,
          soil_type:  args.soil_type,
        });
        return args.device.refreshData();
      });

    this.homey.flow.getActionCard('send_lawn_advice_notification')
      .registerRunListener(async (args) => args.device.sendLawnAdviceNotification());

    this.homey.flow.getActionCard('reset_model_memory')
      .registerRunListener(async (args) => args.device.resetModelMemory());

    // Lawn profile optimization actions
    this.homey.flow.getActionCard('set_lawn_optimization_profile')
      .registerRunListener(async (args) => {
        await args.device.setSettings({ lawn_optimization_profile: args.profile });
        return args.device.refreshData();
      });

    this.homey.flow.getActionCard('set_target_grass_height')
      .registerRunListener(async (args) => {
        const h = Math.max(15, Math.min(100, Math.round(Number(args.height_mm) || 40)));
        await args.device.setSettings({ target_grass_height_mm: h });
        return args.device.refreshData();
      });

    this.homey.flow.getActionCard('reset_lawn_profile_defaults')
      .registerRunListener(async (args) => {
        await args.device.setSettings({
          lawn_optimization_profile:  'balanced',
          target_grass_height_mm:     40,
          minimum_grass_height_mm:    30,
          maximum_grass_height_mm:    60,
          grass_growth_speed:         'medium',
          mowing_frequency_strategy:  'adaptive',
          desired_visual_quality:     'balanced',
        });
        return args.device.refreshData();
      });

    // ── Water schedule actions ─────────────────────────────────────────────────

    this.homey.flow.getActionCard('add_manual_rain')
      .registerRunListener(async (args) => args.device.addManualRain(args.amount_mm));

    this.homey.flow.getActionCard('set_manual_rain_this_week')
      .registerRunListener(async (args) => args.device.setManualRain(args.amount_mm));

    this.homey.flow.getActionCard('add_manual_irrigation')
      .registerRunListener(async (args) => args.device.addManualIrrigation(args.amount_mm));

    this.homey.flow.getActionCard('set_manual_irrigation_this_week')
      .registerRunListener(async (args) => args.device.setManualIrrigation(args.amount_mm));

    this.homey.flow.getActionCard('reset_weekly_water_tracking')
      .registerRunListener(async (args) => args.device.resetWeeklyWaterTracking());

    this.homey.flow.getActionCard('mark_watered_now')
      .registerRunListener(async (args) => args.device.addManualIrrigation(args.amount_mm));

    this.homey.flow.getActionCard('refresh_water_schedule')
      .registerRunListener(async (args) => args.device.refreshData());

    // ── Fertiliser actions ─────────────────────────────────────────────────

    this.homey.flow.getActionCard('set_last_fertiliser_date')
      .registerRunListener(async (args) => {
        return args.device.setLastFertiliserDate(args.date);
      });

    this.homey.flow.getActionCard('mark_fertilised_today')
      .registerRunListener(async (args) => {
        const today = new Date().toISOString().slice(0, 10);
        return args.device.setLastFertiliserDate(today);
      });

    this.homey.flow.getActionCard('mark_fertilised_on_date')
      .registerRunListener(async (args) => {
        return args.device.setLastFertiliserDate(args.date);
      });

    this.homey.flow.getActionCard('refresh_fertiliser_schedule')
      .registerRunListener(async (args) => args.device.refreshData());
  }
}

module.exports = LawnSoilOptimizerApp;
