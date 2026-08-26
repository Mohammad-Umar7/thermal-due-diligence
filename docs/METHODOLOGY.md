# Methodology

Every figure this application displays is computed here. This document gives the
formula, the inputs and the source for each one, so any number on screen can be
traced to its arithmetic.

The governing rule: **the absolute temperature level always comes from NOAA
observations; FortyGuard supplies only spatial offsets.** Section 4 explains why
mixing them any other way produces a confident wrong answer.

---

## 1. The design condition

### What it is

Buildings are sized against a *design condition*: a temperature the building must
cope with, exceeded only rarely. ASHRAE defines the annual cooling design
dry-bulb temperatures as the values exceeded **0.4%**, **1%** and **2%** of all
hours in an average year. The 0.4% value is exceeded about **35 hours a year**
(0.4% × 8,760).

ASHRAE publishes these values in licensed tables. **We do not use those tables.**
We compute the same statistic from public NOAA observations using the published
definition. ASHRAE is cited only as *the standard being referenced*.

### How we compute it

Input: every valid hourly dry-bulb observation at the reference station over a
stated window, from NOAA ISD-Lite.

```
sort observations ascending          -> s[0 .. n-1]
k = round(n * p / 100)               -> how many hours should lie above the answer
design(p) = s[n - 1 - k]
```

`p` is the exceedance percentage. The result is the temperature exceeded by
approximately `p` percent of the observations.

Implementation: [`designDryBulb`](../src/lib/climate/design-condition.ts).

### Validation

On the 1991–2020 window this method returns **43.90 °C** for Phoenix Sky Harbor —
the value the industry designs to for that station. Reproducing the published
figure from raw observations, without reading the table, is the check that the
method is right. It is asserted in
[`cross-validation.test.ts`](../src/lib/climate/cross-validation.test.ts) and
will fail loudly if it ever drifts.

Computed design conditions, 0.4% annual cooling dry-bulb:

| Station | 1991–2020 | 2019–2024 |
|---|---|---|
| Phoenix Sky Harbor, AZ | 43.90 °C | 45.00 °C |
| Las Vegas Harry Reid, NV | 42.80 °C | 43.90 °C |
| Houston Bush Intercontinental, TX | 36.10 °C | 37.20 °C |
| Austin-Bergstrom, TX | 38.30 °C † | 38.90 °C |
| Miami Intl, FL | 33.30 °C | 33.90 °C |

† Austin's ISD-Lite record is missing 1991–1998, so its "1991–2020" figure is
computed over 1999–2020. This is surfaced wherever the number appears.

---

## 2. The gap, in two components

A published design condition can be wrong for a specific parcel for two
independent reasons. We compute and display them separately, because they have
different sources, different confidence, and different remedies.

### 2a. Temporal — the standard's window is historic

The same statistic, computed on a recent window, differs from the historic one.

```
temporal = design(0.4%, recent window) - design(0.4%, published-era window)
```

Both terms are NOAA observations at the same station. **No model is involved**,
so this component carries no modelling uncertainty at all — only sampling
uncertainty from the record length.

Houston: `37.20 − 36.10 = +1.10 °C`.

### 2b. Spatial — the parcel is not the station

```
spatial = FortyGuard(parcel, peak) - FortyGuard(station coordinates, peak)
```

Both terms come from **the same FortyGuard request**, over the same period, at
the same granularity. Because the instrument is identical on both sides, the
difference reflects location rather than method. This is the only quantity
FortyGuard is asked for, and nothing else can supply it: it requires
temperature measured at 100 m resolution across an entire metropolitan area.

Houston: the hottest tile sits `+2.03 °C` above the tile containing the station.

### 2c. Combined

```
combined      = temporal + spatial
parcel design = design(0.4%, published-era window) + combined
```

Houston worst case: `36.10 + 1.10 + 2.03 = 39.23 °C`, a combined gap of
**+3.13 °C** against the standard an engineer would otherwise use.

Implementation: [`computeGap`](../src/lib/climate/design-condition.ts). The
displayed components are asserted to sum exactly to the displayed total.

---

## 3. The thermal record

### Cooling degree days

The standard mean-temperature method, base 18.3 °C (65 °F, the US convention):

```
daily mean  = mean of that day's valid hourly observations
CDD         = sum over days of max(0, daily mean - 18.3)
```

Pure arithmetic. Nothing fitted, nothing interpolated. Days with fewer than
**18 valid hourly observations** are excluded from the sum and the count of
excluded days is reported — filling a sparse day would bias the total silently.

Implementation: [`coolingDegreeDays`](../src/lib/climate/design-condition.ts).

Station CDD per year, 2019–2024:

