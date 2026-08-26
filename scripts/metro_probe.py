"""
Phase 1 validation: one metro-wide, month-long heatmap per city.

Flat pricing (4,220 credits regardless of area or time range) means the correct
strategy is always: largest useful AOI, longest allowed range, one request.

Saves a compact NDJSON of tile centroids + avg/min/max, not the raw GeoJSON.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import bbox, fc, request, poll, credits, ROOT

CITIES = {
    # name: (lat, lon, box_km) - centred to span urban core, the airport station, and fringe
    "phoenix":   (33.4500, -112.0700, 30),
    "lasvegas":  (36.1400, -115.1500, 30),
    # Bush Intercontinental sits 26 km north of downtown, so Houston needs a
    # wider box centred between them; a 30 km box centred downtown excludes
    # the station entirely and silently measures the wrong tile.
    "houston":   (29.8750,  -95.3600, 40),
    "miami":     (25.7800,  -80.2600, 30),
    "austin":    (30.2700,  -97.7300, 30),
}

MONTH = ("2024-07-01", "2024-07-31")


def run(city):
    lat, lon, km = CITIES[city]
    payload = {
        "polygon_aoi": fc(bbox(lat, lon, km * 1000)),
        "date_time": {"start_date": MONTH[0], "end_date": MONTH[1], "filter_type": 4},
        "granularity": 100,
    }
    before = credits()
    code, resp = request("POST", "/heatmap", payload, timeout=120)
    if code != 200 or resp.get("error"):
        print("%s: REJECTED http=%s %s" % (city, code, resp.get("message")))
        return
    aid = resp["data"]["activity_id"]
    print("%s: submitted %s, polling..." % (city, aid[:8]), flush=True)
    t0 = time.time()
    done = poll(aid, timeout_s=1800, interval=10)
    if done.get("status") != "Completed":
        print("%s: %s after %.0fs" % (city, done.get("status"), time.time() - t0))
        return
    feats = ((done.get("result") or {}).get("map_data") or {}).get("features") or []
    stats = (done.get("result") or {}).get("stats_data") or {}
    out_dir = os.path.join(ROOT, "data", "metro")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "%s_2024-07.ndjson" % city)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"_meta": {
            "city": city, "centre": [lat, lon], "box_km": km, "month": MONTH,
            "granularity": 100, "filter_type": 4, "activity_id": aid,
            "n_tiles": len(feats), "stats_data": stats,
            "retrieved_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }}) + "\n")
        for f in feats:
            ring = f["geometry"]["coordinates"][0]
            clon = sum(c[0] for c in ring[:4]) / 4.0
            clat = sum(c[1] for c in ring[:4]) / 4.0
            p = f["properties"]
            fh.write(json.dumps([round(clat, 6), round(clon, 6),
                                 p.get("average_temperature"), p.get("min_temperature"),
                                 p.get("max_temperature")]) + "\n")
    cost = (credits() or 0) - (before or 0)
    size_mb = os.path.getsize(path) / 1e6
    print("%s: %d tiles, %.0fs, %d credits, %.1f MB -> %s" % (
        city, len(feats), time.time() - t0, cost, size_mb, os.path.basename(path)))


if __name__ == "__main__":
    for c in (sys.argv[1:] or ["phoenix"]):
        run(c)
    print("total credits used:", credits())
