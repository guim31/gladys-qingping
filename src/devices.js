// -----------------------------------------------------------------------------
// One Gladys device per Qingping device of the account.
//
// Identity: the device MAC, as the Qingping cloud gives it — the platform id
// of `gladys.externalIds`. Renaming the device in the Qingping+ app keeps it.
//
// Features: one per metric the device has ever reported (an Air Monitor Lite
// has no noise sensor, a thermometer no CO₂), read-only, in the category/type
// couples of the core table (see test/gladys-rules.test.js), plus the age of
// the latest reading, in minutes: a value that stops moving in Gladys is
// either stable or stale, and only the age tells which.
//
// The devices are published with should_poll: false: the integration reads
// the cloud on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'qingping';
export const MAC_PARAM = 'QINGPING_MAC';
export const MODEL_PARAM = 'QINGPING_MODEL';

// Suffixes of the feature external ids: permanent once published. The metric
// keys are the ones of the Qingping API.
export const FEATURE_KEYS = Object.freeze({
  TEMPERATURE: 'temperature',
  PROBE_TEMPERATURE: 'prob_temperature',
  HUMIDITY: 'humidity',
  CO2: 'co2',
  PM25: 'pm25',
  PM10: 'pm10',
  TVOC: 'tvoc',
  TVOC_INDEX: 'tvoc_index',
  NOISE: 'noise',
  PRESSURE: 'pressure',
  BATTERY: 'battery',
  READING_AGE: 'reading_age',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    temperature: 'Temperature',
    prob_temperature: 'Probe temperature',
    humidity: 'Humidity',
    co2: 'CO₂',
    pm25: 'PM2.5',
    pm10: 'PM10',
    tvoc: 'VOC',
    tvoc_index: 'VOC index',
    noise: 'Noise',
    pressure: 'Pressure',
    battery: 'Battery',
    reading_age: 'Reading age',
  },
  fr: {
    temperature: 'Température',
    prob_temperature: 'Température de la sonde',
    humidity: 'Humidité',
    co2: 'CO₂',
    pm25: 'PM2,5',
    pm10: 'PM10',
    tvoc: 'COV',
    tvoc_index: 'Indice COV',
    noise: 'Bruit',
    pressure: 'Pression',
    battery: 'Batterie',
    reading_age: 'Âge de la mesure',
  },
  de: {
    temperature: 'Temperatur',
    prob_temperature: 'Fühlertemperatur',
    humidity: 'Luftfeuchtigkeit',
    co2: 'CO₂',
    pm25: 'PM2,5',
    pm10: 'PM10',
    tvoc: 'VOC',
    tvoc_index: 'VOC-Index',
    noise: 'Lärm',
    pressure: 'Luftdruck',
    battery: 'Batterie',
    reading_age: 'Alter der Messung',
  },
  es: {
    temperature: 'Temperatura',
    prob_temperature: 'Temperatura de la sonda',
    humidity: 'Humedad',
    co2: 'CO₂',
    pm25: 'PM2,5',
    pm10: 'PM10',
    tvoc: 'COV',
    tvoc_index: 'Índice COV',
    noise: 'Ruido',
    pressure: 'Presión',
    battery: 'Batería',
    reading_age: 'Antigüedad de la medida',
  },
};

// Display bounds (the core never applies them on write; the gauge places its
// needle with them). Values outside are clamped: they are sensor glitches.
const sensor = (category, type, unit, min, max, decimals) => ({
  definition: {
    category,
    type,
    ...(unit ? { unit } : {}),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min,
    max,
  },
  decimals,
});

const { SENSOR } = DEVICE_FEATURE_TYPES;
const C = DEVICE_FEATURE_CATEGORIES;
const U = DEVICE_FEATURE_UNITS;

