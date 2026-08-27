# Data Sources

Every dataset used, where it comes from, and what its licence permits.

---

## 1. FortyGuard Temperature API®

| | |
|---|---|
| **Provider** | FortyGuard |
| **Endpoint** | `POST https://api.fortyguard.com/v1/heatmap`, `GET /v1/status/{id}` |
| **Documentation** | <https://docs-api.fortyguard.com/docs> (v1.0.0, 22 April 2026) |
| **Access** | Hackathon plan key, 2,000,000 credits, valid to 30 September 2026 |
| **Licence** | Commercial licence included with the plan. Hackathon terms: participants retain ownership of their project and grant FortyGuard a licence to showcase it. |
| **Used for** | The spatial temperature offset between a parcel and its reference station — the component nothing else can supply |

**What we take from it:** per-tile `average_temperature`, `min_temperature` and
`max_temperature` at 100 m granularity, over a stated month, across a
metropolitan-scale area of interest.

**What we deliberately do not take from it:** absolute design temperatures. See
[METHODOLOGY §4](METHODOLOGY.md#4-why-noaa-and-fortyguard-are-never-differenced-directly).

**Attribution:** FortyGuard is credited as the source of all spatial temperature
data in the interface and in the report export.

**Measured characteristics** (observed 2026-08-26, not documented):

- Cost is flat at **4,220 credits per request**, independent of area and time range
- No area cap is *enforced* on this plan — a 60 km box (1,390 mi²) was accepted —
  but see the retrieval ceiling below, which is the real constraint
- **Retrieval ceiling around 125,000 tiles.** A larger survey completes
  server-side, is charged, and then returns `504` on every attempt to read it:
  their gateway gives up at 30 s and cannot serialise the result. Measured —
  52 km (270,000 tiles) and 40 km (~160,000) unrecoverable; 40 km New York at
  125,454 tiles retrieved; 34 km (~116,000) succeeded 168 of 176 attempts;
  30 km (~90,000) never failed. Surveys are therefore 30–34 km.
- **Coverage is the contiguous 48 states.** Honolulu and Anchorage each returned
  `Completed` with zero tiles and were charged. The planner now excludes
  anything outside the lower 48.
- Out-of-coverage areas return `Completed` with zero features **and still charge**
- `overall_temperature_distribution` is a five-number summary, not a distribution
- `filter_type: 4` (range of days) works, despite being absent from the Known
  Limitations page and the v1.0.0 release notes

---

## 2. NOAA Integrated Surface Database — ISD-Lite

| | |
|---|---|
| **Provider** | NOAA National Centers for Environmental Information (NCEI) |
| **URL** | `https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/{year}/{usaf}-{wban}-{year}.gz` |
| **Licence** | **Public domain.** Work of the U.S. federal government, 17 U.S.C. § 105. No restriction on use or redistribution. |
| **Used for** | The absolute design condition at each reference station, cooling degree days, threshold hours, and the temporal component of the gap |

**Format:** fixed-width, one observation per hour, air temperature in tenths of
a degree Celsius, `-9999` for missing. ISD-Lite is a derived product that selects
one observation per hour, which is exactly the input the design-condition method
requires — and roughly 80× smaller than the full `global-hourly` CSV product
(86 KB versus 6.8 MB per station-year).

**Station selection** — automatic, from the NOAA station history
(`isd-history.csv`). For each urban area we take the nearest first-order station
whose record covers both windows and still reports today, preferring the primary
civil airport an engineer would actually be designing against: a major
international field outranks a nearer military or general-aviation strip. The
chosen station must fall inside the surveyed box, or no comparison is possible.

A sample of the 175 stations used:

| City | Station | USAF | WBAN | Lat | Lon | Elev |
|---|---|---|---|---|---|---|
| Phoenix | Sky Harbor Intl, AZ | 722780 | 23183 | 33.4278 | −112.0038 | 337 m |
| Las Vegas | Harry Reid Intl, NV | 723860 | 23169 | 36.0719 | −115.1633 | 664 m |
| Houston | George Bush Intercontinental, TX | 722430 | 12960 | 29.9902 | −95.3368 | 29 m |
| Austin | Austin-Bergstrom Intl, TX | 722540 | 13904 | 30.1830 | −97.6799 | 148 m |
| Miami | Miami Intl, FL | 722020 | 12839 | 25.7906 | −80.3164 | 3 m |

**Record windows:** 1991–2020 (historic, up to ~262,900 hourly observations per
station) and 2019–2024 (recent, ~52,600). Roughly 4,900 station-years are
cached. Where a station opened later than 1991 — Austin-Bergstrom opened in
1999 — the historic window is the years that actually exist, and the record
reports which window it used rather than claiming 1991. Archive gaps are
recorded, never filled.

**Caching:** files are cached under `data/noaa/` on first fetch and never
re-requested. The directory is gitignored; `scripts/noaa.py` regenerates it.

---

## 3. ASHRAE design conditions — referenced, never copied

ASHRAE publishes annual design conditions in the *Handbook of Fundamentals*,
Chapter 14. **That data is copyrighted and licensed, and no part of it is
scraped, bundled, redistributed or reproduced in this project.**

What we use is the **method**: the definition of the 0.4% / 1% / 2% annual
cooling design dry-bulb temperature as the value exceeded that share of hours in
an average year. Definitions are not copyrightable; we apply the definition to
public-domain NOAA observations and compute the value ourselves.

That this is legitimate is demonstrable rather than asserted: our computation
returns **43.90 °C** for Phoenix Sky Harbor on the 1991–2020 window, matching the
figure the industry designs to, having read only NOAA data. The whole
computation is shown in the interface and asserted in the test suite.

ASHRAE is cited throughout as *the standard being referenced*, never as a source
of data.

---

## 4. Geocoding — U.S. Census Bureau Geocoder

| | |
|---|---|
| **Provider** | U.S. Census Bureau |
| **URL** | `https://geocoding.geo.census.gov/geocoder/` |
| **Licence** | Public domain, U.S. federal government work. No API key, no attribution requirement. |
| **Used for** | Turning a typed US street address into coordinates |

Chosen over commercial geocoders specifically because it is public domain,
keyless, and US-only — which matches FortyGuard's coverage exactly, so an
address the geocoder cannot resolve is very likely outside coverage anyway.

---

## 5. Not used

Considered and rejected, recorded so the choices are legible:

- **ASHRAE published tables** — copyrighted. Method used, data not.
- **FortyGuard `env_params`** — humidity and wet-bulb would strengthen the
  cooling-load argument, but the plan caps a request at three parameters and
  it is not yet incorporated. Noted in [LIMITATIONS §8](LIMITATIONS.md).
- **FortyGuard `satellite` / `streetview` / `heat_intelligence`** — Premium-only,
  unavailable on this key.
- **City building-permit portals (Socrata / ArcGIS)** — intended for the
  build-impact natural experiment (Feature 3). Not yet used; licences vary by
  city and would be recorded here individually before any are ingested.
- **Commercial parcel-boundary data** — licensing is incompatible with a public
  repository.
