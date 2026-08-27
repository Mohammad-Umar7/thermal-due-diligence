/**
 * Assembling a report from the seeded city datasets.
 *
 * The seed files are produced by scripts/seed.py from two inputs: the cached
 * FortyGuard tile field and the cached NOAA station record. Nothing here is
 * hand-entered, and every figure a report carries can be traced back through
 * `provenance` to the request or record it came from.
 */

import austin from "@/data/cities/austin.json";
import houston from "@/data/cities/houston.json";
import lasvegas from "@/data/cities/lasvegas.json";
import miami from "@/data/cities/miami.json";
import phoenix from "@/data/cities/phoenix.json";
import { computeGap, type GapComponents } from "./climate/design-condition";

export interface CityRecord {
  city: string;
  label: string;
  station: {
    name: string; usaf: string; wban: string;
    lat: number; lon: number; elevationM: number;
  };
  noaa: {
    historicWindow: string;
    historicWindowRequested: string;
    historicMissingYears: number[];
    recentWindow: string;
    design04HistoricC: number;
    design04RecentC: number;
    design01RecentC: number;
    design02RecentC: number;
    nHistoricObservations: number;
    nRecentObservations: number;
    cddPerYearC: number;
    cddBaseC: number;
    daysDroppedSparse: number;
    hoursAbovePerYear: Record<string, number>;
    coverageWorstPct: number;
  };
  fortyguard: {
    month: string; granularityM: number; boxKm: number; filterType: number;
    nTiles: number; activityId: string; retrievedUtc: string;
    stationTile: { lat: number; lon: number; avgC: number; minC: number; maxC: number };
    stationTileDistanceM: number;
    peakOffsetC: {
      min: number; p1: number; p25: number; median: number;
      p75: number; p99: number; max: number;
    };
    pctMetroHotterThanStation: number;
  };
  validation: {
    noaaJuly2024MaxC: number | null;
    noaaJuly2024MeanC: number | null;
    fortyguardJuly2024MaxC: number;
    fortyguardMinusNoaaMaxC: number | null;
  };
  parcels: ParcelRecord[];
  /** Header for the metro's Int16 temperature raster; see lib/raster.ts. */
  raster?: import("./raster").RasterHeader;
}

export interface ParcelRecord {
  id: string;
  label: string;
  kind: string;
  address: string;
  lat: number;
  lon: number;
  tileDistanceM: number;
  tile: { avgC: number; minC: number; maxC: number };
  spatialOffsetC: number;
  metroPercentile: number;
}

const CITIES: Record<string, CityRecord> = {
  houston: houston as unknown as CityRecord,
  phoenix: phoenix as unknown as CityRecord,
  lasvegas: lasvegas as unknown as CityRecord,
  austin: austin as unknown as CityRecord,
  miami: miami as unknown as CityRecord,
};

/** Houston leads: largest defensible gap, and the closest model-observation agreement. */
export const FEATURED_CITY = "houston";

export function listCities(): CityRecord[] {
  return [
    CITIES.houston, CITIES.phoenix, CITIES.lasvegas, CITIES.austin, CITIES.miami,
  ].filter(Boolean);
}

export function getCity(city: string): CityRecord | null {
  return CITIES[city] ?? null;
}

export function allParcels(): { city: CityRecord; parcel: ParcelRecord }[] {
  return listCities().flatMap((c) => c.parcels.map((p) => ({ city: c, parcel: p })));
}

export function findParcel(id: string): { city: CityRecord; parcel: ParcelRecord } | null {
  return allParcels().find((x) => x.parcel.id === id) ?? null;
}

/**
 * Turn a geocoded point into the same shape a seeded parcel has, so a looked-up
 * address and a showcase parcel render through exactly one code path. If the
 * two diverged, the demo would be showing something the search could not.
 */
export function parcelFromLookup(input: {
  matchedAddress: string;
  lat: number;
  lon: number;
  peakC: number;
  cellDistanceM: number;
  metroPercentile: number;
  stationPeakC: number;
}): ParcelRecord {
  return {
    id: "lookup",
    label: titleCaseAddress(input.matchedAddress),
    kind: "searched address",
    address: input.matchedAddress,
    lat: input.lat,
    lon: input.lon,
    tileDistanceM: Math.round(input.cellDistanceM),
    // Only the peak is measured for a looked-up point; the raster carries the
    // monthly maximum, which is the statistic the design gap is built from.
    tile: { avgC: NaN, minC: NaN, maxC: input.peakC },
    spatialOffsetC: Math.round((input.peakC - input.stationPeakC) * 100) / 100,
    metroPercentile: input.metroPercentile,
  };
}

