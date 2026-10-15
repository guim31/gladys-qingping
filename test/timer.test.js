// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2 never polls a device
// published with should_poll: false (and never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): the cloud must be read
// by the hub's own timer, with no onPoll at all — and no faster than the
// devices upload.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEST_CONFIG,
  FakeQingping,
  LIVING,
  createAll,
  createClock,
  createWorld,
  featureId,
} from './helpers/world.js';

const MIN = 60_000;

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** A cloud holding the Air Monitor Lite only (report every 15 min, read at 10:00). */
function liteOnly() {
  const cloud = new FakeQingping();
  cloud.list.devices = cloud.list.devices.filter((d) => d.info.mac === LIVING);
  return cloud;
}

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({ clock, cloud: liteOnly(), timers: true, ...options });
  t.after(() => w.app.stop());
  return w;
}

const reads = (cloud) => cloud.requests.filter((r) => r.path === '/v1/apis/devices').length;

/** Move both clocks. */
async function elapse(w, t, ms) {
  w.clock.advance(ms);
  t.mock.timers.tick(ms);
  await settle();
}

test('the internal timer refreshes the states without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');

  const co2 = featureId(w.gladys, 'co2');
  assert.equal(w.fake.lastState(co2), 1053);
  for (const [minutes, value] of [
    [15, 980],
    [30, 870],
    [45, 1210],
  ]) {
    // The device uploads at 10:15, 10:30, 10:45…
    w.cloud.upload(LIVING, Date.UTC(2025, 9, 15, 10, minutes) / 1000, { co2: value });
    await elapse(w, t, 15 * MIN);
    assert.equal(w.fake.lastState(co2), value, `reading of 10:${minutes}`);
  }
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('automatic pace: one read right after each expected upload, no more', async (t) => {
  const w = await timedWorld(t);
  const start = reads(w.cloud);
  // Reading of 10:00, every 15 min: next upload at 10:15, read at 10:16:30.
  assert.equal(w.hub.nextDelay(), 6.5 * MIN);
  await elapse(w, t, 6 * MIN);
  assert.equal(reads(w.cloud), start, 'nothing before the upload is due');
  w.cloud.upload(LIVING, Date.UTC(2025, 9, 15, 10, 15) / 1000, { co2: 990 });
  await elapse(w, t, 0.5 * MIN);
  assert.equal(reads(w.cloud), start + 1);
  // Next one at 10:31:30, a quarter of an hour later.
  assert.equal(w.hub.nextDelay(), 15 * MIN);
  // Over the next hour, the device uploading on time: one read per upload.
  for (const minutes of [30, 45, 60, 75]) {
    w.cloud.upload(LIVING, Date.UTC(2025, 9, 15, 10, minutes) / 1000, { co2: 900 + minutes });
    await elapse(w, t, 15 * MIN);
  }
  assert.equal(reads(w.cloud), start + 1 + 4);
});

test('a late upload is looked for again soon; a long silent device is read at its own pace', async (t) => {
  const w = await timedWorld(t);
  await elapse(w, t, 6.5 * MIN); // 10:16:30, no upload
  assert.equal(w.hub.nextDelay(), 3.75 * MIN, 'a quarter of the interval');
  w.clock.advance(60 * MIN);
  assert.equal(w.hub.nextDelay(), 15 * MIN);
});

test('a fixed interval from the configuration', async (t) => {
  const w = await timedWorld(t, { config: { ...DEFAULT_TEST_CONFIG, poll_interval: '30' } });
  const start = reads(w.cloud);
  await elapse(w, t, 30 * MIN);
  await elapse(w, t, 30 * MIN);
  assert.equal(reads(w.cloud), start + 2);
});

test('never faster than every 2 minutes, never slower than every hour', async (t) => {
  const w = await timedWorld(t);
  const record = w.hub.records.get(LIVING);
  record.device = { ...record.device, reportIntervalS: 30 };
  assert.equal(w.hub.nextDelay(), 2 * MIN);
  record.device = { ...record.device, reportIntervalS: 24 * 3600 };
  assert.equal(w.hub.nextDelay(), 60 * MIN);
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ cloud: liteOnly(), timers: true });
  await w.app.stop();
  const before = w.cloud.requests.length;
  t.mock.timers.tick(120 * MIN);
  await settle();
  assert.equal(w.cloud.requests.length, before);
});
