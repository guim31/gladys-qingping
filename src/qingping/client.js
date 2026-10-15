// -----------------------------------------------------------------------------
// Client of the Qingping open API (developer.qingping.co), the same cloud the
// Qingping+ app uses:
//   - OAuth 2 "client credentials": POST https://oauth.cleargrass.com/oauth2/token
//     with the App Key and App Secret in HTTP Basic, scope `device_full_access`;
//     the answer is a bearer token valid `expires_in` seconds (about 2 hours);
//   - GET  https://apis.cleargrass.com/v1/apis/devices: every device bound to
//     the account with its latest reading, paginated (offset, limit);
//   - PUT  https://apis.cleargrass.com/v1/apis/devices/settings: report and
//     collect intervals of air monitors (seconds).
// Every API call carries `timestamp`, in milliseconds (as the official SDKs do).
//
// The token is kept in the store (/data), so a restart does not ask for a new
// one. Neither the secret nor the token ever reaches a log or an error message.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { parseDeviceList } from './model.js';

export const OAUTH_URL = 'https://oauth.cleargrass.com/oauth2/token';
export const API_URL = 'https://apis.cleargrass.com/v1/apis';
export const SCOPE = 'device_full_access';

export const ERROR_KINDS = Object.freeze({
  CONFIG: 'config', // no App Key / App Secret yet
  AUTH: 'auth', // keys refused
  RATE_LIMIT: 'rate_limit', // HTTP 429
  UNREACHABLE: 'unreachable', // network, timeout, 5xx
  HTTP: 'http', // any other unexpected answer
});