/** Census returns SHOUTED addresses; this makes them readable as a heading. */
function titleCaseAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Tx|Az|Nv|Fl|Ca|Ny|Nw|Ne|Sw|Se|Us)\b/g, (m) => m.toUpperCase());
}

/** One traceable line of arithmetic behind a displayed figure. */
export interface ProvenanceStep {
  label: string;
  value: string;
  source: string;
}

export interface Report {
  city: CityRecord;
  parcel: ParcelRecord;
  gap: GapComponents;
  /** Reference-station figures, unchanged by location. */
  station: {
    cddPerYearC: number;
    cddBaseC: number;
    hoursAbovePerYear: Record<string, number>;
  };
  provenance: {
    standard: ProvenanceStep[];
    temporal: ProvenanceStep[];
    spatial: ProvenanceStep[];
  };
  caveats: string[];
}

export function buildReport(city: CityRecord, parcel: ParcelRecord): Report {
  const gap = computeGap({
    standardC: city.noaa.design04HistoricC,
    recentC: city.noaa.design04RecentC,
    fortyguardStationPeakC: city.fortyguard.stationTile.maxC,
    fortyguardParcelPeakC: parcel.tile.maxC,
  });

  const n = (x: number) => x.toLocaleString("en-US");
  const c = (x: number) => `${x.toFixed(2)} °C`;
  const sc = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} °C`;

  const caveats: string[] = [];
  if (city.noaa.historicMissingYears.length > 0) {
    caveats.push(
      `The reference window is stated as ${city.noaa.historicWindowRequested} but ` +
        `${city.noaa.historicMissingYears.length} of those years ` +
        `(${city.noaa.historicMissingYears[0]}–${city.noaa.historicMissingYears[city.noaa.historicMissingYears.length - 1]}) ` +
        `are absent from the NOAA archive. The figure is computed over ${city.noaa.historicWindow}.`,
    );
  }
  if (parcel.tileDistanceM > 60) {
    caveats.push(
      `The address sits ${parcel.tileDistanceM} m from the centre of its ` +
        `${city.fortyguard.granularityM} m tile, so the reading describes the surrounding block.`,
    );
  }
  const agree = city.validation.fortyguardMinusNoaaMaxC;
  if (agree !== null && Math.abs(agree) > 2) {
    caveats.push(
      `At this station FortyGuard's monthly peak differs from the NOAA observation by ` +
        `${sc(agree)}. Only the offset between two FortyGuard points is used, never its absolute level, ` +
        `but a large disagreement means the spatial term deserves more caution here.`,
    );
  }
  caveats.push(
    `The spatial offset is measured over ${city.fortyguard.month} only. It is assumed to hold at ` +
      `the design condition; that assumption is untested at the 0.4% tail.`,
  );

  return {
    city,
    parcel,
    gap,
    station: {
      cddPerYearC: city.noaa.cddPerYearC,
      cddBaseC: city.noaa.cddBaseC,
      hoursAbovePerYear: city.noaa.hoursAbovePerYear,
    },
    provenance: {
      standard: [
        {
          label: "Reference station",
          value: city.station.name,
          source: `NOAA ISD-Lite ${city.station.usaf}-${city.station.wban}`,
        },
        {
          label: "Record window",
          value: city.noaa.historicWindow,
          source: `${n(city.noaa.nHistoricObservations)} hourly observations`,
        },
        {
          label: "Method",
          value: "value exceeded 0.4% of hours",
          source: "ASHRAE annual cooling design condition, computed here from raw observations",
        },
        {
          label: "Published standard",
          value: c(city.noaa.design04HistoricC),
          source: "computed, not copied from any table",
        },
      ],
      temporal: [
        {
          label: `Same statistic, ${city.noaa.recentWindow}`,
          value: c(city.noaa.design04RecentC),
          source: `${n(city.noaa.nRecentObservations)} hourly observations, same station`,
        },
        {
          label: `Less ${city.noaa.historicWindow} value`,
          value: c(city.noaa.design04HistoricC),
          source: "same station, same method",
        },
        {
          label: "Temporal component",
          value: sc(gap.temporalC),
          source: "NOAA only — no model involved",
        },
      ],
      spatial: [
        {
          label: "FortyGuard at this parcel",
          value: c(parcel.tile.maxC),
          source: `${city.fortyguard.month} peak, ${city.fortyguard.granularityM} m tile`,
        },
        {
          label: "FortyGuard at the station",
          value: c(city.fortyguard.stationTile.maxC),
          source: "same request, same period, same granularity",
        },
        {
          label: "Spatial component",
          value: sc(gap.spatialC),
          source: `activity ${city.fortyguard.activityId.slice(0, 8)}, ${n(city.fortyguard.nTiles)} tiles`,
        },
      ],
    },
    caveats,
  };
}