// Order = display order in Gladys.
export const FEATURES = {
  temperature: sensor(C.TEMPERATURE_SENSOR, SENSOR.DECIMAL, U.CELSIUS, -40, 85, 1),
  prob_temperature: sensor(
    C.TEMPERATURE_SENSOR,
    DEVICE_FEATURE_TYPES.TEMPERATURE_SENSOR.PROBE,
    U.CELSIUS,
    -50,
    150,
    1,
  ),
  humidity: sensor(C.HUMIDITY_SENSOR, SENSOR.DECIMAL, U.PERCENT, 0, 100, 1),
  co2: sensor(C.CO2_SENSOR, SENSOR.INTEGER, U.PPM, 0, 10000, 0),
  pm25: sensor(C.PM25_SENSOR, SENSOR.DECIMAL, U.MICROGRAM_PER_CUBIC_METER, 0, 1000, 1),
  pm10: sensor(C.PM10_SENSOR, SENSOR.DECIMAL, U.MICROGRAM_PER_CUBIC_METER, 0, 1000, 1),
  tvoc: sensor(C.VOC_SENSOR, SENSOR.DECIMAL, U.PPB, 0, 10000, 0),
  tvoc_index: sensor(C.VOC_INDEX_SENSOR, SENSOR.INTEGER, null, 0, 500, 0),
  noise: sensor(C.NOISE_SENSOR, SENSOR.INTEGER, U.DECIBEL, 0, 130, 0),
  pressure: sensor(C.PRESSURE_SENSOR, SENSOR.DECIMAL, U.KILO_PASCAL, 30, 110, 2),
  battery: sensor(C.BATTERY, SENSOR.INTEGER, U.PERCENT, 0, 100, 0),
  // A week, in minutes: older than that, the device is long gone anyway.
  reading_age: sensor(C.DURATION, SENSOR.INTEGER, U.MINUTES, 0, 10080, 0),
};

export const METRIC_FEATURES = Object.keys(FEATURES).filter(
  (key) => key !== FEATURE_KEYS.READING_AGE,
);

/** External ids of a device and its features. */
export const deviceIds = (gladys, mac) => gladys.externalIds(DEVICE_TYPE, mac);

/** The MAC of a device external id, null when it is not one of ours. */
export function macOf(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = deviceIds(gladys, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const mac = externalId.slice(prefix.length);
  return /^[0-9A-F]{6,16}$/.test(mac) ? mac : null;
}

/** The name shown for a device: the one given in the Qingping+ app, else model and MAC end. */
export const deviceName = (device) =>
  device.name ?? `${device.model ?? 'Qingping'} ${device.mac.slice(-4)}`;

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} device parsed device (src/qingping/model.js)
 * @param {string[]} metrics the metric keys it has reported so far
 * @param {string} language feature names language
 */
export function buildDevice(gladys, device, metrics, language = 'en') {
  const ids = deviceIds(gladys, device.mac);
  const names = NAMES[language] ?? NAMES.en;
  const keys = [
    ...METRIC_FEATURES.filter((key) => metrics.includes(key)),
    FEATURE_KEYS.READING_AGE,
  ];
  return {
    name: deviceName(device),
    external_id: ids.device,
    model: device.model ?? undefined,
    should_poll: false,
    params: [
      { name: MAC_PARAM, value: device.mac },
      ...(device.model ? [{ name: MODEL_PARAM, value: device.model }] : []),
    ],
    features: keys.map((key) => ({
      ...FEATURES[key].definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** A value ready for Gladys: rounded and inside the display bounds. */
export function featureValue(key, value) {
  const { definition, decimals } = FEATURES[key];
  const rounded = round(value, decimals);
  return Math.min(definition.max, Math.max(definition.min, rounded));
}

/**
 * The states of a device (null values left out).
 * @param {object} gladys
 * @param {string} mac
 * @param {Record<string, number>} metrics latest values
 * @param {number|null} ageMinutes
 */
export function deviceStates(gladys, mac, metrics, ageMinutes) {
  const ids = deviceIds(gladys, mac);
  const states = [];
  for (const key of METRIC_FEATURES) {
    if (typeof metrics[key] === 'number') {
      states.push({
        device_feature_external_id: ids.feature(key),
        state: featureValue(key, metrics[key]),
      });
    }
  }
  if (typeof ageMinutes === 'number') {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_KEYS.READING_AGE),
      state: featureValue(FEATURE_KEYS.READING_AGE, ageMinutes),
    });
  }
  return states;
}
