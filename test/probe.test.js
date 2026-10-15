// -----------------------------------------------------------------------------
// scripts/probe.mjs, against the fake cloud: it ends on a refusal with fake
// keys, lists the shape of the devices with real ones, and never prints a key,
// a secret, a token, a MAC or a device name.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe.mjs';
import { APP_KEY, APP_SECRET, FakeQingping } from './helpers/fakeQingping.js';

async function run(options) {
  const lines = [];
  const result = await probe({ ...options, print: (line) => lines.push(line) });
  return { result, text: lines.join('\n') };
}

test('fake keys: the token is refused, nothing else is asked', async () => {
  const cloud = new FakeQingping();
  const { result, text } = await run({
    appKey: 'gladys-probe-fake-key',
    appSecret: 'gladys-probe-fake-secret',
    request: cloud.request,
  });
  assert.deepEqual(result, { ok: false, kind: 'auth' });
  assert.match(text, /Token: refused \(auth, HTTP 401\)/);
  assert.equal(cloud.requests.length, 1);
  assert.ok(!text.includes('gladys-probe-fake-secret'));
});

test('real keys: the shape of each device, nothing identifying', async () => {
  const cloud = new FakeQingping();
  const { result, text } = await run({
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    request: cloud.request,
  });
  assert.deepEqual(result, { ok: true, devices: 4 });
  assert.match(
    text,
    /Qingping Air Monitor Lite \(product 1203\): metrics temperature, humidity, co2/,
  );
  for (const secret of [APP_KEY, APP_SECRET, 'fake-access-token', '582D34', 'Living room']) {
    assert.ok(!text.includes(secret), `never "${secret}"`);
  }
});
