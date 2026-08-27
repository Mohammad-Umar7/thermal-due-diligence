# Thermal Due Diligence

> **Every building in America is designed using a temperature from the airport.
> We tell you what it actually is at your address.**

A parcel-level thermal survey for property due diligence. Enter a US address and
get the design temperature that actually applies there — and how far it is from
the one the construction industry is using.

Lookup is instant and runs entirely in the browser: each surveyed metro's
temperature field is measured once and shipped as a 180–320 KB raster, so there
is no API call, no key and no server in the request path. Five metros are
surveyed so far — Houston, Phoenix, Las Vegas, Austin and Miami — and an address
outside them says so plainly rather than guessing.

Built for **FortyGuard Hackathon'26** · Track 02, Future Buildings & Energy.

**Repo:** <https://github.com/Mohammad-Umar7/thermal-due-diligence>  
**Live demo:** _pending — connect the repo at vercel.com/new (auto-detects Next.js, no configuration needed)_

---

## The gap

<!-- screenshot: the levelling diagram -->

```
▔▔▔▔▔  38.70 °C   Bellaire Boulevard retail corridor, Houston
       ╎ +1.50   spatial   — this parcel is not the station   (FortyGuard)
       ╎ +1.10   temporal  — the standard's window is historic (NOAA)
▁▁▁▁▁  36.10 °C   published standard, Bush Intercontinental, 1991–2020
```

A cooling system sized to the published standard at this address is **undersized
by 2.60 °C** on the design day.

## The problem

Buildings are sized against a *design condition* — a temperature exceeded only
0.4% of hours in an average year. That number is measured at one reference
weather station, usually an airport, and computed on a historic 30-year window.

Two things make it wrong for a specific parcel, and they are independent:

| | | Source |
|---|---|---|
| **Temporal** | The climate has moved since the window closed | NOAA only — no model |
| **Spatial** | The parcel is not the station | FortyGuard, same instrument on both sides |

Nobody catches either, because nobody has parcel-level temperature data.
FortyGuard does.

## What we found

Surveying five US metros — ~495,000 tiles at 100 m resolution — produced three
results worth stating plainly.

**1. The design standard is ~1 °C stale.** Recomputing the same 0.4% statistic on
2019–2024 instead of 1991–2020 raises it by **+1.10 °C** in Phoenix, Las Vegas and
Houston, and +0.60 °C in Austin and Miami. This uses only NOAA observations.

**2. The airport is not always the hot outlier.** The intuition that reference
stations sit on cool grass while the city bakes is not generally true:

| Metro | Reference station | Temporal | Spatial range | Metro hotter than station |
|---|---|---|---|---|
| Houston | Bush Intercontinental | +1.10 | −4.02 to +2.11 | 35% |
| Phoenix | Sky Harbor | +1.10 | −1.44 to +0.71 | **32%** |
| Las Vegas | Harry Reid | +1.10 | −1.08 to +1.00 | 70% |
| Austin | Austin-Bergstrom | +0.60 | −2.71 to +1.63 | **73%** |
| Miami | Miami Intl | +0.60 | −3.06 to +2.61 | 49% |

In Phoenix, Sky Harbor is hotter than two-thirds of its metro — so the standard
**over**-sizes for most parcels there. The direction of the error is a property
of the city.

**3. Daytime peaks vary far less across space than nights do.** Across 30 km of
Phoenix in July: daytime peak spread **2.15 °C**, nighttime minimum spread
**5.97 °C**. Because design conditions are daytime peaks, they sit on the
flattest of the three. This inverts in humid cities — Houston, Austin and Miami
show 4.3–6.1 °C of *daytime* spread. A finding for one climate does not transfer
to another.

## The methodological core

**FortyGuard and NOAA are never differenced directly.** This is the decision the
whole project rests on.

FortyGuard is a spatially interpolated model. At the *same coordinates over the
same month* it tracks the mean and the nightly minimum closely, but
systematically under-represents the extreme tail:

| Sky Harbor, July 2024 | NOAA ASOS | FortyGuard | Δ |
|---|---|---|---|
| mean | 38.41 °C | 37.89 °C | −0.52 |
| minimum | 27.80 °C | 27.60 °C | −0.20 |
| **maximum** | **47.20 °C** | **42.73 °C** | **−4.47** |

