"""
Build the seeded dataset the application ships with.

Flat-rate credits mean one request already covers a whole metropolitan area for
a whole month, so the showcase cities are pre-computed once and committed. The
demo then loads instantly and cannot fail in front of a judge because an
upstream API timed out.

Reads:   data/metro/<city>_2024-07.ndjson   (FortyGuard tiles)
         data/noaa/*.txt                    (NOAA ISD-Lite, cached)
Writes:  src/data/cities/<city>.json

Every figure written here is reproducible from those two inputs by rerunning
this script; nothing is hand-entered.
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

HISTORIC = range(1991, 2021)
RECENT = range(2019, 2025)
MONTH = "2024-07"

CITY_LABEL = {
    "houston": "Houston, TX",
    "phoenix": "Phoenix, AZ",
    "lasvegas": "Las Vegas, NV",
    "austin": "Austin, TX",
    "miami": "Miami, FL",
}

# Real addresses inside each queried box, chosen to span land-cover contrast.
# Resolved through the US Census geocoder at build time; nothing is hand-placed.
CANDIDATE_PARCELS = {
    # Verified against the July 2024 tile field: these three span the range,
    # including a parcel COOLER than the station. The standard is wrong in both
    # directions and the example set says so.
    "houston": [
        ("5100 Bellaire Blvd, Bellaire, TX 77401", "Bellaire Boulevard retail corridor", "retail"),
        ("16000 Kennedy Blvd, Houston, TX 77032", "Airport logistics park", "logistics"),
        ("1200 Smith St, Houston, TX 77002", "Downtown office tower", "office"),
    ],
    "phoenix": [
        ("100 N 15th Ave, Phoenix, AZ 85007", "State government campus", "institutional"),
        ("625 E Adams St, Phoenix, AZ 85004", "Downtown warehouse district", "industrial"),
        ("625 N Galvin Pkwy, Phoenix, AZ 85008", "Papago Park edge", "parkland"),
    ],
    "lasvegas": [
        ("3799 S Las Vegas Blvd, Las Vegas, NV 89109", "Strip resort corridor", "hospitality"),
        ("495 S Main St, Las Vegas, NV 89101", "Downtown civic core", "institutional"),
        ("6375 W Charleston Blvd, Las Vegas, NV 89146", "West valley commercial", "commercial"),
    ],
    "austin": [
        ("301 W 2nd St, Austin, TX 78701", "Downtown civic core", "institutional"),
        ("2100 Barton Springs Rd, Austin, TX 78746", "Zilker parkland", "parkland"),
        ("6800 Burleson Rd, Austin, TX 78744", "Southeast industrial", "industrial"),
    ],
    "miami": [
        ("174 E Flagler St, Miami, FL 33131", "Downtown core", "office"),
        ("3251 S Miami Ave, Miami, FL 33129", "Vizcaya waterfront", "parkland"),
        ("7300 NW 35th Ter, Miami, FL 33122", "Airport West industrial", "industrial"),
    ],
}


def geocode(address):
    q = urllib.parse.urlencode(
        {"address": address, "benchmark": "Public_AR_Current", "format": "json"}
    )
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + q
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = json.load(resp)
    matches = data.get("result", {}).get("addressMatches", [])
    if not matches:
        return None
    m = matches[0]
    return {
        "matched": m["matchedAddress"],
        "lat": m["coordinates"]["y"],
        "lon": m["coordinates"]["x"],
    }


def load_tiles(city):
    path = os.path.join(ROOT, "data", "metro", "%s_%s.ndjson" % (city, MONTH))
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


def downsample(rows, target=4000):
    """Even spatial thinning for the locator map. Deterministic, no sampling bias."""
    step = max(1, len(rows) // target)
    return [[round(r[0], 5), round(r[1], 5), round(r[4], 2)] for r in rows[::step]]


def build(city):
    meta, rows = load_tiles(city)
    if not rows:
        print("%s: no metro file, skipped" % city)
        return None

    st = STATIONS[city]

    station_tile, dist = nearest(rows, st["lat"], st["lon"])
    if dist > 200:
        raise ValueError(
            "%s: station is %.0f m from the nearest tile - it is outside the queried "
            "area and no offset can be computed. Fix the AOI in metro_probe.py." % (city, dist)
        )

    obs_hist, cov_hist = load_hours(city, HISTORIC)
    obs_recent, cov_recent = load_hours(city, RECENT)
    t_hist = [t for *_, t in obs_hist]
    t_recent = [t for *_, t in obs_recent]

    d04_hist = design_dry_bulb(t_hist, 0.4)
    d04_recent = design_dry_bulb(t_recent, 0.4)

    dm, dropped = daily_means_from_hours(obs_recent)
    n_years = len(set(y for (y, _m, _d) in dm))
    cdd = cooling_degree_days(dm.values()) / n_years

    july_recent = [t for (y, m, _d, _h, t) in obs_recent if y == 2024 and m == 7]

    peaks_sorted = sorted(r[4] for r in rows)
    offsets = sorted(r[4] - station_tile[4] for r in rows)
    q = lambda a, f: round(a[int(f * (len(a) - 1))], 3)

    missing_hist = cov_hist.get("_missing_years")
    hist_years = sorted(y for y in cov_hist if isinstance(y, int) and cov_hist[y]["observations"] > 0)

    parcels = []
    for address, label, kind in CANDIDATE_PARCELS.get(city, []):
        g = geocode(address)
        if not g:
            print("   ! geocode failed: %s" % address)
            continue
        tile, tdist = nearest(rows, g["lat"], g["lon"])
        if tdist > 250:
            print("   ! %s is %.0f m from the nearest tile, outside the AOI - skipped" % (label, tdist))
            continue
        parcels.append({
            "id": "%s-%s" % (city, kind),
            "label": label,
            "kind": kind,
            "address": g["matched"],
            "lat": round(g["lat"], 6),
            "lon": round(g["lon"], 6),
            "tileDistanceM": round(tdist),
            "tile": {"avgC": tile[2], "minC": tile[3], "maxC": tile[4]},
            "spatialOffsetC": round(tile[4] - station_tile[4], 2),
            "metroPercentile": pct_rank(peaks_sorted, tile[4]),
        })

    record = {
        "city": city,
        "label": CITY_LABEL[city],
        "station": {
            "name": st["name"],
            "usaf": st["usaf"],
            "wban": st["wban"],
            "lat": st["lat"],
            "lon": st["lon"],
            "elevationM": st["elev_m"],
        },
        "noaa": {
            "historicWindow": "%d-%d" % (min(hist_years), max(hist_years)),
            "historicWindowRequested": "1991-2020",
            "historicMissingYears": missing_hist or [],
            "recentWindow": "2019-2024",
            "design04HistoricC": round(d04_hist.tempC if hasattr(d04_hist, "tempC") else d04_hist, 2),
            "design04RecentC": round(d04_recent, 2),
            "design01RecentC": round(design_dry_bulb(t_recent, 1.0), 2),
            "design02RecentC": round(design_dry_bulb(t_recent, 2.0), 2),
            "nHistoricObservations": len(t_hist),
            "nRecentObservations": len(t_recent),
            "cddPerYearC": round(cdd, 1),
            "cddBaseC": 18.3,
            "daysDroppedSparse": len(dropped),
            "hoursAbovePerYear": {
                "35": round(hours_above(t_recent, 35) / 6, 1),
                "40": round(hours_above(t_recent, 40) / 6, 1),
                "45": round(hours_above(t_recent, 45) / 6, 1),
            },
            "coverageWorstPct": min(
                v["coverage_pct"] for k, v in cov_recent.items() if isinstance(k, int)
            ),
        },
        "fortyguard": {
            "month": MONTH,
            "granularityM": meta["granularity"],
            "boxKm": meta["box_km"],
            "filterType": meta["filter_type"],
            "nTiles": len(rows),
            "activityId": meta["activity_id"],
            "retrievedUtc": meta["retrieved_utc"],
            "stationTile": {
                "lat": station_tile[0], "lon": station_tile[1],
                "avgC": station_tile[2], "minC": station_tile[3], "maxC": station_tile[4],
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
            "noaaJuly2024MaxC": round(max(july_recent), 2) if july_recent else None,
            "noaaJuly2024MeanC": round(sum(july_recent) / len(july_recent), 2) if july_recent else None,
            "fortyguardJuly2024MaxC": station_tile[4],
            "fortyguardMinusNoaaMaxC": round(station_tile[4] - max(july_recent), 2) if july_recent else None,
        },
        "parcels": parcels,
        "grid": downsample(rows),
    }
    return record


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    cities = sys.argv[1:] or list(CITY_LABEL)
    index = []
    for city in cities:
        rec = build(city)
        if not rec:
            continue
        path = os.path.join(OUT_DIR, "%s.json" % city)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, separators=(",", ":"))
        size = os.path.getsize(path) / 1024
        print("%-10s %d tiles, %d parcels, station tile %d m away, %.0f KB" % (
            city, rec["fortyguard"]["nTiles"], len(rec["parcels"]),
            rec["fortyguard"]["stationTileDistanceM"], size))
        index.append({
            "city": city, "label": rec["label"],
            "station": rec["station"]["name"],
            "combinedMaxC": round(
                rec["noaa"]["design04RecentC"] - rec["noaa"]["design04HistoricC"]
                + rec["fortyguard"]["peakOffsetC"]["max"], 2),
            "parcels": len(rec["parcels"]),
        })
    if index:
        with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as fh:
            json.dump(index, fh, indent=2)


if __name__ == "__main__":
    main()
