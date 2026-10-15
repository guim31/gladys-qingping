// -----------------------------------------------------------------------------
// Reading the cloud answers (src/qingping/model.js) and the air quality levels
// (src/airQuality.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, THRESHOLDS, evaluate, levelWithMemory, rawLevel } from '../src/airQuality.js';
import { normalizeMac, parseDevice, parseDeviceList } from '../src/qingping/model.js';
import { fixture } from './helpers/fakeQingping.js';

test('parses an Air Monitor Lite of the fixture', () => {
  const [lite] = parseDeviceList(fixture('devices')).devices;
  assert.deepEqual(lite, {
    mac: '582D34000001',
    name: 'Living room',
    productId: 1203,
    model: 'Qingping Air Monitor Lite',
    version: '1.0.6_0104',
    offline: false,
    reportIntervalS: 900,
    collectIntervalS: 900,
    readingAt: Date.UTC(2025, 9, 15, 10, 0, 0),
    metrics: { temperature: 26.4, humidity: 44.3, co2: 1053, pm25: 12, pm10: 12, battery: 100 },
    unhealthy: [],
  });
});

test('ignores the unknown metrics and keeps the known ones of every model', () => {
  const devices = parseDeviceList(fixture('devices')).devices;
  assert.deepEqual(
    devices.map((device) => Object.keys(device.metrics)),
    [
      ['temperature', 'humidity', 'co2', 'pm25', 'pm10', 'battery'],
      ['temperature', 'humidity', 'co2', 'battery'], // `signal` ignored
      ['temperature', 'humidity', 'co2', 'pm25', 'pm10', 'tvoc_index', 'noise', 'battery'],
      ['temperature', 'prob_temperature', 'humidity', 'pressure', 'battery'],
    ],
  );
});

test('a sensor warming up or out of order publishes nothing; the battery status is a charge state', () => {
  const [device] = parseDeviceList(fixture('devices-sensor-warming-up')).devices;
  assert.deepEqual(device.metrics, { temperature: 22.8, humidity: 51, battery: 100 });
  assert.deepEqual(device.unhealthy, ['co2', 'pm25', 'pm10']);
});

test('survives a hostile or incomplete payload', () => {
  assert.equal(parseDevice(null), null);
  assert.equal(parseDevice({ info: { mac: 12 } }), null);
  const device = parseDevice({
    info: { mac: '58:2d:34:00:00:09', status: 'x', setting: { report_interval: -5 } },
    data: { co2: { value: 'NaN' }, temperature: { value: '21.5' }, pm25: 'bad', timestamp: {} },
  });
  assert.equal(device.mac, '582D34000009');
  assert.deepEqual(device.metrics, { temperature: 21.5 });
  assert.equal(device.reportIntervalS, null);
  assert.equal(device.readingAt, null);
  assert.equal(device.offline, false);
  assert.equal(device.name, null);
  assert.deepEqual(parseDeviceList({}), { total: null, devices: [], raw: 0 });
  assert.equal(normalizeMac('abc'), null);
});

test('air quality: the worst metric gives the level and the cause', () => {
  assert.deepEqual(evaluate({ co2: 600, pm25: 5 }).level, 'good');
  assert.equal(evaluate({ co2: 600, pm25: 5 }).cause, null);
  assert.deepEqual(
    { ...evaluate({ co2: 1053, pm25: 12, pm10: 12 }), perMetric: undefined },
    { level: 'poor', cause: 'co2', perMetric: undefined },
  );
  assert.equal(evaluate({ co2: 700, pm25: 60 }).cause, 'pm25');
  assert.equal(evaluate({ co2: 2500 }).level, 'bad');
  assert.equal(evaluate({ tvoc: 700 }).level, 'poor');
  assert.equal(evaluate({ tvoc_index: 260 }).level, 'poor');
  // A thermometer has no air quality.
  assert.deepEqual(evaluate({ temperature: 21, humidity: 50 }), {
    level: null,
    cause: null,
    perMetric: {},
  });
});

test('air quality: every threshold starts the next level', () => {
  for (const [metric, bounds] of Object.entries(THRESHOLDS)) {
    assert.equal(rawLevel(metric, 0), 0);
    bounds.forEach((bound, index) => {
      assert.equal(rawLevel(metric, bound - 0.1), index, `${metric} under ${bound}`);
      assert.equal(rawLevel(metric, bound), index + 1, `${metric} at ${bound}`);
    });
  }
  assert.equal(LEVELS.length, 4);
});

test('air quality: a level only goes down 5 % under its threshold', () => {
  // CO₂ hovering around 1000 ppm.
  let state = evaluate({ co2: 1010 });
  assert.equal(state.level, 'poor');
  state = evaluate({ co2: 990 }, state.perMetric);
  assert.equal(state.level, 'poor', 'still poor at 990');
  state = evaluate({ co2: 960 }, state.perMetric);
  assert.equal(state.level, 'poor', 'still poor at 960');
  state = evaluate({ co2: 940 }, state.perMetric);
  assert.equal(state.level, 'moderate', 'moderate under 950');
  // Going up is immediate.
  state = evaluate({ co2: 1000 }, state.perMetric);
  assert.equal(state.level, 'poor');
  // A big drop goes straight to the right level.
  assert.equal(levelWithMemory('co2', 500, 3), 0);
});
