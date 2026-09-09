import test from "node:test";
import assert from "node:assert/strict";
import { fetchOnlineRoute, rankWaypoints, __setRequestOsrmForTests } from "../src/route/planner.js";
import { requestOsrm, __setFetchJsonForTests } from "../src/api/osrm.js";
import { enrichRouteElevations, __setFetchJsonForTests as setElevationFetch } from "../src/api/elevation.js";

const baseline = { distance: 10000, geometry: { coordinates: [[0, 0], [0.05, 0], [0.1, 0]] } };
const start = { lat: 0, lon: 0, label: "A" };
const end = { lat: 0, lon: 0.1, label: "B" };

test("rankWaypoints returns automatic stops by value/cost and de-duplicates", () => {
  const result = rankWaypoints([
    { name: "late", lat: 0, lon: 0.08, scenicValue: 20 },
    { name: "duplicate-low", lat: 0, lon: 0.02, scenicValue: 10 },
    { name: "early", lat: 0, lon: 0.02, scenicValue: 30 },
  ], baseline, { start, end });
  assert.deepEqual(result.map((item) => item.name), ["early", "late"]);
  assert.ok(result[0].utilityScore >= result[1].utilityScore);
  assert.equal(rankWaypoints([{ name: "demo", lat: 0, lon: 0.04, source: "离线演示占位" }], baseline).length, 0);
});

test("budget degradation removes the lowest utility automatic stop", async () => {
  const calls = [];
  __setRequestOsrmForTests(async (locations, signal, options) => {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    calls.push({ count: locations.length, options });
    const extra = locations.length > 3 ? 3000 : 0;
    return { ...baseline, distance: baseline.distance + extra };
  });
  const route = await fetchOnlineRoute({ start, end, detour: 10, bikeFriendly: false, stops: [
    { name: "cheap", lat: 0, lon: 0.03, scenicValue: 30 },
    { name: "expensive", lat: 0.02, lon: 0.05, scenicValue: 1 },
  ] }, new AbortController().signal);
  assert.deepEqual(route.stops.map((stop) => stop.name), ["cheap"]);
  assert.equal(route.droppedStops, 1);
  assert.ok(calls.length >= 2);
});

test("manual waypoints remain in their original order", async () => {
  __setRequestOsrmForTests(async (locations) => ({ ...baseline, distance: 10000, geometry: { coordinates: [[0, 0], [0.1, 0]] } }));
  const route = await fetchOnlineRoute({ start, end, detour: 0, bikeFriendly: false, stops: [
    { name: "manual 1", lat: 0, lon: 0.07, source: "用户添加", type: "用户途经点" },
    { name: "manual 2", lat: 0, lon: 0.02, source: "用户添加", type: "用户途经点" },
  ] }, new AbortController().signal);
  assert.deepEqual(route.stops.map((stop) => stop.name), ["manual 1", "manual 2"]);
});

test("manual waypoints survive an over-budget route with a warning", async () => {
  __setRequestOsrmForTests(async (locations) => ({ ...baseline, distance: locations.length > 2 ? 20000 : 10000, geometry: { coordinates: locations.map((point) => [point.lon, point.lat]) } }));
  const route = await fetchOnlineRoute({ start, end, detour: 0, bikeFriendly: false, stops: [
    { name: "manual", lat: 0, lon: 0.04, source: "用户添加", type: "用户途经点" },
  ] }, new AbortController().signal);
  assert.deepEqual(route.stops.map((stop) => stop.name), ["manual"]);
  assert.equal(route.distanceKm, 20);
  assert.deepEqual(route.points.map(({ lat, lon }) => [lat, lon]), [[0, 0], [0, 0.04], [0, 0.1]]);
  assert.match(route.routingWarning, /手动途经点/);
});

test("unreachable manual waypoints cannot silently export a route bypassing them", async () => {
  let call = 0;
  __setRequestOsrmForTests(async () => {
    call += 1;
    if (call === 1) return baseline;
    throw Object.assign(new Error("NoRoute"), { code: "NoRoute" });
  });
  await assert.rejects(fetchOnlineRoute({ start, end, detour: 0, bikeFriendly: false, stops: [
    { name: "manual", lat: 0, lon: 0.04, source: "用户添加", type: "用户途经点" },
  ] }, new AbortController().signal), /指定途经点无法接入骑行道路/);
});

test("an empty discovery pool preserves selected curated stops in online requests", async () => {
  const calls = [];
  __setRequestOsrmForTests(async (locations) => {
    calls.push(locations);
    return { ...baseline, geometry: { coordinates: locations.map((point) => [point.lon, point.lat]) } };
  });
  const route = await fetchOnlineRoute({ start, end, detour: 30, candidateStops: [], stops: [
    { name: "已选真实景点", lat: 0, lon: 0.04, source: "公开骑行内容线索" },
  ] });
  assert.deepEqual(route.stops.map((stop) => stop.name), ["已选真实景点"]);
  assert.equal(calls[1][1].name, "已选真实景点");
});

test("large discovery results route only the best few automatic candidates", async () => {
  const counts = [];
  __setRequestOsrmForTests(async (locations) => {
    counts.push(locations.length);
    return baseline;
  });
  const route = await fetchOnlineRoute({ start, end, scenic: 72, detour: 30, candidateStops: Array.from({ length: 150 }, (_, index) => (
    { name: `景点 ${index}`, lat: 0, lon: index / 1600, scenicValue: index }
  )) });
  assert.equal(route.stops.length, 3);
  assert.deepEqual(counts, [2, 5]);
});

test("cancellation propagates from planner to OSRM requester", async () => {
  const controller = new AbortController();
  __setRequestOsrmForTests(async (_locations, signal) => {
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  });
  const pending = fetchOnlineRoute({ start, end, detour: 0, bikeFriendly: false, stops: [] }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("OSRM validates distance and geometry", async () => {
  __setFetchJsonForTests(async () => ({ code: "Ok", routes: [{ distance: -1, geometry: { coordinates: [[0, 0], [0, 0]] } }] }));
  await assert.rejects(requestOsrm([start, end], new AbortController().signal), { code: "InvalidDistance" });
});

test("retries a 400 response without the unsupported exclude option", async () => {
  const calls = [];
  __setRequestOsrmForTests();
  __setFetchJsonForTests(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) {
      const error = new Error("HTTP 400");
      error.status = 400;
      throw error;
    }
    return { code: "Ok", routes: [{ distance: 1000, geometry: { coordinates: [[0, 0], [0.01, 0.01]] } }] };
  });
  const route = await fetchOnlineRoute({ start, end, detour: 20, bikeFriendly: true, stops: [] }, new AbortController().signal);
  assert.equal(route.source, "osrm");
  assert.equal(calls.length, 2);
  assert.match(route.routingWarning, /不支持道路排除/);
});

test("null elevation stays null instead of becoming zero", async () => {
  setElevationFetch(async () => ({ results: [{ elevation: null }, { elevation: 10 }, { elevation: 20 }] }));
  const route = await enrichRouteElevations({ points: [
    { lat: 0, lon: 0, ele: null, hasElevation: false },
    { lat: 0, lon: 0.01, ele: null, hasElevation: false },
    { lat: 0, lon: 0.02, ele: null, hasElevation: false },
  ], stops: [] }, new AbortController().signal);
  assert.equal(route.points[0].ele, null);
  assert.equal(route.points[0].hasElevation, false);
  assert.equal(route.points[1].ele, 10);
});

test.after(() => {
  __setRequestOsrmForTests();
  __setFetchJsonForTests();
  setElevationFetch();
});
