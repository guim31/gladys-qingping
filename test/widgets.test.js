// -----------------------------------------------------------------------------
// The `air_quality` dashboard widget: rendered exactly as sent (the SDK's
// validator: vocabulary and budget), in the four languages, for one device
// and for all of them, and the empty and error states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ERROR_TEXT } from '../src/texts.js';
import { formatNumber } from '../src/widgets.js';
import {
  CELLAR,
  DEFAULT_TEST_CONFIG,
  FakeQingping,
  LIVING,
  OFFICE,
  createWorld,
  deviceId,
} from './helpers/world.js';

const MIN = 60_000;

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('air_quality', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered as sent');
  return ack.data.content;
}

const byType = (c, type) => c.components.filter((component) => component.type === type);

test('one device: its name, its figures as tiles, air quality, reading age, battery', async (t) => {
  const w = await world(t);
  const c = await content(w, { device: deviceId(w.gladys, LIVING) });
  assert.deepEqual(byType(c, 'text'), [{ type: 'text', variant: 'heading', text: 'Living room' }]);
  assert.deepEqual(
    byType(c, 'value').map(({ label, value, unit, color }) => [label, value, unit, color]),
    [
      ['CO₂', 1053, 'ppm', 'danger'],
      ['PM2.5', 12, 'µg/m³', 'success'],
      ['Temperature', 26.4, '°C', undefined],
      ['Humidity', 44, '%', undefined],
      ['PM10', 12, 'µg/m³', 'success'],
    ],
  );
  const [status] = byType(c, 'status');
  assert.deepEqual(status.items, [
    { label: 'Air quality', icon: 'wind', value: 'Poor · CO₂', color: 'danger' },
    { label: 'Latest reading', icon: 'clock', value: '10 min ago', color: 'neutral' },
    { label: 'Battery', icon: 'battery', value: '100 %', color: 'neutral' },
  ]);
  assert.ok(c.ttl_seconds >= 60);
});

test('at most six tiles, within the budget, for the richest monitor', async (t) => {
  const w = await world(t);
  const c = await content(w, { device: deviceId(w.gladys, OFFICE) }, 'de');
  assert.equal(byType(c, 'value').length, 6);
  assert.ok(c.components.length <= 8);
  assert.equal(byType(c, 'status')[0].items[0].value, 'Gut');
});

test('every device: one row each, in the language of the user', async (t) => {
  const w = await world(t);
  const c = await content(w, {}, 'fr');
  assert.equal(c.components.length, 1);
  assert.deepEqual(byType(c, 'status')[0].items, [
    { label: 'Living room', icon: 'wind', value: 'Mauvaise · CO₂', color: 'danger' },
    { label: 'Bedroom', icon: 'wind', value: 'Moyenne · CO₂', color: 'warning' },
    { label: 'Office', icon: 'wind', value: 'Bonne', color: 'success' },
    { label: 'Cellar', icon: 'thermometer', value: '13,7 °C · 78 %', color: 'neutral' },
  ]);
  for (const language of ['en', 'de', 'es']) {
    await content(w, {}, language);
  }
});

test('a stale or offline device says so instead of a frozen level', async (t) => {
  const w = await world(t);
  w.clock.advance(3 * 60 * MIN);
  w.cloud.device(OFFICE).info.status.offline = true;
  await w.hub.pollAll();
  const c = await content(w, {}, 'en');
  const rows = byType(c, 'status')[0].items;
  assert.deepEqual(rows[0], {
    label: 'Living room',
    icon: 'alert-triangle',
    value: 'No recent reading',
    color: 'warning',
  });
  assert.equal(rows[2].value, 'Offline');
  const detail = await content(w, { device: deviceId(w.gladys, CELLAR) }, 'es');
  assert.equal(byType(detail, 'status')[0].items.at(-2).value, 'Sin medida reciente');
  assert.equal(byType(detail, 'status')[0].items.at(-1).color, 'warning', 'battery at 15 %');
});

test('empty account, missing keys, unknown device', async (t) => {
  const empty = await world(t, { cloud: new FakeQingping({ devices: 'devices-empty' }) });
  assert.match((await content(empty)).components[0].text, /No Qingping device/);

  const noKeys = await world(t, { config: { language: 'en' } });
  assert.equal((await content(noKeys)).components[0].text, ERROR_TEXT.config.en);

  const w = await world(t, { config: DEFAULT_TEST_CONFIG });
  const unknown = await content(w, { device: deviceId(w.gladys, '582D34FFFFFF') });
  assert.match(unknown.components[0].text, /no longer on the Qingping account/);
});

test('a new reading asks the dashboards to refresh', async (t) => {
  const w = await world(t);
  const before = w.fake.widgetRefreshes.length;
  w.clock.advance(MIN);
  await w.hub.pollAll();
  assert.equal(w.fake.widgetRefreshes.length, before, 'nothing new, no nudge');
  w.cloud.upload(LIVING, Math.floor(w.clock.now() / 1000), { co2: 700 });
  await w.hub.pollAll();
  assert.equal(w.fake.widgetRefreshes.at(-1), 'air_quality');
});

test('numbers are written the way each language writes them', () => {
  assert.equal(formatNumber(21.44, 1, 'en'), '21.4');
  assert.equal(formatNumber(21.44, 1, 'fr'), '21,4');
  assert.equal(formatNumber(78.2, 0, 'de'), '78');
});
