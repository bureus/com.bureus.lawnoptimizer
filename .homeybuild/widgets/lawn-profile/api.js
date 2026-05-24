'use strict';

const CAPABILITY_KEYS = [
  'lawn_profile_active',
  'lawn_profile_status',
  'recommended_mowing_height_mm',
  'current_target_height_mm',
  'mowing_height_adjustment_reason',
  'mowing_frequency_days',
  'visual_quality_score',
  'heat_stress_severity',
  'frost_severity',
  'lawn_recovery_mode',
  'lawn_growth_score',
  'water_deficit_mm',
  'mowing_status',
  'last_updated',
];

const PROFILE_LABELS = {
  showcase:          'Showcase Lawn',
  balanced:          'Balanced',
  drought_resistant: 'Drought Resistant',
  low_maintenance:   'Low Maintenance',
  shade_lawn:        'Shade Lawn',
  custom:            'Custom',
};

const STATUS_LABELS = {
  premium_growth_mode:    'Premium growth mode',
  spring_growth_mode:     'Spring growth',
  heat_stress_management: 'Heat stress management',
  drought_protection:     'Drought protection',
  drought_resistant_mode: 'Drought resistant mode',
  frost_protection:       'Frost protection',
  low_maintenance_mode:   'Low maintenance mode',
  slow_growth_mode:       'Slow growth',
  normal:                 'Normal',
};

module.exports = {

  async getData({ homey }) {
    const driver  = homey.drivers.getDriver('lawn_soil_optimizer');
    const devices = driver.getDevices();

    if (!devices.length) {
      return { error: 'No lawn device paired yet.' };
    }

    const device   = devices[0];
    const settings = device.getSettings();

    const result = {
      deviceName:      device.getName(),
      profileSetting:  settings.lawn_optimization_profile ?? 'balanced',
      profileLabel:    PROFILE_LABELS[settings.lawn_optimization_profile ?? 'balanced'] ?? 'Balanced',
      targetHeightMm:  settings.target_grass_height_mm    ?? 40,
      minHeightMm:     settings.minimum_grass_height_mm   ?? 30,
      maxHeightMm:     settings.maximum_grass_height_mm   ?? 60,
      growthSpeed:     settings.grass_growth_speed        ?? 'medium',
      freqStrategy:    settings.mowing_frequency_strategy ?? 'adaptive',
      visualQuality:   settings.desired_visual_quality    ?? 'balanced',
    };

    for (const cap of CAPABILITY_KEYS) {
      try {
        result[cap] = device.getCapabilityValue(cap);
      } catch (_) {
        result[cap] = null;
      }
    }

    // Resolve human-readable status label
    result.profileStatusLabel = STATUS_LABELS[result.lawn_profile_status] ?? result.lawn_profile_status ?? '—';

    // Stress flag for UI colouring
    result.hasHeatStress = result.heat_stress_severity !== 'none' && result.heat_stress_severity != null;
    result.hasFrost      = result.frost_severity       !== 'none' && result.frost_severity != null;
    result.inRecovery    = result.lawn_recovery_mode === true;

    // Height range label, e.g. "30–60 mm"
    result.heightRangeLabel = `${result.minHeightMm}–${result.maxHeightMm} mm`;

    return result;
  },

};
