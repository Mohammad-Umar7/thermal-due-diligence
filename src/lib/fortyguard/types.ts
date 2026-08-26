/**
 * Types for the FortyGuard Temperature API v1.0.0.
 *
 * Derived from the live documentation at https://docs-api.fortyguard.com/docs
 * read on 2026-08-26, and corrected against observed behaviour where the two
 * disagree. Divergences are noted inline; docs/API_NOTES.md carries the detail.
 *
 * Units differ per endpoint - /heatmap and /env_params are Celsius,
 * /heat_intelligence is Fahrenheit - so units are named in the field names.
 */

/** A GeoJSON position, [longitude, latitude]. Note the order. */
export type Position = [number, number];

/** A closed linear ring: first and last positions must be identical. */
export type LinearRing = Position[];

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: LinearRing[];
}

export interface GeoJsonFeature<P = Record<string, unknown>> {
  type: "Feature";
  properties: P;
  geometry: GeoJsonPolygon;
}

export interface GeoJsonFeatureCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: GeoJsonFeature<P>[];
}

/**
 * The documentation specifies a FeatureCollection. A bare Polygon is also
 * accepted in practice (verified 2026-08-26), but we send what is documented.
 */
export type PolygonAoi = GeoJsonFeatureCollection | GeoJsonPolygon;

/**
 * 1 single hour, 2 range of hours within one day (max 23h),
 * 3 single day (00:00-23:59), 4 range of days (max 1 month).
 *
 * filter_type 4 is documented on the Create Heatmap page but omitted from the
 * Known Limitations page and the v1.0.0 release notes. It works; verified
 * 2026-08-26 with a full calendar month in one request.
 */
export type FilterType = 1 | 2 | 3 | 4;

/** Metres per tile. The only accepted values. */
export type Granularity = 60 | 80 | 100;

/**
 * tcm            - temperature snapshot, values in Celsius
 * time_of_measure- hour of day (0-23, UTC) of the peak
 * exceedance     - count of hours past `threshold`
 * persistence    - longest unbroken run of hours past `threshold`
 *
 * Choosing the wrong layer yields a confident wrong answer: exceedance and
 * persistence return hours, not temperatures.
 */
export type AnalyticType = "tcm" | "time_of_measure" | "exceedance" | "persistence";

export interface DateTimeSpec {
  /** YYYY-MM-DD. Earliest accepted is 2019-01-01. */
  start_date: string;
  /** YYYY-MM-DD. Required for filter_type 4. */
  end_date?: string;
  /** HH:MM, 24-hour. Required for filter_type 1 and 2. */
  start_time?: string;
  /** HH:MM, 24-hour. Required for filter_type 2. */
  end_time?: string;
  filter_type: FilterType;
}

export interface HeatmapRequest {
  polygon_aoi: PolygonAoi;
  date_time: DateTimeSpec;
  granularity: Granularity;
  analytic_type?: AnalyticType;
  /** Celsius. Only meaningful for exceedance and persistence. Defaults to 30. */
  threshold?: number;
  /** Defaults to "above". Only meaningful for exceedance and persistence. */
  direction?: "above" | "below";
}

/** Per-tile properties on a returned heatmap feature. */
export interface TileProperties {
  tile_id: number;
  average_temperature: number;
  min_temperature: number;
  max_temperature: number;
}

export interface TemperatureStats {
  minimum: number;
  maximum: number;
  mean: number;
  standard_deviation: number;
}

export interface HeatmapStatsData {
  temperature_stats?: TemperatureStats;
  /**
   * Despite the name this is a five-number summary
   * (min, Q1, median, Q3, max) across tiles - NOT a distribution over hours.
   * It cannot be used to derive an hourly percentile. Verified 2026-08-26.
   */
  overall_temperature_distribution?: number[];
  normal_temperature_distribution?: { x_axis: number[]; y_axis: number[] };
  temperature_frequency?: { x_axis: number[]; y_axis: number[] };
}

export interface HeatmapResult {
  map_data: GeoJsonFeatureCollection<TileProperties>;
  stats_data: HeatmapStatsData;
}

export type ActivityStatus = "Processing" | "Completed" | "Failed";

export interface ApiEnvelope<T> {
  error: boolean;
  status_code: number;
  message: string;
  data: T;
}

export interface SubmitData {
  activity_id: string;
}

export interface StatusData<R> {
  activity_id: string;
  status: ActivityStatus;
  result?: R;
}

export interface CreditSummary {
  total_available_credits: number;
  cycle_credits_used: number;
  cycle_remaining_credits: number;
  cycle_usage_percentage: number;
  total_credits_used: number;
  total_remaining_credits: number;
}

/** A tile reduced to what this application needs. */
export interface Tile {
  lat: number;
  lon: number;
  avgC: number;
  minC: number;
  maxC: number;
}

export class FortyGuardError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "auth"
      | "validation"
      | "no-coverage"
      | "rate-limit"
      | "credits-exhausted"
      | "timeout"
      | "failed"
      | "server"
      | "network",
    readonly httpStatus?: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "FortyGuardError";
  }
}
