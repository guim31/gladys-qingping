// -----------------------------------------------------------------------------
// Scene action handler (manifest `scene_actions`, Gladys 5.1+).
//
// `get_air_quality`: the air quality of a device in words, for the actions
// that follow — "Air in the bedroom: {{1.0.level_label}} ({{1.0.cause}})"
// in a message, or a "continue only if level is poor" condition. The device
// values themselves are already readable by any scene; the level, which
// combines them with the thresholds of src/airQuality.js, is not.
// No request: the latest reading the hub holds.
// -----------------------------------------------------------------------------

import { LEVELS } from './airQuality.js';
import { CAUSE_TEXT, LEVEL_TEXT, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async get_air_quality(hub, { fields = {} }) {
    const record = hub.airQuality(fields.device);
    const language = hub.config.language;
    const { level, cause } = record.air;
    return {
      level,
      level_number: LEVELS.indexOf(level) + 1,
      level_label: pick(LEVEL_TEXT[level], language),
      cause: cause ? pick(CAUSE_TEXT[cause], language) : '',
      co2: record.values.co2 ?? null,
      pm25: record.values.pm25 ?? null,
      minutes_since_reading: hub.ageMinutes(record),
      reporting: record.reporting === true,
    };
  },
};
