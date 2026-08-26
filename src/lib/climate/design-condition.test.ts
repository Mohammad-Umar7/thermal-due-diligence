import { describe, expect, it } from "vitest";
import {
  CDD_BASE_C,
  coolingDegreeDays,
  computeGap,
  dailyMeans,
  designDryBulb,
  hoursAbove,
  type HourlyObservation,
} from "./design-condition";

/** Build observations from a flat list of temperatures, spread across whole days. */
function obsFromTemps(temps: number[], year = 2024): HourlyObservation[] {
  return temps.map((tempC, i) => ({
    year,
    month: 1 + Math.floor(i / (24 * 28)) % 12,
    day: 1 + Math.floor(i / 24) % 28,
    hour: i % 24,
    tempC,
  }));
}

describe("designDryBulb", () => {
  it("returns the value exceeded by the requested share of hours", () => {
    // 1000 observations: 0..999. The 0.4% design value should be exceeded by
    // exactly 4 observations (996, 997, 998, 999), so it is 995.
    const temps = Array.from({ length: 1000 }, (_, i) => i);
    const r = designDryBulb(obsFromTemps(temps), 0.4);
    expect(r.tempC).toBe(995);
    expect(r.hoursExceeded).toBe(4);
    expect(r.n).toBe(1000);
  });

  it("computes 1% and 2% consistently and monotonically", () => {
    const temps = Array.from({ length: 10000 }, (_, i) => i / 100);
    const o = obsFromTemps(temps);
    const d04 = designDryBulb(o, 0.4).tempC;
    const d1 = designDryBulb(o, 1).tempC;
    const d2 = designDryBulb(o, 2).tempC;
    // A rarer exceedance must correspond to a hotter temperature.
    expect(d04).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
  });

  it("is insensitive to input ordering", () => {
    const temps = Array.from({ length: 5000 }, (_, i) => (i * 7919) % 5000);
    const forward = designDryBulb(obsFromTemps(temps), 1).tempC;
    const reversed = designDryBulb(obsFromTemps([...temps].reverse()), 1).tempC;
    expect(forward).toBe(reversed);
  });

  it("reports hours-exceeded per year using years actually present", () => {
    const a = obsFromTemps(Array.from({ length: 8760 }, (_, i) => i / 100), 2023);
    const b = obsFromTemps(Array.from({ length: 8760 }, (_, i) => i / 100), 2024);
    const r = designDryBulb([...a, ...b], 1);
    expect(r.window.yearsWithData).toBe(2);
    // ~1% of 17520 = ~175 hours over two years, so ~88 per year.
    expect(r.hoursExceededPerYear).toBeCloseTo(r.hoursExceeded / 2, 6);
  });

  it("throws on empty input rather than returning a plausible zero", () => {
    expect(() => designDryBulb([], 0.4)).toThrow(/no observations/);
  });

  it("rejects out-of-range exceedance percentages", () => {
    const o = obsFromTemps([1, 2, 3]);
    expect(() => designDryBulb(o, 0)).toThrow();
    expect(() => designDryBulb(o, 100)).toThrow();
    expect(() => designDryBulb(o, -1)).toThrow();
  });

  it("handles a constant record without dividing by zero", () => {
    const r = designDryBulb(obsFromTemps(Array(500).fill(30)), 0.4);
    expect(r.tempC).toBe(30);
    expect(r.hoursExceeded).toBe(0);
  });
});

describe("hoursAbove", () => {
  it("counts strictly above the threshold", () => {
    const o = obsFromTemps([34, 35, 36, 40, 41]);
    expect(hoursAbove(o, 35).hours).toBe(3);
    expect(hoursAbove(o, 40).hours).toBe(1);
    expect(hoursAbove(o, 100).hours).toBe(0);
  });

  it("divides by the number of years with data, not the span", () => {
    const a = obsFromTemps([40, 40], 2020);
    const b = obsFromTemps([40, 40], 2024);
    const r = hoursAbove([...a, ...b], 35);
    expect(r.hours).toBe(4);
    expect(r.yearsWithData).toBe(2);
    expect(r.perYear).toBe(2);
  });
});

