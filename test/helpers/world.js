// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Qingping cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the cloud with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { APP_KEY, APP_SECRET, FakeQingping } from './fakeQingping.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Ten minutes after the upload of the first device of the fixture
// (2025-10-15T10:00:00Z).
export const FIXTURE_TIME = Date.UTC(2025, 9, 15, 10, 10, 0);

export const LIVING = '582D34000001';
export const BEDROOM = '582D34000002';
export const OFFICE = '582D34000003';
export const CELLAR = '582D34000004';

/** A manual clock, shared by the hub and the fake cloud. */
export function createClock(start = FIXTURE_TIME) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const DEFAULT_TEST_CONFIG = { app_key: APP_KEY, app_secret: APP_SECRET, language: 'en' };

/**
 * @param {object} [options]
 * @param {FakeQingping} [options.cloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  cloud = new FakeQingping(),
  config = DEFAULT_TEST_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-qingping-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    request: cloud.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, cloud, app, hub: app.hub, clock, dataDir, store };
}

/** External ids of a device and its features. */
export const deviceId = (gladys, mac = LIVING) => gladys.externalIds('qingping', mac).device;
export const featureId = (gladys, key, mac = LIVING) =>
  gladys.externalIds('qingping', mac).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeQingping };
