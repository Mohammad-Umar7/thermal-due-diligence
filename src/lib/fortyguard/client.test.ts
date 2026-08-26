import { describe, expect, it, vi } from "vitest";
import { FortyGuardClient, MemoryCache, cacheKey, squareAoi, tileAt, toTiles } from "./client";
import { FortyGuardError, type GeoJsonFeatureCollection, type HeatmapRequest, type TileProperties } from "./types";

const noSleep = async () => {};

const REQ: HeatmapRequest = {
  polygon_aoi: squareAoi(29.78, -95.39, 1000),
  date_time: { start_date: "2024-07-01", end_date: "2024-07-31", filter_type: 4 },
  granularity: 100,
};

function tileFeature(id: number, lat: number, lon: number, avg: number) {
  const d = 0.0005;
  return {
    type: "Feature" as const,
    properties: { tile_id: id, average_temperature: avg, min_temperature: avg - 5, max_temperature: avg + 5 },
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d],
      ] as [number, number][]],
    },
  };
}

function resultWith(features: ReturnType<typeof tileFeature>[]) {
  return { map_data: { type: "FeatureCollection", features }, stats_data: {} };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeClient(handler: (url: string, init?: RequestInit) => Response, extra = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    return handler(u, init);
  }) as unknown as typeof fetch;
  const client = new FortyGuardClient({
    apiKey: "test-key",
    fetchImpl,
    sleepImpl: noSleep,
    cache: new MemoryCache(),
    ...extra,
  });
  return { client, calls, fetchImpl };
}

describe("submit and poll", () => {
  it("polls until Completed and returns the result", async () => {
    let statusCalls = 0;
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      statusCalls += 1;
      const status = statusCalls < 3 ? "Processing" : "Completed";
      return jsonResponse(200, {
        error: false, status_code: 200, message: status,
        data: { activity_id: "abc", status, result: status === "Completed" ? resultWith([tileFeature(0, 29.78, -95.39, 37)]) : undefined },
      });
    });

    const result = await client.heatmap(REQ);
    expect(result.map_data.features).toHaveLength(1);
    expect(statusCalls).toBe(3);
  });

  it("tolerates a 404 immediately after submission", async () => {
    let statusCalls = 0;
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      statusCalls += 1;
      if (statusCalls <= 2) return jsonResponse(404, { message: "Activity not found" });
      return jsonResponse(200, {
        error: false, status_code: 200, message: "Completed",
        data: { activity_id: "abc", status: "Completed", result: resultWith([tileFeature(0, 29.78, -95.39, 37)]) },
      });
    });

    const result = await client.heatmap(REQ);
    expect(result.map_data.features).toHaveLength(1);
    expect(statusCalls).toBe(3);
  });

  it("raises a distinct error when the activity fails", async () => {
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      return jsonResponse(200, {
        error: false, status_code: 200, message: "Failed",
        data: { activity_id: "abc", status: "Failed" },
      });
    });
    await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind: "failed" });
  });
});

describe("empty results are not data", () => {
  it("treats a Completed-but-empty result as no coverage", async () => {
    // This is exactly what a non-US area returns: success, zero tiles, and a
    // credit charge. It must never reach the caller as a valid reading.
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      return jsonResponse(200, {
        error: false, status_code: 200, message: "Completed",
        data: { activity_id: "abc", status: "Completed", result: resultWith([]) },
      });
    });
    await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind: "no-coverage" });
  });

  it("does not cache an empty result, so a later fix is not masked", async () => {
    let submits = 0;
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        submits += 1;
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      return jsonResponse(200, {
        error: false, status_code: 200, message: "Completed",
        data: { activity_id: "abc", status: "Completed", result: resultWith([]) },
      });
    });
    await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind: "no-coverage" });
    await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind: "no-coverage" });
    expect(submits).toBe(2);
  });
});

