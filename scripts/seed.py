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
import array
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

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
RASTER_DIR = os.path.join(ROOT, "public", "rasters")
HEADER_DIR = os.path.join(ROOT, "data", "rasters")

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
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.load(resp)
    except Exception:
        return None
    matches = data.get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    m = matches[0]
    return {"matched": m["matchedAddress"], "lat": m["coordinates"]["y"], "lon": m["coordinates"]["x"]}


def place_name(lat, lon):
    """
    The Census place containing a point, and whether that point is on land.

    A survey over a bay carries real temperatures for the water, and those are
    the coldest cells in it. San Francisco's coldest cell sits in the Bay inside
    Emeryville's city limits, so a place name alone does not prove land - the
    census block's AREALAND does. Returns (name, is_land); name is None when the
    point is not in any named place.
    """
    q = urllib.parse.urlencode({
        "x": lon, "y": lat, "benchmark": "Public_AR_Current",
        "vintage": "Current_Current", "format": "json",
    })
    url = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?" + q
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            g = json.load(resp).get("result", {}).get("geographies", {})
    except Exception:
        return None, True
    blocks = g.get("2020 Census Blocks") or g.get("Census Blocks") or []
    land = True
    if blocks:
        try:
            land = float(blocks[0].get("AREALAND") or 0) > 0
        except (TypeError, ValueError):
            land = True
    for key in ("Incorporated Places", "Census Designated Places", "County Subdivisions", "Counties"):
        entries = g.get(key) or []
        if entries and entries[0].get("NAME"):
            return entries[0]["NAME"], land
    return None, land


def load_raster(city):
    """
    The raster is the single source of spatial truth.

    The browser reads it for an address lookup, so the seed must read it too.
    Reading raw tiles here instead produced reports whose station temperature
    disagreed with the value the same page computed for a looked-up address,
    because a raster cell can hold more than one tile.
    """
    hp = os.path.join(HEADER_DIR, "%s.json" % city)
    bp = os.path.join(RASTER_DIR, "%s.bin" % city)
    if not (os.path.exists(hp) and os.path.exists(bp)):
        return None, None
    h = json.load(open(hp, encoding="utf-8"))
    g = array.array("h")
    with open(bp, "rb") as fh:
        g.fromfile(fh, h["width"] * h["height"])
    return h, g


def raster_sample(h, g, lat, lon):
    j = int(round((lat - h["lat0"]) / h["dLat"]))
    i = int(round((lon - h["lon0"]) / h["dLon"]))
    if not (0 <= j < h["height"] and 0 <= i < h["width"]):
        return None
    v = g[j * h["width"] + i]
    return None if v == h["noData"] else v / h["scale"]


def raster_cell_centre(h, lat, lon):
    j = int(round((lat - h["lat0"]) / h["dLat"]))
    i = int(round((lon - h["lon0"]) / h["dLon"]))
    return h["lat0"] + j * h["dLat"], h["lon0"] + i * h["dLon"]


def raster_values(h, g):
    """Every cell that carries a measurement, as (lat, lon, degC)."""
    out = []
    W, H, nd, sc = h["width"], h["height"], h["noData"], h["scale"]
    for j in range(H):
        base = j * W
        lat = h["lat0"] + j * h["dLat"]
        for i in range(W):
            v = g[base + i]
            if v != nd:
                out.append((lat, h["lon0"] + i * h["dLon"], v / sc))
    return out


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


def derived_parcels(city, cells, station_peak, peaks_sorted):
    """
    Showcase parcels taken from the survey itself: hottest, median and coolest.

    Walks inward from each extreme until the Census places the point in a named
    place. Over open water there is no place, and that is the point: a coastal
    survey's coldest cells sit in the bay - San Francisco's minimum is in San
    Francisco Bay, Tampa's in Tampa Bay - and quoting those as parcels would be
    quoting somewhere nobody can build.
    """
    by_peak = sorted(cells, key=lambda c: c[2])
    n = len(by_peak)
    # p90/p50/p10 rather than the absolute extremes. A coastal survey's tail is
    # marine air on the shoreline, which says more about the sea breeze than
    # about how the parcel was built.
    hi = int(0.90 * (n - 1))
    lo = int(0.10 * (n - 1))
    mid = n // 2

    def around(idx):
        return by_peak[max(0, idx - 150): idx + 150][::-1]

    plans = [
        (around(hi), "Hot parcel", "hottest"),
        (around(mid), "Median parcel", "median"),
        (around(lo), "Cool parcel", "coolest"),
    ]
    out = []
    used = set()
    for candidates, label, kind in plans:
        chosen = None
        for cell in candidates[:60]:
            key = (round(cell[0], 3), round(cell[1], 3))
            if key in used:
                continue
            name, is_land = place_name(cell[0], cell[1])
            if name and is_land:
                chosen = (cell, name)
                used.add(key)
                break
        if not chosen:
            continue
        cell, name = chosen
        out.append({
            "id": "%s-%s" % (city, kind),
            "label": "%s — %s" % (label, name),
            "kind": kind,
            "address": "%s · %.5f, %.5f" % (name, cell[0], cell[1]),
            "lat": round(cell[0], 6), "lon": round(cell[1], 6),
            "tileDistanceM": 0,
            "tile": {"avgC": None, "minC": None, "maxC": cell[2]},
            "spatialOffsetC": round(cell[2] - station_peak, 2),
            "metroPercentile": pct_rank(peaks_sorted, cell[2]),
        })
    return out


