/**
 * Reading the temperature field in the browser.
 *
 * Each covered metro ships as an Int16 raster built by scripts/rasterize.py:
 * row-major, temperature = value / scale, with a sentinel for cells that carry
 * no measurement (open water, or outside the queried area).
 *
 * Sampling is a single array read, so a lookup is instant and needs no API call
 * at runtime. Rasters are fetched lazily - one metro at a time, ~180-310 KB -
 * and cached for the session.
 */

import type { CityRecord } from "./report";

export interface RasterHeader {
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  width: number;
  height: number;
  scale: number;
  noData: number;
  path: string;
  bytes: number;
  coveragePct: number;
}

export class RasterError extends Error {
  constructor(
    message: string,
    readonly kind: "outside-coverage" | "no-data" | "network",
  ) {
    super(message);
    this.name = "RasterError";
  }
}

const cache = new Map<string, Promise<Int16Array>>();

export function loadRaster(city: CityRecord): Promise<Int16Array> {
  const header = city.raster;
  if (!header) {
    return Promise.reject(new RasterError(`No temperature field for ${city.label}.`, "network"));
  }
  const existing = cache.get(city.city);
  if (existing) return existing;

  const pending = fetch(header.path)
    .then(async (res) => {
      if (!res.ok) throw new RasterError(`Could not load the temperature field (${res.status}).`, "network");
      const buf = await res.arrayBuffer();
      const expected = header.width * header.height * 2;
      if (buf.byteLength !== expected) {
        throw new RasterError(
          `Temperature field for ${city.label} is ${buf.byteLength} bytes, expected ${expected}.`,
          "network",
        );
      }
      return new Int16Array(buf);
    })
    .catch((err) => {
      // A failed fetch must not be remembered, or a transient network blip
      // would poison every later lookup in the session.
      cache.delete(city.city);
      throw err instanceof RasterError
        ? err
        : new RasterError("Could not load the temperature field.", "network");
    });

  cache.set(city.city, pending);
  return pending;
}

/** True when the point falls inside this metro's surveyed rectangle. */
export function covers(city: CityRecord, lat: number, lon: number): boolean {
  const h = city.raster;
  if (!h) return false;
  const latMax = h.lat0 + h.dLat * (h.height - 1);
  const lonMax = h.lon0 + h.dLon * (h.width - 1);
  return lat >= h.lat0 && lat <= latMax && lon >= h.lon0 && lon <= lonMax;
}

/** Distance in metres from a point to the centre of the cell it lands in. */
export function cellDistanceM(h: RasterHeader, lat: number, lon: number): number {
  const j = Math.round((lat - h.lat0) / h.dLat);
  const i = Math.round((lon - h.lon0) / h.dLon);
  const cellLat = h.lat0 + j * h.dLat;
  const cellLon = h.lon0 + i * h.dLon;
  const dy = (lat - cellLat) * 111_320;
  const dx = (lon - cellLon) * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.sqrt(dy * dy + dx * dx);
}

/**
 * Peak temperature at a point, in degrees Celsius.
 *
 * Throws rather than returning a fallback: a point outside the survey and a
 * point over open water are different failures, and both are different from a
 * reading. Returning 0, or the nearest value from kilometres away, would be
 * indistinguishable from a measurement.
 */
export function sample(header: RasterHeader, grid: Int16Array, lat: number, lon: number): number {
  const j = Math.round((lat - header.lat0) / header.dLat);
  const i = Math.round((lon - header.lon0) / header.dLon);
  if (j < 0 || j >= header.height || i < 0 || i >= header.width) {
    throw new RasterError("That address is outside the surveyed area.", "outside-coverage");
  }
  const v = grid[j * header.width + i];
  if (v === header.noData) {
    throw new RasterError(
      "No temperature measurement covers that exact point. Open water and some parcels at the edge of the survey have no reading.",
      "no-data",
    );
  }
  return v / header.scale;
}

/**
 * What share of the surveyed metro is cooler than this value.
 * Computed over the whole raster, so it is exact rather than interpolated from
 * stored percentiles.
 */
export function percentileOf(header: RasterHeader, grid: Int16Array, valueC: number): number {
  const target = valueC * header.scale;
  let cooler = 0;
  let total = 0;
  for (let k = 0; k < grid.length; k++) {
    const v = grid[k];
    if (v === header.noData) continue;
    total++;
    if (v < target) cooler++;
  }
  return total === 0 ? 0 : Math.round((1000 * cooler) / total) / 10;
}
