"""
Sanity-check every seeded metro.

At five metros the numbers could be read by eye. At a hundred and fifty they
cannot, so the things that would previously have been caught by looking are
checked here instead. Anything that fails is a metro that should not ship.

  python scripts/validate.py            # check everything seeded
  python scripts/validate.py --strict   # exit non-zero if anything fails
"""

import array
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITIES = os.path.join(ROOT, "src", "data", "cities")
RASTERS = os.path.join(ROOT, "public", "rasters")

# Plausible bounds for a US first-order station. Outside these, something is
# wrong with the station match or the parsing, not with the climate.
DESIGN_MIN_C, DESIGN_MAX_C = 20.0, 52.0
TEMPORAL_MIN_C, TEMPORAL_MAX_C = -2.0, 5.0
# Judged on p1..p99, not min/max: a coastal survey's extremes sit on the
# shoreline or in open water. The Bay Area genuinely spans ~21 C between
# Emeryville on the bay and Saranap inland, so the bound is generous.
MAX_SPATIAL_SPAN_C = 26.0
MIN_NOAA_COVERAGE_PCT = 85.0
MAX_STATION_TILE_M = 250
# Beyond this the model and the observations disagree so much at the station
# that the spatial offset should be treated with caution. Not fatal - it is
# reported in the interface - but worth surfacing here.
MODEL_DISAGREEMENT_WARN_C = 5.0


