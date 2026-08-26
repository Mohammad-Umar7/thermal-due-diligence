/**
 * FortyGuard Temperature API client.
 *
 * Three things this wrapper exists to get right:
 *
 *  1. The API is asynchronous. POST returns an activity_id; the result arrives
 *     through GET /status/{id}. A 404 immediately after submission means "not
 *     ready", not "gone" - the docs say so explicitly, and treating it as fatal
 *     is the most likely way to lose a request that has already been paid for.
 *
 *  2. Every successful request costs credits, whether or not it returns data.
 *     An area outside coverage returns Completed with zero features and still
 *     charges. So: cache before spending, and treat an empty result as a
 *     distinct, named failure rather than as data.
 *
 *  3. Cost is flat per request - 4,220 credits regardless of area or time span
 *     (measured 2026-08-26). The right shape for a query is therefore always
 *     the largest useful area over the longest allowed period, not many small
 *     ones.
 */

import {
  FortyGuardError,
  type ApiEnvelope,
  type CreditSummary,
  type GeoJsonFeatureCollection,
  type HeatmapRequest,
  type HeatmapResult,
  type Position,
  type StatusData,
  type SubmitData,
  type Tile,
  type TileProperties,
} from "./types";

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Persistence for completed results. Omit for an in-memory cache. */
  cache?: ResultCache;
  /** Serve only from cache/fixtures; never touch the network. */
  fixturesOnly?: boolean;
  /** Total wall-clock budget for one submit-and-poll cycle. */
  pollTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected for tests, so the suite does not actually sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface ResultCache {
  get(key: string): Promise<HeatmapResult | null>;
  set(key: string, value: HeatmapResult): Promise<void>;
}

export class MemoryCache implements ResultCache {
  private store = new Map<string, HeatmapResult>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: HeatmapResult) {
    this.store.set(key, value);
  }
}

