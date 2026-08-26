"""
NOAA Integrated Surface Database (ISD-Lite) reader and design-condition calculator.

ISD-Lite is a derived ISD product: one observation per hour, fixed-width, air
temperature in tenths of a degree Celsius, -9999 for missing. That is exactly the
input the ASHRAE annual design-condition method wants, and it is ~80x smaller than
the full global-hourly CSV.

Source: https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/{year}/{usaf}-{wban}-{year}.gz
Licence: U.S. federal government work, public domain (17 U.S.C. Sec. 105).

No ASHRAE table is copied. The percentile is computed here from raw observations
using the published method, so the whole computation can be shown.
"""

import gzip
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "noaa")

# Reference stations. These are the first-order airport stations whose records
# underlie the published design conditions the construction industry uses.
STATIONS = {
    "phoenix":  {"usaf": "722780", "wban": "23183", "name": "Phoenix Sky Harbor Intl, AZ",
                 "lat": 33.4278, "lon": -112.0038, "elev_m": 337},
    "lasvegas": {"usaf": "723860", "wban": "23169", "name": "Las Vegas Harry Reid Intl, NV",
                 "lat": 36.0719, "lon": -115.1633, "elev_m": 664},
    "houston":  {"usaf": "722430", "wban": "12960", "name": "Houston George Bush Intercontinental, TX",
                 "lat": 29.9902, "lon": -95.3368, "elev_m": 29},
    "miami":    {"usaf": "722020", "wban": "12839", "name": "Miami Intl, FL",
                 "lat": 25.7906, "lon": -80.3164, "elev_m": 3},
    "austin":   {"usaf": "722540", "wban": "13904", "name": "Austin-Bergstrom Intl, TX",
                 "lat": 30.1830, "lon": -97.6799, "elev_m": 148},
}


def fetch_year(usaf, wban, year):
    """Return raw ISD-Lite text for one station-year, caching to disk."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "%s-%s-%d.txt" % (usaf, wban, year))
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    url = "https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/%d/%s-%s-%d.gz" % (year, usaf, wban, year)
    with urllib.request.urlopen(url, timeout=120) as resp:
        text = gzip.decompress(resp.read()).decode("utf-8", "replace")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return text


def parse(text):
    """Yield (year, month, day, hour, temp_c). Missing temperatures are skipped."""
    for line in text.splitlines():
        if len(line) < 30:
            continue
        try:
            y = int(line[0:4]); m = int(line[5:7]); d = int(line[8:11]); h = int(line[11:13])
            t = int(line[13:19])
        except ValueError:
            continue
        if t == -9999:
            continue
        yield y, m, d, h, t / 10.0


def load_hours(city, years):
    """All valid hourly dry-bulb observations across `years`, plus a coverage report."""
    st = STATIONS[city]
    obs, coverage = [], {}
    for year in years:
        text = fetch_year(st["usaf"], st["wban"], year)
        rows = list(parse(text))
        obs.extend(rows)
        expected = 8784 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 8760
        coverage[year] = {"observations": len(rows), "expected_hours": expected,
                          "coverage_pct": round(100.0 * len(rows) / expected, 2)}
    return obs, coverage


# --- the design condition -----------------------------------------------------

def design_dry_bulb(temps, exceedance_pct):
    """
    The annual design dry-bulb temperature: the value exceeded `exceedance_pct`
    percent of all hours in an average year, over the pooled multi-year record.

    This is the method ASHRAE specifies for its 0.4% / 1% / 2% annual cooling
    design conditions. We compute it from raw NOAA observations rather than
    reading any published table.

    Implementation: sort ascending, take the value at rank (1 - p/100) of n.
    Equivalently the (100 - p)th percentile. Uses the "exceeded by" convention:
    the returned value is exceeded by approximately p% of observations.
    """
    if not temps:
        raise ValueError("no observations")
    s = sorted(temps)
    n = len(s)
    # Number of observations that should lie strictly above the returned value.
    k = int(round(n * exceedance_pct / 100.0))
    k = min(max(k, 0), n - 1)
    return s[n - 1 - k]


def cooling_degree_days(daily_means, base_c=18.3):
    """
    CDD by the standard mean-temperature method: for each day, max(0, mean - base).
    base_c 18.3 C == 65 F, the US convention. Pure arithmetic, no modelling.
    """
    return sum(max(0.0, m - base_c) for m in daily_means)


def daily_means_from_hours(obs, min_hours=18):
    """
    Mean temperature per calendar day, from hourly observations.
    Days with fewer than `min_hours` valid observations are excluded and reported,
    rather than being silently filled.
    """
    buckets = {}
    for y, m, d, h, t in obs:
        buckets.setdefault((y, m, d), []).append(t)
    kept, dropped = {}, []
    for key, vals in buckets.items():
        if len(vals) >= min_hours:
            kept[key] = sum(vals) / len(vals)
        else:
            dropped.append(key)
    return kept, dropped


def hours_above(temps, threshold_c):
    return sum(1 for t in temps if t > threshold_c)
