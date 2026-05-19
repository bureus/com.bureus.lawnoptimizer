'use strict';

const LawnHistoryService    = require('../../lib/LawnHistoryService');
const MonthlySummaryService = require('../../lib/MonthlySummaryService');

const _history = new LawnHistoryService();
const _summary = new MonthlySummaryService();

module.exports = {

  async getData({ homey }) {
    const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
    const devices = driver.getDevices();

    if (!devices.length) {
      return { error: 'No lawn device paired yet.' };
    }

    const device = devices[0];

    // ── Load history ──────────────────────────────────────────────────────────
    const stored  = device.getStoreValue(LawnHistoryService.STORE_KEY) ?? [];
    const history = _history.parse(stored);

    // ── Resolve months ────────────────────────────────────────────────────────
    const now          = new Date();
    const currentYM    = now.toISOString().slice(0, 7);          // 'YYYY-MM'
    const prevDate     = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousYM   = prevDate.toISOString().slice(0, 7);

    // ── Summarise ─────────────────────────────────────────────────────────────
    const currentEntries  = _history.monthEntries(history, currentYM);
    const previousEntries = _history.monthEntries(history, previousYM);

    const current  = _summary.summarise(currentEntries, currentYM);
    const previous = previousEntries.length
      ? _summary.summarise(previousEntries, previousYM)
      : null;

    return {
      deviceName:  device.getName(),
      current,
      previous,
      lastUpdated: device.getCapabilityValue('last_updated') ?? null,
      totalDays:   history.length,
    };
  },

};
