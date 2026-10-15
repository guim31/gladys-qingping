// -----------------------------------------------------------------------------
// Reading the answers of the Qingping cloud (`GET /v1/apis/devices`) into plain
// records. Nothing here trusts the payload: an unknown metric is ignored, a
// value that is not a finite number is dropped, a missing field is null.
//
// Shape of one entry of `devices` (Qingping open API, and the official Go SDK
// ClearGrass/OpenapiSdkGo, structs/res.go):
//   info: { mac, product: { id, name, en_name }, name, version, created_at,
//           group_id, group_name, status: { offline }, setting: {
//           report_interval, collect_interval } }   (intervals in seconds)
//   data: { timestamp: { value }, battery: { value, status? }, temperature:
//           { value, status? }, ... }               (timestamp in seconds)
// The `status` of a sensor metric: 0 normal, 1 abnormal, 2 warming up. For the
// battery, it is the charging state instead (0 on battery, 1 charging, 2 full).
// -----------------------------------------------------------------------------

// The metrics the integration turns into Gladys features, by API key.
export const METRIC_KEYS = Object.freeze([
  'temperature',
  'prob_temperature',
  'humidity',
  'co2',
  'pm25',
  'pm10',
  'tvoc',
  'tvoc_index',
  'noise',
  'pressure',
  'battery',
]);

// The battery `status` is a charging state, not a sensor health.
const STATUS_IS_HEALTH = new Set(METRIC_KEYS.filter((key) => key !== 'battery'));

// Fallback when the cloud gives no report interval (a Bluetooth sensor synced
// through the app or a gateway): one hour.
export const DEFAULT_REPORT_INTERVAL_S = 3600;

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A MAC as the cloud writes it (`582D34000001`), upper case, no separator. */
export function normalizeMac(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const mac = raw.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return mac.length >= 6 && mac.length <= 16 ? mac : null;
}

/**
 * One device of the list.
 * @param {object} raw an entry of `devices`
 * @returns {object|null} null when the entry has no usable MAC
 */
export function parseDevice(raw) {
  const info = raw && typeof raw.info === 'object' && raw.info ? raw.info : {};
  const data = raw && typeof raw.data === 'object' && raw.data ? raw.data : {};
  const mac = normalizeMac(info.mac);
  if (!mac) {
    return null;
  }
  const product = info.product && typeof info.product === 'object' ? info.product : {};
  const setting = info.setting && typeof info.setting === 'object' ? info.setting : {};
  const reportInterval = finite(setting.report_interval);
  const collectInterval = finite(setting.collect_interval);

  const metrics = {};
  const unhealthy = [];
  for (const key of METRIC_KEYS) {
    const entry = data[key];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = finite(entry.value);
    if (value === null) {
      continue;
    }
    // A sensor out of order or still warming up gives a value it does not
    // stand by: keep the previous one in Gladys rather than a wrong reading.
    const status = finite(entry.status);
    if (STATUS_IS_HEALTH.has(key) && (status === 1 || status === 2)) {
      unhealthy.push(key);
      continue;
    }
    metrics[key] = value;
  }

  const timestamp = finite(data.timestamp?.value);
  return {
    mac,
    name: text(info.name),
    productId: finite(product.id),
    model: text(product.en_name) ?? text(product.name),
    version: text(info.version),
    offline: info.status?.offline === true,
    reportIntervalS: reportInterval && reportInterval > 0 ? reportInterval : null,
    collectIntervalS: collectInterval && collectInterval > 0 ? collectInterval : null,
    // Seconds in the API, milliseconds here.
    readingAt: timestamp && timestamp > 0 ? timestamp * 1000 : null,
    metrics,
    unhealthy,
  };
}

/**
 * The whole answer of a page of the device list.
 * @returns {{ total: number|null, devices: object[] }}
 */
export function parseDeviceList(body) {
  const list = Array.isArray(body?.devices) ? body.devices : [];
  return {
    total: finite(body?.total),
    devices: list.map(parseDevice).filter(Boolean),
    raw: list.length,
  };
}

/** The report interval to reckon with, in milliseconds. */
export const reportIntervalMs = (device) =>
  (device.reportIntervalS ?? DEFAULT_REPORT_INTERVAL_S) * 1000;
