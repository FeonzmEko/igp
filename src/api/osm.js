import { fetchJson, getConfig } from "./http.js";

const SEARCH_RADIUS_METERS = 500;
const SIMPLIFY_METERS = 10;
const MAX_BATCH_POINTS = 128;
const MAX_BATCH_KM = 60;
const MAX_ROUTE_KM = 600;
const POSITIVE = [
  '[natural~"^(water|wood|forest|heath|scrub|beach|wetland|spring|cliff|peak)$"]',
  '[tourism~"^(viewpoint|attraction|picnic_site)$"]',
  '[leisure~"^(park|nature_reserve)$"]',
  '[boundary="protected_area"]', '[landuse="forest"]', '[waterway]',
];
const NEGATIVE = ['[landuse~"^(industrial|quarry)$"]', '[industrial]', '[highway~"^(motorway|trunk)$"]'];
const SUPPLY = ['[amenity~"^(cafe|restaurant|fuel)$"]', '[shop~"^(convenience|supermarket)$"]'];
const DISCOVERY = [
  '[tourism~"^(viewpoint|attraction|picnic_site)$"][~"^name(:zh)?$"~"."]',
  '[leisure~"^(park|nature_reserve)$"][~"^name(:zh)?$"~"."]',
];

function num(value) {
  if (value === null || value === undefined || typeof value === "boolean" || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function coordinate(point) {
  const lon = num(Array.isArray(point) ? point[0] : point?.lon ?? point?.lng);
  const lat = num(Array.isArray(point) ? point[1] : point?.lat);
  return lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 ? null : [lon, lat];
}
export function routeCoordinates(route) {
  if (Array.isArray(route)) return route.map(coordinate).filter(Boolean);
  const geometry = route?.geometry;
  if (geometry?.type === "LineString") return routeCoordinates(geometry.coordinates);
  if (Array.isArray(geometry)) return routeCoordinates(geometry);
  if (geometry?.geometry) return routeCoordinates(geometry);
  return routeCoordinates(route?.points || []);
}
export function safeTags(tags) {
  const result = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (["string", "number", "boolean"].includes(typeof value)) result[String(key)] = value;
  }
  return result;
}
export function safeElement(element) {
  const point = coordinate(element?.lat != null ? element : element?.center);
  const result = { id: element?.id, type: element?.type, tags: safeTags(element?.tags) };
  if (point) [result.lon, result.lat] = point;
  if (Array.isArray(element?.geometry)) result.geometry = element.geometry.slice(0, 5000);
  if (Array.isArray(element?.nodes)) result.nodes = element.nodes.slice(0, 2000);
  return result;
}
function hav(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, value)));
}
function segmentMeters(point, a, b) {
  const scale = Math.cos(point[1] * Math.PI / 180);
  const dx = (b[0] - a[0]) * scale;
  const dy = b[1] - a[1];
  const px = (point[0] - a[0]) * scale;
  const py = point[1] - a[1];
  const ratio = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ratio * dx, py - ratio * dy) * 111320;
}
function nearestMeters(coords, lat, lon) {
  const point = [lon, lat];
  let distance = Infinity;
  for (let i = 1; i < coords.length; i += 1) distance = Math.min(distance, segmentMeters(point, coords[i - 1], coords[i]));
  return distance;
}