describe("caching", () => {
  it("serves an identical request from cache without spending credits", async () => {
    let submits = 0;
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        submits += 1;
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      return jsonResponse(200, {
        error: false, status_code: 200, message: "Completed",
        data: { activity_id: "abc", status: "Completed", result: resultWith([tileFeature(0, 29.78, -95.39, 37)]) },
      });
    });

    await client.heatmap(REQ);
    await client.heatmap(REQ);
    await client.heatmap({ ...REQ });
    expect(submits).toBe(1);
  });

  it("produces a stable key regardless of key insertion order", () => {
    const a: HeatmapRequest = { polygon_aoi: REQ.polygon_aoi, date_time: REQ.date_time, granularity: 100 };
    const b: HeatmapRequest = { granularity: 100, date_time: REQ.date_time, polygon_aoi: REQ.polygon_aoi };
    expect(cacheKey(a)).toBe(cacheKey(b));
  });

  it("distinguishes requests that differ only by analytic type", () => {
    expect(cacheKey({ ...REQ, analytic_type: "tcm" })).not.toBe(cacheKey({ ...REQ, analytic_type: "exceedance" }));
  });

  it("never calls the network in fixtures-only mode", async () => {
    const { client, fetchImpl } = makeClient(() => jsonResponse(200, {}), { fixturesOnly: true });
    await expect(client.heatmap(REQ)).rejects.toBeInstanceOf(FortyGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("error classification", () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { message: "bad key" }, "auth"],
    [403, { message: "not on plan" }, "credits-exhausted"],
    [429, { message: "slow down" }, "rate-limit"],
    [400, { message: "bad date", code: "NO_COVERAGE" }, "no-coverage"],
    [422, { message: "missing field" }, "validation"],
    [500, { message: "boom" }, "server"],
  ];
  for (const [status, body, kind] of cases) {
    it(`maps HTTP ${status} to ${kind}`, async () => {
      const { client } = makeClient(() => jsonResponse(status, body));
      await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind });
    });
  }

  it("wraps a network failure rather than leaking it", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection reset");
    }) as unknown as typeof fetch;
    const client = new FortyGuardClient({ apiKey: "k", fetchImpl, sleepImpl: noSleep });
    await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind: "network" });
  });

  it("times out instead of polling forever", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { client } = makeClient((url) => {
      if (url.endsWith("/heatmap")) {
        return jsonResponse(200, { error: false, status_code: 200, message: "ok", data: { activity_id: "abc" } });
      }
      now += 60_000;
      return jsonResponse(200, {
        error: false, status_code: 200, message: "Processing",
        data: { activity_id: "abc", status: "Processing" },
      });
    }, { pollTimeoutMs: 300_000 });
    await expect(client.heatmap(REQ)).rejects.toMatchObject({ kind: "timeout" });
    vi.restoreAllMocks();
  });
});

describe("geometry", () => {
  it("builds a closed ring", () => {
    const fc = squareAoi(29.78, -95.39, 1000) as GeoJsonFeatureCollection;
    const ring = fc.features[0].geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it("compensates longitude for latitude so the box stays square", () => {
    const at60 = squareAoi(60, 0, 1000) as GeoJsonFeatureCollection;
    const ring = at60.features[0].geometry.coordinates[0];
    const lonSpanDeg = ring[1][0] - ring[0][0];
    const latSpanDeg = ring[2][1] - ring[1][1];
    // At 60 degrees latitude a degree of longitude is half a degree of latitude,
    // so the same ground distance needs roughly twice the longitude span.
    expect(lonSpanDeg / latSpanDeg).toBeCloseTo(2, 1);
  });

  it("reduces features to centroids", () => {
    const tiles = toTiles({
      type: "FeatureCollection",
      features: [tileFeature(0, 29.78, -95.39, 37)],
    } as GeoJsonFeatureCollection<TileProperties>);
    expect(tiles[0].lat).toBeCloseTo(29.78, 6);
    expect(tiles[0].lon).toBeCloseTo(-95.39, 6);
    expect(tiles[0].avgC).toBe(37);
    expect(tiles[0].maxC).toBe(42);
  });
});

describe("tileAt", () => {
  const tiles = [
    { lat: 29.78, lon: -95.39, avgC: 37, minC: 30, maxC: 42 },
    { lat: 29.9, lon: -95.5, avgC: 36, minC: 29, maxC: 41 },
  ];

  it("returns the containing tile for a nearby point", () => {
    const hit = tileAt(tiles, 29.7801, -95.3901);
    expect(hit?.tile.avgC).toBe(37);
    expect(hit?.distanceM).toBeLessThan(250);
  });

  it("returns null rather than matching a distant tile", () => {
    expect(tileAt(tiles, 40.0, -80.0)).toBeNull();
  });

  it("returns null for an empty tile set", () => {
    expect(tileAt([], 29.78, -95.39)).toBeNull();
  });
});
