'use strict';

/**
 * LawnHistoryService
 *
 * Manages a rolling ~13-month log of daily lawn snapshots stored in the
 * Homey device store under the key `lawnDailyHistory`.
 *
 * Each entry shape:
 * {
 *   date:        'YYYY-MM-DD',  // ISO date string
 *   score:       number,        // overall lawn score 0–100
 *   rainMm:      number,        // 24-hour rainfall in mm
 *   wateringDue: boolean,       // watering was due today
 *   fertDue:     boolean,       // fertiliser was due today
 *   mowingRec:   boolean,       // mowing was recommended today
 *   frost:       boolean,       // frost severity was not 'none'
 *   heat:        boolean,       // heat stress severity was not 'none'
 *   status:      string,        // lawn_status value
 * }
 *
 * Pure service — no Homey dependencies.
 */
class LawnHistoryService {

  static get STORE_KEY() { return 'lawnDailyHistory'; }

  /** Maximum daily entries to retain (~13 months). */
  static get MAX_DAYS() { return 400; }

  /**
   * Parse stored value (array or any falsy) into a history array.
   * @param   {any}   storedValue  Raw value from device.getStoreValue()
   * @returns {Array}
   */
  parse(storedValue) {
    return Array.isArray(storedValue) ? storedValue : [];
  }

  /**
   * Upsert today's snapshot. Returns the updated history array to persist.
   * Existing entry for the same date is merged (later poll wins on each field).
   *
   * @param   {Array}  history   Current history from parse()
   * @param   {object} snapshot  Must include a `date` field ('YYYY-MM-DD')
   * @returns {Array}
   */
  upsert(history, snapshot) {
    const arr = Array.isArray(history) ? [...history] : [];
    const idx = arr.findIndex(e => e.date === snapshot.date);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...snapshot };
    } else {
      arr.push({ ...snapshot });
    }
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const { MAX_DAYS } = LawnHistoryService;
    return arr.length > MAX_DAYS ? arr.slice(arr.length - MAX_DAYS) : arr;
  }

  /**
   * Get all entries whose date starts with the given 'YYYY-MM' month string.
   * @param   {Array}  history
   * @param   {string} yearMonth  e.g. '2026-05'
   * @returns {Array}
   */
  monthEntries(history, yearMonth) {
    return history.filter(
      e => typeof e.date === 'string' && e.date.startsWith(yearMonth),
    );
  }

  /**
   * Return the distinct YYYY-MM months present in history, ascending.
   * @param   {Array}    history
   * @returns {string[]}
   */
  availableMonths(history) {
    const set = new Set();
    for (const e of history) {
      if (typeof e.date === 'string' && e.date.length >= 7) {
        set.add(e.date.slice(0, 7));
      }
    }
    return [...set].sort();
  }
}

module.exports = LawnHistoryService;
