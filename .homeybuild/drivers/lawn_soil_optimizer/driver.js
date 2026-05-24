'use strict';

const Homey = require('homey');

class LawnSoilOptimizerDriver extends Homey.Driver {

  async onInit() {
    this.log('LawnSoilOptimizerDriver initialised');
  }

  // ─── Pairing ────────────────────────────────────────────────────────────────

  /**
   * SDK v3 pairing session.
   *
   * Flow:
   *  1. "start" view – custom HTML form collects lawn settings
   *  2. "add_device" template – built-in Homey view lists & confirms the device
   *
   * The start view calls session emit 'saveSettings' with form data,
   * then transitions to add_device via window.homey.showView().
   * Homey's add_device template calls list_devices to get the device spec.
   */
  async onPair(session) {
    let pendingDevice = null;

    // Called by start.html to pre-fill lat/lon from Homey's own location
    session.setHandler('getHomeyLocation', async () => {
      try {
        return {
          latitude:  this.homey.geolocation.getLatitude(),
          longitude: this.homey.geolocation.getLongitude(),
        };
      } catch (err) {
        this.log('Could not read Homey geolocation:', err.message);
        return null;
      }
    });

    // Called by start.html when the form is submitted
    session.setHandler('saveSettings', async (formData) => {
      this.log('Pairing – received form data:', JSON.stringify(formData));

      const lat = parseFloat(formData.latitude);
      const lon = parseFloat(formData.longitude);

      if (!isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error('Invalid latitude. Must be between -90 and 90.');
      }
      if (!isFinite(lon) || lon < -180 || lon > 180) {
        throw new Error('Invalid longitude. Must be between -180 and 180.');
      }

      pendingDevice = {
        name: formData.lawnName || 'My Lawn',
        // Unique device id; user can pair multiple lawns
        data: { id: `lawn_${Date.now()}` },
        settings: {
          latitude:                       lat,
          longitude:                      lon,
          lawn_name:                      formData.lawnName || 'My Lawn',
          grass_type:                     formData.grassType || 'cool_season',
          soil_type:                      formData.soilType  || 'loam',
          shade_level:                    formData.shadeLevel || 'full_sun',
          root_depth_cm:                  parseInt(formData.rootDepth, 10) || 6,
          update_interval_minutes:        60,
          enable_notifications:           false,
          preferred_mowing_min_temp:      8,
          preferred_fertilizing_min_temp: 10,
          watering_threshold_mm_24h:      3,
          // Fertiliser scheduling defaults
          last_fertiliser_date:           formData.lastFertiliserDate || '',
          fertiliser_interval_days:       parseInt(formData.fertiliserIntervalDays, 10) || 42,
          fertiliser_strategy:            formData.fertiliserStrategy || 'balanced',
          fertiliser_season_start_month:  parseInt(formData.fertiliserSeasonStart, 10) || 4,
          fertiliser_season_end_month:    parseInt(formData.fertiliserSeasonEnd, 10) || 10,
          fertiliser_min_soil_temp:       parseFloat(formData.fertiliserMinTemp) || 10,
          fertiliser_rain_window_mm_min:  parseFloat(formData.fertiliserRainMin) || 2,
          fertiliser_rain_window_mm_max:  parseFloat(formData.fertiliserRainMax) || 15,
        },
      };

      // Must return a value so the HTML callback fires
      return true;
    });

    // Called by the built-in add_device template to get the device list
    session.setHandler('list_devices', async () => {
      if (!pendingDevice) return [];
      return [pendingDevice];
    });
  }

  // ─── Repair (edit device settings) ─────────────────────────────────────────

  async onRepair(session, device) {
    session.setHandler('getDeviceSettings', async () => {
      return device.getSettings();
    });

    session.setHandler('saveSettings', async (newSettings) => {
      await device.setSettings(newSettings);
      await device.refreshData().catch(this.error.bind(this));
    });

    // Provides dashboard capability values to the repair view
    session.setHandler('getDashboardState', async () => {
      const caps = [
        'lawn_overall_score',
        'lawn_status',
        'primary_recommendation',
        'next_action',
        'next_action_date',
        'next_action_reason',
        'lawn_growth_score',
        'frost_severity',
        'heat_stress_severity',
        'lawn_recovery_mode',
        'last_updated',
      ];
      const result = {};
      for (const cap of caps) {
        try {
          result[cap] = device.getCapabilityValue(cap);
        } catch (_) {
          result[cap] = null;
        }
      }
      return result;
    });
  }

  // ─── Flow trigger helpers (called by device.js) ────────────────────────────

  triggerSoilTempAbove(device, temperature) {
    this.homey.flow
      .getDeviceTriggerCard('soil_temp_above')
      .trigger(device, { temperature }, { temperature })
      .catch(this.error.bind(this));
  }

