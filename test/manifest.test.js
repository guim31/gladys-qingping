// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEVELS } from '../src/airQuality.js';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { REPORT_INTERVALS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { BEDROOM, LIVING, createWorld, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];
const MIN = 60_000;

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionsOf = (field) => field.options.map((option) => option.value);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, cloud transport, environment category', () => {
  assert.equal(manifest.name, 'Qingping');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-qingping:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-qingping/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['environment']);
  assert.equal(manifest.network_discovery, undefined);
  assert.equal(pkg.name, 'gladys-qingping');
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(keysOf(manifest.actions), ['test_connection', 'set_report_interval']);
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const set = await world.fake.action('set_report_interval', {
    device: deviceId(world.gladys, LIVING),
    minutes: '15',
  });
  assert.equal(set.success, true, set.error);
});

test('the report intervals of the action are the ones the code accepts', () => {
  const action = manifest.actions.find((a) => a.key === 'set_report_interval');
  assert.deepEqual(optionsOf(action.fields.find((f) => f.key === 'minutes')), REPORT_INTERVALS);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, {
      device: deviceId(world.gladys, LIVING),
    });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
    for (const output of action.outputs) {
      const value = ack.data.outputs[output.key];
      assert.equal(typeof value, output.type, `${action.key}.${output.key}`);
    }
  }
  // A thermometer has no air quality: a readable error.
  const cellar = await world.fake.sceneAction('get_air_quality', {
    device: deviceId(world.gladys, '582D34000004'),
  });
  assert.equal(cellar.success, false);
  assert.match(cellar.error, /measures no air quality/);
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  // Every trigger once: a level change, a device silent then back.
  const now = () => Math.floor(world.clock.now() / 1000);
  world.clock.advance(5 * MIN);
  world.cloud.upload(LIVING, now(), { co2: 2400 });
  await world.hub.pollAll();
  world.clock.advance(30 * MIN);
  await world.hub.pollAll();
  world.cloud.upload(BEDROOM, now());
  await world.hub.pollAll();

  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} was fired`);
    // Filters match keys of `data`, variables read keys of `data`.
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const key of Object.keys(data)) {
      assert.ok(
        keysOf(trigger.variables).includes(key) || keysOf(trigger.fields).includes(key),
        `${trigger.key}: "${key}" is declared`,
      );
    }
    for (const variable of trigger.variables) {
      const value = data[variable.key];
      assert.ok(value === null || typeof value === variable.type, `${trigger.key}.${variable.key}`);
    }
  }
  const quality = manifest.scene_triggers.find((tr) => tr.key === TRIGGERS.AIR_QUALITY);
  assert.deepEqual(optionsOf(quality.fields.find((f) => f.key === 'level')), LEVELS);
  assert.deepEqual(optionsOf(quality.fields.find((f) => f.key === 'direction')), [
    'worse',
    'better',
  ]);
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.deepEqual(optionsOf(field('language')), LANGUAGES);
  assert.deepEqual(optionsOf(field('poll_interval')), POLL_INTERVALS);
  assert.equal(field('app_secret').type, 'secret', 'the App Secret is a secret field');
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('scene trigger fields use the types the core accepts there', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(['string', 'number', 'select', 'multi_select', 'section'].includes(field.type));
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
