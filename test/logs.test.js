// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the App Secret, the App Key nor the token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_KEY, APP_SECRET } from './helpers/fakeQingping.js';
import { DEFAULT_TEST_CONFIG, LIVING, createAll, createWorld } from './helpers/world.js';

const MIN = 60_000;

/** Capture the lines of the SDK logger. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** No secret of the configuration, and no token, in any line. */
function assertNoSecret(w, logs) {
  const text = logs.texts().join('\n');
  assert.ok(!text.includes(APP_SECRET), 'never the App Secret');
  assert.ok(!text.includes(APP_KEY), 'never the App Key');
  assert.ok(!text.includes('fake-access-token'), 'never the token');
  assert.ok(!text.includes(Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64')));
  assert.ok(w.cloud.issued >= 0);
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to the Qingping cloud: 4 device(s)')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 1; i <= 5; i += 1) {
    w.clock.advance(5 * MIN);
    for (const device of w.cloud.list.devices) {
      w.cloud.upload(device.info.mac, Math.floor(w.clock.now() / 1000));
    }
    w.cloud.upload(LIVING, Math.floor(w.clock.now() / 1000), { co2: 1100 + i * 10 });
    await w.hub.pollAll();
  }
  // Two hours later the token is renewed: still nothing.
  w.clock.advance(2 * 60 * MIN);
  for (const device of w.cloud.list.devices) {
    w.cloud.upload(device.info.mac, Math.floor(w.clock.now() / 1000));
  }
  await w.hub.pollAll();
  assert.deepEqual(logs.texts(), []);
});

test('the cloud down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();

  w.cloud.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(5 * MIN);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');

  logs.clear();
  w.cloud.online = true;
  for (const device of w.cloud.list.devices) {
    w.cloud.upload(device.info.mac, Math.floor(w.clock.now() / 1000));
  }
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.texts()[0], /reachable again/);
});

test('refused keys are logged once, without the secret', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { ...DEFAULT_TEST_CONFIG, app_secret: 'a-wrong-secret-that-must-not-leak' },
  });
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(60 * MIN);
    await w.hub.pollAll();
  }
  const problems = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(problems.length, 1, logs.texts().join('\n'));
  assert.ok(!logs.texts().join('\n').includes('a-wrong-secret-that-must-not-leak'));
  assertNoSecret(w, logs);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(MIN);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States of .* refused/);
});

test('a device going silent and coming back: one line each (lifecycle)', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.cloud.list.devices = w.cloud.list.devices.filter((d) => d.info.mac === LIVING);
  await w.hub.pollAll();
  logs.clear();
  w.clock.advance(60 * MIN);
  await w.hub.pollAll();
  await w.hub.pollAll();
  w.cloud.upload(LIVING, Math.floor(w.clock.now() / 1000));
  await w.hub.pollAll();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Living room stopped reporting', 'Living room reports again'],
  );
});

test('LOG_LEVEL=debug shows each problem and the reading plan; never a secret', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { timers: false });
  w.cloud.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  w.cloud.online = true;
  w.cloud.revokeTokens();
  await w.hub.pollAll();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*unreachable/);
  assertNoSecret(w, logs);
});
