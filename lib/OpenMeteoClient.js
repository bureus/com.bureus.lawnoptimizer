'use strict';

const https = require('https');

const BASE_URL = 'api.open-meteo.com';
const HOURLY_VARS = [
  'temperature_2m',
  'precipitation',
  'rain',
  'cloud_cover',
  'shortwave_radiation',
  'soil_temperature_0cm',
  'soil_temperature_6cm',
  'soil_temperature_18cm',
  'soil_moisture_0_to_1cm',
  'soil_moisture_1_to_3cm',
  'soil_moisture_3_to_9cm',
].join(',');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES         = 3;
const RETRY_DELAY_MS      = 2_000;

/**
 * Fetches hourly weather + soil data from the Open-Meteo free forecast API.
 * No API key required. Includes retry/timeout logic.
 */
class OpenMeteoClient {

  constructor(logger) {
    // Accept a Homey-compatible logger so we can emit app-level logs
    this._log = logger || console.log.bind(console);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * @param {number} latitude   Decimal degrees
   * @param {number} longitude  Decimal degrees
   * @returns {Promise<WeatherSnapshot>}
   */
  async fetchCurrentConditions(latitude, longitude) {
    const path = this._buildPath(latitude, longitude);
    const raw  = await this._fetchWithRetry(path);
    return this._parse(raw);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _buildPath(lat, lon) {
    // past_days=1 ensures we have 24 h of history for rolling averages
    return `/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&hourly=${HOURLY_VARS}`
      + `&forecast_days=2`
      + `&past_days=1`
      + `&timezone=auto`;
  }

  async _fetchWithRetry(path, attempt = 1) {
    try {
      return await this._httpGet(path);
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Open-Meteo request failed after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      this._log(`Open-Meteo fetch attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS} ms…`);
      await this._sleep(RETRY_DELAY_MS * attempt);
      return this._fetchWithRetry(path, attempt + 1);
    }
  }

  _httpGet(path) {
    return new Promise((resolve, reject) => {
      const req = https.get({ hostname: BASE_URL, path, timeout: REQUEST_TIMEOUT_MS }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS} ms`));
      });

      req.on('error', reject);
    });
  }

  /**
   * Parses the Open-Meteo hourly response into a structured snapshot aligned
   * to the current hour, plus a 24 h rolling history array.
   *
   * @param {object} raw  Raw Open-Meteo JSON
   * @returns {WeatherSnapshot}
   */
  _parse(raw) {
    const hourly = raw.hourly;
    if (!hourly || !hourly.time || !Array.isArray(hourly.time)) {
      throw new Error('Unexpected Open-Meteo response shape');
    }

    const times = hourly.time; // ISO strings in local timezone

    // Find the index closest to "now"
    const nowMs  = Date.now();
    let closestIdx = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i]).getTime() - nowMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx  = i;
      }
    }

    // Collect up to 24 entries ending at closestIdx (inclusive)
    const histStart = Math.max(0, closestIdx - 23);
    const history   = [];
    for (let i = histStart; i <= closestIdx; i++) {
      history.push(this._rowAt(hourly, i));
    }

    const current = this._rowAt(hourly, closestIdx);

    // Sum hourly precipitation for the 48 h window *after* the current slot.
    // forecast_days=2 guarantees enough future hours are present.
    let precipitationNext48h = 0;
    const forecastEnd = Math.min(closestIdx + 48, times.length - 1);
    if (Array.isArray(hourly.precipitation)) {
      for (let i = closestIdx + 1; i <= forecastEnd; i++) {
        const v = hourly.precipitation[i];
        if (v !== null && v !== undefined) precipitationNext48h += v;
      }
    }
    precipitationNext48h = Math.round(precipitationNext48h * 10) / 10; // 1 dp

    return { current, history, precipitationNext48h, raw };
  }

  _rowAt(hourly, idx) {
    return {
      time:              hourly.time[idx],
      airTemp:           this._val(hourly.temperature_2m, idx),
      precipitation:     this._val(hourly.precipitation, idx),
      rain:              this._val(hourly.rain, idx),
      cloudCover:        this._val(hourly.cloud_cover, idx),
      shortwaveRad:      this._val(hourly.shortwave_radiation, idx),
      soilTemp0cm:       this._val(hourly.soil_temperature_0cm, idx),
      soilTemp6cm:       this._val(hourly.soil_temperature_6cm, idx),
      soilTemp18cm:      this._val(hourly.soil_temperature_18cm, idx),
      soilMoist0to1:     this._val(hourly.soil_moisture_0_to_1cm, idx),
      soilMoist1to3:     this._val(hourly.soil_moisture_1_to_3cm, idx),
      soilMoist3to9:     this._val(hourly.soil_moisture_3_to_9cm, idx),
    };
  }

  /** Safely index into an array that may be undefined or may contain nulls */
  _val(arr, idx) {
    if (!Array.isArray(arr)) return null;
    const v = arr[idx];
    return (v === null || v === undefined) ? null : v;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * @typedef {object} WeatherRow
 * @property {string}      time
 * @property {number|null} airTemp
 * @property {number|null} precipitation
 * @property {number|null} rain
 * @property {number|null} cloudCover
 * @property {number|null} shortwaveRad
 * @property {number|null} soilTemp0cm
 * @property {number|null} soilTemp6cm
 * @property {number|null} soilTemp18cm
 * @property {number|null} soilMoist0to1
 * @property {number|null} soilMoist1to3
 * @property {number|null} soilMoist3to9
 */

/**
 * @typedef {object} WeatherSnapshot
 * @property {WeatherRow}   current              Closest hour to now
 * @property {WeatherRow[]} history              Up to 24 hourly rows ending at current
 * @property {number}       precipitationNext48h Total forecast precipitation for the next 48 h (mm)
 * @property {object}       raw                  Full API response (for debugging)
 */

module.exports = OpenMeteoClient;
