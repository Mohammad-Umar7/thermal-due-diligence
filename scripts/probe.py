"""
FortyGuard API probe harness.

Answers the open questions in docs/API_NOTES.md against the live API, and records
the credit cost of every successful call. Rejected requests (400/422) are free, so
the validation probes cost nothing.

Usage:  python scripts/probe.py <probe-name> [more names...]
        python scripts/probe.py --list
        python scripts/probe.py --credits
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "probes")


def load_env():
    env = {}
    path = os.path.join(ROOT, ".env.local")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()
KEY = ENV["FORTYGUARD_API_KEY"]
BASE = ENV.get("FORTYGUARD_BASE_URL", "https://api.fortyguard.com/v1")


def redact(text):
    return re.sub(r"[0-9a-f]{32}", "<REDACTED-KEY>", text)


def request(method, path, payload=None, timeout=90):
    url = path if path.startswith("http") else BASE + path
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("api-key", KEY)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, {"_raw": raw[:2000]}
    except Exception as exc:
        return 0, {"_error": str(exc)}


def credits():
    _, data = request("POST", "/system/fetch-api-key-usage", {"api_key": KEY})
    return data.get("credit_summary", {}).get("total_credits_used")


def poll(activity_id, timeout_s=600, interval=5, read_timeout=900):
    """Poll to completion. A 404 shortly after submit means 'not ready', not fatal."""
    started = time.time()
    consecutive_404 = 0
    while time.time() - started < timeout_s:
        code, data = request("GET", "/status/%s" % activity_id, timeout=read_timeout)
        if code == 404:
            consecutive_404 += 1
            if consecutive_404 > 12:
                return {"status": "Missing", "_note": "404 for 60s+"}
            time.sleep(interval)
            continue
        consecutive_404 = 0
        payload = data.get("data", data)
        status = str(payload.get("status", "")).lower()
        if status in ("completed", "succeeded"):
            return payload
        if status in ("failed", "error"):
            return payload
        time.sleep(interval)
    return {"status": "Timeout", "_elapsed": time.time() - started}


# --- area of interest helpers -------------------------------------------------

def bbox(lat, lon, metres):
    """Closed square polygon of side `metres` centred on (lat, lon)."""
    dlat = metres / 111_320.0
    dlon = metres / (111_320.0 * max(0.2, abs(__import__("math").cos(__import__("math").radians(lat)))))
    h_lat, h_lon = dlat / 2, dlon / 2
    ring = [
        [lon - h_lon, lat - h_lat],
        [lon + h_lon, lat - h_lat],
        [lon + h_lon, lat + h_lat],
        [lon - h_lon, lat + h_lat],
        [lon - h_lon, lat - h_lat],
    ]
    return ring


def fc(ring):
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [ring]}}
        ],
    }


def bare(ring):
    return {"type": "Polygon", "coordinates": [ring]}


# A ~500 m box over an industrial parcel south of Sky Harbor, Phoenix AZ.
PHX = bbox(33.4255, -112.0100, 500)
# Non-US control: central London.
LONDON = bbox(51.5074, -0.1278, 500)


def summarise_result(payload):
    """Condense a completed heatmap result without dumping megabytes of GeoJSON."""
    result = payload.get("result") or {}
    md = result.get("map_data") or {}
    sd = result.get("stats_data") or {}
    feats = md.get("features") or []
    out = {
        "status": payload.get("status"),
        "map_data_keys": sorted(md.keys())[:12],
        "n_features": len(feats),
        "stats_data_keys": sorted(sd.keys())[:20],
    }
    if feats:
        f0 = feats[0]
        out["feature0_properties"] = f0.get("properties")
        geom = f0.get("geometry") or {}
        out["feature0_geometry_type"] = geom.get("type")
    for k, v in sd.items():
        if isinstance(v, dict):
            out["stats.%s" % k] = {kk: (vv if not isinstance(vv, (list, dict)) else "<%s len=%s>" % (type(vv).__name__, len(vv))) for kk, vv in list(v.items())[:12]}
        elif isinstance(v, list):
            out["stats.%s" % k] = {"len": len(v), "first5": v[:5], "last5": v[-5:]}
        else:
            out["stats.%s" % k] = v
    return out


def run_heatmap(name, payload, save_full=True):
    before = credits()
    code, resp = request("POST", "/heatmap", payload)
    record = {"probe": name, "submit_http": code, "submit_response": resp, "request": payload}
    if code != 200 or resp.get("error"):
        record["outcome"] = "rejected-at-submit"
        record["credits_charged"] = (credits() or 0) - (before or 0)
        return record
    activity_id = resp["data"]["activity_id"]
    record["activity_id"] = activity_id
    t0 = time.time()
    payload_done = poll(activity_id)
    record["seconds_to_complete"] = round(time.time() - t0, 1)
    record["status"] = payload_done.get("status")
    record["summary"] = summarise_result(payload_done)
    after = credits()
    record["credits_charged"] = (after or 0) - (before or 0)
    if save_full and payload_done.get("result"):
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(os.path.join(OUT_DIR, "%s.full.json" % name), "w", encoding="utf-8") as fh:
            json.dump(payload_done, fh)
    return record


# --- probes -------------------------------------------------------------------

def probe_single_hour():
    """Baseline: filter_type 1. Establishes cost and response shape."""
    return run_heatmap("single_hour", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    })


def probe_range_of_days():
    """THE decisive probe: does filter_type 4 exist? Docs contradict themselves."""
    return run_heatmap("range_of_days", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2024-07-01", "end_date": "2024-07-31", "filter_type": 4},
        "granularity": 100,
    })


def probe_single_day():
    """Does filter_type 3 return an hourly series or a daily aggregate?"""
    return run_heatmap("single_day", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2024-07-15", "filter_type": 3},
        "granularity": 100,
    })


def probe_history_2019():
    """Docs say history starts 2019-01-01; hackathon FAQ says 2021. Which is true?"""
    return run_heatmap("history_2019", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2019-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    })


def probe_history_2020():
    return run_heatmap("history_2020", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2020-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    })


def probe_exceedance():
    """Does exceedance give us threshold-hours directly? Feature 2 depends on this."""
    return run_heatmap("exceedance_40c", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2024-07-01", "end_date": "2024-07-31", "filter_type": 4},
        "granularity": 100,
        "analytic_type": "exceedance",
        "threshold": 40,
        "direction": "above",
    })


def probe_bare_polygon():
    """Is a bare Polygon accepted, or is FeatureCollection mandatory? (Free if rejected.)"""
    return run_heatmap("bare_polygon", {
        "polygon_aoi": bare(PHX),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    }, save_full=False)


def probe_non_us():
    """Coverage boundary. Expected to be rejected, and therefore free."""
    return run_heatmap("non_us_london", {
        "polygon_aoi": fc(LONDON),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    }, save_full=False)


def probe_pre_2019():
    """Lower bound check. Expected 400, free."""
    return run_heatmap("pre_2019", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2018-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    }, save_full=False)


def probe_granularity_60():
    """Cost sensitivity to granularity at fixed area."""
    return run_heatmap("granularity_60", {
        "polygon_aoi": fc(PHX),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 60,
    })


PROBES = {
    "single_hour": probe_single_hour,
    "range_of_days": probe_range_of_days,
    "single_day": probe_single_day,
    "history_2019": probe_history_2019,
    "history_2020": probe_history_2020,
    "exceedance": probe_exceedance,
    "bare_polygon": probe_bare_polygon,
    "non_us": probe_non_us,
    "pre_2019": probe_pre_2019,
    "granularity_60": probe_granularity_60,
}

FREE_FIRST = ["non_us", "pre_2019", "bare_polygon"]


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--list":
        print("probes:", ", ".join(PROBES))
        print("free-first (validation only):", ", ".join(FREE_FIRST))
        return
    if args[0] == "--credits":
        _, data = request("POST", "/system/fetch-api-key-usage", {"api_key": KEY})
        print(redact(json.dumps(data.get("credit_summary"), indent=2)))
        return
    names = list(PROBES) if args[0] == "--all" else args
    os.makedirs(OUT_DIR, exist_ok=True)
    results = []
    for name in names:
        if name not in PROBES:
            print("unknown probe: %s" % name)
            continue
        print("\n===== %s =====" % name, flush=True)
        rec = PROBES[name]()
        results.append(rec)
        print(redact(json.dumps(rec, indent=2, default=str))[:4000], flush=True)
        with open(os.path.join(OUT_DIR, "%s.json" % name), "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=2, default=str)
    print("\n===== credit ledger =====")
    for r in results:
        print("%-18s http=%-4s status=%-12s cost=%s" % (
            r["probe"], r["submit_http"], r.get("status", r.get("outcome")), r.get("credits_charged")))
    print("total used to date:", credits())




# --- appended: area-scaling and spatial-variation probes ----------------------

def _phx_box(metres, lat=33.4400, lon=-112.0430):
    return bbox(lat, lon, metres)


def probe_area_2km():
    return run_heatmap("area_2km", {
        "polygon_aoi": fc(_phx_box(2000)),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    })


def probe_area_5km():
    return run_heatmap("area_5km", {
        "polygon_aoi": fc(_phx_box(5000)),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    })


def probe_area_12km():
    """Deliberately over the 10 mi^2 Basic cap: is the cap enforced on this plan?"""
    return run_heatmap("area_12km", {
        "polygon_aoi": fc(_phx_box(12000)),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    }, save_full=False)


PROBES["area_2km"] = probe_area_2km
PROBES["area_5km"] = probe_area_5km
PROBES["area_12km"] = probe_area_12km


def probe_month_wide():
    """Linchpin: filter_type 4 over a large AOI. Tests (a) does range-of-days exist,
    (b) cost, (c) response shape, (d) spatial contrast across 5 km of Phoenix."""
    return run_heatmap("month_wide", {
        "polygon_aoi": fc(_phx_box(5000)),
        "date_time": {"start_date": "2024-07-01", "end_date": "2024-07-31", "filter_type": 4},
        "granularity": 100,
    })


def probe_day_wide():
    """Fallback if filter_type 4 is rejected: single day over the same 5 km box.
    Per-tile daily min/mean/max exposes both spatial contrast and diurnal range."""
    return run_heatmap("day_wide", {
        "polygon_aoi": fc(_phx_box(5000)),
        "date_time": {"start_date": "2024-07-15", "filter_type": 3},
        "granularity": 100,
    })


PROBES["month_wide"] = probe_month_wide
PROBES["day_wide"] = probe_day_wide


if __name__ == "__main__":
    main()
