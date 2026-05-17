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