export class QingpingError extends Error {
  constructor(kind, message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'QingpingError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const PAGE_SIZE = 50;
const MAX_PAGES = 20;
// A token is renewed this long before it expires.
const TOKEN_MARGIN_MS = 5 * 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 7200;
const TIMEOUT_MS = 20_000;

/** A short fingerprint of the keys: the stored token is reused only with them. */
export const keysFingerprint = (appKey, appSecret) =>
  createHash('sha256').update(`${appKey}\n${appSecret}`).digest('hex').slice(0, 16);

/**
 * The default network seam: fetch, with a timeout.
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export async function fetchRequest(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return {
    status: response.status,
    headers: { 'retry-after': response.headers.get('retry-after') },
    body: await response.text(),
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `Retry-After` in milliseconds (seconds or an HTTP date), null when absent. */
function retryAfter(headers, now) {
  const raw = headers?.['retry-after'];
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

// The `msg` of a Qingping error body, kept short and free of anything that
// looks like a credential.
function describe(body) {
  const json = parseJson(body);
  const message =
    (json && (json.msg || json.message || json.error_description || json.error)) || '';
  return String(message)
    .replace(/[A-Za-z0-9_-]{24,}/g, '…')
    .slice(0, 120);
}

export class QingpingClient {
  /**
   * @param {object} options
   * @param {string} options.appKey
   * @param {string} options.appSecret
   * @param {object} [options.store] persistence of the token (src/store.js)
   * @param {Function} [options.request] network seam (fetchRequest)
   * @param {() => number} [options.now]
   */
  constructor({ appKey, appSecret, store = null, request = fetchRequest, now = Date.now }) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.store = store;
    this.request = request;
    this.now = now;
    this.fingerprint = keysFingerprint(appKey, appSecret);
    this.token = null; // { accessToken, expiresAt }
    this.loaded = false;
    this.pendingToken = null;
  }

  async send(url, options) {
    try {
      return await this.request(url, options);
    } catch (err) {
      const reason =
        err?.name === 'TimeoutError'
          ? 'timed out'
          : err?.cause?.code || err?.code || err?.name || 'error';
      throw new QingpingError(ERROR_KINDS.UNREACHABLE, `Qingping cloud unreachable (${reason})`);
    }
  }

  // --- Token -------------------------------------------------------------------

  async loadStoredToken() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const saved = this.store ? await this.store.getToken() : null;
    if (
      saved &&
      saved.fingerprint === this.fingerprint &&
      typeof saved.accessToken === 'string' &&
      typeof saved.expiresAt === 'number'
    ) {
      this.token = { accessToken: saved.accessToken, expiresAt: saved.expiresAt };
    }
  }

  tokenValid() {
    return this.token !== null && this.now() < this.token.expiresAt - TOKEN_MARGIN_MS;
  }

  /** A valid bearer token, from memory, from /data, or a new one. */
  async getToken() {
    await this.loadStoredToken();
    if (this.tokenValid()) {
      return this.token.accessToken;
    }
    // Concurrent callers share one token request.
    this.pendingToken ??= this.requestToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  async requestToken() {
    if (!this.appKey || !this.appSecret) {
      throw new QingpingError(ERROR_KINDS.CONFIG, 'App Key and App Secret are not set');
    }
    const basic = Buffer.from(`${this.appKey}:${this.appSecret}`).toString('base64');
    const response = await this.send(OAUTH_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
    });
    if (response.status === 200) {
      const json = parseJson(response.body);
      if (!json || typeof json.access_token !== 'string' || !json.access_token) {
        throw new QingpingError(ERROR_KINDS.HTTP, 'Token answer without access_token');
      }
      const lifetime =
        Number(json.expires_in) > 0 ? Number(json.expires_in) : DEFAULT_TOKEN_LIFETIME_S;
      this.token = { accessToken: json.access_token, expiresAt: this.now() + lifetime * 1000 };
      await this.store?.setToken({ fingerprint: this.fingerprint, ...this.token });
      return this.token.accessToken;
    }
    throw this.failure(response, 'token');
  }

  async forgetToken() {
    this.token = null;
    await this.store?.setToken(null);
  }

  failure(response, what) {
    const { status } = response;
    const detail = describe(response.body);
    const suffix = detail ? `: ${detail}` : '';
    if (status === 429) {
      return new QingpingError(ERROR_KINDS.RATE_LIMIT, `Qingping rate limit reached (${what})`, {
        status,
        retryAfterMs: retryAfter(response.headers, this.now()),
      });
    }
    if (what === 'token' && [400, 401, 403].includes(status)) {
      return new QingpingError(
        ERROR_KINDS.AUTH,
        `App Key or App Secret refused (HTTP ${status})${suffix}`,
        {
          status,
        },
      );
    }
    if (status === 401 || status === 403) {
      return new QingpingError(ERROR_KINDS.AUTH, `Access refused (HTTP ${status})${suffix}`, {
        status,
      });
    }
    if (status >= 500 || status === 0) {
      return new QingpingError(ERROR_KINDS.UNREACHABLE, `Qingping cloud error (HTTP ${status})`, {
        status,
      });
    }
    return new QingpingError(
      ERROR_KINDS.HTTP,
      `Unexpected answer (HTTP ${status}, ${what})${suffix}`,
      {
        status,
      },
    );
  }

  // --- API -----------------------------------------------------------------------

  /** An authenticated call; a token the API refuses is renewed once. */
  async call(path, { method = 'GET', query = {}, json, what }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getToken();
      const params = new URLSearchParams({ ...query, timestamp: String(this.now()) });
      const url = method === 'GET' ? `${API_URL}${path}?${params}` : `${API_URL}${path}`;
      const response = await this.send(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(json ? { 'content-type': 'application/json' } : {}),
        },
        body: json ? JSON.stringify({ ...json, timestamp: this.now() }) : undefined,
      });
      if (response.status === 401 && attempt === 0) {
        // Expired or revoked before its time: ask for a new one.
        await this.forgetToken();
        continue;
      }
      if (response.status !== 200) {
        throw this.failure(response, what);
      }
      const body = parseJson(response.body);
      if (!body || typeof body !== 'object') {
        throw new QingpingError(ERROR_KINDS.HTTP, `Answer is not JSON (${what})`);
      }
      // The API may answer 200 with an error message instead of data.
      if (typeof body.msg === 'string' && body.msg && !body.devices) {
        throw new QingpingError(
          ERROR_KINDS.HTTP,
          `Qingping refused the ${what}: ${describe(response.body)}`,
        );
      }
      return body;
    }
    throw new QingpingError(ERROR_KINDS.AUTH, 'Access refused (HTTP 401)', { status: 401 });
  }

  /** Every device of the account with its latest reading. */
  async listDevices() {
    const devices = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await this.call('/devices', {
        query: { offset: String(offset), limit: String(PAGE_SIZE) },
        what: 'device list',
      });
      const parsed = parseDeviceList(body);
      devices.push(...parsed.devices);
      offset += parsed.raw;
      if (parsed.raw === 0 || parsed.total === null || offset >= parsed.total) {
        break;
      }
    }
    return devices;
  }

  /**
   * Report and collect intervals of air monitors, in seconds.
   * @param {string[]} macs
   */
  async updateSettings(macs, { reportIntervalS, collectIntervalS }) {
    await this.call('/devices/settings', {
      method: 'PUT',
      json: { mac: macs, report_interval: reportIntervalS, collect_interval: collectIntervalS },
      what: 'settings update',
    });
  }
}
