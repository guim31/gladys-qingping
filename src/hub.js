// -----------------------------------------------------------------------------
// The Qingping hub: reads the device list of the account on a timer of the
// container, publishes the devices and their states, fires the scene events
// on transitions, and answers the actions, the widget and the scene action.
//
// Timing. The cloud only knows what the devices uploaded: an Air Monitor
// uploads every report interval set in the Qingping+ app (15 minutes by
// default on battery), a Bluetooth thermometer when the app or a gateway
// syncs it. Reading faster brings nothing but requests, so by default
// (`auto`) the hub reads the list right after the next upload it expects
// (latest reading + report interval + a margin), and no more often than every
// 2 minutes nor less often than every hour. A fixed interval can be chosen
// instead. One request reads every device (50 per page).
//
// Gladys never polls these devices (should_poll: false, and Gladys#3198): the
// hub's own timer drives everything; onPoll only serves a Gladys that would
// poll anyway, and answers from the latest reading without a request.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { LEVELS, evaluate } from './airQuality.js';
import { buildDevice, deviceIds, deviceName, deviceStates, macOf } from './devices.js';
import { ERROR_KINDS, QingpingClient, QingpingError } from './qingping/client.js';
import { METRIC_KEYS, reportIntervalMs } from './qingping/model.js';
import {
  ACTION_TEXT,
  CAUSE_TEXT,
  ERROR_TEXT,
  LEVEL_TEXT,
  REPORT_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'qingping-hub' });

export const WIDGET_KEY = 'air_quality';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  AIR_QUALITY: 'air_quality_changed',
  STOPPED: 'device_stopped_reporting',
  RESUMED: 'device_reporting_again',
});

// Report intervals offered by the "Set the report interval" action, minutes.
export const REPORT_INTERVALS = ['1', '5', '10', '15', '30', '60'];

export const HUB_TIMINGS = {
  minPollMs: 2 * 60_000,
  maxPollMs: 60 * 60_000,
  // Read this long after the moment a device should have uploaded.
  uploadSlackMs: 90_000,
  // No interval known yet: read every quarter of an hour.
  defaultPollMs: 15 * 60_000,
  // After a failure.
  retryMs: 5 * 60_000,
  rateLimitMs: 15 * 60_000,
  authRetryMs: 60 * 60_000,
  // Re-send an unchanged value this often, so Gladys never shows it as old.
  heartbeatMs: 6 * 60 * 60_000,
  // A device is stale past two report intervals plus this margin, and never
  // before this minimum.
  staleSlackMs: 5 * 60_000,
  minStaleMs: 30 * 60_000,
};

const signature = (config) => JSON.stringify([config.appKey, config.appSecret]);

