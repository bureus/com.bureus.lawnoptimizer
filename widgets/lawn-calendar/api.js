'use strict';

const LawnCalendarService = require('../../lib/LawnCalendarService');

const COMPLETED_STORE_KEY = 'lawnCalendarCompleted';

module.exports = {

  async getData({ homey }) {
    const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
    const devices = driver.getDevices();

    if (!devices.length) {
      return { error: 'No lawn device paired yet.' };
    }

    const device    = devices[0];
    const stored    = device.getStoreValue(LawnCalendarService.STORE_KEY) ?? [];
    const completed = device.getStoreValue(COMPLETED_STORE_KEY) ?? {};

    const today   = new Date().toISOString().slice(0, 10);
    const horizon = addDays(today, LawnCalendarService.HORIZON_DAYS);

    const events = stored
      .filter(e => typeof e.date === 'string' && e.date >= today && e.date <= horizon)
      .map(e => ({ ...e, completed: !!completed[e.id] }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      deviceName:  device.getName(),
      events,
      today,
      lastUpdated: device.getCapabilityValue('last_updated') ?? null,
    };
  },

  async completeEvent({ homey, body }) {
    const device = _device(homey);
    if (!body || !body.id) {
      const err = new Error('Missing id'); err.statusCode = 400; throw err;
    }
    await device.markCalendarEventComplete({
      id:       String(body.id),
      type:     body.type ? String(body.type) : '',
      date:     body.date ? String(body.date) : null,
      amountMm: body.amountMm != null ? Number(body.amountMm) : null,
    });
    return { ok: true };
  },

  async uncompleteEvent({ homey, body }) {
    const device = _device(homey);
    if (!body || !body.id) {
      const err = new Error('Missing id'); err.statusCode = 400; throw err;
    }
    await device.unmarkCalendarEventComplete(String(body.id));
    return { ok: true };
  },

};

function _device(homey) {
  const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
  const devices = driver.getDevices();
  if (!devices.length) {
    const err = new Error('No lawn device paired yet.');
    err.statusCode = 404;
    throw err;
  }
  return devices[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
