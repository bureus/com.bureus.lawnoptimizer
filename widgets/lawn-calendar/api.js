'use strict';

const LawnCalendarService = require('../../lib/LawnCalendarService');

module.exports = {

  async getData({ homey }) {
    const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
    const devices = driver.getDevices();

    if (!devices.length) {
      return { error: 'No lawn device paired yet.' };
    }

    const device = devices[0];

    // Read pre-calculated events from device store
    const stored = device.getStoreValue(LawnCalendarService.STORE_KEY) ?? [];

    // Filter to today + 14 days, discard stale past events
    const today   = new Date().toISOString().slice(0, 10);
    const horizon = addDays(today, LawnCalendarService.HORIZON_DAYS);

    const events = stored
      .filter(e => typeof e.date === 'string' && e.date >= today && e.date <= horizon)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      deviceName:  device.getName(),
      events,
      today,
      lastUpdated: device.getCapabilityValue('last_updated') ?? null,
    };
  },

};

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
