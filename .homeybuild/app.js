'use strict';

const Homey = require('homey');

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
    // soil_temp_above / soil_temp_below – run listener filters by threshold
    this.homey.flow.getDeviceTriggerCard('soil_temp_above')
      .registerRunListener(async (args, state) => {
        return state.temperature > args.temperature;
      });

    this.homey.flow.getDeviceTriggerCard('soil_temp_below')
      .registerRunListener(async (args, state) => {
        return state.temperature < args.temperature;
      });

    this.homey.flow.getDeviceTriggerCard('growth_score_above')
      .registerRunListener(async (args, state) => {
        return state.score > args.score;
      });

    // Remaining triggers have no run listener (fire unconditionally)
    this.homey.flow.getDeviceTriggerCard('mowing_recommended_changed');
    this.homey.flow.getDeviceTriggerCard('watering_recommended_changed');
    this.homey.flow.getDeviceTriggerCard('fertilizing_recommended_changed');
    this.homey.flow.getDeviceTriggerCard('frost_risk_started');
    this.homey.flow.getDeviceTriggerCard('heat_stress_started');
    this.homey.flow.getDeviceTriggerCard('lawn_status_changed');
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
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('mowing_recommended') === true;
      });

    this.homey.flow.getConditionCard('watering_is_recommended')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('watering_recommended') === true;
      });

    this.homey.flow.getConditionCard('fertilizing_is_recommended')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('fertilizing_recommended') === true;
      });

    this.homey.flow.getConditionCard('frost_risk_is_active')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('frost_risk') === true;
      });

    this.homey.flow.getConditionCard('heat_stress_is_active')
      .registerRunListener(async (args) => {
        return args.device.getCapabilityValue('heat_stress_risk') === true;
      });
  }

  _registerActions() {
    this.homey.flow.getActionCard('refresh_now')
      .registerRunListener(async (args) => {
        return args.device.refreshData();
      });

    this.homey.flow.getActionCard('set_lawn_profile')
      .registerRunListener(async (args) => {
        await args.device.setSettings({
          grass_type: args.grass_type,
          soil_type:  args.soil_type,
        });
        // Trigger an immediate refresh so changes take effect right away
        return args.device.refreshData();
      });

    this.homey.flow.getActionCard('send_lawn_advice_notification')
      .registerRunListener(async (args) => {
        return args.device.sendLawnAdviceNotification();
      });

    this.homey.flow.getActionCard('reset_model_memory')
      .registerRunListener(async (args) => {
        return args.device.resetModelMemory();
      });
  }
}

module.exports = LawnSoilOptimizerApp;
