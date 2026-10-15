# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Qingping air monitors and thermometers in Gladys, through the official
  Qingping cloud API: App Key and App Secret from developer.qingping.co, the
  access token kept in `/data`.
- One device per Qingping device of the account, with a feature per metric it
  reports: temperature, probe temperature, humidity, CO₂, PM2.5, PM10, VOC or
  VOC index, noise, pressure, battery, and the age of the latest reading.
- An air quality level per monitor (Good, Moderate, Poor, Very poor) with the
  pollutant behind it.
- The cloud is read right after each upload the devices are expected to make
  (their report interval), or at a fixed interval.
- Dashboard widget "Qingping air quality": one device or all of them.
- Scene triggers "Air quality changed", "Device stopped reporting" and "Device
  reporting again"; scene action "Get the air quality".
- Configuration actions "Test the connection" and "Set the report interval"
  (air monitors).
- Every text in English, French, German and Spanish, and the documentation in
  the four languages.

[Unreleased]: https://github.com/guim31/gladys-qingping/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-qingping/releases/tag/v1.0.1
