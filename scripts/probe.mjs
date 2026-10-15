#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Qingping cloud, with the integration's own client, read
// only: asks for a token, then (if granted) reads the device list. Prints the
// HTTP outcome and the SHAPE of the answers (keys, metric names, models),
// never a key, a secret, a token, a MAC or a device name.
//
//   node scripts/probe.mjs                     # fake keys: must end on "refused"
//   QINGPING_APP_KEY=… QINGPING_APP_SECRET=… node scripts/probe.mjs
//
// Nothing is written: the token is kept in memory only.
// -----------------------------------------------------------------------------

import { pathToFileURL } from 'node:url';
import { QingpingClient, QingpingError, fetchRequest } from '../src/qingping/client.js';

const FAKE_KEY = 'gladys-probe-fake-key';
const FAKE_SECRET = 'gladys-probe-fake-secret';

/** Wraps the network seam to report each exchange without its content. */
function recording(request, print) {
  return async (url, options = {}) => {
    const { origin, pathname } = new URL(url);
    try {
      const response = await request(url, options);
      let shape = 'not JSON';
      try {
        const body = JSON.parse(response.body);
        shape = `keys: ${Object.keys(body ?? {}).join(', ') || '(none)'}`;
      } catch {
        // keep "not JSON"
      }
      print(`${options.method ?? 'GET'} ${origin}${pathname} → HTTP ${response.status} (${shape})`);
      return response;
    } catch (err) {
      print(
        `${options.method ?? 'GET'} ${origin}${pathname} → network error (${err.cause?.code ?? err.code ?? err.name})`,
      );
      throw err;
    }
  };
}

export async function probe({
  appKey = process.env.QINGPING_APP_KEY || FAKE_KEY,
  appSecret = process.env.QINGPING_APP_SECRET || FAKE_SECRET,
  request = fetchRequest,
  print = (line) => console.log(line),
} = {}) {
  const fake = appKey === FAKE_KEY;
  print(
    `Qingping probe, ${fake ? 'fake keys (a refusal is the expected outcome)' : 'keys from the environment'}`,
  );
  const client = new QingpingClient({ appKey, appSecret, request: recording(request, print) });
  try {
    await client.getToken();
    print('Token: granted');
  } catch (err) {
    if (err instanceof QingpingError) {
      print(`Token: refused (${err.kind}${err.status ? `, HTTP ${err.status}` : ''})`);
      return { ok: false, kind: err.kind };
    }
    throw err;
  }
  const devices = await client.listDevices();
  print(`Devices: ${devices.length}`);
  for (const [index, device] of devices.entries()) {
    print(
      `  #${index + 1} ${device.model ?? 'unknown model'} (product ${device.productId ?? '?'}): ` +
        `metrics ${Object.keys(device.metrics).join(', ') || 'none'}` +
        `${device.unhealthy.length ? `, warming up ${device.unhealthy.join(', ')}` : ''}, ` +
        `report every ${device.reportIntervalS ?? '?'} s, ` +
        `reading ${device.readingAt ? `${Math.round((Date.now() - device.readingAt) / 60_000)} min old` : 'absent'}, ` +
        `${device.offline ? 'offline' : 'online'}`,
    );
  }
  return { ok: true, devices: devices.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  probe()
    .then((result) => {
      process.exitCode = result.ok ? 0 : 2;
    })
    .catch((err) => {
      console.error(`Probe failed: ${err.message}`);
      process.exitCode = 1;
    });
}
