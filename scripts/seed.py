"""
Build the seeded dataset the application ships with.

Driven entirely by data/metros.json, so adding a metro means adding a survey and
rerunning this - never editing a list by hand.

Reads:   data/metros.json                  the survey plan (place + station + box)
         data/metro/<city>_2024-07.ndjson   FortyGuard tiles
         data/noaa/*.txt                    NOAA ISD-Lite, cached
Writes:  src/data/cities/<city>.json        one record per metro
         src/data/cities/index.ts           generated import map for the app

Every figure written here is reproducible from those inputs by rerunning this
script; nothing is hand-entered.
"""

import json
import math
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from noaa import (  # noqa: E402
    STATIONS,
    cooling_degree_days,
    daily_means_from_hours,
    design_dry_bulb,
    hours_above,
    load_hours,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "src", "data", "cities")
METRO_DIR = os.path.join(ROOT, "data", "metro")

HISTORIC = range(1991, 2021)
RECENT = range(2019, 2025)
MONTH = "2024-07"

# Hand-verified street addresses, used where they exist because a real address
# reads better on the landing page than a coordinate. Everywhere else the
# showcase parcels are derived from the survey itself, below.
CURATED_PARCELS = {
    "houston": [
        ("5100 Bellaire Blvd, Bellaire, TX 77401", "Bellaire Boulevard retail corridor", "retail"),
        ("16000 Kennedy Blvd, Houston, TX 77032", "Airport logistics park", "logistics"),
        ("1200 Smith St, Houston, TX 77002", "Downtown office tower", "office"),
    ],
}


def geocode(address):
    q = urllib.parse.urlencode(
        {"address": address, "benchmark": "Public_AR_Current", "format": "json"}
    )
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + q
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            data = json.load(resp)
    except Exception:
        return None
    matches = data.get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    m = matches[0]
    return {"matched": m["matchedAddress"], "lat": m["coordinates"]["y"], "lon": m["coordinates"]["x"]}


def place_name(lat, lon):
    """Census place containing a point, for labelling a derived parcel."""
    q = urllib.parse.urlencode({
        "x": lon, "y": lat, "benchmark": "Public_AR_Current",
        "vintage": "Current_Current", "format": "json",
    })
    url = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?" + q
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            g = json.load(resp).get("result", {}).get("geographies", {})
    except Exception:
        return None
    for key in ("Incorporated Places", "Census Designated Places", "County Subdivisions", "Counties"):
        entries = g.get(key) or []
        if entries and entries[0].get("NAME"):
            return entries[0]["NAME"]
    return None


def load_tiles(city):
    path = os.path.join(METRO_DIR, "%s_%s.ndjson" % (city, MONTH))
    if not os.path.exists(path):
        return None, None
    rows = []
    with open(path, encoding="utf-8") as fh:
        meta = json.loads(fh.readline())["_meta"]
        for line in fh:
            rows.append(json.loads(line))
    return meta, rows


def nearest(rows, lat, lon):
    best, bd = None, 9e9
    cos = math.cos(math.radians(lat))
    for r in rows:
        d = (r[0] - lat) ** 2 + ((r[1] - lon) * cos) ** 2
        if d < bd:
            bd, best = d, r
    return best, math.sqrt(bd) * 111320


def pct_rank(sorted_vals, v):
    lo, hi = 0, len(sorted_vals)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_vals[mid] < v:
            lo = mid + 1
        else:
            hi = mid
    return round(100.0 * lo / len(sorted_vals), 1)


