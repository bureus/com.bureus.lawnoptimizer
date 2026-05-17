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

  async get({ homey, query }) {
    const { deviceId } = query || {};

    // getDriver is synchronous in SDK v3 — no await needed
    let driver;
    try {
      driver = homey.drivers.getDriver('lawn_soil_optimizer');
    } catch (err) {
      return { error: 'driver_error', message: `Driver not found: ${err.message}` };
    }

    if (!driver) {
      return { error: 'driver_error', message: 'Driver lawn_soil_optimizer not loaded yet.' };
    }

    const devices = driver.getDevices();

    if (!devices || !devices.length) {
      return { error: 'no_devices', message: 'No lawn device paired yet. Pair a device first.' };
    }

    const device = (deviceId
      ? devices.find(d => d.getData().id === deviceId || d.id === deviceId)
      : null) || devices[0];

    const result = {
      deviceName: device.getName(),
      deviceId:   device.getData().id,
    };

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
