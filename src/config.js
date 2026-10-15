// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// How often the cloud is read. `auto`: right after each device's next
// expected report (its report interval, set in the Qingping+ app); otherwise
// a fixed number of minutes.
export const POLL_INTERVALS = ['auto', '5', '10', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  app_key: '',
  app_secret: '',
  poll_interval: 'auto',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const poll =
    source.poll_interval === undefined || source.poll_interval === null
      ? DEFAULT_CONFIG.poll_interval
      : String(source.poll_interval);
  return {
    // Keys and secrets are copied from the developer site: spaces around
    // them are a copy accident, never part of them.
    appKey: text('app_key'),
    appSecret: text('app_secret'),
    pollMinutes: POLL_INTERVALS.includes(poll) && poll !== 'auto' ? Number(poll) : null,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