  triggerSoilTempBelow(device, temperature) {
    this.homey.flow
      .getDeviceTriggerCard('soil_temp_below')
      .trigger(device, { temperature }, { temperature })
      .catch(this.error.bind(this));
  }

  triggerGrowthScoreAbove(device, score) {
    this.homey.flow
      .getDeviceTriggerCard('growth_score_above')
      .trigger(device, { score }, { score })
      .catch(this.error.bind(this));
  }

  triggerMowingChanged(device, recommended) {
    this.homey.flow
      .getDeviceTriggerCard('mowing_recommended_changed')
      .trigger(device, { recommended })
      .catch(this.error.bind(this));
  }

  triggerWateringChanged(device, recommended) {
    this.homey.flow
      .getDeviceTriggerCard('watering_recommended_changed')
      .trigger(device, { recommended })
      .catch(this.error.bind(this));
  }

  triggerFertilizingChanged(device, recommended) {
    this.homey.flow
      .getDeviceTriggerCard('fertilizing_recommended_changed')
      .trigger(device, { recommended })
      .catch(this.error.bind(this));
  }

  triggerFrostRiskStarted(device) {
    this.homey.flow
      .getDeviceTriggerCard('frost_risk_started')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerHeatStressStarted(device) {
    this.homey.flow
      .getDeviceTriggerCard('heat_stress_started')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerLawnStatusChanged(device, status) {
    this.homey.flow
      .getDeviceTriggerCard('lawn_status_changed')
      .trigger(device, { status })
      .catch(this.error.bind(this));
  }

  // ─── Water schedule trigger helpers ───────────────────────────────────────

  triggerWateringDueStarted(device) {
    this.homey.flow
      .getDeviceTriggerCard('watering_due_started')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerWateringDueCleared(device) {
    this.homey.flow
      .getDeviceTriggerCard('watering_due_cleared')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerWaterDeficitAbove(device, deficit) {
    this.homey.flow
      .getDeviceTriggerCard('water_deficit_above')
      .trigger(device, { deficit_mm: deficit }, { deficit: deficit })
      .catch(this.error.bind(this));
  }

  triggerWeeklyWaterTargetReached(device) {
    this.homey.flow
      .getDeviceTriggerCard('weekly_water_target_reached')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerWaterScheduleChanged(device, status) {
    this.homey.flow
      .getDeviceTriggerCard('water_schedule_changed')
      .trigger(device, { status: status || '' })
      .catch(this.error.bind(this));
  }

  triggerWateringDelayedDueToRain(device) {
    this.homey.flow
      .getDeviceTriggerCard('watering_delayed_due_to_rain')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerWeeklyWaterReset(device) {
    this.homey.flow
      .getDeviceTriggerCard('weekly_water_reset')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  // ─── Lawn profile optimization trigger helpers ─────────────────────────────

  triggerMowingHeightAdjustmentRecommended(device, heightMm, reason) {
    this.homey.flow
      .getDeviceTriggerCard('mowing_height_adjustment_recommended')
      .trigger(device, { recommended_height_mm: heightMm, reason: reason || '' })
      .catch(this.error.bind(this));
  }

  triggerLawnProfileChanged(device, profile) {
    this.homey.flow
      .getDeviceTriggerCard('lawn_profile_changed')
      .trigger(device, { profile: profile || '' })
      .catch(this.error.bind(this));
  }

  triggerMowingFrequencyChanged(device, frequencyDays) {
    this.homey.flow
      .getDeviceTriggerCard('mowing_frequency_changed')
      .trigger(device, { frequency_days: frequencyDays })
      .catch(this.error.bind(this));
  }

  // ─── Fertiliser trigger helpers ────────────────────────────────────────────

  triggerFertiliserDueStarted(device, nextDate) {
    this.homey.flow
      .getDeviceTriggerCard('fertiliser_due_started')
      .trigger(device, { next_date: nextDate || '' })
      .catch(this.error.bind(this));
  }

  triggerFertiliserDueCleared(device) {
    this.homey.flow
      .getDeviceTriggerCard('fertiliser_due_cleared')
      .trigger(device)
      .catch(this.error.bind(this));
  }

  triggerFertiliserDateChanged(device, nextDate, daysRemaining) {
    this.homey.flow
      .getDeviceTriggerCard('fertiliser_date_changed')
      .trigger(device, { next_date: nextDate || '', days_remaining: daysRemaining ?? 0 })
      .catch(this.error.bind(this));
  }

  triggerFertiliserDelayed(device, reason) {
    this.homey.flow
      .getDeviceTriggerCard('fertiliser_delayed')
      .trigger(device, { reason: reason || '' })
      .catch(this.error.bind(this));
  }
}

module.exports = LawnSoilOptimizerDriver;
