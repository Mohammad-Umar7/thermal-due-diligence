# FortyGuard Temperature API® — Endpoint Notes

**Source:** <https://docs-api.fortyguard.com/docs> — read 26 August 2026, API version **v1.0.0**
(initial public release, 22 April 2026).
**Method:** the docs site is a JS-rendered SPA; `curl` returns a 1.3 KB shell. All pages below
were read through a headless browser.

Everything here is transcribed from the live documentation. Where the documentation contradicts
the build brief, or contradicts itself, it is called out explicitly in
[§8 Discrepancies](#8-discrepancies-and-open-questions).

---

## 1. Basics

| | |
|---|---|
| Base URL | `https://api.fortyguard.com/v1/` |
| Auth | `api-key: YOUR_API_KEY` request header. No OAuth, no token exchange. |
| Pattern | Asynchronous. POST returns an `activity_id`; poll `GET /v1/status/{activity_id}`. |
| Coverage | **United States only** on every plan. Non-US coordinates are rejected. |
| Content type | `application/json` |

### Response envelope

Every endpoint returns the same wrapper:

```json
{
  "error": false,
  "status_code": 200,
  "message": "Heatmap Submitted Successfully",
  "data": { "activity_id": "f52d2453-6a59-4b31-afa3-8fe3bb1ac5df" }
}
```

### Status / error codes

| Code | Meaning |
|---|---|
| 400 / 422 | Invalid request or validation error |
| 401 | Missing or invalid API key |
| 403 | Insufficient plan access |
| 404 | Activity not found — **also returned transiently right after submission** |
| 429 | Rate limit exceeded |
| 500 | Server-side processing error |

Activity states: `Processing` (keep polling, bounded) · `Completed` (read the result) ·
`Failed` (terminal — stop polling, record the `activity_id`).

> The documented 404-immediately-after-submit behaviour matters: the poller must treat an early
> 404 as "not ready yet", not as a fatal error. This is handled in our adapter.

---

## 2. The six endpoints

| Endpoint | Method | Plan | Purpose |
|---|---|---|---|
| `/v1/heatmap` | POST | Basic + Premium | GeoJSON thermal map + statistics for a polygon AOI |
| `/v1/satellite` | POST | **Premium only** | Satellite-image segmentation, per-class coverage |
| `/v1/streetview` | POST | **Premium only** | Street-level segmentation, per-class coverage |
| `/v1/heat_intelligence` | POST | **Premium only** | Multi-dimensional PDF report via signed link |
| `/v1/env_params` | POST | Basic (3 params) + Premium (all) | Humidity, AQI, solar irradiance, wet-bulb, etc. |
| `/v1/status/{activity_id}` | GET | Basic + Premium | Unified status and result retrieval |

Plus credit reporting: `POST /v1/system/fetch-api-key-usage` and
`POST /v1/system/fetch-api-key-custom-usage` (per release notes; the docs site exposes these
through an interactive "Check API Credits Usage" widget rather than a documented schema).

**On a Basic/Startup key, three of the six are unavailable to us.** Our project is built
entirely on `/v1/heatmap` + `/v1/status`, with `/v1/env_params` as an optional enrichment.

---

## 3. `POST /v1/heatmap` — the endpoint this project runs on

Produces a GeoJSON polygon layer of tiles carrying temperature values, plus aggregate statistics.

### Required

| Field | Type | Notes |
|---|---|---|
| `polygon_aoi` | object | **GeoJSON `FeatureCollection`** whose geometry is a closed `Polygon` (first coordinate == last). |
| `date_time.start_date` | string | `YYYY-MM-DD` |
| `date_time.filter_type` | number | See table below |
| `granularity` | number | **60**, **80**, or **100** — metres per tile |

### Optional

| Field | Type | Notes |
|---|---|---|
| `date_time.start_time` | string | `HH:MM`, 24-hour. Required for `filter_type` 1 and 2. |
| `date_time.end_time` | string | Required for `filter_type` 2. Auto-set to start + 1 h for type 1. |
| `date_time.end_date` | string | Required for `filter_type` 4. Auto-populated for 1–3. |
| `analytic_type` | string | `tcm` (default) · `time_of_measure` · `exceedance` · `persistence` |
| `threshold` | number | °C threshold for `exceedance` / `persistence`. Default **30 °C**. Ignored by `tcm` and `time_of_measure`. |
| `direction` | string | `above` (default) or `below`. For `exceedance` / `persistence` only. |

### `filter_type`

| Value | Meaning | Requires |
|---|---|---|
| 1 | Single hour | `start_date`, `start_time` |
| 2 | Range of hours, same day (**max 23 h**) | `start_date`, `start_time`, `end_time` |
| 3 | Single day (00:00–23:59) | `start_date` |
| 4 | Range of days, week/month, **≤ 1 month** | `start_date`, `end_date` |

> ⚠️ **`filter_type: 4` is contested.** It is documented on the Create Heatmap page but is
> *absent* from both the Known Limitations page ("`filter_type` must be 1, 2, or 3") and the
> v1.0.0 release notes (which list only Single Hour, Range of Hours, Single Day). See §8.

### `analytic_type` — read this before querying

A FortyGuard engineer warned in the Aug 18 session that picking the wrong layer "will hand you
a confident wrong answer". The four layers are not interchangeable:

| Value | Returns | Unit |
|---|---|---|
| `tcm` | Temperature snapshot — the temperature of each tile | °C |
| `time_of_measure` | Hour of day (0–23, **UTC**) at which peak temperature occurs | hour |
| `exceedance` | **Count of hours** the temperature passes `threshold` | hour |
| `persistence` | **Longest continuous run** of hours past `threshold` | hour |

`stats_data.units` reports `"hour"` for the latter three and °C for `tcm`.

**How this project uses them:**

- `tcm` → the temperature record itself; the input to the design-condition percentile and to CDD.
- `exceedance` with `threshold: 35 / 40 / 45`, `direction: above` → Feature 2's
  "hours per year above operational thresholds", computed by the API rather than by us.
- `persistence` → longest unbroken heat run; relevant to equipment recovery, not yet used.
- `time_of_measure` → not used. It is UTC-based and would need care to interpret locally.

### Result payload

`GET /v1/status/{activity_id}` on a completed heatmap returns:

```json
{
  "data": {
    "activity_id": "…", "status": "Completed",
    "result": { "map_data": { }, "stats_data": { } }
  }
}
```

- **`map_data`** — GeoJSON `FeatureCollection` of tile polygons with per-tile values.
- **`stats_data`** — aggregate statistics over all tiles:
  - `Temperature_stats` — `Minimum`, `Maximum`, `Mean`, `Standard_deviation`
  - `Overall_temperature_distribution` — `array[number]`, **sorted temperature values**
  - `Normal_temperature_distribution` — `{ x_axis, y_axis }`, a normalised density curve
  - `Temperature_frequency` — histogram bin counts

> **`Overall_temperature_distribution` is the single most valuable field for this project.**
> A sorted array of values is exactly what a percentile computation consumes. It is the
> route to a design-condition figure without hand-rolling a histogram — subject to confirming
> what population it is sorted over (tiles? hours? both?). See §8.

### Area cap

Basic / Startup: **10 mi²** per request. Premium: 50 mi².
A parcel bounding box is a rounding error against that cap, so the cap does not constrain us.

---

## 4. `POST /v1/env_params`

Requires `latitude`, `longitude`, `temperature` (**°C**), and `date_time`
(`filter_type` 1–3 only — no range-of-days here).

`analysis` is an optional array; omit for all. **Basic and Startup are capped at 3 parameters
per request**, so any use of this endpoint must choose its three deliberately.

Available parameters:

- **Thermal & atmospheric:** `heat_index_celsius`, `apparent_temperature_celsius`,
  `wet_bulb_temperature_celsius`, `relative_humidity_percent`, `precipitation_mm`,
  `cloud_cover_octas`, `elevation`
- **Air quality (US AQI) & gases:** `air_quality:idx`, `air_quality_pm2p5:idx`,
  `air_quality_pm10:idx`, `air_quality_no2:idx`, `aqi_us_co`, `air_quality_o3:idx`,
  `air_quality_so2:idx`, `methane_ppb`, `co2_ppm`
- **Solar:** `solar_irradiance` — clear-sky GHI / DNI / DHI

Result carries `metadata` (timezone, `timezone_offset_hours`, `time_range`, `timestamps`) and
`locations[]` with time-aligned arrays.

**Missing-value semantics — important.** Unavailable values are returned as JSON `null`.
Older stored responses may still carry a legacy `-999`. *"Missing values must not be
interpreted as zero."* Our parser coerces both `null` and `-999` to `null` and excludes them
from every aggregate.

If we use this endpoint at all, the three parameters would be
`relative_humidity_percent`, `wet_bulb_temperature_celsius`, `apparent_temperature_celsius` —
humidity is the honest caveat on any dry-bulb-only claim about cooling load.

---

## 5. Premium endpoints (unavailable on our key)

- **`POST /v1/satellite`** — `sat.latitude`, `sat.longitude`, `date_time`, `granularity`
  (60/80/100). Returns Base64 original imagery, `image_year`, and a `segmentation` object with
  per-class `segments` coverage, `image_legend` RGB, and a Base64 mask.
- **`POST /v1/streetview`** — `latitude`, `longitude`, `vertical_angle`, `horizontal_angle`,
  `back_view`. Returns front (and optionally back) original + segmented imagery with per-class
  coverage and `image_date`.
- **`POST /v1/heat_intelligence`** — `latitude`, `longitude`, `temperature`
  (**°F here, unlike `/v1/env_params` which takes °C**), `date`, and `analysis[]` from
  `geographic` / `environmental` / `urban` / `events` / `anthropogenic`. Completed status
  returns `result.download_link`, a temporary signed URL to a PDF. Generation takes several
  minutes; the link must be used immediately and never logged or shared.

> Note the unit inconsistency across endpoints: `heat_intelligence` takes **Fahrenheit**,
> `env_params` takes **Celsius**, `heatmap` returns Celsius. Any adapter must be explicit
> about units per endpoint. Ours carries units in the type signature.

---

## 6. Plans, credits and limits

| Capability | API Basic | API Premium | API Startup |
|---|---|---|---|
| Monthly credits | 1,000,000 | 5,000,000 | 1,000,000 |
| Heatmap max area | 10 mi² | 50 mi² | 10 mi² |
| Map Statistics | Full | Full | Full |
| Environmental Parameters | 3 per request | All | 3 per request |
| Satellite / Street View / Heat Intelligence | ✗ | ✓ | ✗ |
| Access window | Monthly, renews | Monthly, renews | **6 months, one-time** |
| Regional coverage | US only | US only | US only |
| Commercial licence | Included | Included | Included |

**Credit rules**

- Credits are deducted **only on successful completion** (`status: Completed`).
- **Failed tasks cost nothing.** Validation rejections (400) cost nothing.
- Unused credits do **not** roll over; they reset on `credits_reset_date`.

**Per-request credit cost is not documented anywhere.** The docs state only that cost varies
by request complexity. This must be measured empirically: read the usage endpoint, issue one
known request, read it again, and record the delta. Until that measurement exists, treat the
budget as unknown and cache everything.

**Input constraints**

- Latitude ∈ [-90, 90], longitude ∈ [-180, 180], **and inside the United States**.
- `polygon_aoi` must be a valid `FeatureCollection` with a **closed** Polygon.
- Dates `YYYY-MM-DD`, times `HH:MM` 24-hour.
- Heatmap forecasting: up to **now + 12 hours**. Beyond that → 400.
- Requests violating these return 400 and are **not charged**.

No numeric rate limit is published, though 429 is a documented response.

---

## 7. Implications for this project

1. **The AOI is a polygon, not a point.** A parcel query means building a small closed bounding
   box around the geocoded address. Tile granularity is 60–100 m, so a box smaller than one
   tile is pointless; the box should be sized to return a meaningful number of tiles.
2. **`granularity` is 60/80/100 m — not 20 m².** The 20 m figure in FortyGuard's marketing is
   the underlying model resolution, not a value this API accepts. We will describe our own
   output as 60 m tiles, because that is what we requested. Claiming 20 m would be unsupportable.
3. **`exceedance` computes threshold-hours for us** — Feature 2's threshold-hours metric comes
   straight from the API rather than from our own hourly reduction. Fewer moving parts, and the
   number is FortyGuard's own.
4. **`Overall_temperature_distribution` may yield the design percentile directly** — pending
   confirmation of what the array enumerates.
5. **If `filter_type: 4` works, the credit maths changes completely.** One request per month
   versus ~720 per month is the difference between a feasible multi-year record and an
   impossible one. **This is the first thing to test once a key is in hand.**
6. **Failed and rejected requests are free**, so probing behaviour costs credits only when it
   succeeds. Debugging is cheaper than the brief assumed — but a *successful* probe still costs,
   so cache from the first call regardless.

---

## 8. Discrepancies and open questions

### Documentation vs. the build brief

| Item | Brief said | Docs say | Resolution |
|---|---|---|---|
| History start | 1 Jan **2021** | **1 Jan 2019** on every endpoint page and in Known Limitations | Docs win → potentially **7 years** of record, not 5. **Must be tested.** |
| `polygon_aoi` shape | bare GeoJSON `Polygon` | `FeatureCollection` wrapping a Polygon | Follow the docs. Try bare Polygon as a fallback only. |
| Resolution | "20 m² per cell" | `granularity` ∈ {60, 80, 100} m | Request 60 m; describe output as 60 m. |
| `/v1/heat-intelligence` | "illustrative mockup, not a real endpoint" | `/v1/heat_intelligence` **is real** (underscore), Premium-only, returns a PDF link | Brief was half right: the *endpoint* exists, the mockup's `risk_level` / `credits_remaining` fields do not. Irrelevant to us — we are not on Premium. |
| Quantiles / analytics layer | "may compute our design percentile natively" | No "quantiles" feature exists. The nearest thing is `stats_data.Overall_temperature_distribution` and `exceedance`. | Adjust: use `exceedance` for threshold-hours; compute the percentile ourselves from the distribution array or from `tcm` values. |
| Credit cost per request | "priced by request complexity" | Same — no table published | Measure empirically. |

### Documentation vs. itself

1. **`filter_type: 4`** — documented on the Create Heatmap page; contradicted by Known
   Limitations and by the release notes. **Test before designing around it.**
2. **History start date** — API docs say 2019-01-01 throughout; the *hackathon FAQ* says
   "1 January 2021". These are different FortyGuard surfaces disagreeing. Test.
3. **Resolution** — hackathon FAQ says "~20-metre resolution"; the API accepts 60/80/100 m.

### Open questions requiring a live key

- [ ] Does `filter_type: 4` actually work? (Highest value question.)
- [ ] Does a 2019 or 2020 `start_date` return data, or 400?
- [ ] What population does `Overall_temperature_distribution` enumerate — tiles, hours, or
      tile-hours? This determines whether a percentile over it is meaningful.
- [ ] What does one heatmap request cost in credits, by `filter_type` and `granularity`?
- [ ] Which plan is the hackathon key on — Basic or Startup?
- [ ] Does `filter_type: 3` (single day) return an hourly series, or a daily aggregate?
      Feature 2's CDD calculation depends on the answer.
- [ ] Is a bare `Polygon` accepted for `polygon_aoi`, or is `FeatureCollection` mandatory?

Every one of these is answerable with a handful of requests, and rejected requests are free.

---

## 9. Getting a key

Not emailed automatically. Per the Day 1 participant brief:

> Log in to the **Temperature Dashboard®** at <https://dashboard.fortyguard.com/login>,
> open the **Profile** section (bottom-left of the screen), and **generate your key**.
> Dashboard access is required first.

Support: `support@fortyguard.com` (technical) · `hackathon@fortyguard.com` (everything else) ·
Slack `#help-technical`.