def derived_parcels(city, rows, station_tile, peaks_sorted):
    """
    Showcase parcels taken from the survey itself: the hottest point, the coolest
    point, and one at the median. Labelled by the Census place that contains
    them, so a reader knows where they are without a street address.
    """
    by_peak = sorted(rows, key=lambda r: r[4])
    picks = [
        (by_peak[-1], "Hottest surveyed point", "hottest"),
        (by_peak[len(by_peak) // 2], "Median parcel", "median"),
        (by_peak[0], "Coolest surveyed point", "coolest"),
    ]
    out = []
    for tile, label, kind in picks:
        name = place_name(tile[0], tile[1])
        out.append({
            "id": "%s-%s" % (city, kind),
            "label": "%s — %s" % (label, name) if name else label,
            "kind": kind,
            "address": "%s · %.5f, %.5f" % (name or "within the survey", tile[0], tile[1]),
            "lat": round(tile[0], 6), "lon": round(tile[1], 6),
            "tileDistanceM": 0,
            "tile": {"avgC": tile[2], "minC": tile[3], "maxC": tile[4]},
            "spatialOffsetC": round(tile[4] - station_tile[4], 2),
            "metroPercentile": pct_rank(peaks_sorted, tile[4]),
        })
    return out


def build(city, label):
    meta, rows = load_tiles(city)
    if not rows:
        return None

    st = STATIONS[city]
    station_tile, dist = nearest(rows, st["lat"], st["lon"])
    if dist > 250:
        raise ValueError(
            "%s: station is %.0f m from the nearest tile - it is outside the surveyed "
            "box, so no offset can be computed against it." % (city, dist)
        )

    obs_hist, cov_hist = load_hours(city, HISTORIC)
    obs_recent, cov_recent = load_hours(city, RECENT)
    t_hist = [t for *_, t in obs_hist]
    t_recent = [t for *_, t in obs_recent]
    if not t_hist or not t_recent:
        raise ValueError("%s: no NOAA observations for %s-%s" % (city, st["usaf"], st["wban"]))

    d04_hist = design_dry_bulb(t_hist, 0.4)
    d04_recent = design_dry_bulb(t_recent, 0.4)

    dm, dropped = daily_means_from_hours(obs_recent)
    n_years = len(set(y for (y, _m, _d) in dm)) or 1
    cdd = cooling_degree_days(dm.values()) / n_years
    n_recent_years = len(set(o[0] for o in obs_recent)) or 1

    july = [t for (y, m, _d, _h, t) in obs_recent if y == 2024 and m == 7]

    peaks_sorted = sorted(r[4] for r in rows)
    offsets = sorted(r[4] - station_tile[4] for r in rows)
    q = lambda a, f: round(a[int(f * (len(a) - 1))], 3)

    hist_years = sorted(y for y in cov_hist if isinstance(y, int) and cov_hist[y]["observations"] > 0)
    missing_hist = cov_hist.get("_missing_years")

    parcels = []
    for address, plabel, kind in CURATED_PARCELS.get(city, []):
        g = geocode(address)
        if not g:
            continue
        tile, tdist = nearest(rows, g["lat"], g["lon"])
        if tdist > 250:
            continue
        parcels.append({
            "id": "%s-%s" % (city, kind), "label": plabel, "kind": kind,
            "address": g["matched"], "lat": round(g["lat"], 6), "lon": round(g["lon"], 6),
            "tileDistanceM": round(tdist),
            "tile": {"avgC": tile[2], "minC": tile[3], "maxC": tile[4]},
            "spatialOffsetC": round(tile[4] - station_tile[4], 2),
            "metroPercentile": pct_rank(peaks_sorted, tile[4]),
        })
    if not parcels:
        parcels = derived_parcels(city, rows, station_tile, peaks_sorted)

    return {
        "city": city,
        "label": label,
        "station": {
            "name": st["name"], "usaf": st["usaf"], "wban": st["wban"],
            "lat": st["lat"], "lon": st["lon"], "elevationM": st["elev_m"],
        },
        "noaa": {
            "historicWindow": "%d-%d" % (min(hist_years), max(hist_years)) if hist_years else "n/a",
            "historicWindowRequested": "1991-2020",
            "historicMissingYears": missing_hist or [],
            "recentWindow": "2019-2024",
            "design04HistoricC": round(d04_hist, 2),
            "design04RecentC": round(d04_recent, 2),
            "design01RecentC": round(design_dry_bulb(t_recent, 1.0), 2),
            "design02RecentC": round(design_dry_bulb(t_recent, 2.0), 2),
            "nHistoricObservations": len(t_hist),
            "nRecentObservations": len(t_recent),
            "cddPerYearC": round(cdd, 1),
            "cddBaseC": 18.3,
            "daysDroppedSparse": len(dropped),
            "hoursAbovePerYear": {
                "35": round(hours_above(t_recent, 35) / n_recent_years, 1),
                "40": round(hours_above(t_recent, 40) / n_recent_years, 1),
                "45": round(hours_above(t_recent, 45) / n_recent_years, 1),
            },
            "coverageWorstPct": min(
                (v["coverage_pct"] for k, v in cov_recent.items() if isinstance(k, int)), default=0
            ),
        },
        "fortyguard": {
            "month": MONTH, "granularityM": meta["granularity"], "boxKm": meta["box_km"],
            "filterType": meta["filter_type"], "nTiles": len(rows),
            "activityId": meta["activity_id"], "retrievedUtc": meta["retrieved_utc"],
            "stationTile": {
                "lat": station_tile[0], "lon": station_tile[1], "avgC": station_tile[2],
                "minC": station_tile[3], "maxC": station_tile[4],
            },
            "stationTileDistanceM": round(dist),
            "peakOffsetC": {
                "min": q(offsets, 0.0), "p1": q(offsets, 0.01), "p25": q(offsets, 0.25),
                "median": q(offsets, 0.5), "p75": q(offsets, 0.75), "p99": q(offsets, 0.99),
                "max": q(offsets, 1.0),
            },
            "pctMetroHotterThanStation": round(
                100.0 * sum(1 for o in offsets if o > 0) / len(offsets), 1
            ),
        },
        "validation": {
            "noaaJuly2024MaxC": round(max(july), 2) if july else None,
            "noaaJuly2024MeanC": round(sum(july) / len(july), 2) if july else None,
            "fortyguardJuly2024MaxC": station_tile[4],
            "fortyguardMinusNoaaMaxC": round(station_tile[4] - max(july), 2) if july else None,
        },
        "parcels": parcels,
    }


def write_index(cities, order):
    """
    Generated module so the app imports exactly the metros that exist.

    `order` is the survey plan's order - largest urban footprint first - so the
    interface never has to guess how to rank them, and a metro added later slots
    into the right place without anyone editing a list.
    """
    ranked = [c for c in order if c in cities] + sorted(set(cities) - set(order))
    ident = lambda c: "c_" + c.replace("-", "_")
    lines = [
        "// GENERATED by scripts/seed.py - do not edit by hand.",
        "// Rerun the seed to change what is listed here.",
        "",
    ]
    for c in ranked:
        lines.append('import %s from "./%s.json";' % (ident(c), c))
    lines += ["", "/** Every surveyed metro, largest urban footprint first. */",
              "export const CITY_ORDER: string[] = ["]
    for c in ranked:
        lines.append('  "%s",' % c)
    lines += ["];", "", "export const CITY_JSON: Record<string, unknown> = {"]
    for c in ranked:
        lines.append('  "%s": %s,' % (c, ident(c)))
    lines += ["};", ""]
    with open(os.path.join(OUT_DIR, "index.ts"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    plan = json.load(open(os.path.join(ROOT, "data", "metros.json"), encoding="utf-8"))
    only = set(sys.argv[1:])
    built = []
    for entry in plan:
        city = entry["city"]
        if only and city not in only:
            continue
        try:
            rec = build(city, entry["label"])
        except Exception as exc:
            print("%-20s SKIPPED  %s" % (city, exc))
            continue
        if not rec:
            continue
        with open(os.path.join(OUT_DIR, "%s.json" % city), "w", encoding="utf-8") as fh:
            json.dump(rec, fh, separators=(",", ":"))
        built.append(city)
        temporal = rec["noaa"]["design04RecentC"] - rec["noaa"]["design04HistoricC"]
        print("%-20s %6d tiles  std %5.2f  temporal %+5.2f  spatial %+5.2f..%+5.2f  %d parcels" % (
            city, rec["fortyguard"]["nTiles"], rec["noaa"]["design04HistoricC"], temporal,
            rec["fortyguard"]["peakOffsetC"]["min"], rec["fortyguard"]["peakOffsetC"]["max"],
            len(rec["parcels"])))

    # The index must list every seeded file, including ones built on an earlier run.
    existing = sorted(
        f[:-5] for f in os.listdir(OUT_DIR)
        if f.endswith(".json") and f != "index.json"
    )
    write_index(existing, [e["city"] for e in plan])
    print("\n%d built this run, %d seeded in total" % (len(built), len(existing)))


if __name__ == "__main__":
    main()
