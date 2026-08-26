# Limitations

An honest account of what this tool cannot tell you. Everything here is
surfaced in the interface as well, not buried in the repository.

---

## 1. The model under-represents extreme heat

FortyGuard is a spatially interpolated model, and compared against the NOAA
station observation at the same point it **misses the extreme tail**, by
−4.5 °C in Phoenix and −5.2 °C in Las Vegas for July 2024.

This is why the absolute design temperature always comes from NOAA and
FortyGuard supplies only the offset between two points. But it also means:

- **We cannot tell you the hottest temperature your parcel has actually reached.**
  We can tell you how your parcel compares to the reference station.
- The spatial offset is measured on **monthly peak** values. We assume the
  offset at the design condition equals the offset in the monthly peak.
  That assumption is untested at the 0.4% tail and is the largest single
  source of uncertainty in the headline figure.

## 2. The spatial offset is measured over one month

The showcase figures use **July 2024**. A parcel's offset from its station may
vary by season, and a single month is a small sample for a statistic meant to
describe design conditions.

Widening this is a matter of credits, not method: each additional month is one
request. The current figures should be read as *"the offset observed in July
2024"*, not *"the offset in general"*.

## 3. Resolution is 100 m, not parcel-level

The API accepts `granularity` of 60, 80 or 100 m; we request 100 m. FortyGuard's
marketing describes ~20 m resolution, which is the underlying model resolution,
not a value the API accepts.

A 100 m tile is larger than most urban parcels. **A small parcel shares its tile
with its neighbours**, so the reading describes its immediate block rather than
its property line. Reported temperatures are the tile's, and the distance from
the queried point to the tile centre is shown.

At 500 m and below, boxes returned essentially uniform values — the model has no
sub-tile structure to reveal.

## 4. Daytime peaks vary far less across space than nights do

Measured across 30 km of Phoenix, July 2024, ~90,000 tiles:

| Statistic | Spatial spread |
|---|---|
| Monthly maximum (daytime peak) | 2.15 °C |
| Monthly average | 2.31 °C |
| Monthly minimum (night) | **5.97 °C** |

Because design conditions are daytime peaks, they sit on the **flattest** of the
three. The urban heat island is largely a nocturnal phenomenon: it shows up
strongly in degree-days and overnight equipment recovery, and weakly in peak
sizing.

This inverts in humid cities. Houston, Austin and Miami show 4.3–5.7 °C of
daytime spatial spread but only ~2 °C at night. **A finding for one climate does
not transfer to another**, and this tool should not be read as if it did.

## 5. The airport is not always the hot outlier

The intuition that reference stations sit on cool grass while the city bakes is
**not generally true**:

| City | Share of metro hotter than its reference station, at peak |
|---|---|
| Austin | 73.1% |
| Las Vegas | 69.7% |
| Houston | 58.6% |
| Miami | 49.2% |
| **Phoenix** | **31.7%** |

In Phoenix, Sky Harbor is hotter than two-thirds of its metro — designing to it
**over**-sizes for most parcels. The direction of the error is a property of the
city, and we report it per city rather than assuming it.

## 6. Coverage

- **United States only.** Non-US coordinates return a completed, *empty* result
  and still consume credits. We detect an empty result and report it as a
  coverage failure; we never interpret it as a temperature.
- **History begins 2019-01-01.** Earlier dates are rejected. (FortyGuard's
  hackathon FAQ says 2021; the API and its observed behaviour say 2019.)
- **Forecast reaches +12 hours** and only on heatmap endpoints.
- **NOAA station records have gaps.** Austin's ISD-Lite record is missing
  1991–1998, so its historic window is 1999–2020. Gaps are recorded and
  displayed, never filled.

## 7. Sample sizes and windows

| Quantity | Sample |
|---|---|
| Design condition, recent | ~52,600 hourly observations (6 years) |
| Design condition, historic | ~262,900 hourly observations (30 years) |
| Spatial offset | 1 month, ~90,000 tiles per metro |
| Cities characterised | **5** |

Five cities is not a national claim. The five here were chosen for heat
relevance and span two climate types; a sixth could behave differently from all
of them.

## 8. What we deliberately do not compute

- **No dollar figures.** An energy-cost estimate needs degree-days × a cited
  tariff × a cited system efficiency. The last two are properties of a specific
  building we do not know. We show the degree-day difference and stop rather
  than publish a number with a guessed link in its chain.
- **No physics.** No solar gain, heat transfer, albedo or thermodynamic
  simulation of any kind.
- **No regulatory or compliance claims.** Heat-specific zoning barely exists in
  the US and varies by jurisdiction. Nothing here indicates non-compliance with
  anything.
- **No humidity in the headline.** Design cooling loads depend on wet-bulb as
  well as dry-bulb. Dry-bulb alone understates the difference between a dry and
  a humid city. FortyGuard's `env_params` endpoint exposes wet-bulb and
  relative humidity, but the Basic/Hackathon plan caps a request at three
  parameters, and we have not incorporated it.

## 9. Not a substitute for engineering

This is a **screening tool for due diligence**, not a mechanical design
document. It indicates that the standard design condition may be wrong for a
site and by roughly how much. Sizing a system requires a licensed engineer, a
building model and a load calculation. Nothing here replaces that.
