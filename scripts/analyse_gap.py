"""
Phase 1 analysis: how far is each parcel from the reference station, measured
consistently by FortyGuard, and what does that do to the design condition?

Method (the delta / anomaly-transfer approach):
  absolute level   <- NOAA hourly observations at the reference station
  spatial offset   <- FortyGuard, station tile vs parcel tile, same request
  parcel design    =  NOAA 0.4% design dry-bulb  +  (FG parcel peak - FG station peak)

Never compares a NOAA tail statistic directly against a FortyGuard tail statistic:
the model smooths extremes, so that difference would measure the model, not the site.
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from noaa import STATIONS, load_hours, design_dry_bulb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_tiles(city, month="2024-07"):
    path = os.path.join(ROOT, "data", "metro", "%s_%s.ndjson" % (city, month))
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
    for r in rows:
        d = (r[0] - lat) ** 2 + ((r[1] - lon) * math.cos(math.radians(lat))) ** 2
        if d < bd:
            bd, best = d, r
    return best, math.sqrt(bd) * 111320


def analyse(city):
    meta, rows = load_tiles(city)
    if not rows:
        return None
    st = STATIONS[city]
    obs, cov = load_hours(city, range(2019, 2025))
    temps = [t for *_, t in obs]
    d04 = design_dry_bulb(temps, 0.4)

    station_tile, dist = nearest(rows, st["lat"], st["lon"])
    peak_offsets = sorted(r[4] - station_tile[4] for r in rows)
    night_offsets = sorted(r[3] - station_tile[3] for r in rows)
    n = len(peak_offsets)
    q = lambda a, f: a[int(f * (len(a) - 1))]

    # NOAA vs FortyGuard at the same point, same month - the commensurability check
    jul = [t for (y, m, d, h, t) in obs if y == 2024 and m == 7]
    return {
        "city": city, "station": st["name"], "n_tiles": n, "station_tile_dist_m": round(dist),
        "noaa_design_04": d04,
        "noaa_jul24": {"mean": sum(jul) / len(jul), "max": max(jul), "min": min(jul)},
        "fg_station_tile": {"avg": station_tile[2], "min": station_tile[3], "max": station_tile[4]},
        "peak_offset": {"min": peak_offsets[0], "p1": q(peak_offsets, .01), "median": q(peak_offsets, .5),
                        "p99": q(peak_offsets, .99), "max": peak_offsets[-1],
                        "span": peak_offsets[-1] - peak_offsets[0],
                        "pct_hotter_than_station": 100.0 * sum(1 for o in peak_offsets if o > 0) / n},
        "night_offset": {"min": night_offsets[0], "max": night_offsets[-1],
                         "span": night_offsets[-1] - night_offsets[0]},
    }


if __name__ == "__main__":
    cities = sys.argv[1:] or list(STATIONS)
    out = []
    for c in cities:
        a = analyse(c)
        if a:
            out.append(a)
    print("%-10s %6s %6s %7s %7s %7s %7s %7s %7s" % (
        "city", "NOAA", "FGpk", "tailGAP", "offMIN", "offMAX", "PEAKspan", "NGTspan", "%hotter"))
    print("-" * 82)
    for a in out:
        print("%-10s %6.2f %6.2f %7.2f %+7.2f %+7.2f %8.2f %8.2f %7.1f" % (
            a["city"], a["noaa_design_04"], a["fg_station_tile"]["max"],
            a["fg_station_tile"]["max"] - a["noaa_jul24"]["max"],
            a["peak_offset"]["min"], a["peak_offset"]["max"],
            a["peak_offset"]["span"], a["night_offset"]["span"],
            a["peak_offset"]["pct_hotter_than_station"]))
    print("\nNOAA    = ASHRAE-equivalent 0.4% annual design dry-bulb, 2019-2024 hourly obs")
    print("FGpk    = FortyGuard monthly max at the station tile, July 2024")
    print("tailGAP = FortyGuard monthly max MINUS NOAA observed July max at the same point")
    print("          (this is model smoothing, NOT a property of any location)")
    print("PEAKspan/NGTspan = metro-wide span of tile offsets vs the station tile")
    with open(os.path.join(ROOT, "data", "metro", "gap_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
