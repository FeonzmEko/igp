import { requestOsrm } from "../api/osrm.js";

let requestOsrmImpl = requestOsrm;
export function __setRequestOsrmForTests(requester) { requestOsrmImpl = requester || requestOsrm; }

const haversineKm = (a, b) => {
  const radius = 6371;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
};
const projectOnSegment = (point, a, b) => {
  const scale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180) || 1;
  const ax = a.lon * scale; const ay = a.lat;
  const bx = b.lon * scale; const by = b.lat;
  const px = point.lon * scale; const py = point.lat;
  const dx = bx - ax; const dy = by - ay;
  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return { ratio, point: { lat: a.lat + (b.lat - a.lat) * ratio, lon: a.lon + (b.lon - a.lon) * ratio } };
};
const baselineCoordinates = (baselineRoute) => (baselineRoute?.geometry?.coordinates || []).map(([lon, lat]) => ({ lat: Number(lat), lon: Number(lon) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
const projection = (waypoint, points) => {
  let best = { index: 0, ratio: 0, distance: Infinity, alongKm: 0 };
  let alongKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = haversineKm(points[index - 1], points[index]);
    const projected = projectOnSegment(waypoint, points[index - 1], points[index]);
    const distance = haversineKm(waypoint, projected.point);
    if (distance < best.distance) best = { index: index - 1, ratio: projected.ratio, distance, alongKm: alongKm + segment * projected.ratio };
    alongKm += segment;
  }
  return best;
};

const isManualWaypoint = (waypoint) => waypoint.source === "用户添加" || waypoint.type === "用户途经点";
const isDemoWaypoint = (waypoint) => waypoint.source === "离线演示占位" || waypoint.source === "离线演示";
const scenicValueFor = (waypoint) => {
  if (Number.isFinite(Number(waypoint.scenicValue))) return Number(waypoint.scenicValue);
  const tags = waypoint.tags || {};
  const natural = String(tags.natural || waypoint.natural || "").toLowerCase();
  const tourism = String(tags.tourism || waypoint.tourism || "").toLowerCase();
  const landuse = String(tags.landuse || waypoint.landuse || "").toLowerCase();
  const type = String(waypoint.type || "").toLowerCase();
  if (tourism === "viewpoint" || /观景|viewpoint/.test(type)) return 30;
  if (natural === "water" || /水岸|湖|河|溪|海/.test(type)) return 25;
  if (natural === "wood" || natural === "forest" || landuse === "forest" || /森林|林道|林间/.test(type)) return 20;
  if (leisureValue(waypoint, tags) === "park" || /公园/.test(type)) return 15;
  if (natural === "nature_reserve" || /自然保护区/.test(type)) return 20;
  if (landuse === "industrial" || /工业|industrial/.test(type)) return -20;
  if (/高速|motorway|trunk/.test(type)) return -15;
  if (String(waypoint.sceneryWeight || "") && /观景/.test(type)) return 30;
  return 10;
};
const leisureValue = (waypoint, tags) => String(tags.leisure || waypoint.leisure || "").toLowerCase();

export function rankWaypoints(waypoints = [], baselineRoute, { start, end } = {}) {
  const points = baselineCoordinates(baselineRoute);
  const manual = []; const automatic = [];
  waypoints.forEach((waypoint, originalIndex) => {
    if (!Number.isFinite(Number(waypoint?.lat)) || !Number.isFinite(Number(waypoint?.lon))) return;
    const isManual = waypoint.source === "用户添加" || waypoint.type === "用户途经点";
    if (isManual) manual.push({ ...waypoint, _originalIndex: originalIndex });
    else if (!isDemoWaypoint(waypoint)) automatic.push({ ...waypoint, _originalIndex: originalIndex });
  });
  if (points.length < 2) return [...manual, ...automatic].map(({ _originalIndex, ...item }) => item);
  const ranked = automatic.map((waypoint) => {
    const key = `${Number(waypoint.lat).toFixed(5)},${Number(waypoint.lon).toFixed(5)}`;
    const projected = projection(waypoint, points);
    const before = points[projected.index];
    const after = points[Math.min(projected.index + 1, points.length - 1)];
    const costKm = Math.max(0, haversineKm(before, waypoint) + haversineKm(waypoint, after) - haversineKm(before, after));
    const scenicValue = scenicValueFor(waypoint);
    return { ...waypoint, scenicValue, detourCostKm: costKm, utilityScore: scenicValue / Math.max(costKm, 0.25), alongKm: projected.alongKm, _key: key };
  })
    .sort((a, b) => b.utilityScore - a.utilityScore || a.detourCostKm - b.detourCostKm || a._originalIndex - b._originalIndex);
  const seen = new Set();
  const unique = ranked.filter((waypoint) => { if (seen.has(waypoint._key)) return false; seen.add(waypoint._key); return true; });
  return [...manual, ...unique].map(({ _originalIndex, _key, ...item }) => item);
}

function unsupportedExcludeError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  // routing.openstreetmap.de responds with a bare HTTP 400 when it does not
  // support OSRM's `exclude` option, so there may be no error text to match.
  return code === "InvalidValue" || code === "InvalidOptions" || Number(error?.status) === 400 || /exclude/i.test(message) && /invalid|option|parameter/i.test(message);
}

function isNoRouteError(error) {
  const code = String(error?.code || "").toLowerCase();
  return code === "noroute" || code === "norout found" || /no route|cannot find route|不可达|未找到可骑行道路/i.test(String(error?.message || ""));
}

function orderStopsForRoute(stops) {
  const manual = stops.filter(isManualWaypoint);
  const automatic = stops.filter((stop) => !isManualWaypoint(stop)).slice().sort((a, b) => (a.alongKm ?? Infinity) - (b.alongKm ?? Infinity));
  return [...manual, ...automatic];
}

export async function fetchOnlineRoute(route, signal) {
  const routingOptions = route.bikeFriendly ? { exclude: "motorway,trunk" } : {};
  let exclusionFallback = false;
  const requestRoute = async (locations) => {
    try { return await requestOsrmImpl(locations, signal, exclusionFallback ? {} : routingOptions); }
    catch (error) { if (routingOptions.exclude && !exclusionFallback && unsupportedExcludeError(error)) { exclusionFallback = true; return requestOsrmImpl(locations, signal, {}); } throw error; }
  };
  const baseline = await requestRoute([route.start, route.end]);
  const baselineDistanceKm = Number(baseline.distance) / 1000;
  const maxDistanceKm = baselineDistanceKm * (1 + Number(route.detour || 0) / 100);
  const sourceStops = route.candidateStops || route.stops || [];
  const rankedStops = rankWaypoints(sourceStops, baseline, { start: route.start, end: route.end });
  let candidateStops = orderStopsForRoute(rankedStops);
  let selectedPayload = null; let selectedStops = candidateStops; let droppedStops = 0;
  const warnings = [];
  if (!candidateStops.length) {
    selectedPayload = baseline;
    selectedStops = [];
  }
  while (!selectedPayload) {
    try {
      const payload = await requestRoute([route.start, ...candidateStops, route.end]);
      const distanceKm = Number(payload.distance) / 1000;
      if (distanceKm <= maxDistanceKm || candidateStops.length === 0) { selectedPayload = payload; selectedStops = candidateStops; break; }
    } catch (error) {
      if (!isNoRouteError(error)) throw error;
      const automatic = candidateStops.filter((stop) => !isManualWaypoint(stop));
      if (!automatic.length) {
        selectedPayload = baseline;
        selectedStops = candidateStops;
        warnings.push("手动途经点无法全部接入道路轨迹，已保留为路线提示点。");
        break;
      }
    }
    const automatic = candidateStops.filter((stop) => stop.source !== "用户添加" && stop.type !== "用户途经点");
    if (!automatic.length) {
      selectedPayload = baseline;
      selectedStops = candidateStops;
      warnings.push("手动途经点超过绕行预算，已保留并提示现场核对。");
      break;
    }
    const worst = automatic.slice().sort((a, b) => (a.utilityScore || 0) - (b.utilityScore || 0))[0];
    candidateStops = orderStopsForRoute(rankWaypoints(candidateStops.filter((stop) => stop !== worst), baseline, { start: route.start, end: route.end }));
    droppedStops += 1;
  }
  const coordinates = selectedPayload.geometry.coordinates;
  const points = coordinates.map(([lon, lat]) => ({ lat: Number(lat), lon: Number(lon), ele: null, hasElevation: false, elevationSource: "无高程数据" }));
  const routeDistance = (endIndex = points.length - 1) => points.slice(1, endIndex + 1).reduce((sum, point, index) => sum + haversineKm(points[index], point), 0);
  const stops = selectedStops.map((stop, stopIndex) => { const located = projection(stop, points); const index = Math.min(located.index + (located.ratio >= 0.5 ? 1 : 0), points.length - 1); return { ...stop, id: stopIndex + 1, index, lat: Number(stop.lat), lon: Number(stop.lon), ele: null, hasElevation: false, km: located.alongKm }; });
  if (droppedStops) warnings.push(`已按最多绕行 ${route.detour}% 调整，移除 ${droppedStops} 个低性价比景点。`);
  if (exclusionFallback) warnings.push("当前骑行路由服务不支持道路排除参数，请出发前核对道路类型。");
  return { ...route, points, stops, distanceKm: Number(selectedPayload.distance) / 1000, directDistanceKm: baselineDistanceKm, detourPercent: baselineDistanceKm > 0 ? (Number(selectedPayload.distance) / Number(baseline.distance) - 1) * 100 : 0, elevationGain: 0, source: "osrm", provider: "OpenStreetMap 骑行路由", droppedStops, routingWarning: warnings.join(" "), elevationSource: "无高程数据" };
}
