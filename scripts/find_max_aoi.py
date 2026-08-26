"""Find the largest AOI the plan accepts. Rejected submits cost nothing."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import bbox, fc, request

for km in (60, 40, 30, 20, 15):
    ring = bbox(33.4500, -112.0700, km * 1000)
    payload = {
        "polygon_aoi": fc(ring),
        "date_time": {"start_date": "2024-07-15", "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    }
    code, resp = request("POST", "/heatmap", payload)
    msg = (resp.get("message") or str(resp))[:130]
    print("%3d km  (%6.0f mi2)  http=%s  %s" % (km, (km * 1000) ** 2 / 2.59e6, code, msg))
    if code == 200:
        print("  -> ACCEPTED at %d km (activity %s...)" % (km, resp["data"]["activity_id"][:8]))
        break