def build(city, label):
    meta, rows = load_tiles(city)
    if not rows:
        return None

    st = STATIONS[city]

    rh, rg = load_raster(city)
    if not rh:
        raise ValueError("%s: no raster - run scripts/rasterize.py first" % city)
    station_peak = raster_sample(rh, rg, st["lat"], st["lon"])
    if station_peak is None:
        raise ValueError("%s: the raster has no value at the reference station" % city)
    c_lat, c_lon = raster_cell_centre(rh, st["lat"], st["lon"])
    dist = math.hypot((st["lat"] - c_lat) * 111320,
                      (st["lon"] - c_lon) * 111320 * math.cos(math.radians(st["lat"])))
    cells = raster_values(rh, rg)

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

    peaks_sorted = sorted(c[2] for c in cells)
    offsets = sorted(v - station_peak for v in peaks_sorted)
    q = lambda a, f: round(a[int(f * (len(a) - 1))], 3)

    hist_years = sorted(y for y in cov_hist if isinstance(y, int) and cov_hist[y]["observations"] > 0)
    missing_hist = cov_hist.get("_missing_years")

    parcels = []
    for address, plabel, kind in CURATED_PARCELS.get(city, []):
        g = geocode(address)
        if not g:
            continue
        v = raster_sample(rh, rg, g["lat"], g["lon"])
        if v is None:
            continue
        pc_lat, pc_lon = raster_cell_centre(rh, g["lat"], g["lon"])
        tdist = math.hypot((g["lat"] - pc_lat) * 111320,
                           (g["lon"] - pc_lon) * 111320 * math.cos(math.radians(g["lat"])))
        parcels.append({
            "id": "%s-%s" % (city, kind), "label": plabel, "kind": kind,
            "address": g["matched"], "lat": round(g["lat"], 6), "lon": round(g["lon"], 6),
            "tileDistanceM": round(tdist),
            "tile": {"avgC": None, "minC": None, "maxC": v},
            "spatialOffsetC": round(v - station_peak, 2),
            "metroPercentile": pct_rank(peaks_sorted, v),
        })
    if len(parcels) < 3:
        have = {p["kind"] for p in parcels}
        for extra in derived_parcels(city, cells, station_peak, peaks_sorted):
            if extra["kind"] not in have and len(parcels) < 3:
                parcels.append(extra)

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
                "lat": round(c_lat, 6), "lon": round(c_lon, 6),
                "avgC": None, "minC": None, "maxC": station_peak,
            },
            "stationTileDistanceM": round(dist),
            # p1/p99 are what the interface quotes: a coastal survey's absolute
            # extremes sit in open water, so min/max would describe the sea.
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
            "fortyguardJuly2024MaxC": station_peak,
            "fortyguardMinusNoaaMaxC": round(station_peak - max(july), 2) if july else None,
        },
        "parcels": parcels,
        "raster": rh,
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


def seed_one(entry):
    city = entry["city"]
    try:
        rec = build(city, entry["label"])
    except Exception as exc:
        return city, None, str(exc)
    if not rec:
        return city, None, "no survey on disk"
    # Write through a temp file and rename. Seeding runs concurrently and a dev
    # server watches this directory; writing in place let a reader observe a
    # half-written file and fail to parse it.
    final = os.path.join(OUT_DIR, "%s.json" % city)
    tmp = final + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, separators=(",", ":"))
    os.replace(tmp, final)
    return city, rec, None


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    plan = json.load(open(os.path.join(ROOT, "data", "metros.json"), encoding="utf-8"))
    only = set(sys.argv[1:])
    todo = [e for e in plan if not only or e["city"] in only]
    print("seeding %d metros" % len(todo), flush=True)

    built = []
    lock = threading.Lock()
    with ThreadPoolExecutor(max_workers=8) as pool:
        for city, rec, err in pool.map(seed_one, todo):
            with lock:
                if err:
                    print("%-20s SKIPPED  %s" % (city, err), flush=True)
                    continue
                built.append(city)
                temporal = rec["noaa"]["design04RecentC"] - rec["noaa"]["design04HistoricC"]
                print("%-20s %6d tiles  std %5.2f  temporal %+5.2f  spatial %+5.2f..%+5.2f  %d parcels" % (
                    city, rec["fortyguard"]["nTiles"], rec["noaa"]["design04HistoricC"], temporal,
                    rec["fortyguard"]["peakOffsetC"]["min"], rec["fortyguard"]["peakOffsetC"]["max"],
                    len(rec["parcels"])), flush=True)

    # The index must list every seeded file, including ones built on an earlier run.
    existing = sorted(
        f[:-5] for f in os.listdir(OUT_DIR)
        if f.endswith(".json") and f != "index.json"
    )
    write_index(existing, [e["city"] for e in plan])
    print("\n%d built this run, %d seeded in total" % (len(built), len(existing)))


if __name__ == "__main__":
    main()
