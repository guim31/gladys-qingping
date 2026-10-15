// -----------------------------------------------------------------------------
// An in-memory Qingping cloud, behind the `request` seam of the client: the
// OAuth token endpoint and the device list / settings API, answering like the
// real one (fixtures in test/fixtures/qingping/). No network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { API_URL, OAUTH_URL } from '../../src/qingping/client.js';

export const APP_KEY = 'test-app-key-0001';
export const APP_SECRET = 'test-app-secret-do-not-log-0001';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/qingping/${name}.json`, import.meta.url), 'utf8'));

const json = (status, body, headers = {}) => ({
  status,
  headers,
  body: JSON.stringify(body),
});

export class FakeQingping {
  constructor({ devices = 'devices', appKey = APP_KEY, appSecret = APP_SECRET } = {}) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.list = fixture(devices);
    this.online = true;
    this.rateLimited = false;
    this.tokens = new Set();
    this.issued = 0;
    this.requests = [];
    this.settings = [];
    this.request = this.handle.bind(this);
  }

  /** A device of the list, by MAC. */
  device(mac) {
    return this.list.devices.find((entry) => entry.info.mac === mac);
  }

  /** A new upload of a device: its metrics and timestamp change. */
  upload(mac, timestampS, values = {}) {
    const entry = this.device(mac);
    entry.data.timestamp = { value: timestampS };
    for (const [key, value] of Object.entries(values)) {
      entry.data[key] = { ...(entry.data[key] ?? {}), value };
    }
  }

  revokeTokens() {
    this.tokens.clear();
  }

  async handle(url, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(url);
    this.requests.push({
      method,
      path: target.pathname,
      query: target.searchParams,
      headers,
      body,
    });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.rateLimited) {
      return json(429, { msg: 'too many requests' }, { 'retry-after': '1200' });
    }
    if (url === OAUTH_URL) {
      return this.token(headers, body);
    }
    if (!url.startsWith(API_URL)) {
      return json(404, { msg: 'not found' });
    }
    const bearer = (headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.tokens.has(bearer)) {
      return json(401, { msg: 'invalid token' });
    }
    const path = target.pathname.replace(new URL(API_URL).pathname, '');
    if (path === '/devices' && method === 'GET') {
      if (!/^\d{13}$/.test(target.searchParams.get('timestamp') ?? '')) {
        return json(400, { msg: 'timestamp is required' });
      }
      const offset = Number(target.searchParams.get('offset') ?? 0);
      const limit = Number(target.searchParams.get('limit') ?? 10);
      return json(200, {
        total: this.list.devices.length,
        devices: structuredClone(this.list.devices.slice(offset, offset + limit)),
      });
    }
    if (path === '/devices/settings' && method === 'PUT') {
      const payload = JSON.parse(body);
      this.settings.push(payload);
      for (const mac of payload.mac) {
        const entry = this.device(mac);
        if (!entry) {
          return json(400, { msg: 'device not found' });
        }
        entry.info.setting = {
          report_interval: payload.report_interval,
          collect_interval: payload.collect_interval,
        };
      }
      return json(200, {});
    }
    return json(404, { msg: 'not found' });
  }

  token(headers, body) {
    const expected = Buffer.from(`${this.appKey}:${this.appSecret}`).toString('base64');
    const params = new URLSearchParams(body);
    if (headers.authorization !== `Basic ${expected}`) {
      return json(401, fixture('token-invalid-client'));
    }
    if (
      params.get('grant_type') !== 'client_credentials' ||
      params.get('scope') !== 'device_full_access'
    ) {
      return json(400, { error: 'invalid_request' });
    }
    this.issued += 1;
    const token = `${fixture('token').access_token}-${this.issued}`;
    this.tokens.add(token);
    return json(200, { ...fixture('token'), access_token: token });
  }
}
