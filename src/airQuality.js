// -----------------------------------------------------------------------------
// One readable air quality level per device, from the metrics it measures:
// good, moderate, poor or bad — the worst of its CO₂, PM2.5, PM10 and VOC
// levels, and the metric responsible (`cause`).
//
// The thresholds (lower bound of each level above "good"), in the unit the
// Qingping cloud reports:
//   - CO₂ (ppm): 800 / 1000 / 2000 — 1000 and 2000 are the guide values of the
//     German Environment Agency (UBA) for indoor air; 800 marks "ventilate
//     soon";
//   - PM2.5 (µg/m³): 15 / 35 / 55 — 15 is the 24-hour WHO 2021 guideline, 35
//     and 55 the US EPA breakpoints for "unhealthy for sensitive groups" and
//     "unhealthy";
//   - PM10 (µg/m³): 45 / 100 / 200 — 45 is the 24-hour WHO 2021 guideline;
//   - TVOC (ppb): 220 / 660 / 2200 — the levels derived from the UBA TVOC
//     guidance that most consumer monitors use;
//   - VOC index (Sensirion, 1 to 500, 100 = the room's usual air): 150 / 250 /
//     400.
// Temperature, humidity and noise do not count: they are comfort, not air
// quality. A thermometer has no air quality level (null).
//
// A metric only goes back down a level once it is 5 % under the threshold it
// crossed: a CO₂ hovering around 1000 ppm does not flip the level (and fire
// the scene trigger) at every reading.
// -----------------------------------------------------------------------------

export const LEVELS = Object.freeze(['good', 'moderate', 'poor', 'bad']);

export const THRESHOLDS = Object.freeze({
  co2: [800, 1000, 2000],
  pm25: [15, 35, 55],
  pm10: [45, 100, 200],
  tvoc: [220, 660, 2200],
  tvoc_index: [150, 250, 400],
});

// Order of precedence when two metrics share the worst level.
export const AIR_METRICS = Object.freeze(Object.keys(THRESHOLDS));

const HYSTERESIS = 0.05;

/** Level index (0 good … 3 bad) of one value, without memory. */
export function rawLevel(metric, value) {
  const bounds = THRESHOLDS[metric];
  let level = 0;
  for (const bound of bounds) {
    if (value >= bound) {
      level += 1;
    }
  }
  return level;
}

/** Level index of one value, given the level it had at the previous reading. */
export function levelWithMemory(metric, value, previous) {
  const level = rawLevel(metric, value);
  if (previous === undefined || previous === null || level >= previous) {
    return level;
  }
  // Going down: only once under the crossed threshold minus the margin.
  const crossed = THRESHOLDS[metric][previous - 1];
  return value >= crossed * (1 - HYSTERESIS) ? previous : level;
}

/**
 * @param {Record<string, number>} metrics the latest values of a device
 * @param {Record<string, number>} [previous] the per-metric level indexes of
 *   the previous evaluation
 * @returns {{ level: string|null, cause: string|null, perMetric: Record<string, number> }}
 */
export function evaluate(metrics, previous = {}) {
  const perMetric = {};
  let worst = -1;
  let cause = null;
  for (const metric of AIR_METRICS) {
    const value = metrics[metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const level = levelWithMemory(metric, value, previous[metric]);
    perMetric[metric] = level;
    if (level > worst) {
      worst = level;
      cause = metric;
    }
  }
  if (worst < 0) {
    return { level: null, cause: null, perMetric };
  }
  return { level: LEVELS[worst], cause: worst > 0 ? cause : null, perMetric };
}

export const levelIndex = (level) => LEVELS.indexOf(level);
