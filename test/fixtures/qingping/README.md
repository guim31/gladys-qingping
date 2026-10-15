# Qingping cloud fixtures

Answers of the Qingping open API (`oauth.cleargrass.com/oauth2/token`,
`apis.cleargrass.com/v1/apis/devices`), as the fake cloud of
`test/helpers/fakeQingping.js` serves them.

**Reconstructed, not captured.** The integration was developed without a
Qingping device nor account, and the Qingping hosts were not reachable from the
development session. The shapes come from:

- the official Go SDK of Qingping,
  [ClearGrass/OpenapiSdkGo](https://github.com/ClearGrass/OpenapiSdkGo)
  (`structs/res.go`: `info.mac`, `info.product.{id,name,en_name}`,
  `info.status.offline`, `info.setting.{report_interval,collect_interval}`,
  `data.<metric>.{value}`; no license, read only);
- [danielskowronski/qingping-iot-cloud](https://github.com/danielskowronski/qingping-iot-cloud)
  (BSD-2-Clause): the metric list and units, the `status` of a sensor (0
  normal, 1 abnormal, 2 warming up; for the battery, the charging state), and
  the real readings of its README (an Air Monitor Lite at 26.4 °C, 44.3 %,
  1053 ppm, 12 µg/m³; a CO2 & Temp & RH Monitor at 21.4 °C, 56 %, 959 ppm,
  signal -61 dBm), reused in `devices.json`;
- [Harry-Chen/qingping-api-influxdb-forwarder](https://github.com/Harry-Chen/qingping-api-influxdb-forwarder)
  and [smcgarrigle/home-assortment](https://github.com/smcgarrigle/home-assortment)
  (MIT): the token request, `expires_in`, `timestamp` in milliseconds on the
  API calls, `total` and `devices` in the list.

Product 1203 is the Air Monitor Lite (Qingping developer documentation); the
other product ids are placeholders — the code never relies on them. MACs are
invented (on the Qingping `582D34` prefix), names are generic, tokens fake.

`scripts/probe.mjs` checks these shapes against the real cloud: its output
(shape only, nothing identifying) is the way to replace them with captures.
