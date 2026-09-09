import { fetchJson, getConfig } from "./http.js";

let fetchJsonImpl = fetchJson;
export function __setFetchJsonForTests(fetcher) { fetchJsonImpl = fetcher || fetchJson; }

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const haversineKm = (a, b) => {
  const radius = 6371;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
};
const nearestPointIndex = (points, target) => points.reduce((best, point, index) => {
  return haversineKm(point, target) < haversineKm(points[best], target) ? index : best;
}, 0);
const samplePointIndices = (length, maxSamples = 100) => length <= maxSamples
  ? Array.from({ length }, (_, index) => index)
  : Array.from({ length: maxSamples }, (_, index) => Math.round(index * (length - 1) / (maxSamples - 1)));
const routeDistance = (points, endIndex = points.length - 1) => {
  let total = 0;
  for (let index = 1; index <= endIndex && index < points.length; index += 1) total += haversineKm(points[index - 1], points[index]);
  return total;
};

export async function enrichRouteElevations(route, signal) {
  const config = getConfig();
  const baseUrl = String(config.elevationBaseUrl || "https://api.open-elevation.com/api/v1/lookup");
  const indices = samplePointIndices(route.points.length, 100);
  const samples = [];
  for (let offset = 0; offset < indices.length; offset += 50) {
    const batch = indices.slice(offset, offset + 50);
    const locations = batch.map((index) => `${route.points[index].lat},${route.points[index].lon}`).join("|");
    const payload = await fetchJsonImpl(`${baseUrl}?locations=${encodeURIComponent(locations)}`, {
      signal,
      timeoutMs: Number(config.elevationTimeoutMs) || 14000,
      headers: { Accept: "application/json" },
    });
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (results.length !== batch.length) throw new Error("高程服务返回点数不完整");
    results.forEach((result, index) => {
      const rawElevation = result?.elevation;
      const elevation = rawElevation === null || rawElevation === undefined || rawElevation === "" ? NaN : Number(rawElevation);
      samples.push({ index: batch[index], elevation: Number.isFinite(elevation) ? elevation : null });
    });
  }
  const validSamples = samples.filter((sample) => Number.isFinite(sample.elevation));
  if (validSamples.length < 2) throw new Error("没有可用的高程数据");
  const points = route.points.map((point, index) => {
    const exact = samples.find((sample) => sample.index === index);
    if (exact && !Number.isFinite(exact.elevation)) return { ...point, ele: null, hasElevation: false, elevationSource: "Open-Elevation" };
    let left = validSamples[0];
    let right = validSamples[validSamples.length - 1];
    for (let sampleIndex = 1; sampleIndex < validSamples.length; sampleIndex += 1) {
      if (validSamples[sampleIndex].index >= index) { right = validSamples[sampleIndex]; left = validSamples[sampleIndex - 1]; break; }
    }
    const span = Math.max(right.index - left.index, 1);
    const ratio = clamp((index - left.index) / span, 0, 1);
    return { ...point, ele: left.elevation + (right.elevation - left.elevation) * ratio, hasElevation: true, elevationSource: "Open-Elevation" };
  });
  let elevationGain = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (Number.isFinite(points[index].ele) && Number.isFinite(points[index - 1].ele)) elevationGain += Math.max(0, points[index].ele - points[index - 1].ele);
  }
  const stops = (route.stops || []).map((stop) => {
    const index = nearestPointIndex(points, stop);
    const elevation = points[index].ele;
    return { ...stop, index, ele: Number.isFinite(elevation) ? elevation : null, hasElevation: Number.isFinite(elevation), km: routeDistance(points, index) };
  });
  return { ...route, points, stops, elevationGain: Math.round(elevationGain), elevationSource: "Open-Elevation" };
}
