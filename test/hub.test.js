// -----------------------------------------------------------------------------
// The hub, end to end against the fake cloud and the SDK's fake Gladys:
// discovery, states (only for the devices the user added, republished when
// one is added), features learnt over time, the scene events on transitions,
// the transport badge, the connection status and the configuration changes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/qingping/client.js';
import { ERROR_TEXT } from '../src/texts.js';
import {
  BEDROOM,
  CELLAR,
  DEFAULT_TEST_CONFIG,
  FakeQingping,
  LIVING,
  OFFICE,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const S = 1000;
const MIN = 60_000;
const at = (clock) => Math.floor(clock.now() / S);

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('publishes one device per Qingping device, named as in the app, not polled by Gladys', async (t) => {
  const { fake, gladys } = await world(t);
  const devices = fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Living room', 'Bedroom', 'Office', 'Cellar'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  const living = devices[0];
  assert.equal(living.external_id, deviceId(gladys, LIVING));
  assert.deepEqual(living.params, [
    { name: 'QINGPING_MAC', value: LIVING },
    { name: 'QINGPING_MODEL', value: 'Qingping Air Monitor Lite' },
  ]);
  assert.deepEqual(fake.connectionStatus, { connected: true });
});

test('publishes the states of the devices the user added only, all of them when one is added', async (t) => {
  const { fake, gladys } = await world(t);
  assert.equal(fake.states.length, 0, 'nothing before a device is added');
  await fake.deviceCreated(fake.discoveredDevices[0]);
  assert.equal(fake.lastState(featureId(gladys, 'co2')), 1053);
  assert.equal(fake.lastState(featureId(gladys, 'temperature')), 26.4);
  assert.equal(fake.lastState(featureId(gladys, 'reading_age')), 10);
  assert.equal(fake.lastState(featureId(gladys, 'co2', BEDROOM)), undefined);
  assert.ok(fake.widgetRefreshes.includes('air_quality'));
  assert.deepEqual(fake.transports.at(-1), {
    device_external_id: deviceId(gladys, LIVING),
    transport: 'cloud',
  });
});

test('publishes only what changed, and every value again after six hours', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = () => w.fake.states.length;
  const before = count();
  await w.hub.pollAll();
  assert.equal(count(), before, 'same minute, nothing new');

  w.clock.advance(MIN);
  await w.hub.pollAll();
  assert.equal(count() - before, 4, 'only the four reading ages moved');

  w.cloud.upload(LIVING, at(w.clock), { co2: 1100 });
  w.clock.advance(MIN);
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'co2')), 1100);

  // The heartbeat: the SDK compares with the real clock.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 60 * MIN + 1 });
  const beforeHeartbeat = count();
  await w.hub.pollAll();
  assert.ok(count() - beforeHeartbeat >= 27, 'every feature re-sent');
});

test('learns the metrics a device starts to report, and never forgets one', async (t) => {
  const w = await world(t, { cloud: new FakeQingping({ devices: 'devices-sensor-warming-up' }) });
  const names = () =>
    w.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(names(), [
    'temperature',
    'humidity',
    'co2',
    'pm25',
    'pm10',
    'battery',
    'reading_age',
  ]);
  // The warmed up sensors report; a new metric appears (VOC index).
  const entry = w.cloud.list.devices[0];
  for (const key of ['co2', 'pm25', 'pm10']) {
    entry.data[key].status = 0;
  }
  entry.data.tvoc_index = { value: 100 };
  delete entry.data.humidity;
  await w.hub.pollAll();
  assert.deepEqual(names(), [
    'temperature',
    'humidity',
    'co2',
    'pm25',
    'pm10',
    'tvoc_index',
    'battery',
    'reading_age',
  ]);
  // Kept in /data across a restart.
  await w.store.flush();
  const again = await createWorld({
    dataDir: w.dataDir,
    cloud: new FakeQingping({ devices: 'devices-empty' }),
  });
  t.after(() => again.app.stop());
  assert.deepEqual(await again.store.getMetrics('582D34000005'), [
    'temperature',
    'humidity',
    'co2',
    'pm25',
    'pm10',
    'battery',
    'tvoc_index',
  ]);
});

test('fires "air quality changed" on a level change, with what the scene needs', async (t) => {
  const w = await world(t);
  w.clock.advance(10 * MIN);
  w.cloud.upload(LIVING, at(w.clock), { co2: 2150, pm25: 14 });
  await w.hub.pollAll();
  w.clock.advance(15 * MIN);
  w.cloud.upload(LIVING, at(w.clock), { co2: 640, pm25: 8 });
  await w.hub.pollAll();
  const events = w.fake.sceneEvents.filter((e) => e.key === 'air_quality_changed');
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].data, {
    device: deviceId(w.gladys, LIVING),
    device_name: 'Living room',
    level: 'bad',
    level_label: 'Very poor',
    previous_level: 'poor',
    cause: 'CO₂',
    direction: 'worse',
    co2: 2150,
    pm25: 14,
  });
  assert.equal(events[1].data.level, 'good');
  assert.equal(events[1].data.direction, 'better');
  assert.equal(events[1].data.cause, '');
});

