# Qingping for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings **Qingping air monitors and thermometers** into Gladys through the
official **Qingping cloud API** (developer.qingping.co) — the cloud the
Qingping+ app uses. Free App Key and App Secret, no extra hardware.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against a simulated Qingping cloud whose answers were
> reconstructed from the Qingping documentation and the open-source clients
> of the community (see [Credits](#credits)), not against a real account.
> Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-qingping/issues).

## Features

- **One device per Qingping device** of the account, named as in the Qingping+
  app, with a feature per metric it reports: temperature, probe temperature,
  humidity, CO₂, PM2.5, PM10, VOC (ppb) or VOC index, noise, pressure,
  battery, and the **reading age** (minutes since the latest upload), which
  tells a stable value from a frozen one.
- An **air quality level** per monitor — Good, Moderate, Poor, Very poor — the
  worst of its CO₂, particles and VOC, with the pollutant behind it, on
  published thresholds (German Environment Agency, WHO 2021, US EPA) and a 5 %
  hysteresis.
- **Dashboard widget** "Qingping air quality": one device (tiles colored by
  level, air quality in words, age of the reading, battery) or all of them (one
  line each). A device that stopped uploading says so instead of showing a
  frozen value.
- **Scene triggers**: _Air quality changed_ (filters: monitor, new level,
  getting worse or better), _Device stopped reporting_ (no upload for two
  report intervals, or offline for Qingping) and _Device reporting again_.
- **Scene action**: _Get the air quality_, the level in words for a message or
  a condition.
- **Configuration actions**: _Test the connection_ and _Set the report
  interval_ of an air monitor (1 minute to 1 hour).
- A **transport badge** per device: cloud, or unreachable when it stopped
  uploading.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- Devices bound in the **Qingping+** app, in Qingping mode (not HomeKit).
- An **App Key** and **App Secret**: log in to
  [developer.qingping.co](https://developer.qingping.co) with the account of
  the app, open **Access Management**, copy both. Free.
- Internet access from Gladys (`oauth.cleargrass.com`, `apis.cleargrass.com`).

Targeted hardware: Qingping Air Monitor Lite, Air Monitor 2, CO₂ Temp & RH
Monitor, the Wi-Fi thermo-hygrometers, the Lee Guitars hygrometer, and the
Bluetooth sensors synced through a Qingping gateway or the app — any device
the API returns.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-qingping`
   (or install **Qingping** from the catalog once it is listed).
2. In **Configuration**, paste the App Key and the App Secret, save, then
   click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Token**: OAuth 2 client credentials, `POST https://oauth.cleargrass.com/oauth2/token`
  with the App Key and App Secret in HTTP Basic, scope `device_full_access`.
  The token (about 2 hours) is kept in `/data/qingping-state.json` (mode 0600) with a fingerprint of the keys, so a restart does not ask for a new
  one; it is renewed 5 minutes before it expires, or once when the API
  refuses it.
- **Readings**: `GET https://apis.cleargrass.com/v1/apis/devices` returns every
  device with its latest upload (50 per page, `timestamp` in milliseconds).
  The cloud only knows what the devices uploaded: every report interval set in
  the app (15 minutes by default on battery). In automatic mode, the next read
  is planned right after the next upload the integration expects (latest
  reading + report interval + 90 s), between 2 minutes and 1 hour; a late
  upload is looked for again after a quarter of the interval. A fixed interval
  can be chosen instead.
- **Quotas**: Qingping publishes none. The integration makes one request per
  reading (about 100 a day at 15 minutes) plus a token every 2 hours; on
  `429` it waits at least 15 minutes or the `Retry-After` of the cloud.
- **Gladys polling**: the devices are published with `should_poll: false` and
  the integration reads the cloud on its own timer (Gladys#3198); `onPoll`
  only answers from the latest reading.
- **States**: only for the devices added in Gladys, only the values that
  changed (`publishChangedStates`), every value again after 6 hours (so Gladys
  never shows one as old), and all of them when a device is added or Gladys
  reconnects.
- **Features learnt**: a device gets a feature for every metric it ever
  reported (remembered in `/data`), so a sensor warming up never removes one.
  A metric whose `status` says "abnormal" or "warming up" is not published.
- **Report interval**: `PUT https://apis.cleargrass.com/v1/apis/devices/settings`
  (air monitors only), on demand from the Configuration screen.
- **Logs**: nothing at info for a normal reading; one line when the cloud is
  lost and one when it is back; one line when a device stops or resumes
  uploading. `LOG_LEVEL=debug` shows the rest. Never the secret nor the token.

A read-only probe of the real cloud, which prints the shape of the answers and
nothing identifying:

```bash
node scripts/probe.mjs        # fake keys: must end on "Token: refused (auth, HTTP 401)"
QINGPING_APP_KEY=… QINGPING_APP_SECRET=… node scripts/probe.mjs
```

## Not checked without the hardware

- The real answers of the cloud: field names come from the official Go SDK and
  community clients; product ids other than 1203 (Air Monitor Lite), the units
  of `tvoc` on every model, the `status` values of the sensors, and the error
  bodies are assumptions.
- Whether `PUT /devices/settings` accepts every interval offered (1 to 60
  minutes) on every air monitor.
- The behaviour of Bluetooth sensors synced by the app (report interval, the
  `offline` flag).
- The widget and the scene cards in a real Gladys.

## Limitations

- Cloud only: no local reading (MQTT "private cloud" mode or Bluetooth).
- The values are as fresh as the uploads: 15 minutes by default on battery.
- Read-only, except the report interval of the air monitors.
- No history backfill: only the latest reading is read.
- Devices in HomeKit mode are not on the Qingping cloud.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Qingping cloud (`test/helpers/fakeQingping.js`, fixtures in
`test/fixtures/qingping/`). See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [ClearGrass/OpenapiSdkGo](https://github.com/ClearGrass/OpenapiSdkGo), the
  official Go SDK of the Qingping open API (no license: read only, nothing
  copied): endpoints, scope, request and answer structures.
- [qingping-iot-cloud](https://github.com/danielskowronski/qingping-iot-cloud)
  by Daniel Skowroński (BSD-2-Clause): the metric list, units and sensor
  statuses, and the real readings of its README, reused in the fixtures.
- [qingping-api-influxdb-forwarder](https://github.com/Harry-Chen/qingping-api-influxdb-forwarder)
  by Shengqi Chen (MIT) and [home-assortment](https://github.com/smcgarrigle/home-assortment)
  by Stephen McGarrigle (MIT): the token flow, the poll pace and the
  `/devices/settings` endpoint.
- [qingping_cgs1](https://github.com/mash2k3/qingping_cgs1) by mash2k3 (Home
  Assistant, local MQTT; no license: read only): model names and metrics.
- The architecture and the conformity tests follow
  [gladys-pihole](https://github.com/guim31/gladys-pihole),
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is not affiliated with Qingping (Qingping Technology (Beijing)
Co., Ltd. / ClearGrass), nor endorsed or sponsored by it. "Qingping" is their
trademark.

## License

Apache-2.0