A naive product would show *"standard 45.0 °C, your parcel 42.7 °C, gap −2.3 °C"*
— and that number would measure **the model's smoothing, not the parcel**.

The fix is the standard anomaly-transfer approach from climate downscaling: take
the **absolute level** from the instrument that measures it well (calibrated
point observations), and take only the **spatial offset** from the instrument
that resolves space (the model). Houston leads the demo partly because its
model–observation agreement is the closest of the five, at **+0.52 °C**.

## No ASHRAE table was copied

ASHRAE publishes design conditions in licensed tables. **None is used here.** We
apply the published *method* — the temperature exceeded 0.4% of hours — to
public-domain NOAA observations.

That this is legitimate is demonstrable rather than asserted: on the 1991–2020
window our computation returns **43.90 °C** for Phoenix Sky Harbor, the figure the
industry designs to, having read only NOAA data. It is asserted in the test suite
and will fail loudly if it ever drifts.

## Every number is traceable

Every headline figure has a **"How this was calculated"** panel showing inputs,
method and source. No dollar estimates appear anywhere: converting degree-days to
energy cost needs a published tariff *and* a stated system efficiency, and the
second is a property of a building we have not seen. A figure with a guessed link
in its chain is worse than no figure.

Uncertainty is surfaced in the interface, not buried:
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) is the honest account.

## Running it

```bash
npm install
npm run dev
```

The app ships with five pre-computed cities in `src/data/cities/`, so it runs
with **zero live API calls** and cannot fail in front of a judge because an
upstream API timed out.

```bash
npm test          # 61 tests, including cross-validation against real NOAA data
npm run build
```

To regenerate the seed data you need a FortyGuard key in `.env.local`
(see [.env.example](.env.example)):

```bash
python scripts/metro_probe.py houston    # one request, whole metro, whole month
python scripts/seed.py                   # rebuild src/data/cities/
python scripts/rasterize.py              # rebuild public/rasters/*.bin
```

Adding a metro is one FortyGuard request (4,220 credits) plus a rerun of those
last two scripts.

## What we learned about the API

Measured against the live API, not read from the docs. Full detail in
[docs/API_NOTES.md](docs/API_NOTES.md).

- **Cost is flat at 4,220 credits per request** — independent of area *and* time
  range, verified from 0.5 km to 60 km boxes and from one hour to one month. The
  efficient query is therefore always the largest area over the longest period.
  One request covers an entire metro for a month.
- **`filter_type: 4` works**, despite being absent from the Known Limitations page
  and the v1.0.0 release notes.
- **History starts 2019-01-01**, not 2021 as the hackathon FAQ states.
- **No area cap** was enforced on the Hackathon plan; a 60 km box (1,390 mi²) was
  accepted.
- ⚠️ **Out-of-coverage areas return `Completed` with zero features — and still
  charge credits.** London cost 4,220 for an empty result. Our client raises this
  as `no-coverage` and deliberately does not cache it, so an empty
  FeatureCollection can never be read downstream as "zero degrees".
- `overall_temperature_distribution` is a five-number summary, not a distribution.

Total credits used across all development and all five cities: **~72,000 of
2,000,000 (3.6%)**.

## Repository

| | |
|---|---|
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Every formula, with inputs and sources |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Every dataset and its licence |
| [docs/API_NOTES.md](docs/API_NOTES.md) | Real endpoint shapes as discovered |
| [docs/PRIOR_ART.md](docs/PRIOR_ART.md) | What Temperature Property does and doesn't do |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | What this cannot tell you |

```
src/lib/fortyguard/   typed client: submit-and-poll, backoff, caching, fixtures mode
src/lib/climate/      design conditions, degree days, ISD-Lite parsing
src/components/       the levelling diagram and document furniture
scripts/              probe harness, NOAA pipeline, seed builder
```

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Vitest · deployed on Vercel.
Reports are statically prerendered, so a cached report loads in well under two
seconds.

---

Spatial temperature data from the
[FortyGuard Temperature API®](https://docs-api.fortyguard.com/docs).
Station observations from [NOAA NCEI](https://www.ncei.noaa.gov/), public domain.

A screening tool for due diligence, not a mechanical design document.