const DEFAULT_BASE = "https://api.fortyguard.com/v1";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FortyGuardClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly cache: ResultCache;
  private readonly fixturesOnly: boolean;
  private readonly pollTimeoutMs: number;
  private readonly doFetch: typeof fetch;
  private readonly doSleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.cache = opts.cache ?? new MemoryCache();
    this.fixturesOnly = opts.fixturesOnly ?? false;
    this.pollTimeoutMs = opts.pollTimeoutMs ?? 15 * 60 * 1000;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.doSleep = opts.sleepImpl ?? sleep;
  }

  /**
   * Submit a heatmap request and return its completed result.
   * Served from cache when the identical request has been made before.
   */
  async heatmap(req: HeatmapRequest): Promise<HeatmapResult> {
    const key = cacheKey(req);
    const cached = await this.cache.get(key);
    if (cached) return cached;

    if (this.fixturesOnly) {
      throw new FortyGuardError(
        "No recorded result for this request and live calls are disabled.",
        "no-coverage",
      );
    }

    const activityId = await this.submit(req);
    const result = await this.pollForResult(activityId);

    const features = result.map_data?.features ?? [];
    if (features.length === 0) {
      // Completed, charged, and empty. This is what an out-of-coverage area
      // looks like: it does not reject. Naming it prevents an empty
      // FeatureCollection from being read downstream as "zero degrees".
      throw new FortyGuardError(
        "FortyGuard returned no temperature tiles for this area. Coverage is limited to the United States.",
        "no-coverage",
      );
    }

    await this.cache.set(key, result);
    return result;
  }

  private async submit(req: HeatmapRequest): Promise<string> {
    const res = await this.call("POST", "/heatmap", req);
    const body = (await this.readJson(res)) as ApiEnvelope<SubmitData>;
    if (!res.ok || body?.error) {
      throw this.classify(res.status, body);
    }
    const id = body?.data?.activity_id;
    if (!id) {
      throw new FortyGuardError("Submission succeeded but returned no activity_id.", "server", res.status, body);
    }
    return id;
  }

  /**
   * Poll until Completed or Failed.
   *
   * Backoff starts short (results can land in ~2 minutes) and widens to 15s.
   * Early 404s are tolerated for a grace window because the docs state the
   * activity may briefly be unknown right after submission.
   */
  private async pollForResult(activityId: string): Promise<HeatmapResult> {
    const startedAt = Date.now();
    const grace404Ms = 90_000;
    let delay = 3_000;

    while (Date.now() - startedAt < this.pollTimeoutMs) {
      const res = await this.call("GET", `/status/${encodeURIComponent(activityId)}`);

      if (res.status === 404) {
        if (Date.now() - startedAt < grace404Ms) {
          await this.doSleep(delay);
          continue;
        }
        throw new FortyGuardError(
          `Activity ${activityId} was not found after ${Math.round(grace404Ms / 1000)}s.`,
          "server",
          404,
        );
      }

      const body = (await this.readJson(res)) as ApiEnvelope<StatusData<HeatmapResult>>;
      if (!res.ok) throw this.classify(res.status, body);

      const data = body?.data;
      if (data?.status === "Completed") {
        if (!data.result) {
          throw new FortyGuardError("Activity completed without a result payload.", "server", res.status, body);
        }
        return data.result;
      }
      if (data?.status === "Failed") {
        // Failed activities are not charged.
        throw new FortyGuardError(`Activity ${activityId} failed during processing.`, "failed", res.status, body);
      }

      await this.doSleep(delay);
      delay = Math.min(Math.round(delay * 1.5), 15_000);
    }

    throw new FortyGuardError(
      `Activity ${activityId} did not complete within ${Math.round(this.pollTimeoutMs / 1000)}s.`,
      "timeout",
    );
  }

  async credits(): Promise<CreditSummary> {
    const res = await this.call("POST", "/system/fetch-api-key-usage", { api_key: this.apiKey });
    const body = (await this.readJson(res)) as { credit_summary?: CreditSummary };
    if (!res.ok || !body?.credit_summary) {
      throw this.classify(res.status, body);
    }
    return body.credit_summary;
  }

  private async call(method: "GET" | "POST", path: string, payload?: unknown): Promise<Response> {
    const headers: Record<string, string> = { "api-key": this.apiKey };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: "no-store",
      });
    } catch (cause) {
      throw new FortyGuardError(
        `Network request to ${path} failed.`,
        "network",
        undefined,
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  private async readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  private classify(status: number, body: unknown): FortyGuardError {
    const b = body as { message?: string; code?: string; detail?: unknown } | null;
    const message = b?.message ?? `FortyGuard request failed with HTTP ${status}.`;

    if (status === 401) return new FortyGuardError("API key missing or invalid.", "auth", status, b);
    if (status === 403) {
      return new FortyGuardError(
        "This endpoint is not available on the current plan.",
        "credits-exhausted",
        status,
        b,
      );
    }
    if (status === 429) {
      return new FortyGuardError("Rate limit exceeded. Retry shortly.", "rate-limit", status, b);
    }
    if (status === 400 || status === 422) {
      const kind = b?.code === "NO_COVERAGE" ? "no-coverage" : "validation";
      return new FortyGuardError(message, kind, status, b);
    }
    if (status >= 500) return new FortyGuardError(message, "server", status, b);
    return new FortyGuardError(message, "server", status, b);
  }
}

// --- geometry and reduction ---------------------------------------------------

/**
 * A closed square ring of side `metres` centred on a point.
 * Longitude degrees shrink with latitude, so the east-west span is scaled by
 * cos(latitude); without that the box is visibly rectangular away from the equator.
 */
export function squareAoi(lat: number, lon: number, metres: number): GeoJsonFeatureCollection {
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.max(0.2, Math.abs(Math.cos((lat * Math.PI) / 180))));
  const hLat = dLat / 2;
  const hLon = dLon / 2;
  const ring: Position[] = [
    [lon - hLon, lat - hLat],
    [lon + hLon, lat - hLat],
    [lon + hLon, lat + hLat],
    [lon - hLon, lat + hLat],
    [lon - hLon, lat - hLat],
  ];
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
  };
}

/** Reduce a heatmap FeatureCollection to tile centroids plus temperatures. */
export function toTiles(fc: GeoJsonFeatureCollection<TileProperties>): Tile[] {
  return (fc.features ?? []).map((f) => {
    const ring = f.geometry.coordinates[0];
    // A tile ring is a closed rectangle: average the four distinct corners.
    const corners = ring.slice(0, 4);
    const lon = corners.reduce((a, c) => a + c[0], 0) / corners.length;
    const lat = corners.reduce((a, c) => a + c[1], 0) / corners.length;
    return {
      lat,
      lon,
      avgC: f.properties.average_temperature,
      minC: f.properties.min_temperature,
      maxC: f.properties.max_temperature,
    };
  });
}

/**
 * The tile containing, or nearest to, a point.
 * Returns null when the nearest tile is further away than `maxDistanceM`, so a
 * point outside the queried area is reported rather than silently matched to
 * a distant tile.
 */
export function tileAt(tiles: readonly Tile[], lat: number, lon: number, maxDistanceM = 250):
  | { tile: Tile; distanceM: number }
  | null {
  let best: Tile | null = null;
  let bestSq = Infinity;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const t of tiles) {
    const dy = t.lat - lat;
    const dx = (t.lon - lon) * cos;
    const sq = dy * dy + dx * dx;
    if (sq < bestSq) {
      bestSq = sq;
      best = t;
    }
  }
  if (!best) return null;
  const distanceM = Math.sqrt(bestSq) * 111_320;
  return distanceM <= maxDistanceM ? { tile: best, distanceM } : null;
}

/** Stable cache key: identical requests must produce identical keys. */
export function cacheKey(req: HeatmapRequest): string {
  return JSON.stringify(req, Object.keys(req).sort());
}
