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
# Retrieval ceiling, learned the expensive way. A survey completes and is charged
# server-side, then the result has to come back through their gateway, which gives
# up at 30 s. Measured: 52 km (270,000 tiles) and 40 km (~160,000) 504 forever and
# are unrecoverable; 40 km New York at 125,454 tiles came back fine; 34 km
# (~116,000) succeeded 142 times out of 148; 30 km (~90,000) has never failed.
# 34 is therefore marginal - the six failures were re-run at 30.
MAX_BOX_KM = 34
STATION_MARGIN_KM = 4    # keep the station clear of the box edge


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


# FortyGuard returns an empty - but still billed - result outside the lower 48.
# Verified by surveying Honolulu and Anchorage: Completed, zero tiles, charged.
CONUS_LAT = (24.4, 49.5)
CONUS_LON = (-125.0, -66.9)


def in_contiguous_us(lat, lon):
    return CONUS_LAT[0] <= lat <= CONUS_LAT[1] and CONUS_LON[0] <= lon <= CONUS_LON[1]


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
            if not r["BEGIN"] or not r["END"] or r["END"] < "20250101":
                continue
            # A station that opened later still gives a long historic window;
            # Austin-Bergstrom opened in 1999 and would otherwise be dropped,
            # leaving Austin matched to a field 77 km away. The seed records the
            # window it actually had data for, so this is surfaced, not hidden.
            if r["BEGIN"] > "20000101":
                continue
            try:
                lat, lon = float(r["LAT"]), float(r["LON"])
            except ValueError:
                continue
            if lat == 0 and lon == 0:
                continue
            if not in_contiguous_us(lat, lon):
                continue
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
    out = [u for u in out if in_contiguous_us(u["lat"], u["lon"])]
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
    if side <= MAX_BOX_KM:
        return c_lat, c_lon, round(side)

    # Too far apart to hold both. Miami--Fort Lauderdale is 1,244 sq mi and its
    # centroid sits 46 km from Miami International; no box spans both. Centre on
    # the station instead - it must be inside for any comparison to mean
    # anything - and cover the core around it. Coverage of the wider sprawl is
    # reduced, which is honest, where dropping the metro entirely is not.
    if station_is_reachable(urban, station):
        return station["lat"], station["lon"], MAX_BOX_KM
    return None


def station_is_reachable(urban, station):
    """
    Is a station-centred box still a survey OF this urban area?

    Only when the urban area's own reach plus the box's half-extent gets to the
    station. Miami--Fort Lauderdale is 1,244 sq mi, so a box on Miami
    International covers a large part of it and qualifies. Concord--Walnut Creek
    is small and 40 km from SFO, so a box there would survey San Francisco and
    label it Concord - that does not qualify.
    """
    d = haversine_km(urban["lat"], urban["lon"], station["lat"], station["lon"])
    urban_radius_km = math.sqrt(urban["sq_mi"] * 2.58999) / 2.0
    return d <= urban_radius_km + MAX_BOX_KM / 2.0 + 5.0


def build(limit, existing=None):
    """
    Choose metros to survey.

    `existing` is a plan already surveyed. Its entries are kept exactly as they
    are and their stations reserved, so re-running to add coverage never
    reshuffles a metro that has already been paid for.
    """
    stations = load_stations()
    urban = load_urban_areas()

    chosen = list(existing or [])
    used_slugs = {e["city"] for e in chosen}
    used_stations = {(e["station"]["usaf"], e["station"]["wban"]) for e in chosen}
    covered_geoids = {e.get("geoid") for e in chosen if e.get("geoid")}

    for u in urban:
        if len(chosen) >= limit:
            break
        if u["geoid"] in covered_geoids or slug(u["name"]) in used_slugs:
            continue
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
            "geoid": u["geoid"],
            "label": u["name"],
            "urban_sq_mi": u["sq_mi"],
            "centre": [round(c_lat, 5), round(c_lon, 5)],
            "box_km": side,
            "station": station,
            "station_dist_km": round(dist, 1),
        })
    return chosen


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--supplement"]
    supplement = "--supplement" in sys.argv
    limit = int(args[0]) if args else 60
    out = os.path.join(DATA, "metros.json")

    existing = None
    if supplement and os.path.exists(out):
        existing = json.load(open(out, encoding="utf-8"))
        print("keeping %d already-planned metros, topping up to %d\n" % (len(existing), limit))

    chosen = build(limit, existing)
    if existing:
        added = [c for c in chosen if c["city"] not in {e["city"] for e in existing}]
        print("ADDED %d metros:" % len(added))
        for c in added:
            print("  %-20s %-32s %2dkm  %s" % (
                c["city"], c["label"][:32], c["box_km"], c["station"]["name"][:34]))
        print()
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
