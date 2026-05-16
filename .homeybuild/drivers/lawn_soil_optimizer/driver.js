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
}

module.exports = LawnSoilOptimizerDriver;
