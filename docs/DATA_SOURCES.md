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
- No area cap enforced on this plan; a 60 km box (1,390 mi²) was accepted
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

**Stations used** — first-order airport stations, the class whose records
underlie published design conditions:

| City | Station | USAF | WBAN | Lat | Lon | Elev |
|---|---|---|---|---|---|---|
| Phoenix | Sky Harbor Intl, AZ | 722780 | 23183 | 33.4278 | −112.0038 | 337 m |
| Las Vegas | Harry Reid Intl, NV | 723860 | 23169 | 36.0719 | −115.1633 | 664 m |
| Houston | George Bush Intercontinental, TX | 722430 | 12960 | 29.9902 | −95.3368 | 29 m |
| Austin | Austin-Bergstrom Intl, TX | 722540 | 13904 | 30.1830 | −97.6799 | 148 m |
| Miami | Miami Intl, FL | 722020 | 12839 | 25.7906 | −80.3164 | 3 m |

**Record windows:** 1991–2020 (historic, ~262,900 hourly observations per
station) and 2019–2024 (recent, ~52,600). Coverage exceeds 99% in every
station-year used, except Austin 1991–1998 which is absent from the archive
entirely and is recorded as a gap rather than filled.

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
