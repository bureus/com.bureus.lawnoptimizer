'use strict';

const CAPABILITY_KEYS = [
  'lawn_overall_score',
  'lawn_status',
  'primary_recommendation',
  'next_action',
  'next_action_date',
  'next_action_reason',
  'frost_severity',
  'heat_stress_severity',
  'lawn_recovery_mode',
  'lawn_growth_score',
  'water_deficit_mm',
  'fertiliser_days_remaining',
  'last_updated',
];

module.exports = {

  async getData({ homey }) {
    const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
    const devices = driver.getDevices();

    if (!devices.length) {
      return { error: 'No lawn device paired yet.' };
    }

    const device = devices[0];
    const result = { deviceName: device.getName() };

    for (const cap of CAPABILITY_KEYS) {
      try {
        result[cap] = device.getCapabilityValue(cap);
      } catch (_) {
        result[cap] = null;
      }
    }

    return result;
  },

};