// Simplify the query only. Keep the original geometry for all final 500 m checks.
// Expanding the candidate search by the simplification tolerance avoids gaps.
function simplify(coords) {
  if (coords.length < 3) return coords;
  const keep = new Set([0, coords.length - 1]);
  const ranges = [[0, coords.length - 1]];
  while (ranges.length) {
    const [first, last] = ranges.pop();
    let furthest = -1;
    let distance = SIMPLIFY_METERS;
    for (let index = first + 1; index < last; index += 1) {
      const offset = segmentMeters(coords[index], coords[first], coords[last]);
      if (offset > distance) { distance = offset; furthest = index; }
    }
    if (furthest !== -1) {
      keep.add(furthest);
      ranges.push([first, furthest], [furthest, last]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((index) => coords[index]);
}
function routeBatches(coords) {
  if (coords.length < 2) return [];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) total += hav(coords[i - 1], coords[i]);
  if (total > MAX_ROUTE_KM) return [];
  const compact = simplify(coords);
  const batches = [];
  let batch = [compact[0]];
  let batchKm = 0;
  for (let i = 1; i < compact.length; i += 1) {
    const start = compact[i - 1];
    const end = compact[i];
    const count = Math.max(1, Math.ceil(hav(start, end) / MAX_BATCH_KM));
    for (let step = 1; step <= count; step += 1) {
      const point = step === count ? end : [start[0] + (end[0] - start[0]) * step / count, start[1] + (end[1] - start[1]) * step / count];
      const previous = batch.at(-1);
      const distance = hav(previous, point);
      if (batch.length > 1 && (batch.length >= MAX_BATCH_POINTS || batchKm + distance > MAX_BATCH_KM)) {
        batches.push(batch);
        // Both batches include this vertex, preserving the connecting segment.
        batch = [previous];
        batchKm = 0;
      }
      batch.push(point);
      batchKm += distance;
    }
  }
  if (batch.length > 1) batches.push(batch);
  return batches;
}
function query(points, discovery) {
  const filters = discovery ? DISCOVERY : [...POSITIVE, ...NEGATIVE, ...SUPPLY];
  const line = points.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(",");
  const around = `(around:${SEARCH_RADIUS_METERS + SIMPLIFY_METERS},${line})`;
  // Overpass accepts a polyline in one around filter. Repeating a query for
  // every 600 m sample created thousands of overlapping search statements.
  return `[out:json][timeout:25];(${filters.map((filter) => `nwr${around}${filter};`).join("")});out center geom tags;`;
}
function normalize(elements, status) {
  const seen = new Set();
  const features = [];
  for (const element of elements) {
    const item = safeElement(element);
    const key = `${item.type}:${item.id}`;
    if (item.id == null || seen.has(key)) continue;
    seen.add(key);
    features.push(item);
  }
  return { status, features, elements: features, data: features, counts: { total: features.length }, dataSource: "overpass" };
}
async function queryCorridor(coords, signal, discovery = false) {
  const batches = routeBatches(coords);
  if (!batches.length) return normalize([], "unavailable");
  const config = getConfig();
  const elements = [];
  let successfulBatches = 0;
  let partial = false;
  let errorMessage;
  for (const batch of batches) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    try {
      const payload = await fetchJson(config.overpassBaseUrl, {
        method: "POST",
        body: new URLSearchParams({ data: query(batch, discovery) }).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeoutMs: config.overpassTimeoutMs,
        signal,
      });
      if (!Array.isArray(payload?.elements)) throw new Error("Overpass 返回了无效的景点数据");
      successfulBatches += 1;
      if (payload.remark) partial = true;
      elements.push(...payload.elements);
    } catch (error) {
      if (signal?.aborted) throw error;
      partial = true;
      errorMessage = String(error?.message || error);
      // Keep earlier batches when the service fails partway through a route.
      // A failed service should not incur another timeout for every remaining batch.
      break;
    }
  }
  const status = successfulBatches === 0 ? "unavailable" : partial ? "partial" : "ready";
  return { ...normalize(elements, status), ...(errorMessage ? { error: errorMessage } : {}) };
}
function sourceUrl(item) {
  return item.id == null ? "" : `https://www.openstreetmap.org/${item.type}/${item.id}`;
}
function scenicStop(feature, coords) {
  const tags = feature.tags;
  const name = String(tags["name:zh"] || tags.name || "").trim();
  if (!name || feature.lat == null || feature.lon == null) return null;
  if (tags.access === "private" || tags.access === "no" || tags.bicycle === "no") return null;
  // Area centers describe the environment; a lake or river center is never a
  // suitable cycling waypoint, even if the area also has a tourism tag.
  if (tags.waterway || tags.water || /^(water|wetland|bay|strait)$/.test(String(tags.natural || ""))) return null;
  if (tags.industrial != null || /^(industrial|quarry)$/.test(String(tags.landuse || ""))) return null;
  const tourist = /^(viewpoint|attraction|picnic_site)$/.test(String(tags.tourism || ""));
  const park = tags.leisure === "park";
  const reserveNode = tags.leisure === "nature_reserve" && feature.type === "node";
  if (!tourist && !park && !reserveNode) return null;
  const distance = nearestMeters(coords, feature.lat, feature.lon);
  if (distance > SEARCH_RADIUS_METERS) return null;
  const scenicValue = tags.tourism === "viewpoint" ? 30 : reserveNode ? 25 : park ? 15 : 20;
  return {
    id: feature.id,
    osmId: feature.id,
    osmType: feature.type,
    name,
    type: tags.tourism || tags.leisure,
    note: tags.description || "",
    sourceUrl: sourceUrl(feature),
    scenicValue,
    tags,
    lat: feature.lat,
    lon: feature.lon,
    distanceMeters: Math.round(distance),
    source: "overpass",
  };
}

export async function discoverScenicStops(start, end, scenic = 50, signal) {
  const coords = routeCoordinates([start, end]);
  const base = await queryCorridor(coords, signal, true);
  const stops = base.features.map((feature) => scenicStop(feature, coords)).filter(Boolean)
    .sort((a, b) => b.scenicValue / (b.distanceMeters + 250) - a.scenicValue / (a.distanceMeters + 250))
    .slice(0, Number(scenic) >= 52 ? 24 : 12);
  return { ...base, stops };
}
export async function queryRouteAmenities(route, signal) {
  const coords = routeCoordinates(route);
  const base = await queryCorridor(coords, signal);
  const items = [];
  for (const feature of base.features) {
    const tags = feature.tags;
    if (!/^(cafe|restaurant|fuel)$/.test(String(tags.amenity || "")) && !/^(convenience|supermarket)$/.test(String(tags.shop || ""))) continue;
    if (feature.lat == null || feature.lon == null) continue;
    const distance = nearestMeters(coords, feature.lat, feature.lon);
    if (distance > SEARCH_RADIUS_METERS) continue;
    items.push({
      id: feature.id, osmId: feature.id, osmType: feature.type,
      type: tags.amenity || tags.shop,
      name: tags["name:zh"] || tags.name || "补给点",
      lat: feature.lat, lon: feature.lon,
      distance: Math.round(distance), distanceMeters: Math.round(distance),
      distanceKm: Number((distance / 1000).toFixed(3)),
      sourceUrl: sourceUrl(feature),
    });
  }
  return { ...base, supplies: { status: base.status, items }, routePoints: coords.length };
}
