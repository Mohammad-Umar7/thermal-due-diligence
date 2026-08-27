"""
Resample the FortyGuard tile field onto a regular lat/lon raster.

FortyGuard returns tiles on a projected grid, so their centroids do not sit on a
regular lat/lon lattice and cannot be indexed arithmetically. Rather than ship
159,000 irregular points and search them in the browser, we resample once here
onto a grid we define, so an address lookup becomes a single array read.

Output per city:
  public/rasters/<city>.bin   Int16 little-endian, row-major, H*W values
                              temperature = value / 100, -32768 = no data
  raster header written into src/data/cities/<city>.json

Resolution matches the request granularity (100 m), so nothing is smoothed away:
this is a reprojection, not a downsample.
"""

import array
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
METRO = os.path.join(ROOT, "data", "metro")
CITIES = os.path.join(ROOT, "src", "data", "cities")
RASTERS = os.path.join(ROOT, "public", "rasters")

NO_DATA = -32768
MONTH = "2024-07"


def load(city):
    path = os.path.join(METRO, "%s_%s.ndjson" % (city, MONTH))
    if not os.path.exists(path):
        return None, None
    rows = []
    with open(path, encoding="utf-8") as fh:
        meta = json.loads(fh.readline())["_meta"]
        for line in fh:
            rows.append(json.loads(line))
    return meta, rows


def build(city):
    meta, rows = load(city)
    if not rows:
        print("%s: no metro file" % city)
        return None

    lat0 = min(r[0] for r in rows)
    lat1 = max(r[0] for r in rows)
    lon0 = min(r[1] for r in rows)
    lon1 = max(r[1] for r in rows)

    # Cell size equal to the requested granularity, expressed in degrees at the
    # centre latitude. Longitude degrees shrink with latitude, hence the cosine.
    gran_m = meta["granularity"]
    mid_lat = (lat0 + lat1) / 2.0
    d_lat = gran_m / 111_320.0
    d_lon = gran_m / (111_320.0 * math.cos(math.radians(mid_lat)))

    H = int(math.floor((lat1 - lat0) / d_lat)) + 1
    W = int(math.floor((lon1 - lon0) / d_lon)) + 1

    # Accumulate: a raster cell may receive more than one tile centroid, and the
    # honest reduction is a mean rather than "last one wins".
    total = [0.0] * (H * W)
    count = [0] * (H * W)

    for lat, lon, _avg, _mn, mx in rows:
        j = int(round((lat - lat0) / d_lat))
        i = int(round((lon - lon0) / d_lon))
        if 0 <= j < H and 0 <= i < W:
            k = j * W + i
            total[k] += mx
            count[k] += 1

    filled = sum(1 for c in count if c)
    grid = array.array("h", [NO_DATA]) * (H * W)
    for k in range(H * W):
        if count[k]:
            grid[k] = int(round((total[k] / count[k]) * 100))

    # Fill single-cell holes from their neighbours. Projection differences leave
    # a scatter of empty cells inside an otherwise covered area; leaving them as
    # no-data would report "outside coverage" for a perfectly valid address.
    holes = 0
    for j in range(H):
        for i in range(W):
            k = j * W + i
            if grid[k] != NO_DATA:
                continue
            acc = n = 0
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    jj, ii = j + dj, i + di
                    if 0 <= jj < H and 0 <= ii < W:
                        v = grid[jj * W + ii]
                        if v != NO_DATA:
                            acc += v
                            n += 1
            if n >= 4:  # only fill a cell that is genuinely surrounded
                grid[k] = int(round(acc / n))
                holes += 1

    os.makedirs(RASTERS, exist_ok=True)
    out = os.path.join(RASTERS, "%s.bin" % city)
    with open(out, "wb") as fh:
        grid.tofile(fh)

    covered = sum(1 for v in grid if v != NO_DATA)
    header = {
        "lat0": round(lat0, 6), "lon0": round(lon0, 6),
        "dLat": d_lat, "dLon": d_lon,
        "width": W, "height": H,
        "scale": 100, "noData": NO_DATA,
        "path": "/rasters/%s.bin" % city,
        "bytes": os.path.getsize(out),
        "coveragePct": round(100.0 * covered / (H * W), 1),
    }
    print("%-10s %dx%d  %d tiles -> %d cells (%.1f%% covered, %d holes filled)  %.0f KB" % (
        city, W, H, len(rows), covered, header["coveragePct"], holes,
        os.path.getsize(out) / 1024))
    return header


def main():
    cities = sys.argv[1:] or ["houston", "phoenix", "lasvegas", "austin", "miami"]
    for city in cities:
        header = build(city)
        if not header:
            continue
        p = os.path.join(CITIES, "%s.json" % city)
        rec = json.load(open(p, encoding="utf-8"))
        rec["raster"] = header
        json.dump(rec, open(p, "w", encoding="utf-8"), separators=(",", ":"))


if __name__ == "__main__":
    main()