| Station | CDD (base 18.3 °C) |
|---|---|
| Phoenix | 2,877 |
| Miami | 2,787 |
| Las Vegas | 2,258 |
| Houston | 1,906 |
| Austin | 1,784 |

### Hours above operational thresholds

Count of hours strictly above 35 °C, 40 °C and 45 °C, divided by the number of
years actually present in the record (not the span of the window).

Implementation: [`hoursAbove`](../src/lib/climate/design-condition.ts).

| Station | h > 35 °C / yr | h > 40 °C / yr |
|---|---|---|
| Phoenix | 1,591 | 511 |
| Las Vegas | 1,063 | 281 |
| Austin | 339 | 10 |
| Houston | 178 | 2 |
| Miami | 4 | 0 |

FortyGuard's `exceedance` analytic computes the same quantity spatially, using
`threshold` and `direction`, which is how the parcel side of this comparison is
obtained.

---

## 4. Why NOAA and FortyGuard are never differenced directly

This is the most important methodological decision in the project.

FortyGuard is a spatially interpolated model. Compared against the NOAA station
observation **at the same coordinates, over the same month**, it tracks the mean
and the nightly minimum closely but systematically **under-represents the extreme
tail**:

| Sky Harbor, July 2024 | NOAA ASOS | FortyGuard | Δ |
|---|---|---|---|
| mean | 38.41 °C | 37.89 °C | −0.52 |
| minimum | 27.80 °C | 27.60 °C | −0.20 |
| **maximum** | **47.20 °C** | **42.73 °C** | **−4.47** |

The same test across all five cities:

| City | FortyGuard max − NOAA max, same point |
|---|---|
| Houston | **+0.34 °C** |
| Austin | −1.11 °C |
| Miami | +2.26 °C |
| Phoenix | −4.49 °C |
| Las Vegas | −5.23 °C |

A naive product would show *"design standard 45.0 °C, your parcel 42.7 °C"* and
report a −2.3 °C gap. **That number would measure the model's smoothing, not the
parcel.** It is the single most available way to get this wrong.

The fix is the standard anomaly-transfer approach used in climate downscaling:
take the **absolute level** from the instrument that measures it well (a
calibrated point observation), and take only the **spatial offset** from the
instrument that resolves space (the model). A model tail statistic is never
subtracted from an observation tail statistic.

Houston is the demonstration city partly because its model-observation agreement
(+0.34 °C) is the closest of the five, so the offset rests on the firmest ground.

---

## 5. Querying FortyGuard

### Area of interest

The API takes a GeoJSON `FeatureCollection` whose geometry is a closed `Polygon`.
A parcel query is a square box centred on the geocoded address. Longitude spans
are scaled by `cos(latitude)`, without which boxes are visibly rectangular away
from the equator.

### Request shape

Credit cost is **flat at 4,220 credits per request** — independent of area and of
time range (measured 2026-08-26 across boxes from 0.5 km to 60 km and ranges from
one hour to one month). The efficient query is therefore always the **largest
useful area over the longest allowed period**, read for many points at once,
rather than one request per parcel.

Standing query for a showcase city:

```json
{
  "polygon_aoi": { "type": "FeatureCollection", "features": [ ... 30 km box ... ] },
  "date_time": { "start_date": "2024-07-01", "end_date": "2024-07-31", "filter_type": 4 },
  "granularity": 100
}
```

This returns ~90,000 tiles carrying per-tile `average_temperature`,
`min_temperature` and `max_temperature` for the month. Both the station tile and
any parcel tile are read from that one response, which is also why they are
guaranteed commensurable.

### Analysis layer

`analytic_type` selects what the tile values mean. Reading the wrong one produces
a confident wrong answer:

| Layer | Value | Used here for |
|---|---|---|
| `tcm` (default) | temperature, °C | the record and the spatial offset |
| `exceedance` | **hours** past `threshold` | threshold-hours at the parcel |
| `persistence` | **hours**, longest unbroken run | not currently used |
| `time_of_measure` | hour of day, **UTC** | not used; UTC would need care |

---

## 6. What is deliberately not computed

- **No energy cost in dollars.** A defensible figure needs degree-days × a cited
  tariff × a cited system efficiency. Two of those three are properties of a
  specific building we do not know. Rather than publish a number with a guessed
  link in the chain, we publish the degree-day difference and stop.
- **No physics.** No solar gain coefficients, no heat-transfer model, no albedo
  assumptions, no thermodynamic simulation.
- **No regulatory claims.** Heat-specific zoning barely exists in the US and
  varies by jurisdiction. The only standard referenced is ASHRAE design
  conditions, which are real and verifiable.
- **No interpolation across coverage gaps.** Where data is missing it is reported
  as missing.