describe("dailyMeans", () => {
  it("averages a full day of observations", () => {
    const day = Array.from({ length: 24 }, (_, h) => ({
      year: 2024, month: 7, day: 15, hour: h, tempC: h,
    }));
    const { kept, droppedDays } = dailyMeans(day);
    expect(kept).toHaveLength(1);
    expect(kept[0].meanC).toBeCloseTo(11.5, 10);
    expect(droppedDays).toBe(0);
  });

  it("drops sparse days instead of filling them", () => {
    const sparse = Array.from({ length: 5 }, (_, h) => ({
      year: 2024, month: 7, day: 15, hour: h, tempC: 40,
    }));
    const { kept, droppedDays } = dailyMeans(sparse, 18);
    expect(kept).toHaveLength(0);
    expect(droppedDays).toBe(1);
  });

  it("returns days in chronological order", () => {
    const mk = (m: number, d: number) =>
      Array.from({ length: 24 }, (_, h) => ({ year: 2024, month: m, day: d, hour: h, tempC: 20 }));
    const { kept } = dailyMeans([...mk(8, 2), ...mk(7, 15), ...mk(8, 1)]);
    expect(kept.map((k) => `${k.month}-${k.day}`)).toEqual(["7-15", "8-1", "8-2"]);
  });
});

describe("coolingDegreeDays", () => {
  it("sums max(0, dailyMean - base)", () => {
    // Three days at a constant 28.3 C: each contributes exactly 10 degree-days.
    const days = [1, 2, 3].flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => ({ year: 2024, month: 7, day: d, hour: h, tempC: 28.3 })),
    );
    const r = coolingDegreeDays(days);
    expect(r.baseC).toBe(CDD_BASE_C);
    expect(r.totalCddC).toBeCloseTo(30, 6);
    expect(r.daysCounted).toBe(3);
  });

  it("contributes nothing on days at or below the base", () => {
    const cold = Array.from({ length: 24 }, (_, h) => ({
      year: 2024, month: 1, day: 1, hour: h, tempC: 5,
    }));
    expect(coolingDegreeDays(cold).totalCddC).toBe(0);
  });

  it("never returns a negative total", () => {
    const mixed = [
      ...Array.from({ length: 24 }, (_, h) => ({ year: 2024, month: 1, day: 1, hour: h, tempC: -20 })),
      ...Array.from({ length: 24 }, (_, h) => ({ year: 2024, month: 7, day: 1, hour: h, tempC: 28.3 })),
    ];
    const r = coolingDegreeDays(mixed);
    expect(r.totalCddC).toBeGreaterThanOrEqual(0);
    expect(r.totalCddC).toBeCloseTo(10, 6);
  });

  it("respects a custom base temperature", () => {
    const days = Array.from({ length: 24 }, (_, h) => ({
      year: 2024, month: 7, day: 1, hour: h, tempC: 30,
    }));
    expect(coolingDegreeDays(days, 20).totalCddC).toBeCloseTo(10, 6);
    expect(coolingDegreeDays(days, 25).totalCddC).toBeCloseTo(5, 6);
  });

  it("averages per year over years with data only", () => {
    const mk = (y: number) =>
      Array.from({ length: 24 }, (_, h) => ({ year: y, month: 7, day: 1, hour: h, tempC: 28.3 }));
    const r = coolingDegreeDays([...mk(2021), ...mk(2024)]);
    expect(r.yearsWithData).toBe(2);
    expect(r.perYearC).toBeCloseTo(10, 6);
  });
});

describe("computeGap", () => {
  it("decomposes the gap additively and anchors on the standard", () => {
    // Houston: published-era 36.10, recent 37.20, parcel 2.03 C above station.
    const g = computeGap({
      standardC: 36.1,
      recentC: 37.2,
      fortyguardStationPeakC: 37.54,
      fortyguardParcelPeakC: 39.57,
    });
    expect(g.temporalC).toBeCloseTo(1.1, 6);
    expect(g.spatialC).toBeCloseTo(2.03, 6);
    expect(g.combinedC).toBeCloseTo(3.13, 6);
    expect(g.parcelDesignC).toBeCloseTo(39.23, 6);
    // The components must add to the combined figure exactly as displayed.
    expect(g.temporalC + g.spatialC).toBeCloseTo(g.combinedC, 6);
    expect(g.standardC + g.combinedC).toBeCloseTo(g.parcelDesignC, 6);
  });

  it("handles a parcel cooler than its station", () => {
    const g = computeGap({
      standardC: 43.9,
      recentC: 45.0,
      fortyguardStationPeakC: 42.71,
      fortyguardParcelPeakC: 41.27,
    });
    expect(g.spatialC).toBeCloseTo(-1.44, 6);
    expect(g.combinedC).toBeCloseTo(-0.34, 6);
    expect(g.parcelDesignC).toBeLessThan(g.standardC);
  });

  it("returns a zero gap when nothing has changed and the parcel is the station", () => {
    const g = computeGap({
      standardC: 40, recentC: 40,
      fortyguardStationPeakC: 38, fortyguardParcelPeakC: 38,
    });
    expect(g.combinedC).toBe(0);
    expect(g.parcelDesignC).toBe(40);
  });
});
