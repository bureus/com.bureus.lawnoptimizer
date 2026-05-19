'use strict';

/**
 * MonthlySummaryService
 *
 * Aggregates an array of daily history entries (from LawnHistoryService) into
 * a monthly summary object suitable for display in the Monthly Lawn Summary widget.
 *
 * Pure service — no side effects.
 */
class MonthlySummaryService {

  /**
   * Summarise an array of daily entries for a given month.
   *
   * @param   {Array}  entries   Daily entries for the target month
   * @param   {string} yearMonth 'YYYY-MM'
   * @returns {MonthlySummary}
   */
  summarise(entries, yearMonth) {
    if (!entries || entries.length === 0) {
      return { yearMonth, hasData: false, daysWithData: 0 };
    }

    const scores = entries
      .map(e => e.score)
      .filter(s => typeof s === 'number' && !Number.isNaN(s));

    const rains = entries.map(e => (typeof e.rainMm === 'number' ? e.rainMm : 0));
    const totalRainMm = Math.round(rains.reduce((a, b) => a + b, 0) * 10) / 10;

    return {
      yearMonth,
      hasData:        true,
      daysWithData:   entries.length,
      totalRainMm,
      wateringDays:   entries.filter(e => e.wateringDue).length,
      fertiliserDays: entries.filter(e => e.fertDue).length,
      mowingDays:     entries.filter(e => e.mowingRec).length,
      frostDays:      entries.filter(e => e.frost).length,
      heatDays:       entries.filter(e => e.heat).length,
      avgScore:       scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null,
      bestScore:  scores.length ? Math.max(...scores) : null,
      worstScore: scores.length ? Math.min(...scores) : null,
    };
  }

  /**
   * Compute a signed numeric delta between current and previous month for a
   * given numeric key. Returns null if either summary is missing/lacks the key.
   *
   * @param   {MonthlySummary|null} current
   * @param   {MonthlySummary|null} previous
   * @param   {string}             key
   * @returns {number|null}
   */
  delta(current, previous, key) {
    if (!current || !previous) return null;
    const c = current[key];
    const p = previous[key];
    if (c == null || p == null) return null;
    return Math.round((c - p) * 10) / 10;
  }
}

/**
 * @typedef {object} MonthlySummary
 * @property {string}      yearMonth
 * @property {boolean}     hasData
 * @property {number}      daysWithData
 * @property {number}      totalRainMm
 * @property {number}      wateringDays
 * @property {number}      fertiliserDays
 * @property {number}      mowingDays
 * @property {number}      frostDays
 * @property {number}      heatDays
 * @property {number|null} avgScore
 * @property {number|null} bestScore
 * @property {number|null} worstScore
 */

module.exports = MonthlySummaryService;
