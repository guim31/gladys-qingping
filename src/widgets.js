// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `air_quality`.
//
// The use case: a glance at the wall tablet tells whether to open a window.
// So the widget says the air quality in words (good, moderate, poor, very
// poor), what drives it (CO₂, particles, VOC), and whether the reading is
// recent — a monitor whose battery died shows a frozen "good" otherwise.
//
// One device (chosen in the widget settings, or the only one of the account):
// its figures as tiles (CO₂, PM2.5, temperature, humidity… up to six), a
// status list (air quality, latest reading, battery). Every device otherwise:
// one status row each. The figures are sent as values, not bound to device
// features, so the widget works before the devices are added to Gladys.
//
// Read only, no button: the air is not something to command.
// Budget: 1 heading, 6 tiles, 1 status list (8 components at most).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { THRESHOLDS, rawLevel } from './airQuality.js';
import { deviceName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { CAUSE_TEXT, ERROR_TEXT, LEVEL_TEXT, pick } from './texts.js';

export const TEXT = {
  noDevice: {
    en: 'No Qingping device on the account yet: add your devices in the Qingping+ app.',
    fr: "Aucun appareil Qingping sur le compte : ajoutez vos appareils dans l'appli Qingping+.",
    de: 'Noch kein Qingping-Gerät im Konto: Füge deine Geräte in der Qingping+-App hinzu.',
    es: 'Todavía no hay ningún dispositivo Qingping en la cuenta: añádalos en la aplicación Qingping+.',
  },
  unknown: {
    en: 'This device is no longer on the Qingping account: choose another one in the widget settings.',
    fr: "Cet appareil n'est plus sur le compte Qingping : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Gerät ist nicht mehr im Qingping-Konto: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este dispositivo ya no está en la cuenta de Qingping: elija otro en la configuración del widget.',
  },
  airQuality: {
    en: 'Air quality',
    fr: "Qualité de l'air",
    de: 'Luftqualität',
    es: 'Calidad del aire',
  },
  reading: {
    en: 'Latest reading',
    fr: 'Dernière mesure',
    de: 'Letzte Messung',
    es: 'Última medida',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  stale: {
    en: 'No recent reading',
    fr: 'Pas de mesure récente',
    de: 'Keine aktuelle Messung',
    es: 'Sin medida reciente',
  },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  now: { en: 'just now', fr: "à l'instant", de: 'gerade eben', es: 'ahora mismo' },
  ago: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} min', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} h', es: 'hace {n} h' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  humidity: { en: 'Humidity', fr: 'Humidité', de: 'Feuchtigkeit', es: 'Humedad' },
  noise: { en: 'Noise', fr: 'Bruit', de: 'Lärm', es: 'Ruido' },
  vocIndex: { en: 'VOC index', fr: 'Indice COV', de: 'VOC-Index', es: 'Índice COV' },
};

// Tiles, by priority: air quality first, comfort after.
const TILES = [
  { key: 'co2', label: CAUSE_TEXT.co2, unit: 'ppm', icon: 'wind' },
  { key: 'pm25', label: CAUSE_TEXT.pm25, unit: 'µg/m³', icon: 'cloud' },
  { key: 'temperature', label: TEXT.temperature, unit: '°C', icon: 'thermometer', decimals: 1 },
  { key: 'humidity', label: TEXT.humidity, unit: '%', icon: 'droplet' },
  { key: 'pm10', label: CAUSE_TEXT.pm10, unit: 'µg/m³', icon: 'cloud' },
  { key: 'tvoc', label: CAUSE_TEXT.tvoc, unit: 'ppb', icon: 'activity' },
  { key: 'tvoc_index', label: TEXT.vocIndex, icon: 'activity' },
  { key: 'noise', label: TEXT.noise, unit: 'dB', icon: 'volume-2' },
];
const MAX_TILES = 6;

export const LEVEL_COLORS = {
  good: WIDGET_COLORS.SUCCESS,
  moderate: WIDGET_COLORS.WARNING,
  poor: WIDGET_COLORS.DANGER,
  bad: WIDGET_COLORS.DANGER,
};
const METRIC_COLORS = [
  WIDGET_COLORS.SUCCESS,
  WIDGET_COLORS.WARNING,
  WIDGET_COLORS.DANGER,
  WIDGET_COLORS.DANGER,
];

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A number the way the language writes it (decimal comma in fr, de, es). */
export const formatNumber = (value, decimals, language) => {
  const text = (Math.round(value * 10 ** decimals) / 10 ** decimals).toFixed(decimals);
  return language === 'en' ? text : text.replace('.', ',');
};

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** "Poor · CO₂" */
function levelText(record, language) {
  const { level, cause } = record.air;
  const label = t(LEVEL_TEXT[level], language);
  return cause ? `${label} · ${t(CAUSE_TEXT[cause], language)}` : label;
}

function ageText(minutes, language) {
  if (minutes < 1) {
    return t(TEXT.now, language);
  }
  if (minutes < 120) {
    return t(TEXT.ago, language).replace('{n}', String(minutes));
  }
  return t(TEXT.hoursAgo, language).replace('{n}', String(Math.floor(minutes / 60)));
}

/** The "Latest reading" status value, with its color. */
function readingItem(hub, record, language) {
  const age = hub.ageMinutes(record);
  if (age === null) {
    return { value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
  }
  if (record.device.offline) {
    return { value: t(TEXT.offline, language), color: WIDGET_COLORS.WARNING };
  }
  if (!record.reporting) {
    return { value: t(TEXT.stale, language), color: WIDGET_COLORS.WARNING };
  }
  return { value: ageText(age, language), color: WIDGET_COLORS.NEUTRAL };
}

/** Summary row of one device (all-devices view). */
function deviceRow(hub, record, language) {
  const label = fit(deviceName(record.device), 40);
  const reading = readingItem(hub, record, language);
  if (record.readingAt === null || !record.reporting) {
    return { label, icon: 'alert-triangle', ...reading };
  }
  if (record.air.level) {
    return {
      label,
      icon: 'wind',
      value: fit(levelText(record, language), 40),
      color: LEVEL_COLORS[record.air.level],
    };
  }
  // A thermometer: its figures.
  const parts = [];
  if (typeof record.values.temperature === 'number') {
    parts.push(`${formatNumber(record.values.temperature, 1, language)} °C`);
  }
  if (typeof record.values.humidity === 'number') {
    parts.push(`${formatNumber(record.values.humidity, 0, language)} %`);
  }
  return {
    label,
    icon: 'thermometer',
    value: fit(parts.join(' · ') || reading.value, 40),
    color: WIDGET_COLORS.NEUTRAL,
  };
}

function detail(hub, record, language) {
  const components = [
    { type: 'text', variant: 'heading', text: fit(deviceName(record.device), 40) },
  ];
  const tiles = TILES.filter(({ key }) => typeof record.values[key] === 'number').slice(
    0,
    MAX_TILES,
  );
  for (const tile of tiles) {
    const value = record.values[tile.key];
    components.push({
      type: 'value',
      value: Math.round(value * 10 ** (tile.decimals ?? 0)) / 10 ** (tile.decimals ?? 0),
      ...(tile.unit ? { unit: tile.unit } : {}),
      label: t(tile.label, language),
      icon: tile.icon,
      ...(THRESHOLDS[tile.key] ? { color: METRIC_COLORS[rawLevel(tile.key, value)] } : {}),
    });
  }
  const items = [];
  if (record.air.level) {
    items.push({
      label: t(TEXT.airQuality, language),
      icon: 'wind',
      value: fit(levelText(record, language), 40),
      color: LEVEL_COLORS[record.air.level],
    });
  }
  items.push({
    label: t(TEXT.reading, language),
    icon: 'clock',
    ...readingItem(hub, record, language),
  });
  if (typeof record.values.battery === 'number') {
    const battery = Math.round(record.values.battery);
    items.push({
      label: t(TEXT.battery, language),
      icon: 'battery',
      value: `${battery} %`,
      color: battery <= 15 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });
  return components;
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.error && hub.records.size === 0) {
    return message(ERROR_TEXT[hub.error.kind], language);
  }
  if (hub.records.size === 0) {
    return message(TEXT.noDevice, language);
  }
  const records = hub.view(settings?.device);
  if (records.length === 0) {
    return message(TEXT.unknown, language);
  }
  const components =
    records.length === 1
      ? detail(hub, records[0], language)
      : [{ type: 'status', items: records.slice(0, 10).map((r) => deviceRow(hub, r, language)) }];
  // The data moves at the pace of the uploads; the hub nudges on each new one.
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
