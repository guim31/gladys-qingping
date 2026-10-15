// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container),
// one JSON file readable by its owner only:
//   - the Qingping access token, its expiry, and a fingerprint of the keys it
//     was issued for (never the keys themselves), so a restart does not ask
//     for a new token;
//   - the metrics each device has ever reported, so a reading that misses one
//     (a sensor warming up) never removes a feature from the device.
// Losing the file is harmless: a new token is requested, the metrics are
// learnt again from the next reading.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'qingping-store' });
const FILE_NAME = 'qingping-state.json';

export class Store {
  constructor(directory = process.env.QINGPING_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.data = null;
    this.pending = null;
    this.writing = null;
  }

  async load() {
    if (this.data) {
      return this.data;
    }
    let data = {};
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      data = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
    }
    this.data = {
      token: data.token && typeof data.token === 'object' ? data.token : null,
      metrics: data.metrics && typeof data.metrics === 'object' ? data.metrics : {},
    };
    return this.data;
  }

  async getToken() {
    return (await this.load()).token;
  }

  async setToken(token) {
    (await this.load()).token = token;
    return this.save();
  }

  /** The metric keys a device has reported so far (order kept). */
  async getMetrics(mac) {
    const known = (await this.load()).metrics[mac];
    return Array.isArray(known) ? known.filter((key) => typeof key === 'string') : [];
  }

  async setMetrics(mac, keys) {
    (await this.load()).metrics[mac] = keys;
    return this.save();
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind. Mode 0600: the token stays private.
  save() {
    if (!this.pending) {
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        this.pending = null;
        const snapshot = JSON.stringify(this.data);
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, snapshot, { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
        } catch (err) {
          logger.warn(`Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