export class QingpingHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] network seam (src/qingping/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} device records, by MAC */
    this.records = new Map();
    this.error = null;
    this.lastSuccessAt = null;
    this.connection = null;
    this.transports = new Map();
    this.discovered = null;
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, devices lost and back, user
  // actions). A problem that repeats is logged once at its own level, then at
  // debug until it clears. LOG_LEVEL=debug shows everything.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle ---------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previousLanguage = this.config?.language;
    this.config = config;
    if (signature(config) !== this.signature) {
      // Other keys, maybe another account: start from scratch.
      this.signature = signature(config);
      this.client = new QingpingClient({
        appKey: config.appKey,
        appSecret: config.appSecret,
        store: this.store,
        request: this.request,
        now: this.now,
      });
      this.records.clear();
      this.error = null;
      this.discovered = null;
    } else if (previousLanguage !== config.language) {
      this.discovered = null;
    }
    // A read started with the previous configuration must not stand for this one.
    await this.polling?.catch(() => {});
    await this.pollAll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  // --- Reading the cloud -------------------------------------------------------

  /** Read the cloud now (concurrent calls share the read), then plan the next read. */
  pollAll() {
    this.polling ??= this.read().finally(() => {
      this.polling = null;
      this.schedule();
    });
    return this.polling;
  }

  async read() {
    if (!this.config.appKey || !this.config.appSecret) {
      this.error = { kind: ERROR_KINDS.CONFIG, message: 'App Key and App Secret are not set' };
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    let devices;
    try {
      devices = await this.client.listDevices();
    } catch (err) {
      if (!(err instanceof QingpingError)) {
        throw err;
      }
      await this.applyFailure(err);
      return;
    }
    await this.applySuccess(devices);
  }

  async applyFailure(err) {
    const wasKind = this.error?.kind;
    this.error = { kind: err.kind, message: err.message, retryAfterMs: err.retryAfterMs };
    // One line when the problem starts or changes, not one per reading.
    if (wasKind !== err.kind) {
      this.warned.delete('cloud');
    }
    this.problem('cloud', err.message, err.kind === ERROR_KINDS.AUTH ? 'error' : 'warn');
    await this.publishConnectionStatus();
  }

  async applySuccess(devices) {
    const now = this.now();
    if (this.lastSuccessAt === null) {
      logger.info(`Connected to the Qingping cloud: ${devices.length} device(s)`);
    } else if (this.error) {
      logger.info('Qingping cloud reachable again');
    }
    this.warned.delete('cloud');
    this.error = null;
    this.lastSuccessAt = now;

    let structureChanged = false;
    let widgetChanged = false;
    const seen = new Set();
    for (const device of devices) {
      seen.add(device.mac);
      let record = this.records.get(device.mac);
      if (!record) {
        record = await this.newRecord(device);
        this.records.set(device.mac, record);
        structureChanged = true;
        widgetChanged = true;
        if (this.discovered !== null) {
          logger.info(
            `New Qingping device: ${deviceName(device)} (${device.model ?? 'unknown model'})`,
          );
        }
      }
      const changes = await this.update(record, device, now);
      structureChanged ||= changes.structure;
      widgetChanged ||= changes.widget;
    }
    for (const mac of [...this.records.keys()]) {
      if (!seen.has(mac)) {
        // Unbound from the account in the Qingping+ app.
        logger.info(`Qingping device ${deviceName(this.records.get(mac).device)} left the account`);
        this.records.delete(mac);
        structureChanged = true;
        widgetChanged = true;
      }
    }

    if (structureChanged || this.discovered === null) {
      await this.publishDevices();
    }
    await this.publishStates([...this.records.values()]);
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async newRecord(device) {
    return {
      device,
      metricKeys: await this.store.getMetrics(device.mac),
      values: {},
      readingAt: null,
      air: { level: null, cause: null, perMetric: {} },
      reporting: null,
      silentSince: null,
    };
  }

  /** Apply a fresh entry of the list to a record; fire the transitions. */
  async update(record, device, now) {
    const changes = { structure: false, widget: false };
    const renamed = deviceName(record.device) !== deviceName(device);
    record.device = device;
    changes.widget ||= renamed;

    // The features a device gets are the metrics it ever reported.
    const learnt = METRIC_KEYS.filter(
      (key) => key in device.metrics || device.unhealthy.includes(key),
    ).filter((key) => !record.metricKeys.includes(key));
    if (learnt.length > 0) {
      record.metricKeys = [...record.metricKeys, ...learnt];
      await this.store.setMetrics(device.mac, record.metricKeys);
      changes.structure = true;
    }

    const fresh = device.readingAt !== null && device.readingAt !== record.readingAt;
    if (fresh) {
      record.values = { ...record.values, ...device.metrics };
      record.readingAt = device.readingAt;
      changes.widget = true;
      const previous = record.air.level;
      record.air = evaluate(record.values, record.air.perMetric);
      if (previous !== null && record.air.level !== null && previous !== record.air.level) {
        await this.fire(TRIGGERS.AIR_QUALITY, record, {
          level: record.air.level,
          level_label: pick(LEVEL_TEXT[record.air.level], this.config.language),
          previous_level: previous,
          cause: record.air.cause ? pick(CAUSE_TEXT[record.air.cause], this.config.language) : '',
          direction:
            LEVELS.indexOf(record.air.level) > LEVELS.indexOf(previous) ? 'worse' : 'better',
          co2: record.values.co2 ?? null,
          pm25: record.values.pm25 ?? null,
        });
      }
    }

    const reporting = this.isReporting(record, now);
    if (reporting !== record.reporting) {
      changes.widget = true;
      if (record.reporting === true && !reporting) {
        record.silentSince = record.readingAt ?? now;
        logger.info(`${deviceName(device)} stopped reporting`);
        await this.fire(TRIGGERS.STOPPED, record, {
          minutes_since_reading: this.ageMinutes(record, now),
          offline: device.offline,
        });
      } else if (record.reporting === false && reporting) {
        const silent = Math.round((now - (record.silentSince ?? now)) / 60_000);
        logger.info(`${deviceName(device)} reports again`);
        await this.fire(TRIGGERS.RESUMED, record, { silent_minutes: silent });
        record.silentSince = null;
      } else if (record.reporting === null && !reporting) {
        record.silentSince = record.readingAt ?? now;
      }
      record.reporting = reporting;
    }
    return changes;
  }

  /** How long without a reading before a device counts as silent. */
  staleAfterMs(record) {
    return Math.max(
      this.timings.minStaleMs,
      2 * reportIntervalMs(record.device) + this.timings.staleSlackMs,
    );
  }

  isReporting(record, now) {
    if (record.device.offline || record.readingAt === null) {
      return false;
    }
    return now - record.readingAt <= this.staleAfterMs(record);
  }

  ageMinutes(record, now = this.now()) {
    return record.readingAt === null
      ? null
      : Math.max(0, Math.floor((now - record.readingAt) / 60_000));
  }

  /** The delay until the next read. */
  nextDelay() {
    const t = this.timings;
    if (this.error) {
      if (this.error.kind === ERROR_KINDS.RATE_LIMIT) {
        return Math.max(t.rateLimitMs, this.error.retryAfterMs ?? 0);
      }
      if (this.error.kind === ERROR_KINDS.AUTH || this.error.kind === ERROR_KINDS.CONFIG) {
        return t.authRetryMs; // a new configuration reads at once
      }
      return t.retryMs;
    }
    if (this.config.pollMinutes) {
      return this.config.pollMinutes * 60_000;
    }
    const now = this.now();
    const candidates = [];
    for (const record of this.records.values()) {
      const interval = reportIntervalMs(record.device);
      if (record.readingAt === null) {
        candidates.push(interval);
        continue;
      }
      const expected = record.readingAt + interval + t.uploadSlackMs;
      if (expected > now) {
        candidates.push(expected - now);
      } else if (now - expected < interval) {
        // Late upload: look again soon, not a whole interval later.
        candidates.push(interval / 4);
      } else {
        // Silent for long: no hurry, keep the device's own pace.
        candidates.push(interval);
      }
    }
    const delay = candidates.length ? Math.min(...candidates) : t.defaultPollMs;
    return Math.min(t.maxPollMs, Math.max(t.minPollMs, delay));
  }

  schedule() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.config) {
      return;
    }
    const delay = this.nextDelay();
    logger.debug(`Next read in ${Math.round(delay / 1000)} s`);
    this.pollTimer = setTimeout(() => {
      this.pollAll()
        .then(() => this.resolved('timer'))
        .catch((err) => this.problem('timer', `Reading failed: ${err.message}`, 'error'));
    }, delay);
    this.pollTimer.unref?.();
  }

  // --- Publishing to Gladys -------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.device, record.metricKeys, this.config.language),
    );
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = devices.length;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** Only the devices the user added: Gladys drops the states of the others. */
  isCreated(mac) {
    const id = deviceIds(this.gladys, mac).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The states of these records, in one call: only what changed, a heartbeat for the rest. */
  async publishStates(records, { force = false } = {}) {
    const created = records.filter((record) => this.isCreated(record.device.mac));
    if (created.length === 0) {
      return;
    }
    const states = created.flatMap((record) =>
      deviceStates(this.gladys, record.device.mac, record.values, this.ageMinutes(record)),
    );
    if (force) {
      for (const record of created) {
        this.gladys.forgetPublishedStates(deviceIds(this.gladys, record.device.mac).device);
      }
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      const names = created.map((record) => deviceName(record.device)).join(', ');
      this.problem('states', `States of ${names} refused: ${err.message}`);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.reporting === null || !this.isCreated(record.device.mac)) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.device.mac).device;
      const transport = record.reporting ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  async publishConnectionStatus() {
    const status = this.error
      ? { connected: false, message: ERROR_TEXT[this.error.kind] }
      : { connected: true };
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.device.mac).device,
        device_name: deviceName(record.device),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Gladys events -----------------------------------------------------------------

  /** "Search" in the Discovery tab: read the cloud now. */
  async rediscover() {
    this.discovered = null;
    await this.pollAll();
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const mac = macOf(this.gladys, device.external_id);
    const record = mac === null ? null : this.records.get(mac);
    if (!record) {
      return;
    }
    await this.publishStates([record], { force: true });
    this.transports.delete(device.external_id);
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll): the latest reading, no request. */
  async pollDevice(device) {
    const mac = macOf(this.gladys, device.external_id);
    const record = mac === null ? null : this.records.get(mac);
    if (record) {
      await this.publishStates([record]);
    }
  }

  // --- Actions -------------------------------------------------------------------------

  /** The record of a device chosen in a form; throws a readable message. */
  recordOf(deviceExternalId) {
    const language = this.config?.language;
    if (!deviceExternalId) {
      throw new Error(pick(ACTION_TEXT.pickDevice, language));
    }
    const mac = macOf(this.gladys, deviceExternalId);
    const record = mac === null ? null : this.records.get(mac);
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownDevice, language));
    }
    return record;
  }

  /** "Test the connection": read the cloud now, one line per device. */
  async testConnection() {
    await this.pollAll();
    if (this.error) {
      return ERROR_TEXT[this.error.kind];
    }
    const now = this.now();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = text.none;
        continue;
      }
      const lines = [text.ok(this.records.size)];
      for (const record of this.records.values()) {
        const parts = [];
        if (record.device.offline) {
          parts.push(text.offline);
        } else if (!record.reporting) {
          parts.push(text.stale);
        }
        const age = this.ageMinutes(record, now);
        if (age !== null) {
          parts.push(text.minutes(age));
        }
        lines.push(labelled(deviceName(record.device), parts.join(', '), language));
      }
      message[language] = lines.join('\n').slice(0, 1000);
    }
    return message;
  }

  /** "Set the report interval" (air monitors): applied by the device at its next upload. */
  async setReportInterval(deviceExternalId, minutes) {
    const record = this.recordOf(deviceExternalId);
    const language = this.config.language;
    if (!REPORT_INTERVALS.includes(String(minutes ?? ''))) {
      throw new Error(pick(ACTION_TEXT.pickInterval, language));
    }
    const reportIntervalS = Number(minutes) * 60;
    // The device measures at least as often as it reports.
    const collectIntervalS = Math.min(
      record.device.collectIntervalS ?? reportIntervalS,
      reportIntervalS,
    );
    try {
      await this.client.updateSettings([record.device.mac], { reportIntervalS, collectIntervalS });
    } catch (err) {
      if (!(err instanceof QingpingError)) {
        throw err;
      }
      logger.warn(`Report interval of ${deviceName(record.device)} refused: ${err.message}`);
      throw new Error(`${pick(ERROR_TEXT[err.kind], language)} (${err.message})`, { cause: err });
    }
    record.device = { ...record.device, reportIntervalS, collectIntervalS };
    logger.info(`Report interval of ${deviceName(record.device)} set to ${minutes} min`);
    this.schedule();
    return ACTION_TEXT.intervalSet;
  }

  /** The air quality of a device, for the scene action. */
  airQuality(deviceExternalId) {
    const record = this.recordOf(deviceExternalId);
    if (record.air.level === null) {
      throw new Error(pick(ACTION_TEXT.noAirQuality, this.config.language));
    }
    return record;
  }

  /** What the widget shows: one device, or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const mac = macOf(this.gladys, deviceExternalId);
    const record = mac === null ? null : this.records.get(mac);
    return record ? [record] : [];
  }
}
