'use strict';

/**
 * SoilTemperatureModel
 *
 * Estimates soil temperatures at different depths using a weighted blending
 * model. Prefers real Open-Meteo soil temperature readings; falls back to
 * air-temperature-based estimates when those fields are missing.
 *
 * Modifiers applied:
 *   - Sandy soil: reacts faster (higher weight on current readings)
 *   - Clay soil:  reacts slower (higher weight on previous/persistent state)
 *   - Partial/full shade: reduces solar warming contribution
 *   - Warm-season grass has a higher optimal growth window (informational)
 */
class SoilTemperatureModel {

  /**
   * @param {object} settings  Device settings subset
   * @param {string} settings.soil_type     'sand' | 'loam' | 'clay'
   * @param {string} settings.shade_level   'full_sun' | 'partial_shade' | 'shade'
   * @param {string} settings.grass_type    'cool_season' | 'warm_season' | 'mixed'
   * @param {number} settings.root_depth_cm
   */
  constructor(settings) {
    this._soilType   = settings.soil_type    || 'loam';
    this._shade      = settings.shade_level  || 'full_sun';
    this._grassType  = settings.grass_type   || 'cool_season';
    this._rootDepth  = settings.root_depth_cm || 6;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Calculate all relevant temperature estimates from a weather snapshot.
   *
   * @param {import('./OpenMeteoClient').WeatherSnapshot} snapshot
   * @param {number|null} previousRootZone  Stored root-zone temp from last run
   * @returns {SoilTemps}
   */
  calculate(snapshot, previousRootZone) {
    const { current, history } = snapshot;

    const airTemp         = current.airTemp ?? 10;
    const avgAirTemp24h   = this._avg(history.map((r) => r.airTemp));
    const soilSurface     = this._estimateSurface(current, avgAirTemp24h);
    const soil6cm         = this._estimateSoil6cm(current, soilSurface, previousRootZone, avgAirTemp24h);
    const rootZone        = this._estimateRootZone(current, soil6cm, previousRootZone, avgAirTemp24h, airTemp);
    const soilMoisturePct = this._soilMoisturePct(current);
    const rain24h         = this._sum(history.map((r) => r.precipitation ?? r.rain));

    return {
      airTemp,
      soilSurface:    this._round(soilSurface),
      soil6cm:        this._round(soil6cm),
      rootZone:       this._round(rootZone),
      soilMoisturePct,
      rain24h:        this._round(rain24h),
      avgAirTemp24h:  this._round(avgAirTemp24h),
    };
  }

  // ─── Surface temperature ───────────────────────────────────────────────────

  _estimateSurface(current, avgAirTemp24h) {
    // Prefer real API value
    if (current.soilTemp0cm !== null) {
      return this._applyShadeMod(current.soilTemp0cm, current.shortwaveRad);
    }

    // Fallback: air temperature + solar adjustment
    const solarBoost = this._solarBoost(current.shortwaveRad, current.cloudCover);
    return avgAirTemp24h + solarBoost;
  }

  // ─── 6 cm depth ───────────────────────────────────────────────────────────

  _estimateSoil6cm(current, soilSurface, prev, avgAirTemp24h) {
    if (current.soilTemp6cm !== null) {
      return current.soilTemp6cm;
    }
    // Weighted estimate: surface + air average
    const wSurface = 0.60;
    const wAir     = 0.40;
    const raw = (wSurface * soilSurface) + (wAir * avgAirTemp24h);
    return this._applySoilTypeLag(raw, prev ?? raw);
  }

  // ─── Root zone ─────────────────────────────────────────────────────────────

  _estimateRootZone(current, soil6cm, prev, avgAirTemp24h, airTemp) {
    const hasPrev = typeof prev === 'number' && isFinite(prev);

    // Best case: we have real soil6cm from API
    if (current.soilTemp6cm !== null) {
      const raw = 0.65 * soil6cm
                + 0.25 * avgAirTemp24h
                + 0.10 * this._solarAdjustedSurface(current);
      return this._applySoilTypeLag(raw, hasPrev ? prev : raw);
    }

    // Partial fallback: no API soil data, use air temps
    if (hasPrev) {
      return 0.70 * prev
           + 0.25 * avgAirTemp24h
           + 0.05 * airTemp;
    }

    // Cold-start fallback: no previous value either
    return avgAirTemp24h;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Apply soil-type reaction speed modifier.
   * Sandy soil tracks air temp faster; clay is more inertial.
   */
  _applySoilTypeLag(newEstimate, previousValue) {
    const weights = {
      sand: { w_new: 0.80, w_prev: 0.20 },
      loam: { w_new: 0.65, w_prev: 0.35 },
      clay: { w_new: 0.50, w_prev: 0.50 },
    };
    const { w_new, w_prev } = weights[this._soilType] || weights.loam;
    return w_new * newEstimate + w_prev * previousValue;
  }

  /** Reduce surface warming contribution based on shade level */
  _applyShadeMod(baseTemp, shortwaveRad) {
    const solarBoost = this._solarBoost(shortwaveRad, null);
    const shadeFactor = { full_sun: 1.0, partial_shade: 0.6, shade: 0.2 };
    const factor = shadeFactor[this._shade] || 1.0;
    return baseTemp + solarBoost * (factor - 1.0); // subtract unshaded boost
  }

  /** Solar-adjusted surface: air temp + solar boost with shade applied */
  _solarAdjustedSurface(current) {
    const boost  = this._solarBoost(current.shortwaveRad, current.cloudCover);
    const factor = { full_sun: 1.0, partial_shade: 0.6, shade: 0.2 }[this._shade] || 1.0;
    return (current.airTemp ?? 10) + boost * factor;
  }

  /**
   * Estimate solar warming contribution to surface temperature.
   * Returns °C uplift (0–5).
   */
  _solarBoost(shortwaveRad, cloudCover) {
    if (shortwaveRad !== null && shortwaveRad > 0) {
      // Empirically: ~600 W/m² clear sky → ~3–4 °C surface uplift
      return Math.min(5, shortwaveRad / 150);
    }
    if (cloudCover !== null) {
      const clearFraction = Math.max(0, 1 - cloudCover / 100);
      return clearFraction * 2.5;
    }
    return 0;
  }

  /**
   * Convert volumetric soil moisture (m³/m³) to a percentage 0–100.
   * Uses a weighted average of the three top layers from Open-Meteo.
   * Field capacity ≈ 0.40 m³/m³ → 100%.
   */
  _soilMoisturePct(current) {
    const values = [current.soilMoist0to1, current.soilMoist1to3, current.soilMoist3to9]
      .filter((v) => v !== null);
    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.min(100, Math.round((avg / 0.40) * 100));
  }

  _avg(arr) {
    const valid = arr.filter((v) => v !== null && isFinite(v));
    if (valid.length === 0) return 10; // safe default
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }

  _sum(arr) {
    return arr.filter((v) => v !== null && isFinite(v))
              .reduce((a, b) => a + b, 0);
  }

  _round(v, decimals = 1) {
    if (v === null || !isFinite(v)) return null;
    const factor = 10 ** decimals;
    return Math.round(v * factor) / factor;
  }
}

/**
 * @typedef {object} SoilTemps
 * @property {number}      airTemp
 * @property {number}      soilSurface      Estimated or real 0 cm temp
 * @property {number}      soil6cm          Estimated or real 6 cm temp
 * @property {number}      rootZone         Weighted root-zone estimate
 * @property {number|null} soilMoisturePct  0–100 %, null if no data
 * @property {number}      rain24h          mm of precipitation in last 24 h
 * @property {number}      avgAirTemp24h    Rolling 24 h air temp average
 */

module.exports = SoilTemperatureModel;
