/**
 * Design conditions and degree days, computed from raw hourly observations.
 *
 * Nothing in this file reads a published table. The ASHRAE 0.4% / 1% / 2% annual
 * cooling design dry-bulb temperatures are *defined* as the values exceeded that
 * share of hours in an average year; we compute them from NOAA hourly data using
 * that definition, so the whole chain can be shown in the UI.
 *
 * ASHRAE is cited only as the standard being referenced, never as a data source.
 */

/** A single hourly dry-bulb observation. */
export interface HourlyObservation {
  year: number;
  month: number;
  day: number;
  hour: number;
  /** Dry-bulb air temperature, degrees Celsius. */
  tempC: number;
}

export interface DesignCondition {
  /** Exceedance percentage: 0.4, 1 or 2. */
  exceedancePct: number;
  /** The dry-bulb temperature exceeded that share of hours, degrees Celsius. */
  tempC: number;
  /** Number of observations the statistic was computed over. */
  n: number;
  /** How many observations lie strictly above `tempC`. */
  hoursExceeded: number;
  /** Implied hours per year above the value, at the observed record length. */
  hoursExceededPerYear: number;
  /** Inclusive window the observations were drawn from. */
  window: { firstYear: number; lastYear: number; yearsWithData: number };
}

/**
 * The annual design dry-bulb temperature: the value exceeded `exceedancePct`
 * percent of all hours in the pooled record.
 *
 * Rank convention: with n observations sorted ascending, k = round(n * p/100)
 * observations should lie above the answer, so the answer sits at index
 * n - 1 - k. This is the "exceeded by p% of hours" reading of the definition.
 *
 * Throws rather than guessing when there is no data - a silently returned 0
 * would be indistinguishable from a genuine reading.
 */
export function designDryBulb(
  observations: readonly HourlyObservation[],
  exceedancePct: number,
): DesignCondition {
  if (observations.length === 0) {
    throw new Error("designDryBulb: no observations supplied");
  }
  if (!(exceedancePct > 0 && exceedancePct < 100)) {
    throw new Error(`designDryBulb: exceedancePct must be in (0,100), got ${exceedancePct}`);
  }

  const sorted = observations.map((o) => o.tempC).sort((a, b) => a - b);
  const n = sorted.length;
  const k = Math.min(Math.max(Math.round((n * exceedancePct) / 100), 0), n - 1);
  const tempC = sorted[n - 1 - k];

  const years = new Set(observations.map((o) => o.year));
  const yearsWithData = years.size;
  const hoursExceeded = countAbove(sorted, tempC);

  return {
    exceedancePct,
    tempC,
    n,
    hoursExceeded,
    hoursExceededPerYear: yearsWithData > 0 ? hoursExceeded / yearsWithData : 0,
    window: {
      firstYear: Math.min(...years),
      lastYear: Math.max(...years),
      yearsWithData,
    },
  };
}

/** Count of values strictly greater than `threshold` in an ascending-sorted array. */
function countAbove(sortedAsc: readonly number[], threshold: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] > threshold) hi = mid;
    else lo = mid + 1;
  }
  return sortedAsc.length - lo;
}

/** Hours in the record strictly above a threshold, and the per-year rate. */
export function hoursAbove(
  observations: readonly HourlyObservation[],
  thresholdC: number,
): { hours: number; perYear: number; n: number; yearsWithData: number } {
  const years = new Set(observations.map((o) => o.year));
  const hours = observations.reduce((acc, o) => acc + (o.tempC > thresholdC ? 1 : 0), 0);
  return {
    hours,
    perYear: years.size > 0 ? hours / years.size : 0,
    n: observations.length,
    yearsWithData: years.size,
  };
}

export interface DailyMean {
  year: number;
  month: number;
  day: number;
  meanC: number;
  observationCount: number;
}

/**
 * Mean temperature per calendar day.
 *
 * Days with fewer than `minHoursPerDay` observations are excluded and returned
 * separately rather than filled. Filling a sparse day with an interpolated value
 * would quietly bias degree-day totals, and we would have no way to show it.
 */
