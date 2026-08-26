/**
 * NOAA Integrated Surface Database (ISD-Lite) parsing.
 *
 * ISD-Lite is a fixed-width derived product carrying one observation per hour.
 * Columns are position-delimited, right-aligned, space-padded:
 *
 *   0-3   year
 *   5-6   month
 *   8-10  day
 *   11-12 hour (UTC)
 *   13-18 air temperature, tenths of a degree Celsius
 *   19-24 dew point, tenths of a degree Celsius
 *   ...
 *
 * -9999 is the missing-value sentinel and must never be read as a temperature.
 * A single unconverted -9999 would drag a mean down by roughly a thousand
 * degrees, so the guard here is load-bearing rather than defensive.
 *
 * Source:  https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/
 * Licence: work of the U.S. federal government, public domain (17 U.S.C. 105).
 */

import type { HourlyObservation } from "./design-condition";

export const ISD_MISSING = -9999;

export interface ParseReport {
  observations: HourlyObservation[];
  linesRead: number;
  missingTemperature: number;
  malformed: number;
}

export function parseIsdLite(text: string): ParseReport {
  const observations: HourlyObservation[] = [];
  let linesRead = 0;
  let missingTemperature = 0;
  let malformed = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim() === "") continue;
    linesRead += 1;

    if (line.length < 19) {
      malformed += 1;
      continue;
    }

    const year = Number(line.slice(0, 4).trim());
    const month = Number(line.slice(5, 7).trim());
    const day = Number(line.slice(8, 11).trim());
    const hour = Number(line.slice(11, 13).trim());
    const tenths = Number(line.slice(13, 19).trim());

    if (
      !Number.isFinite(year) || !Number.isFinite(month) ||
      !Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(tenths)
    ) {
      malformed += 1;
      continue;
    }

    if (tenths === ISD_MISSING) {
      missingTemperature += 1;
      continue;
    }

    observations.push({ year, month, day, hour, tempC: tenths / 10 });
  }

  return { observations, linesRead, missingTemperature, malformed };
}

/** Hours a complete year should contain, accounting for leap years. */
export function hoursInYear(year: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 8784 : 8760;
}

export interface CoverageReport {
  year: number;
  observations: number;
  expectedHours: number;
  coveragePct: number;
}

export function coverageByYear(observations: readonly HourlyObservation[]): CoverageReport[] {
  const counts = new Map<number, number>();
  for (const o of observations) counts.set(o.year, (counts.get(o.year) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, n]) => ({
      year,
      observations: n,
      expectedHours: hoursInYear(year),
      coveragePct: Math.round((1000 * n) / hoursInYear(year)) / 10,
    }));
}
