import test from "node:test";
import assert from "node:assert/strict";
import { calculateScenicScore } from "../src/route/scenic.js";

const route = { points: [{ lat: 30, lon: 120 }, { lat: 30, lon: 120.1 }], distanceKm: 10 };

test("returns null score for offline OSM data", () => {
  const result = calculateScenicScore(route, { status: "offline" });
  assert.equal(result.score, null);
  assert.equal(result.status, "offline");
});

test("classifies nearby OSM features and applies weighted score", () => {
  const result = calculateScenicScore(route, {
    status: "ok",
    dataSource: "test",
    features: [
      { id: 1, lat: 30, lon: 120.04, tags: { natural: "water" } },
      { id: 2, lat: 30, lon: 120.04, tags: { tourism: "viewpoint" } },
      { id: 3, lat: 30, lon: 120.04, tags: { landuse: "industrial" } },
      { id: 4, lat: 31, lon: 121, tags: { natural: "forest" } },
    ],
  });
  assert.equal(result.counts.water, 1);
  assert.equal(result.counts.viewpoint, 1);
  assert.equal(result.counts.industrial, 1);
  assert.equal(result.counts.forest, 0);
  assert.equal(result.score, 35);
  assert.equal(result.dataSource, "test");
});

test("caps dense contributions to the 0-100 range", () => {
  const features = Array.from({ length: 100 }, (_, id) => ({ id, lat: 30, lon: 120.05, tags: { natural: "water" } }));
  const result = calculateScenicScore(route, { status: "ok", features });
  assert.equal(result.score, 25);
  assert.ok(result.score >= 0 && result.score <= 100);
});

