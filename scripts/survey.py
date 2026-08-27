"""
Survey many metros against the FortyGuard API, concurrently.

The API is asynchronous - submit returns an activity_id and the result arrives
through polling - so many surveys can be in flight at once. Wall-clock for the
whole run is then roughly the slowest single survey rather than the sum.

Credits are charged per completed request (4,220 flat, regardless of area or
time range), so a survey already on disk is never re-requested.

  python scripts/survey.py            # every metro in data/metros.json
  python scripts/survey.py --limit 6  # the largest 6, for a throughput check
  python scripts/survey.py houston phoenix
"""

import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import bbox, credits, fc, poll, request, ROOT  # noqa: E402

METRO_DIR = os.path.join(ROOT, "data", "metro")
MONTH = ("2024-07-01", "2024-07-31")
MONTH_TAG = "2024-07"

# The API tolerates several in-flight activities; this is deliberately modest so
# a batch cannot look like abuse, and so a 429 does not cascade.
CONCURRENCY = 5

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def out_path(city):
    return os.path.join(METRO_DIR, "%s_%s.ndjson" % (city, MONTH_TAG))


def ticket_path(city):
    return os.path.join(METRO_DIR, "%s_%s.activity" % (city, MONTH_TAG))


def survey(entry):
    city = entry["city"]
    path = out_path(city)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return {"city": city, "status": "cached", "credits": 0}

    t0 = time.time()
    ticket = ticket_path(city)
    aid = None
    charged = 0

    # A submitted activity has already been paid for. If a previous run was
    # killed after submitting, resume polling that activity rather than paying
    # for the same survey twice - results stay retrievable by id.
    if os.path.exists(ticket):
        aid = open(ticket, encoding="utf-8").read().strip() or None
        if aid:
            log("  %-22s resuming %s" % (city, aid[:8]))

    if not aid:
        lat, lon = entry["centre"]
        payload = {
            "polygon_aoi": fc(bbox(lat, lon, entry["box_km"] * 1000)),
            "date_time": {"start_date": MONTH[0], "end_date": MONTH[1], "filter_type": 4},
            "granularity": 100,
        }
        code, resp = request("POST", "/heatmap", payload, timeout=180)
        if code != 200 or resp.get("error"):
            log("  %-22s REJECTED http=%s %s" % (city, code, str(resp.get("message"))[:70]))
            return {"city": city, "status": "rejected", "http": code, "credits": 0}
        aid = resp["data"]["activity_id"]
        charged = 4220
        # Written before polling, so the id survives a crash or a kill.
        os.makedirs(METRO_DIR, exist_ok=True)
        with open(ticket, "w", encoding="utf-8") as fh:
            fh.write(aid)
        log("  %-22s submitted %s (%d km)" % (city, aid[:8], entry["box_km"]))

    done = poll(aid, timeout_s=5400, interval=15, read_timeout=900)
    status = done.get("status")
    if status != "Completed":
        log("  %-22s %s after %.0fs" % (city, status, time.time() - t0))
        return {"city": city, "status": str(status), "credits": charged}

    feats = ((done.get("result") or {}).get("map_data") or {}).get("features") or []
    if not feats:
        # Completed but empty is what an out-of-coverage area looks like, and it
        # is still charged. Recorded rather than written as if it were data.
        log("  %-22s EMPTY (charged, no tiles)" % city)
        return {"city": city, "status": "empty", "credits": charged}

    stats = (done.get("result") or {}).get("stats_data") or {}
    os.makedirs(METRO_DIR, exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"_meta": {
            "city": city, "label": entry["label"],
            "centre": entry["centre"], "box_km": entry["box_km"],
            "month": list(MONTH), "granularity": 100, "filter_type": 4,
            "activity_id": aid, "n_tiles": len(feats), "stats_data": stats,
            "station": entry["station"],
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
    os.replace(tmp, path)  # only a complete file ever appears at the real path
    if os.path.exists(ticket):
        os.remove(ticket)   # survey banked; the ticket is spent

    elapsed = time.time() - t0
    log("  %-22s DONE %6d tiles  %5.0fs  %.1f MB" % (
        city, len(feats), elapsed, os.path.getsize(path) / 1e6))
    return {"city": city, "status": "ok", "tiles": len(feats), "seconds": elapsed, "credits": charged}


def main():
    args = sys.argv[1:]
    metros = json.load(open(os.path.join(ROOT, "data", "metros.json"), encoding="utf-8"))

    limit = None
    names = []
    i = 0
    while i < len(args):
        if args[i] == "--limit":
            limit = int(args[i + 1]); i += 2
        else:
            names.append(args[i]); i += 1
    if names:
        metros = [m for m in metros if m["city"] in names]
    if limit:
        metros = metros[:limit]

    todo = [m for m in metros if not (os.path.exists(out_path(m["city"]))
                                      and os.path.getsize(out_path(m["city"])) > 1000)]
    log("%d metros requested, %d already on disk, %d to fetch (~%d credits)" % (
        len(metros), len(metros) - len(todo), len(todo), len(todo) * 4220))
    if not todo:
        return

    before = credits()
    t0 = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(survey, m): m for m in todo}
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as exc:
                city = futures[fut]["city"]
                log("  %-22s ERROR %s" % (city, exc))
                results.append({"city": city, "status": "error", "credits": 0})

    ok = [r for r in results if r["status"] == "ok"]
    elapsed = time.time() - t0
    log("\n%d/%d succeeded in %.0f min (%.0f s/survey wall-clock at %dx)" % (
        len(ok), len(todo), elapsed / 60, elapsed / max(1, len(todo)), CONCURRENCY))
    if ok:
        log("median survey %.0fs, slowest %.0fs" % (
            sorted(r["seconds"] for r in ok)[len(ok) // 2], max(r["seconds"] for r in ok)))
    for r in results:
        if r["status"] not in ("ok", "cached"):
            log("  ! %s: %s" % (r["city"], r["status"]))
    after = credits()
    log("credits used this run: %s (total %s)" % (
        (after or 0) - (before or 0), after))


if __name__ == "__main__":
    main()