test('no air quality event at start, for the same level, nor for a thermometer', async (t) => {
  const w = await world(t);
  w.clock.advance(10 * MIN);
  w.cloud.upload(LIVING, at(w.clock), { co2: 1080 });
  w.cloud.upload(CELLAR, at(w.clock), { temperature: 25 });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('a device that stops uploading is reported once, and once when it is back', async (t) => {
  const w = await world(t);
  await createAll(w);
  // The bedroom monitor reports every 10 min: silent past 2 × 10 + 5 min.
  w.clock.advance(12 * MIN); // 25 min after its reading
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 0);
  w.clock.advance(10 * MIN);
  await w.hub.pollAll();
  w.clock.advance(10 * MIN);
  await w.hub.pollAll();
  const stopped = w.fake.sceneEvents.filter((e) => e.key === 'device_stopped_reporting');
  assert.ok(stopped.length >= 1);
  const bedroom = stopped.find((e) => e.data.device === deviceId(w.gladys, BEDROOM));
  assert.deepEqual(bedroom.data, {
    device: deviceId(w.gladys, BEDROOM),
    device_name: 'Bedroom',
    minutes_since_reading: 35,
    offline: false,
  });
  assert.equal(
    stopped.filter((e) => e.data.device === deviceId(w.gladys, BEDROOM)).length,
    1,
    'once',
  );
  assert.ok(
    w.fake.transports.some(
      (e) => e.device_external_id === deviceId(w.gladys, BEDROOM) && e.transport === 'unreachable',
    ),
  );

  w.cloud.upload(BEDROOM, at(w.clock), { co2: 700 });
  await w.hub.pollAll();
  const back = w.fake.sceneEvents.filter(
    (e) => e.key === 'device_reporting_again' && e.data.device === deviceId(w.gladys, BEDROOM),
  );
  assert.deepEqual(
    back.map((e) => e.data.silent_minutes),
    [45],
  );
  assert.equal(w.fake.transports.at(-1).transport, 'cloud');
});

test('a device the cloud says offline is not reporting, even with a recent reading', async (t) => {
  const w = await world(t);
  w.cloud.device(OFFICE).info.status.offline = true;
  await w.hub.pollAll();
  const event = w.fake.sceneEvents.find((e) => e.key === 'device_stopped_reporting');
  assert.equal(event.data.device_name, 'Office');
  assert.equal(event.data.offline, true);
});

test('a device removed from the account leaves the Discovery tab', async (t) => {
  const w = await world(t);
  w.cloud.list.devices = w.cloud.list.devices.filter((d) => d.info.mac !== CELLAR);
  await w.hub.pollAll();
  assert.equal(w.fake.discoveredDevices.length, 3);
});

test('connection status: missing keys, refused keys, then fixed by the configuration', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.CONFIG],
  });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.cloud.requests.length, 0);

  await w.fake.configUpdated({ ...DEFAULT_TEST_CONFIG, app_secret: 'wrong' });
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.AUTH],
  });

  await w.fake.configUpdated(DEFAULT_TEST_CONFIG);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.discoveredDevices.length, 4);
});

test('the cloud down: status says so, devices and values kept, back at the next read', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.online = false;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.UNREACHABLE],
  });
  assert.equal(w.hub.records.size, 4);
  assert.equal(w.hub.nextDelay(), 5 * MIN);
  w.cloud.online = true;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a rate limit waits at least what the cloud asks', async (t) => {
  const w = await world(t);
  w.cloud.rateLimited = true;
  await w.hub.pollAll();
  assert.equal(w.hub.nextDelay(), 20 * MIN);
});

test('changing the language renames the features of the next discovery', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...DEFAULT_TEST_CONFIG, language: 'fr' });
  const names = w.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(names.includes('Âge de la mesure'));
});

test('Gladys restarting: everything is sent again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.fake.states.length - before, 27);
});

test('onPoll answers from the latest reading, without a request', async (t) => {
  const w = await world(t);
  await createAll(w);
  const requests = w.cloud.requests.length;
  const ack = await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.equal(w.cloud.requests.length, requests);
});

test('"Set the report interval" sends it to the cloud and adapts the reading pace', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ack = await w.fake.action('set_report_interval', {
    device: deviceId(w.gladys, LIVING),
    minutes: '5',
  });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /Report interval changed/);
  assert.deepEqual(w.cloud.settings.at(-1).mac, [LIVING]);
  assert.equal(w.cloud.settings.at(-1).report_interval, 300);
  assert.equal(w.cloud.settings.at(-1).collect_interval, 300);
  assert.equal(w.hub.records.get(LIVING).device.reportIntervalS, 300);

  const missing = await w.fake.action('set_report_interval', { minutes: '5' });
  assert.equal(missing.success, false);
  assert.equal(missing.error, 'Choose a device.');
  const noInterval = await w.fake.action('set_report_interval', {
    device: deviceId(w.gladys, LIVING),
  });
  assert.equal(noInterval.error, 'Choose a report interval.');
});

test('"Test the connection" reports every device', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /^Connected to the Qingping cloud: 4 device\(s\)\./);
  assert.match(ack.data.message.fr, /Living room : mesure d'il y a 10 min/);

  const empty = await world(t, { cloud: new FakeQingping({ devices: 'devices-empty' }) });
  const none = await empty.fake.action('test_connection', {});
  assert.match(none.data.message.en, /no device on this account/);

  const refused = await world(t, { config: { ...DEFAULT_TEST_CONFIG, app_secret: 'nope' } });
  const ackRefused = await refused.fake.action('test_connection', {});
  assert.deepEqual(ackRefused.data.message, ERROR_TEXT[ERROR_KINDS.AUTH]);
});
