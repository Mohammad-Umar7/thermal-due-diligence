"""
Download every NOAA station-year the seed will need, concurrently.

The seed needs 36 station-years per metro (1991-2020 historic plus 2019-2024
recent). Fetched one at a time that is thousands of sequential requests; the
cache is shared and idempotent, so it parallelises cleanly.

Files already cached are skipped, and a 404 is recorded as an archive gap
rather than retried on every run.
"""
import json, os, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from noaa import CACHE, ROOT, fetch_year  # noqa: E402

YEARS = list(range(1991, 2025))
CONCURRENCY = 12

done = 0
lock = threading.Lock()


def grab(job):
    global done
    usaf, wban, year = job
    try:
        fetch_year(usaf, wban, year)
        ok = True
    except Exception:
        ok = False
    with lock:
        done += 1
        if done % 250 == 0:
            print("  %d/%d" % (done, TOTAL), flush=True)
    return ok


if __name__ == "__main__":
    plan = json.load(open(os.path.join(ROOT, "data", "metros.json"), encoding="utf-8"))
    os.makedirs(CACHE, exist_ok=True)
    jobs = []
    for m in plan:
        s = m["station"]
        for y in YEARS:
            p = os.path.join(CACHE, "%s-%s-%d.txt" % (s["usaf"], s["wban"], y))
            if os.path.exists(p) or os.path.exists(p + ".missing"):
                continue
            jobs.append((s["usaf"], s["wban"], y))
    TOTAL = len(jobs)
    print("%d station-years to fetch (%d metros x %d years)" % (TOTAL, len(plan), len(YEARS)), flush=True)
    if not jobs:
        sys.exit(0)
    failures = 0
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for fut in as_completed([pool.submit(grab, j) for j in jobs]):
            if not fut.result():
                failures += 1
    print("done. %d fetched, %d failed" % (TOTAL - failures, failures))
