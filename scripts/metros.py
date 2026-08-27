"""
Choose which places to survey, and which reference station to survey them against.

Two inputs, both authoritative and public:
  data/2024_Gaz_ua_national.txt   Census urban areas: name, land area, centroid
  data/isd-history.csv            NOAA station history: id, position, record span

Ranking is by urban land area rather than population, because this tool is about
parcels: built-up square miles is the thing we are actually covering.

The station must fall INSIDE the surveyed box. A reference station outside the
box cannot be compared against, and a nearest-tile lookup will silently match a
tile on the box edge instead - which is exactly how the first Houston survey
produced numbers measured against the wrong place.
"""

import csv
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

MIN_BOX_KM = 30
MAX_BOX_KM = 34          # ~116,000 tiles. The retrieval ceiling sits between
                         # 125,454 tiles (40 km New York, retrieved fine) and
                         # ~160,000 (40 km Atlanta/Chicago, 504 forever). Their
                         # gateway gives up at 30 s and the result, though charged,
                         # is then unreadable. 34 km keeps a margin under that.
                         # server-side, are charged, and then 504 forever: their
                         # gateway gives up at 30 s and cannot serialise 160,000
                         # tiles in that time. Verified at 40 km and 52 km.
                         # 52 km was 270,000 tiles and the status response could not
                         # be downloaded inside a sane timeout.
STATION_MARGIN_KM = 4    # keep the station clear of the box edge


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_stations():
    """First-order US stations whose record spans the historic and recent windows."""
    out = []
    with open(os.path.join(DATA, "isd-history.csv"), encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            if r["CTRY"] != "US" or not r["WBAN"] or r["WBAN"] == "99999":
                continue
            # ISD-Lite files are named USAF-WBAN-year; a station with no USAF id
            # cannot be fetched, so it is not usable as a reference station.
            if not r["USAF"] or r["USAF"] == "999999":
                continue
            if not r["BEGIN"] or not r["END"] or r["BEGIN"] > "19950101" or r["END"] < "20250101":
                continue
            try:
                lat, lon = float(r["LAT"]), float(r["LON"])
            except ValueError:
                continue
            if lat == 0 and lon == 0:
                continue
            # Contiguous US plus Alaska and Hawaii; FortyGuard is US-only.
            out.append({
                "usaf": r["USAF"], "wban": r["WBAN"],
                "name": r["STATION NAME"].strip().title(),
                "state": r["STATE"].strip(), "lat": lat, "lon": lon,
                "elev_m": float(r["ELEV(M)"]) if r["ELEV(M)"] else 0.0,
            })
    return out


def load_urban_areas():
    path = os.path.join(DATA, "2024_Gaz_ua_national.txt")
    out = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            r = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in r.items()}
            try:
                out.append({
                    "geoid": r["GEOID"],
                    "name": r["NAME"].replace(" Urban Area", ""),
                    "sq_mi": float(r["ALAND_SQMI"]),
                    "lat": float(r["INTPTLAT"]),
                    "lon": float(r["INTPTLONG"]),
                })
            except (ValueError, KeyError):
                continue
    out.sort(key=lambda u: -u["sq_mi"])
    return out


def slug(name):
    s = name.split(",")[0].split("--")[0].lower()
    return "".join(ch for ch in s if ch.isalnum() or ch == "-").strip("-") or "area"


MILITARY = ("afb", "air force", " nas", "naval", "air reserve", "army", "marine", "coast guard")


def station_rank(station, urban):
    """
    How likely this station is to be the one design conditions are published for.
    Higher is better; the caller subtracts a distance penalty.
    """
    name = station["name"].lower()
    city_words = [
        w for w in urban["name"].split(",")[0].replace("--", " ").replace("-", " ").lower().split()
        if len(w) > 3
    ]

    score = 0.0
    if "international" in name or "intl" in name:
        score += 3.0
    if any(w in name for w in city_words):
        score += 2.5
    if any(m in name for m in MILITARY):
        score -= 3.0
    # "Downtown", "Executive", "Municipal" and "Field" are secondary fields in a
    # metro that also has a primary international airport.
    if any(w in name for w in ("downtown", "executive", "municipal", "muni")):
        score -= 1.5
    return score


