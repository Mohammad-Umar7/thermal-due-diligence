# Prior Art — FortyGuard Temperature Property®

**Reviewed:** 26 August 2026
**Subject:** <https://property.fortyguard.com/>
**Question this document answers:** does FortyGuard's existing property product already perform
the reference-station design-condition gap analysis that Thermal Due Diligence is built around?

**Answer: No.** Detail and evidence below.

---

## 1. What Temperature Property is

A lead-generation questionnaire that produces a human-readable PDF, emailed to the user.

The site describes a three-step process:

1. **Choose your profile** — Homeowner, Engineer, or Investor
2. **Fill the form** — property, location and requirements
3. **Get your report** — "comprehensive PDF report with insights and recommendations via email"

Stated turnaround: *"Complete the form in 5–10 minutes and receive your report within 1 hour."*
The confirmation screen says *"Processing typically takes less than 1 hour."*

It is an Angular single-page app (`property.fortyguard.com`) with four routes:
`/landing`, `/user-selection`, `/form/:userType`, `/confirmation`.

## 2. What each persona's report claims to include

Taken verbatim from the profile-selection screen.

| Persona | Advertised report contents |
|---|---|
| **Homeowner** | Temperature trends and patterns · Basic property impact assessment · Simple recommendations · Easy-to-understand visualizations |
| **Engineer** | Advanced technical analysis · Building performance metrics · HVAC system recommendations · Detailed insulation analysis · Professional-grade data |
| **Investor** | Investment risk analysis · Market trend insights · Financial impact projections · Portfolio optimization data · ROI calculations |

## 3. What it asks the user for

The Engineer form is an eight-section wizard, gated behind a free-text "What is your objective
for creating this report?" prompt:

1. Site · 2. Contextual Factors · 3. Building Envelope · 4. Systems ·
5. Thermal Performance · 6. Additional Information · 7. Basic Information · 8. Confirm & Submit

Roughly 100+ input fields were recovered from the form bundle. A representative sample:

- **Envelope:** Wall U-Value, Window U-Value, SHGC (Solar Heat Gain Coefficient), Window-to-Wall
  Ratio, Roof Reflectance (%), Roof/Wall/Floor Insulation Type and Thickness (mm), Facade
  Materials, Thermal Mass Materials, Glass Facade Area
- **Systems:** HVAC Type, SEER/EER Rating, Cooling Capacity (kW), Filtration MERV, Ducts
  Location, Building Automation System, Backup Power, Renewable Energy Capacity, Peak Load Capacity
- **Context:** Surrounding Land Use, Local Microclimate Notes, Orientation Facing, Elevation,
  Shading System Type and Coverage (%), Outdoor Space Type
- **Financial (Investor):** Baseline NOI, Cap Rate (%), Discount Rate (%), Energy Price per kWh,
  Occupancy Rate, Time Horizon, Budget in USD

Location is entered by address autocomplete (Google Places) or latitude/longitude, with a
"Use My Current Location" option. Preset city chips include Phoenix AZ, Houston TX, Miami FL,
Atlanta GA, Los Angeles CA, Denver CO, Seattle WA, Boston MA, Chicago IL, New York NY.

**The essential characteristic: the user must already know their building.** Wall U-value,
SHGC and SEER are numbers you read off a datasheet or a mechanical schedule. This is a
professional intake form for a consulting deliverable, not a self-serve lookup.

## 4. What it does *not* do

The decisive check. Every JavaScript bundle served by the app was downloaded and searched:

| Bundle | Size |
|---|---|
| `main.9124c112f0b1ba0c.js` | 372 KB |
| `chunk-232.0476d0971fe1cf8a.js` (the form) | 617 KB |
| `chunk-973.a7ee4efa54c4d258.js` | 95 KB |
| `chunk-309.1146377c72440711.js` | 13 KB |

Case-insensitive occurrence counts across all four:

| Term | Occurrences |
|---|---|
| `ASHRAE` | **0** |
| `design temperature` | **0** |
| `design day` | **0** |
| `degree day` / `degree-day` / `CDD` / `HDD` | **0** |
| `weather station` / `reference station` | **0** |
| `airport` | **0** |
| `dry bulb` / `dry-bulb` | **0** |
| `percentile` / `0.4%` | **0** |
| `TMY` | **0** |
| `NOAA` | **0** |
| `HVAC` | 17 |

There is no reference-station comparison, no design-condition percentile, no degree-day
accounting, and no concept of a published design standard anywhere in the product's client code.

**Stated limitation:** the PDF is generated server-side, so this evidence bounds the *client*
only. It remains possible the backend narrative mentions a design standard in prose. What can
be said with confidence is that the product collects no reference-station input, exposes no
design-condition output, and offers no interactive comparison — the analysis is not a feature
of the product a user interacts with.

## 5. How Thermal Due Diligence differs

| | Temperature Property® | Thermal Due Diligence |
|---|---|---|
| **Input** | ~100 fields, 5–10 minutes | One address |
| **Who can use it** | Someone holding a mechanical schedule | Anyone |
| **Output** | PDF emailed within the hour | Report on screen in under 2 seconds |
| **Central question** | "How does temperature affect this building?" | "How far is this parcel from the temperature the building code assumes?" |
| **Reference baseline** | None | NOAA reference station, 0.4% design condition computed from hourly record |
| **Degree days** | Not present | Parcel vs. station CDD, per year |
| **Method transparency** | Recommendations in prose | Every figure has its arithmetic on screen |
| **Audience** | Owner commissioning an assessment | Buyer performing diligence before a transaction |

The two are complements, not competitors. Temperature Property answers *"how should I build
this?"* once you have a design. Thermal Due Diligence answers *"is the standard everyone is
designing against even right for this parcel?"* before there is one.

## 6. Adjacent FortyGuard surfaces

- **Heat Intelligence API** (`POST /v1/heat_intelligence`, Premium only) — generates a
  multi-dimensional PDF across Geographic / Environmental / Urban / Events / Anthropogenic
  categories. Returns a temporary signed `download_link`, not structured data. Also narrative
  output, also no design-condition comparison in its documented schema.
- **Temperature Dashboard®** — map and analytics product; not parcel-report shaped.
- **Hackathon showcase prototypes** — the event page links example prototypes under
  "See What's Possible". Track 02 (Future Buildings & Energy) lists *HVAC Optimization,
  Energy Forecasting, Retrofit ROI* as example ideas. None is the design-condition gap.

## 7. Verdict

**Proceed.** The reference-station gap analysis, the degree-day translation and the empirical
build-impact study are all unoccupied. The nearest FortyGuard product asks the user for a
hundred building parameters and mails back a narrative; ours asks for an address and shows
its arithmetic.
