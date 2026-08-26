/**
 * Cross-validation against real NOAA observations.
 *
 * The design-condition maths exists twice in this repo: once in Python
 * (scripts/noaa.py), used to explore the problem, and once in TypeScript, used
 * by the application. They were written separately. If they disagree on real
 * data, one of them is wrong and every number in the UI is suspect.
 *
 * These tests read the ISD-Lite files cached under data/noaa/ and assert the
 * TypeScript implementation reproduces the figures the Python pipeline produced.
 * The cache is gitignored, so the suite skips cleanly when the data is absent
 * rather than failing a fresh clone.
 *
 * Regenerate with:  python scripts/noaa.py  (via scripts/analyse_gap.py)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coolingDegreeDays, designDryBulb, hoursAbove, type HourlyObservation } from "./design-condition";
import { coverageByYear, parseIsdLite } from "./isd";

const NOAA_DIR = join(process.cwd(), "data", "noaa");

const STATIONS = {
  phoenix: { usaf: "722780", wban: "23183" },
  lasvegas: { usaf: "723860", wban: "23169" },
  houston: { usaf: "722430", wban: "12960" },
  austin: { usaf: "722540", wban: "13904" },
  miami: { usaf: "722020", wban: "12839" },
} as const;

function loadYears(city: keyof typeof STATIONS, years: number[]): HourlyObservation[] | null {
  const st = STATIONS[city];
  const out: HourlyObservation[] = [];
  for (const y of years) {
    const p = join(NOAA_DIR, `${st.usaf}-${st.wban}-${y}.txt`);
    if (!existsSync(p)) return null;
    out.push(...parseIsdLite(readFileSync(p, "utf8")).observations);
  }
  return out;
}

const RECENT = [2019, 2020, 2021, 2022, 2023, 2024];

/**
 * Values produced independently by scripts/noaa.py over 2019-2024.
 * 0.4% annual design dry-bulb, degrees Celsius.
 */
const EXPECTED_RECENT_04: Record<keyof typeof STATIONS, number> = {
  phoenix: 45.0,
  lasvegas: 43.9,
  houston: 37.2,
  austin: 38.9,
  miami: 33.9,
};

/** Same statistic over the 1991-2020 window the published tables rest on. */
const EXPECTED_HISTORIC_04: Partial<Record<keyof typeof STATIONS, number>> = {
  phoenix: 43.9,
  lasvegas: 42.8,
  houston: 36.1,
  miami: 33.3,
};

describe("TypeScript matches the Python pipeline on real NOAA data", () => {
  for (const city of Object.keys(EXPECTED_RECENT_04) as (keyof typeof STATIONS)[]) {
    it(`${city}: 0.4% design dry-bulb, 2019-2024`, () => {
      const obs = loadYears(city, RECENT);
      if (!obs) return; // cache absent; nothing to validate against
      expect(obs.length).toBeGreaterThan(50_000);
      const d = designDryBulb(obs, 0.4);
      expect(d.tempC).toBeCloseTo(EXPECTED_RECENT_04[city], 2);
      expect(d.window.yearsWithData).toBe(6);
    });
  }

  for (const [city, expected] of Object.entries(EXPECTED_HISTORIC_04) as [keyof typeof STATIONS, number][]) {
    it(`${city}: 0.4% design dry-bulb, 1991-2020`, () => {
      const years = Array.from({ length: 30 }, (_, i) => 1991 + i);
      const obs = loadYears(city, years);
      if (!obs) return;
      expect(designDryBulb(obs, 0.4).tempC).toBeCloseTo(expected, 2);
    });
  }

  it("reproduces the published ASHRAE value for Phoenix on the published window", () => {
    // The credibility anchor: 43.9 C is the figure the industry designs to for
    // Phoenix Sky Harbor. We arrive at it from raw hourly observations, without
    // reading any copyrighted table. If this drifts, the method is broken.
    const years = Array.from({ length: 30 }, (_, i) => 1991 + i);
    const obs = loadYears("phoenix", years);
    if (!obs) return;
    expect(designDryBulb(obs, 0.4).tempC).toBeCloseTo(43.9, 2);
  });
});

describe("sanity properties on real data", () => {
  it("orders the design percentiles correctly for every city", () => {
    for (const city of Object.keys(STATIONS) as (keyof typeof STATIONS)[]) {
      const obs = loadYears(city, RECENT);
      if (!obs) continue;
      const d04 = designDryBulb(obs, 0.4).tempC;
      const d1 = designDryBulb(obs, 1).tempC;
      const d2 = designDryBulb(obs, 2).tempC;
      expect(d04, city).toBeGreaterThanOrEqual(d1);
      expect(d1, city).toBeGreaterThanOrEqual(d2);
    }
  });

  it("exceeds the 0.4% value for roughly 35 hours a year", () => {
    const obs = loadYears("houston", RECENT);
    if (!obs) return;
    // 0.4% of 8760 hours is 35.04. Allow slack for ties in a discrete record.
    const d = designDryBulb(obs, 0.4);
    expect(d.hoursExceededPerYear).toBeGreaterThan(20);
    expect(d.hoursExceededPerYear).toBeLessThan(55);
  });

  it("produces plausible cooling degree days for a hot city", () => {
    const obs = loadYears("houston", RECENT);
    if (!obs) return;
    const cdd = coolingDegreeDays(obs);
    // Houston sits near 1,900 CDD (base 65 F) per year. A result outside this
    // band means the daily aggregation or the base temperature is wrong.
    expect(cdd.perYearC).toBeGreaterThan(1500);
    expect(cdd.perYearC).toBeLessThan(2400);
    expect(cdd.yearsWithData).toBe(6);
  });

  it("finds no hours above 40 C in Miami and many in Phoenix", () => {
    const mia = loadYears("miami", RECENT);
    const phx = loadYears("phoenix", RECENT);
    if (!mia || !phx) return;
    expect(hoursAbove(mia, 40).perYear).toBeLessThan(1);
    expect(hoursAbove(phx, 40).perYear).toBeGreaterThan(300);
  });

  it("reports near-complete station coverage", () => {
    const obs = loadYears("houston", RECENT);
    if (!obs) return;
    for (const c of coverageByYear(obs)) {
      expect(c.coveragePct, `${c.year}`).toBeGreaterThan(95);
    }
  });
});

describe("ISD-Lite parsing", () => {
  it("converts tenths of a degree and drops the missing sentinel", () => {
    const text = [
      "2024 07 15 14   401   150 10132     0     0     0 -9999 -9999",
      "2024 07 15 15 -9999   150 10132     0     0     0 -9999 -9999",
      "2024 07 15 16  -123   150 10132     0     0     0 -9999 -9999",
    ].join("\n");
    const r = parseIsdLite(text);
    expect(r.observations).toHaveLength(2);
    expect(r.observations[0].tempC).toBeCloseTo(40.1, 6);
    expect(r.observations[1].tempC).toBeCloseTo(-12.3, 6);
    expect(r.missingTemperature).toBe(1);
  });

  it("never emits the sentinel as a temperature on real files", () => {
    const obs = loadYears("phoenix", [2024]);
    if (!obs) return;
    expect(obs.some((o) => o.tempC < -80)).toBe(false);
    expect(obs.some((o) => o.tempC > 70)).toBe(false);
  });

  it("counts malformed lines instead of throwing", () => {
    const r = parseIsdLite("short\n2024 07 15 14   401   150 10132     0     0     0\n\n");
    expect(r.malformed).toBe(1);
    expect(r.observations).toHaveLength(1);
  });
});
