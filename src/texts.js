// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the air
// quality levels, the action and scene action messages. Four languages, the
// four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './qingping/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// One short explanation per error kind (src/qingping/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.CONFIG]: {
    en: 'Enter your Qingping App Key and App Secret in the configuration.',
    fr: 'Saisissez votre App Key et votre App Secret Qingping dans la configuration.',
    de: 'Gib deinen Qingping App Key und dein App Secret in der Konfiguration ein.',
    es: 'Introduzca su App Key y su App Secret de Qingping en la configuración.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'App Key or App Secret refused by Qingping: copy them again from developer.qingping.co.',
    fr: 'App Key ou App Secret refusé par Qingping : recopiez-les depuis developer.qingping.co.',
    de: 'App Key oder App Secret von Qingping abgelehnt: Kopiere sie erneut von developer.qingping.co.',
    es: 'Qingping ha rechazado la App Key o el App Secret: cópielos de nuevo desde developer.qingping.co.',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'Too many requests to the Qingping cloud, retrying later.',
    fr: 'Trop de requêtes vers le cloud Qingping, nouvel essai plus tard.',
    de: 'Zu viele Anfragen an die Qingping-Cloud, neuer Versuch später.',
    es: 'Demasiadas solicitudes a la nube de Qingping, se reintentará más tarde.',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The Qingping cloud does not answer.',
    fr: 'Le cloud Qingping ne répond pas.',
    de: 'Die Qingping-Cloud antwortet nicht.',
    es: 'La nube de Qingping no responde.',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'Unexpected answer from the Qingping cloud, see the logs.',
    fr: 'Réponse inattendue du cloud Qingping, voir les logs.',
    de: 'Unerwartete Antwort der Qingping-Cloud, sieh in den Protokollen nach.',
    es: 'Respuesta inesperada de la nube de Qingping, consulte los registros.',
  },
};

// Air quality levels (src/airQuality.js), short: a widget status value.
export const LEVEL_TEXT = {
  good: { en: 'Good', fr: 'Bonne', de: 'Gut', es: 'Buena' },
  moderate: { en: 'Moderate', fr: 'Moyenne', de: 'Mäßig', es: 'Moderada' },
  poor: { en: 'Poor', fr: 'Mauvaise', de: 'Schlecht', es: 'Mala' },
  bad: { en: 'Very poor', fr: 'Très mauvaise', de: 'Sehr schlecht', es: 'Muy mala' },
};

// The metric behind a level ("cause"), short.
export const CAUSE_TEXT = {
  co2: { en: 'CO₂', fr: 'CO₂', de: 'CO₂', es: 'CO₂' },
  pm25: { en: 'PM2.5', fr: 'PM2,5', de: 'PM2,5', es: 'PM2,5' },
  pm10: { en: 'PM10', fr: 'PM10', de: 'PM10', es: 'PM10' },
  tvoc: { en: 'VOC', fr: 'COV', de: 'VOC', es: 'COV' },
  tvoc_index: { en: 'VOC', fr: 'COV', de: 'VOC', es: 'COV' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (count) => `Connected to the Qingping cloud: ${count} device(s).`,
    none: 'Connected, but no device on this account: add them in the Qingping+ app.',
    stale: 'no recent reading',
    offline: 'offline',
    minutes: (minutes) => `reading ${minutes} min old`,
  },
  fr: {
    ok: (count) => `Connecté au cloud Qingping : ${count} appareil(s).`,
    none: "Connecté, mais aucun appareil sur ce compte : ajoutez-les dans l'appli Qingping+.",
    stale: 'pas de mesure récente',
    offline: 'hors ligne',
    minutes: (minutes) => `mesure d'il y a ${minutes} min`,
  },
  de: {
    ok: (count) => `Mit der Qingping-Cloud verbunden: ${count} Gerät(e).`,
    none: 'Verbunden, aber kein Gerät in diesem Konto: Füge sie in der Qingping+-App hinzu.',
    stale: 'keine aktuelle Messung',
    offline: 'offline',
    minutes: (minutes) => `Messung vor ${minutes} min`,
  },
  es: {
    ok: (count) => `Conectado a la nube de Qingping: ${count} dispositivo(s).`,
    none: 'Conectado, pero no hay ningún dispositivo en esta cuenta: añádalos en la aplicación Qingping+.',
    stale: 'sin medida reciente',
    offline: 'sin conexión',
    minutes: (minutes) => `medida de hace ${minutes} min`,
  },
};

// Messages of the "Set the report interval" action and of the scene action.
export const ACTION_TEXT = {
  pickDevice: {
    en: 'Choose a device.',
    fr: 'Choisissez un appareil.',
    de: 'Wähle ein Gerät.',
    es: 'Elija un dispositivo.',
  },
  pickInterval: {
    en: 'Choose a report interval.',
    fr: 'Choisissez un intervalle de remontée.',
    de: 'Wähle ein Sendeintervall.',
    es: 'Elija un intervalo de envío.',
  },
  unknownDevice: {
    en: 'This device is not on the Qingping account (yet): wait for the next reading.',
    fr: "Cet appareil n'est pas (encore) sur le compte Qingping : attendez la prochaine lecture.",
    de: 'Dieses Gerät ist (noch) nicht im Qingping-Konto: Warte auf die nächste Abfrage.',
    es: 'Este dispositivo no está (todavía) en la cuenta de Qingping: espere a la próxima lectura.',
  },
  noAirQuality: {
    en: 'This device measures no air quality (no CO₂, particles or VOC).',
    fr: "Cet appareil ne mesure pas la qualité de l'air (ni CO₂, ni particules, ni COV).",
    de: 'Dieses Gerät misst keine Luftqualität (kein CO₂, kein Feinstaub, keine VOC).',
    es: 'Este dispositivo no mide la calidad del aire (ni CO₂, ni partículas, ni COV).',
  },
  intervalSet: {
    en: 'Report interval changed: the device applies it at its next report.',
    fr: "Intervalle de remontée modifié : l'appareil l'applique à sa prochaine remontée.",
    de: 'Sendeintervall geändert: Das Gerät übernimmt es bei der nächsten Übertragung.',
    es: 'Intervalo de envío modificado: el dispositivo lo aplicará en su próximo envío.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object built from a table of per-language renderers. */
export const each = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));
