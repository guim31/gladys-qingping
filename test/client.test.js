// -----------------------------------------------------------------------------
// The Qingping cloud client against the fake cloud: OAuth client credentials,
// the token kept in /data and reused, renewed when refused, the paginated
// device list, the settings call, and the errors (never with a secret).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ERROR_KINDS,
  OAUTH_URL,
  QingpingClient,
  QingpingError,
  keysFingerprint,
} from '../src/qingping/client.js';
import { Store } from '../src/store.js';
import { APP_KEY, APP_SECRET, FakeQingping } from './helpers/fakeQingping.js';
import { createClock } from './helpers/world.js';

const tempStore = () => new Store(mkdtempSync(join(tmpdir(), 'gladys-qingping-client-')));

function setup({ cloud = new FakeQingping(), store = tempStore(), appKey, appSecret } = {}) {
  const clock = createClock();
  const client = new QingpingClient({
    appKey: appKey ?? APP_KEY,
    appSecret: appSecret ?? APP_SECRET,
    store,
    request: cloud.request,
    now: clock.now,
  });
  return { cloud, store, client, clock };
}

test('asks a token with the client credentials, then reads the devices with it', async () => {
  const { cloud, client } = setup();
  const devices = await client.listDevices();
  assert.equal(devices.length, 4);
  const [tokenRequest, listRequest] = cloud.requests;
  assert.equal(tokenRequest.method, 'POST');
  assert.equal(tokenRequest.path, new URL(OAUTH_URL).pathname);
  assert.equal(
    tokenRequest.headers.authorization,
    `Basic ${Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64')}`,
  );
  assert.equal(tokenRequest.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(listRequest.path, '/v1/apis/devices');
  assert.match(listRequest.headers.authorization, /^Bearer fake-access-token/);
  assert.match(listRequest.query.get('timestamp'), /^\d{13}$/, 'timestamp in milliseconds');
});

test('keeps the token in /data and reuses it after a restart, until it expires', async () => {
  const store = tempStore();
  const cloud = new FakeQingping();
  const first = setup({ cloud, store });
  await first.client.listDevices();
  await store.flush();
  assert.equal(cloud.issued, 1);
  assert.equal(statSync(store.path).mode & 0o777, 0o600, 'the file is private');

  // A restart: a new client on the same /data.
  const reloaded = new Store(store.directory);
  const second = new QingpingClient({
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    store: reloaded,
    request: cloud.request,
    now: first.clock.now,
  });
  await second.listDevices();
  assert.equal(cloud.issued, 1, 'no new token after a restart');
  const saved = await reloaded.getToken();
  assert.equal(saved.fingerprint, keysFingerprint(APP_KEY, APP_SECRET));
  assert.ok(!JSON.stringify(saved).includes(APP_SECRET), 'the secret is never stored');

  // Two hours later the token is renewed before use.
  first.clock.advance(2 * 60 * 60_000);
  await second.listDevices();
  assert.equal(cloud.issued, 2);
});

test('a token issued for other keys is not reused', async () => {
  const store = tempStore();
  const cloud = new FakeQingping();
  await setup({ cloud, store }).client.listDevices();
  const other = new FakeQingping({ appKey: 'other-key', appSecret: 'other-secret' });
  const { client } = setup({ cloud: other, store, appKey: 'other-key', appSecret: 'other-secret' });
  await client.listDevices();
  assert.equal(other.issued, 1);
});

test('a token refused by the API is renewed once', async () => {
  const { cloud, client } = setup();
  await client.listDevices();
  cloud.revokeTokens();
  const devices = await client.listDevices();
  assert.equal(devices.length, 4);
  assert.equal(cloud.issued, 2);
});

test('reads every page of a long list', async () => {
  const cloud = new FakeQingping();
  const template = cloud.list.devices[1];
  cloud.list.devices = Array.from({ length: 120 }, (_, index) => {
    const entry = structuredClone(template);
    entry.info.mac = `582D34${String(index).padStart(6, '0')}`;
    return entry;
  });
  const { client } = setup({ cloud });
  const devices = await client.listDevices();
  assert.equal(devices.length, 120);
  assert.equal(new Set(devices.map((d) => d.mac)).size, 120);
  const pages = cloud.requests.filter((r) => r.path === '/v1/apis/devices');
  assert.deepEqual(
    pages.map((r) => r.query.get('offset')),
    ['0', '50', '100'],
  );
});

test('wrong keys: an AUTH error that does not leak the secret', async () => {
  const { client } = setup({ appSecret: 'wrong-secret-value-123456' });
  await assert.rejects(client.listDevices(), (err) => {
    assert.ok(err instanceof QingpingError);
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes('wrong-secret-value-123456'));
    assert.ok(!err.message.includes(APP_KEY));
    return true;
  });
});

test('no keys: a CONFIG error, no request', async () => {
  const { cloud, client } = setup({ appKey: '', appSecret: '' });
  await assert.rejects(client.listDevices(), { kind: ERROR_KINDS.CONFIG });
  assert.equal(cloud.requests.length, 0);
});

test('network down, rate limit, server error', async () => {
  const { cloud, client } = setup();
  cloud.online = false;
  await assert.rejects(client.listDevices(), { kind: ERROR_KINDS.UNREACHABLE });
  cloud.online = true;
  cloud.rateLimited = true;
  await assert.rejects(client.listDevices(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.RATE_LIMIT);
    assert.equal(err.retryAfterMs, 1_200_000);
    return true;
  });
  cloud.rateLimited = false;
  const failing = setup({
    cloud: { request: async () => ({ status: 503, headers: {}, body: '<html>' }) },
  });
  await assert.rejects(failing.client.listDevices(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('an error message in a 200 answer is an error', async () => {
  const cloud = new FakeQingping();
  const original = cloud.request;
  const { client } = setup({
    cloud: {
      request: async (url, options) =>
        url.includes('/apis/devices')
          ? { status: 200, headers: {}, body: '{"msg":"permission denied"}' }
          : original(url, options),
    },
  });
  await assert.rejects(client.listDevices(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.HTTP);
    assert.match(err.message, /permission denied/);
    return true;
  });
});

test('updates the report interval of air monitors', async () => {
  const { cloud, client } = setup();
  await client.updateSettings(['582D34000001'], { reportIntervalS: 300, collectIntervalS: 300 });
  const [payload] = cloud.settings;
  assert.deepEqual(payload.mac, ['582D34000001']);
  assert.equal(payload.report_interval, 300);
  assert.equal(payload.collect_interval, 300);
  assert.ok(payload.timestamp > 1e12, 'timestamp in milliseconds');
  const request = cloud.requests.at(-1);
  assert.equal(request.method, 'PUT');
  assert.equal(request.path, '/v1/apis/devices/settings');
});
