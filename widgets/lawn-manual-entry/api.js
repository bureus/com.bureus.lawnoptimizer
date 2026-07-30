'use strict';

module.exports = {

  async getData({ homey }) {
    const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
    const devices = driver.getDevices();

    if (!devices.length) {
      return { error: 'No lawn device paired yet.' };
    }

    const device   = devices[0];
    const settings = device.getSettings();

    return {
      deviceName:              device.getName(),
      lastFertiliserDate:      settings.last_fertiliser_date || '',
      fertiliserNextDate:      device.getCapabilityValue('fertiliser_next_date') ?? '—',
      fertiliserDaysRemaining: device.getCapabilityValue('fertiliser_days_remaining') ?? null,
      fertiliserStatus:        device.getCapabilityValue('fertiliser_status') ?? '',
      fertiliserDue:           device.getCapabilityValue('fertiliser_due') === true,
      weeklyTargetMm:          settings.weekly_water_target_mm ?? 25,
      rainThisWeekMm:          device.getCapabilityValue('rain_this_week_mm') ?? 0,
      irrigationThisWeekMm:    device.getCapabilityValue('irrigation_this_week_mm') ?? 0,
      totalThisWeekMm:         device.getCapabilityValue('total_water_this_week_mm') ?? 0,
      deficitMm:               device.getCapabilityValue('water_deficit_mm') ?? 0,
      wateringDue:             device.getCapabilityValue('watering_due') === true,
      lastUpdated:             device.getCapabilityValue('last_updated') ?? null,
    };
  },

  async applyRain({ homey, body }) {
    const device = _device(homey);
    const amount = Math.max(0, Number(body?.amountMm) || 0);
    if (body?.mode === 'set') {
      await device.setManualRain(amount);
    } else {
      await device.addManualRain(amount);
    }
    return { ok: true };
  },

  async applyIrrigation({ homey, body }) {
    const device = _device(homey);
    const amount = Math.max(0, Number(body?.amountMm) || 0);
    if (body?.mode === 'set') {
      await device.setManualIrrigation(amount);
    } else {
      await device.addManualIrrigation(amount);
    }
    return { ok: true };
  },

  async markFertilised({ homey, body }) {
    const device  = _device(homey);
    const dateStr = (body?.date || new Date().toISOString().slice(0, 10)).trim();
    await device.setLastFertiliserDate(dateStr);
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
