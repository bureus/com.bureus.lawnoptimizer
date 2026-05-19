'use strict';

/**
 * LawnCalendarService
 *
 * Generates a list of upcoming lawn care events for the next 14 days by
 * combining the outputs of all lawn services.
 *
 * Event shape:
 * {
 *   id:          string,   // unique, stable key (e.g. 'watering-2026-05-22')
 *   type:        string,   // 'watering' | 'fertiliser' | 'mowing' | 'frost' | 'heat_stress' | 'recovery'
 *   title:       string,   // Short human-readable label
 *   date:        string,   // 'YYYY-MM-DD'
 *   time:        string|null, // 'HH:MM' or null
 *   severity:    string,   // 'low' | 'medium' | 'high' | 'critical'
 *   status:      string,   // 'today' | 'upcoming' | 'overdue'
 *   reason:      string,   // Supporting detail
 *   actionLabel: string,   // CTA text
 * }
 *
 * Pure service — no side effects, no Homey dependencies.
 */
class LawnCalendarService {

  static get STORE_KEY() { return 'lawnCalendarEvents'; }

  /** Default lookahead window in days. */
  static get HORIZON_DAYS() { return 14; }

  /**
   * Generate upcoming calendar events.
   *
   * @param {object} p
   * @param {string} p.today              Current date 'YYYY-MM-DD'
   * @param {object} p.waterResult        From WaterScheduleService
   * @param {object} p.fertResult         From FertiliserScheduleService
   * @param {object} p.mowingResult       From MowingWindowService
   * @param {object} p.stressResult       From LawnStressService
   * @param {object} p.assessment         From LawnScoringService
   * @param {object} p.settings           Device settings (for preferred_watering_time)
   * @returns {CalendarEvent[]}  Sorted by date asc, then severity desc.
   */
  generate({ today, waterResult, fertResult, mowingResult, stressResult, assessment, settings }) {
    const horizon = this._addDays(today, LawnCalendarService.HORIZON_DAYS);
    const events  = [];

    // ── Active stress conditions (today) ──────────────────────────────────────

    if (stressResult.frostSeverity !== 'none') {
      const sev = stressResult.frostSeverity;
      events.push({
        id:          'frost-' + today,
        type:        'frost',
        title:       'Frost risk',
        date:        today,
        time:        null,
        severity:    sev === 'severe' ? 'critical' : sev === 'moderate' ? 'high' : 'medium',
        status:      'today',
        reason:      `Frost severity: ${sev}`,
        actionLabel: 'Avoid mowing — protect grass',
      });
    }

    if (stressResult.heatStressSeverity !== 'none') {
      const sev = stressResult.heatStressSeverity;
      events.push({
        id:          'heat-' + today,
        type:        'heat_stress',
        title:       'Heat stress',
        date:        today,
        time:        null,
        severity:    sev === 'severe' ? 'critical' : sev === 'moderate' ? 'high' : 'medium',
        status:      'today',
        reason:      `Heat stress severity: ${sev}`,
        actionLabel: 'Water lightly to cool root zone',
      });
    }

    if (stressResult.recoveryMode) {
      events.push({
        id:          'recovery-' + today,
        type:        'recovery',
        title:       'Recovery period',
        date:        today,
        time:        null,
        severity:    'low',
        status:      'today',
        reason:      'Low growth score — grass is building strength',
        actionLabel: 'Avoid heavy disturbance',
      });
    }

    // ── Upcoming watering ─────────────────────────────────────────────────────

    const waterDate = waterResult.nextWateringDate;
    if (this._validDate(waterDate) && waterDate <= horizon) {
      const deficitMm = waterResult.waterDeficitMm     ?? 0;
      const amountMm  = waterResult.nextWateringAmountMm ?? 0;
      const isOverdue = waterDate < today;
      events.push({
        id:          'watering-' + (isOverdue ? today : waterDate),
        type:        'watering',
        title:       amountMm > 0 ? `Water lawn (${amountMm} mm)` : 'Water lawn',
        date:        isOverdue ? today : waterDate,
        time:        settings.preferred_watering_time || null,
        severity:    deficitMm > 20 ? 'high' : deficitMm > 8 ? 'medium' : 'low',
        status:      isOverdue ? 'overdue' : waterDate === today ? 'today' : 'upcoming',
        reason:      deficitMm > 0
          ? `Water deficit: ${deficitMm} mm remaining this week`
          : (waterResult.status || 'Water schedule'),
        actionLabel: amountMm > 0 ? `Apply ${amountMm} mm` : 'Water the lawn',
      });
    }

    // ── Fertiliser ────────────────────────────────────────────────────────────

    const fertDate   = fertResult.nextDate;
    const fertDue    = fertResult.due;
    const daysRem    = fertResult.daysRemaining ?? null;

    // Show if: due now, or within horizon, or up to 3 days overdue
    const fertVisible = fertDue
      || (this._validDate(fertDate) && fertDate >= this._addDays(today, -3) && fertDate <= horizon);

    if (fertVisible) {
      const isOverdue = this._validDate(fertDate) && fertDate < today;
      const displayDate = (isOverdue || !this._validDate(fertDate)) ? today : fertDate;
      events.push({
        id:          'fertiliser-' + displayDate,
        type:        'fertiliser',
        title:       'Apply fertiliser',
        date:        displayDate,
        time:        null,
        severity:    fertDue || isOverdue ? 'high'
          : daysRem != null && daysRem <= 3 ? 'medium' : 'low',
        status:      isOverdue ? 'overdue' : displayDate === today ? 'today' : 'upcoming',
        reason:      fertResult.status || 'Fertiliser interval reached',
        actionLabel: 'Apply fertiliser now',
      });
    }

    // ── Mowing window ─────────────────────────────────────────────────────────

    const mowingWindow = mowingResult.nextMowingWindow;
    if (mowingWindow && mowingWindow !== '—') {
      const match = /(\d{4}-\d{2}-\d{2})/.exec(mowingWindow);
      if (match) {
        const mowDate = match[1];
        if (mowDate >= today && mowDate <= horizon) {
          events.push({
            id:          'mowing-' + mowDate,
            type:        'mowing',
            title:       'Mow lawn',
            date:        mowDate,
            time:        null,
            severity:    assessment.mowingRecommended ? 'medium' : 'low',
            status:      mowDate === today ? 'today' : 'upcoming',
            reason:      mowingResult.mowingStatus || 'Dry window — good conditions',
            actionLabel: 'Mow the lawn',
          });
        }
      }
    }

    // ── Sort: by date ascending, then severity descending ─────────────────────

    const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
    });

    return events;
  }

  /**
   * Return the single most urgent (first) event, or null.
   * @param {CalendarEvent[]} events
   * @returns {CalendarEvent|null}
   */
  nextEvent(events) {
    return (Array.isArray(events) && events.length > 0) ? events[0] : null;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _validDate(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && str !== '—';
  }

  _addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}

/**
 * @typedef {object} CalendarEvent
 * @property {string}      id
 * @property {string}      type
 * @property {string}      title
 * @property {string}      date
 * @property {string|null} time
 * @property {string}      severity
 * @property {string}      status
 * @property {string}      reason
 * @property {string}      actionLabel
 */

module.exports = LawnCalendarService;
