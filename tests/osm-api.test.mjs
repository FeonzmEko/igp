import test from "node:test";
import assert from "node:assert/strict";
import { discoverScenicStops, queryRouteAmenities, routeCoordinates, safeElement } from "../src/api/osm.js";

function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}
const response = (elements = [], extra = {}) => ({ ok: true, json: async () => ({ elements, ...extra }) });
const decodeQuery = (options) => new URLSearchParams(options.body).get("data");
const point = (id, tags, lat = 30, lon = 120.05) => ({ type: "node", id, lat, lon, tags });
const route = { points: [{ lat: 30, lon: 120 }, { lat: 30, lon: 120.1 }] };

function polyline(query) {
  const line = query.match(/\(around:\d+,([^)]*)\)/)?.[1];
  assert.ok(line, "request contains an Overpass polyline around filter");
  const values = line.split(",").map(Number);
  return Array.from({ length: values.length / 2 }, (_, index) => values.slice(index * 2, index * 2 + 2));
}

test("Shanghai to Ganpu discovery uses a few polyline statements instead of thousands of point queries", async (t) => {
  const queries = [];
  mockFetch(t, async (_url, options) => { queries.push(decodeQuery(options)); return response(); });
  await discoverScenicStops({ lat: 31.24981, lon: 121.45522 }, { lat: 30.3935, lon: 120.889725 }, 72);
  assert.ok(queries.length >= 1 && queries.length <= 3);
  assert.ok(queries.reduce((total, query) => total + query.length, 0) < 4000);
  for (const query of queries) {
    assert.equal((query.match(/around:/g) || []).length, 2);
    assert.ok(polyline(query).length >= 2);
  }
});

test("dense road geometry is bounded without losing the connecting segment between batches", async (t) => {
  const queries = [];
  const points = Array.from({ length: 1000 }, (_, index) => ({ lat: 30 + (index % 2) * 0.0003, lon: 120 + index * 0.0001 }));
  mockFetch(t, async (_url, options) => {
    queries.push(decodeQuery(options));
    return response([point(1, { name: "重复观景台", tourism: "viewpoint" })]);
  });
  const result = await queryRouteAmenities({ points });
  assert.equal(result.status, "ready");
  assert.equal(result.features.length, 1, "features are deduplicated across overlapping batches");
  assert.ok(queries.length > 1 && queries.length <= 10);
  for (let index = 0; index < queries.length; index += 1) {
    const current = polyline(queries[index]);
    assert.ok(current.length <= 128);
    assert.ok(queries[index].length < 35000, "individual requests stay bounded");
    assert.equal((queries[index].match(/around:/g) || []).length, 11);
    if (index) assert.deepEqual(polyline(queries[index - 1]).at(-1), current[0]);
  }
});

test("1000 nearly straight road points collapse to small queries while preserving endpoints", async (t) => {
  const queries = [];
  const points = Array.from({ length: 1000 }, (_, index) => ({ lat: 30 + index * 0.001, lon: 120 + index * 0.001 }));
  mockFetch(t, async (_url, options) => { queries.push(decodeQuery(options)); return response(); });
  const result = await queryRouteAmenities({ points });
  assert.equal(result.routePoints, 1000, "original geometry remains available for distance checks");
  assert.ok(queries.length <= 3);
  assert.ok(queries.reduce((sum, query) => sum + query.length, 0) < 6000);
  assert.deepEqual(polyline(queries[0])[0], [30, 120]);
  assert.deepEqual(polyline(queries.at(-1)).at(-1), [30.999, 120.999]);
});