def box_for(urban, station):
    """
    Smallest box that covers the urban core and contains the station, within limits.
    Returns (centre_lat, centre_lon, side_km) or None when the station is too far.
    """
    # Centre midway between the urban centroid and the station so both sit inside.
    c_lat = (urban["lat"] + station["lat"]) / 2.0
    c_lon = (urban["lon"] + station["lon"]) / 2.0

    # Half-extent needed to hold the station, in km, on each axis.
    dy = abs(station["lat"] - c_lat) * 111.32
    dx = abs(station["lon"] - c_lon) * 111.32 * math.cos(math.radians(c_lat))
    need_for_station = 2 * (max(dy, dx) + STATION_MARGIN_KM)

    # Enough to cover the urban footprint if it were square.
    need_for_urban = math.sqrt(urban["sq_mi"] * 2.58999)

    side = max(MIN_BOX_KM, need_for_station, min(need_for_urban, MAX_BOX_KM))
    if side > MAX_BOX_KM:
        return None
    return c_lat, c_lon, round(side)


def build(limit):
    stations = load_stations()
    urban = load_urban_areas()

    chosen = []
    used_slugs = set()
    used_stations = set()

    for u in urban:
        if len(chosen) >= limit:
            break
        # Among stations close enough to share a box with the urban core, prefer
        # the one an engineer would actually be designing against. Published
        # design conditions are tabulated for the primary civil airport, so a
        # major international field outranks a nearer military or general
        # aviation strip even though both are valid first-order stations.
        near = sorted(stations, key=lambda s: haversine_km(u["lat"], u["lon"], s["lat"], s["lon"]))[:25]
        scored = []
        for s in near:
            if (s["usaf"], s["wban"]) in used_stations:
                continue
            box = box_for(u, s)
            if not box:
                continue
            d = haversine_km(u["lat"], u["lon"], s["lat"], s["lon"])
            scored.append((station_rank(s, u) - d / 60.0, s, box, d))
        if not scored:
            continue
        scored.sort(key=lambda t: -t[0])
        _, station, box_t, dist = scored[0]
        pick = (station, box_t, dist)

        station, (c_lat, c_lon, side), dist = pick
        name = slug(u["name"])
        if name in used_slugs:
            name = "%s-%s" % (name, u["geoid"])
        used_slugs.add(name)
        used_stations.add((station["usaf"], station["wban"]))

        chosen.append({
            "city": name,
            "label": u["name"],
            "urban_sq_mi": u["sq_mi"],
            "centre": [round(c_lat, 5), round(c_lon, 5)],
            "box_km": side,
            "station": station,
            "station_dist_km": round(dist, 1),
        })
    return chosen


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    chosen = build(limit)
    out = os.path.join(DATA, "metros.json")
    json.dump(chosen, open(out, "w", encoding="utf-8"), indent=1)
    print("%-3s %-28s %8s %6s %6s  %s" % ("#", "urban area", "sq_mi", "box", "dist", "station"))
    print("-" * 104)
    for i, c in enumerate(chosen, 1):
        print("%-3d %-28s %8.0f %5dkm %5.1f  %s (%s-%s)" % (
            i, c["label"][:28], c["urban_sq_mi"], c["box_km"], c["station_dist_km"],
            c["station"]["name"][:34], c["station"]["usaf"], c["station"]["wban"]))
    print("\n%d surveys -> %d credits (%.1f%% of 1,928,260 remaining)" % (
        len(chosen), len(chosen) * 4220, 100.0 * len(chosen) * 4220 / 1_928_260))
    tiles = sum((c["box_km"] * 1000 / 100) ** 2 for c in chosen)
    print("~%.1fM tiles total, ~%.0f MB of rasters" % (tiles / 1e6, tiles * 2 / 1e6))