def check(city):
    """Return (errors, warnings) for one seeded metro."""
    errs, warns = [], []
    path = os.path.join(CITIES, "%s.json" % city)
    rec = json.load(open(path, encoding="utf-8"))

    n = rec["noaa"]
    fg = rec["fortyguard"]
    val = rec["validation"]

    # --- the design condition itself -----------------------------------------
    for key in ("design04HistoricC", "design04RecentC"):
        v = n[key]
        if not (DESIGN_MIN_C <= v <= DESIGN_MAX_C):
            errs.append("%s = %.2f C is outside %g..%g" % (key, v, DESIGN_MIN_C, DESIGN_MAX_C))

    if not (n["design04RecentC"] >= n["design01RecentC"] >= n["design02RecentC"]):
        errs.append("design percentiles out of order: 0.4%%=%.2f 1%%=%.2f 2%%=%.2f" % (
            n["design04RecentC"], n["design01RecentC"], n["design02RecentC"]))

    temporal = round(n["design04RecentC"] - n["design04HistoricC"], 2)
    if not (TEMPORAL_MIN_C <= temporal <= TEMPORAL_MAX_C):
        errs.append("temporal component %+.2f C is implausible" % temporal)

    # --- record quality -------------------------------------------------------
    if n["nRecentObservations"] < 40000:
        errs.append("only %d recent observations (expected ~52,600)" % n["nRecentObservations"])
    if n["nHistoricObservations"] < 100000:
        warns.append("historic record is short: %d observations" % n["nHistoricObservations"])
    if n["coverageWorstPct"] < MIN_NOAA_COVERAGE_PCT:
        errs.append("worst-year NOAA coverage %.1f%%" % n["coverageWorstPct"])
    if n["historicMissingYears"]:
        warns.append("historic window missing %d years (%s)" % (
            len(n["historicMissingYears"]),
            "%s-%s" % (n["historicMissingYears"][0], n["historicMissingYears"][-1])))

    # --- the survey -----------------------------------------------------------
    if fg["stationTileDistanceM"] > MAX_STATION_TILE_M:
        errs.append("station is %d m from its nearest tile - outside the surveyed box"
                    % fg["stationTileDistanceM"])
    if fg["nTiles"] < 20000:
        errs.append("only %d tiles in the survey" % fg["nTiles"])

    span = fg["peakOffsetC"]["p99"] - fg["peakOffsetC"]["p1"]
    if span > MAX_SPATIAL_SPAN_C:
        errs.append("spatial span %.2f C is implausibly wide" % span)
    if span < 0.05:
        warns.append("spatial span %.3f C is almost flat - little signal here" % span)

    disagree = val.get("fortyguardMinusNoaaMaxC")
    if disagree is None:
        warns.append("no July 2024 NOAA observations to validate against")
    elif abs(disagree) > MODEL_DISAGREEMENT_WARN_C:
        warns.append("model vs observation at the station differs by %+.2f C" % disagree)

    # --- parcels --------------------------------------------------------------
    if not rec["parcels"]:
        errs.append("no showcase parcels")
    kinds = {p["kind"] for p in rec["parcels"]}
    if len(rec["parcels"]) < 3:
        warns.append("only %d showcase parcels (%s)" % (len(rec["parcels"]), ", ".join(sorted(kinds))))
    for p in rec["parcels"]:
        if p["tileDistanceM"] > MAX_STATION_TILE_M:
            errs.append("parcel %s is %d m from its tile" % (p["id"], p["tileDistanceM"]))
        if not (0 <= p["metroPercentile"] <= 100):
            errs.append("parcel %s percentile %.1f" % (p["id"], p["metroPercentile"]))

    # --- raster agrees with the seeded tiles ---------------------------------
    h = rec.get("raster")
    if not h:
        warns.append("no raster - this metro cannot answer an address lookup")
    else:
        binpath = os.path.join(RASTERS, "%s.bin" % city)
        expected = h["width"] * h["height"] * 2
        if not os.path.exists(binpath):
            errs.append("raster file missing")
        elif os.path.getsize(binpath) != expected:
            errs.append("raster is %d bytes, header says %d" % (os.path.getsize(binpath), expected))
        else:
            g = array.array("h")
            with open(binpath, "rb") as fh:
                g.fromfile(fh, h["width"] * h["height"])

            def sample(lat, lon):
                j = int(round((lat - h["lat0"]) / h["dLat"]))
                i = int(round((lon - h["lon0"]) / h["dLon"]))
                if not (0 <= j < h["height"] and 0 <= i < h["width"]):
                    return None
                v = g[j * h["width"] + i]
                return None if v == h["noData"] else v / h["scale"]

            st = sample(rec["station"]["lat"], rec["station"]["lon"])
            if st is None:
                errs.append("raster has no value at the station")
            elif abs(st - fg["stationTile"]["maxC"]) > 0.1:
                errs.append("raster station value %.2f != seeded tile %.2f"
                            % (st, fg["stationTile"]["maxC"]))
            for p in rec["parcels"]:
                v = sample(p["lat"], p["lon"])
                if v is None:
                    errs.append("raster has no value at parcel %s" % p["id"])
                elif abs(v - p["tile"]["maxC"]) > 0.1:
                    errs.append("raster parcel %s %.2f != seeded %.2f"
                                % (p["id"], v, p["tile"]["maxC"]))
            if h["coveragePct"] < 40:
                warns.append("raster only %.1f%% covered (largely water?)" % h["coveragePct"])

    return errs, warns


def main():
    strict = "--strict" in sys.argv
    cities = sorted(
        f[:-5] for f in os.listdir(CITIES)
        if f.endswith(".json") and f != "index.json"
    )
    n_err = n_warn = 0
    failed = []
    for city in cities:
        try:
            errs, warns = check(city)
        except Exception as exc:
            print("%-22s EXCEPTION %s" % (city, exc))
            failed.append(city)
            n_err += 1
            continue
        for e in errs:
            print("%-22s ERROR   %s" % (city, e))
        for w in warns:
            print("%-22s warn    %s" % (city, w))
        n_err += len(errs)
        n_warn += len(warns)
        if errs:
            failed.append(city)

    print("\n%d metros checked, %d errors, %d warnings" % (len(cities), n_err, n_warn))
    if failed:
        print("metros with errors: %s" % ", ".join(sorted(set(failed))))
    if strict and n_err:
        sys.exit(1)


if __name__ == "__main__":
    main()