test("discovery keeps named real stops and source identity, excluding water centers and inaccessible or unnamed features", async (t) => {
  mockFetch(t, async () => response([
    point(1, { "name:zh": "江边观景台", tourism: "viewpoint" }),
    point(2, { tourism: "viewpoint" }),
    { type: "relation", id: 3, center: { lat: 30, lon: 120.06 }, tags: { name: "湖心", natural: "water", tourism: "attraction" } },
    { type: "way", id: 4, center: { lat: 30, lon: 120.07 }, tags: { name: "滨水公园", leisure: "park" } },
    point(5, { name: "私人观景点", tourism: "viewpoint", access: "private" }),
    point(6, { name: "远处观景点", tourism: "viewpoint" }, 30.02),
    point(7, { name: "河道中心", waterway: "river" }),
    point(8, { name: "厂区", landuse: "industrial", tourism: "attraction" }),
  ]));
  const result = await discoverScenicStops(route.points[0], route.points[1]);
  assert.deepEqual(result.stops.map((item) => item.name), ["江边观景台", "滨水公园"]);
  assert.equal(result.stops[0].id, 1);
  assert.equal(result.stops[0].osmId, 1);
  assert.equal(result.stops[0].osmType, "node");
  assert.equal(result.stops[0].sourceUrl, "https://www.openstreetmap.org/node/1");
  assert.equal(result.stops[1].sourceUrl, "https://www.openstreetmap.org/way/4");
});

test("environment keeps lake data for scoring, while supplies are checked against the original 500 m corridor", async (t) => {
  mockFetch(t, async () => response([
    point(1, { name: "湖面", natural: "water" }),
    point(2, { name: "近处咖啡", amenity: "cafe" }, 30 + 490 / 111320),
    point(3, { name: "超范围咖啡", amenity: "cafe" }, 30 + 505 / 111320),
    point(4, { name: "便利店", shop: "convenience" }),
  ]));
  const result = await queryRouteAmenities(route);
  assert.equal(result.features.length, 4);
  assert.deepEqual(result.supplies.items.map((item) => item.name), ["近处咖啡", "便利店"]);
  assert.equal(result.supplies.items[0].distanceMeters, 490);
});

test("partial network failure preserves earlier batches and stops retrying the failed service", async (t) => {
  let requests = 0;
  mockFetch(t, async () => {
    requests += 1;
    if (requests === 2) throw new Error("service unavailable");
    return response([point(1, { name: "便利店", shop: "convenience" })]);
  });
  const result = await queryRouteAmenities({ points: [{ lat: 30, lon: 120 }, { lat: 32, lon: 122 }] });
  assert.equal(requests, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.supplies.status, "partial");
  assert.equal(result.features.length, 1);
  assert.match(result.error, /service unavailable/);
});

test("Overpass remarks report partial results and first-request failure reports unavailable", async (t) => {
  let requests = 0;
  mockFetch(t, async () => {
    requests += 1;
    if (requests === 1) return response([point(1, { tourism: "viewpoint", name: "观景台" })], { remark: "runtime limit" });
    throw new Error("network down");
  });
  const partial = await queryRouteAmenities(route);
  assert.equal(partial.status, "partial");
  assert.equal(partial.features.length, 1);
  const unavailable = await queryRouteAmenities(route);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.features.length, 0);
});

test("caller cancellation propagates without returning empty success or launching later batches", async (t) => {
  const controller = new AbortController();
  let requests = 0;
  mockFetch(t, async (_url, options) => {
    requests += 1;
    assert.equal(options.signal.aborted, false);
    controller.abort();
    throw new DOMException("Aborted", "AbortError");
  });
  await assert.rejects(queryRouteAmenities({ points: [{ lat: 30, lon: 120 }, { lat: 32, lon: 122 }] }, controller.signal), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("invalid null coordinates cannot become Gulf of Guinea features or valid route points", () => {
  assert.deepEqual(routeCoordinates([{ lat: null, lon: null }, { lat: 30, lon: 120 }]), [[120, 30]]);
  const feature = safeElement({ type: "node", id: 1, lat: null, lon: null });
  assert.equal(feature.lat, undefined);
  assert.equal(feature.lon, undefined);
});