export function dailyMeans(
  observations: readonly HourlyObservation[],
  minHoursPerDay = 18,
): { kept: DailyMean[]; droppedDays: number } {
  const buckets = new Map<string, { y: number; m: number; d: number; sum: number; count: number }>();
  for (const o of observations) {
    const key = `${o.year}-${o.month}-${o.day}`;
    const b = buckets.get(key);
    if (b) {
      b.sum += o.tempC;
      b.count += 1;
    } else {
      buckets.set(key, { y: o.year, m: o.month, d: o.day, sum: o.tempC, count: 1 });
    }
  }
  const kept: DailyMean[] = [];
  let droppedDays = 0;
  for (const b of buckets.values()) {
    if (b.count >= minHoursPerDay) {
      kept.push({ year: b.y, month: b.m, day: b.d, meanC: b.sum / b.count, observationCount: b.count });
    } else {
      droppedDays += 1;
    }
  }
  kept.sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
  return { kept, droppedDays };
}

/** 18.3 degrees Celsius is 65 degrees Fahrenheit, the US degree-day convention. */
export const CDD_BASE_C = 18.3;

export interface DegreeDayResult {
  /** Total cooling degree days over the whole record, degree-days Celsius. */
  totalCddC: number;
  /** Mean cooling degree days per year with data. */
  perYearC: number;
  daysCounted: number;
  daysDropped: number;
  yearsWithData: number;
  baseC: number;
}

/**
 * Cooling degree days by the mean-temperature method:
 * for each day, max(0, dailyMean - base), summed.
 *
 * Pure arithmetic over the observations. No modelling assumptions, nothing
 * fitted, nothing interpolated.
 */
export function coolingDegreeDays(
  observations: readonly HourlyObservation[],
  baseC: number = CDD_BASE_C,
  minHoursPerDay = 18,
): DegreeDayResult {
  const { kept, droppedDays } = dailyMeans(observations, minHoursPerDay);
  const totalCddC = kept.reduce((acc, d) => acc + Math.max(0, d.meanC - baseC), 0);
  const years = new Set(kept.map((d) => d.year));
  return {
    totalCddC,
    perYearC: years.size > 0 ? totalCddC / years.size : 0,
    daysCounted: kept.length,
    daysDropped: droppedDays,
    yearsWithData: years.size,
    baseC,
  };
}

/**
 * The two-component gap.
 *
 * The published design condition an engineer works to is computed on a historic
 * 30-year window at one reference station. Two separate things make it wrong for
 * a specific parcel today:
 *
 *   temporal  - the same statistic on a recent window differs from the historic
 *               one. Computed from NOAA observations at the station only; no
 *               model is involved.
 *   spatial   - the parcel is not the station. Measured by FortyGuard at both
 *               points, in the same request, so the difference reflects location
 *               rather than instrument.
 *
 * The absolute level is always anchored on NOAA. FortyGuard supplies only the
 * offset. A FortyGuard tail statistic is never differenced against a NOAA tail
 * statistic - the model smooths extremes, so that difference would measure the
 * model rather than the site.
 */
export interface GapComponents {
  /** Published-era design condition at the reference station, degrees C. */
  standardC: number;
  /** Same statistic recomputed on the recent window, degrees C. */
  recentC: number;
  /** recentC - standardC. */
  temporalC: number;
  /** FortyGuard parcel peak minus FortyGuard station peak, degrees C. */
  spatialC: number;
  /** temporalC + spatialC. */
  combinedC: number;
  /** standardC + combinedC: the design condition to use at this parcel. */
  parcelDesignC: number;
}

export function computeGap(input: {
  standardC: number;
  recentC: number;
  fortyguardParcelPeakC: number;
  fortyguardStationPeakC: number;
}): GapComponents {
  const temporalC = round2(input.recentC - input.standardC);
  const spatialC = round2(input.fortyguardParcelPeakC - input.fortyguardStationPeakC);
  const combinedC = round2(temporalC + spatialC);
  return {
    standardC: input.standardC,
    recentC: input.recentC,
    temporalC,
    spatialC,
    combinedC,
    parcelDesignC: round2(input.standardC + combinedC),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
