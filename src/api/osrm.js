import { fetchJson, getConfig } from "./http.js";

let fetchJsonImpl = fetchJson;
export function __setFetchJsonForTests(fetcher) { fetchJsonImpl = fetcher || fetchJson; }

function invalidRouteError(message, code = "InvalidRoute") {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function requestOsrm(locations, signal, options = {}) {
  if (!Array.isArray(locations) || locations.length < 2) throw new Error("OSRM 至少需要起点和终点");
  locations.forEach((point) => {
    if (!Number.isFinite(Number(point?.lat)) || Number(point.lat) < -90 || Number(point.lat) > 90
      || !Number.isFinite(Number(point?.lon)) || Number(point.lon) < -180 || Number(point.lon) > 180) {
      throw invalidRouteError("OSRM 请求包含无效坐标", "InvalidCoordinates");
    }
  });
  const coordinates = locations.map((point) => `${Number(point.lon)},${Number(point.lat)}`).join(";");
  const params = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "false" });
  if (options.exclude) params.set("exclude", options.exclude);
  const config = getConfig();
  const baseUrl = String(config.osrmBaseUrl || "https://routing.openstreetmap.de/routed-bike").replace(/\/$/, "");
  const payload = await fetchJsonImpl(`${baseUrl}/route/v1/cycling/${coordinates}?${params}`, {
    signal,
    timeoutMs: Number(config.osrmTimeoutMs) || 12000,
    headers: { Accept: "application/json" },
  });
  const route = payload?.routes?.[0];
  if (payload?.code !== "Ok") {
    const error = invalidRouteError(payload?.message || "未找到可骑行道路", payload?.code || "RouteError");
    if (payload?.status !== undefined) error.status = payload.status;
    throw error;
  }
  if (!route || !Number.isFinite(Number(route.distance)) || Number(route.distance) < 0) {
    throw invalidRouteError("OSRM 返回了无效距离", "InvalidDistance");
  }
  if (!Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2) {
    throw invalidRouteError("OSRM 返回的道路几何至少需要两个点", "InvalidGeometry");
  }
  route.geometry.coordinates.forEach((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2 || !Number.isFinite(Number(coordinate[0]))
      || Number(coordinate[0]) < -180 || Number(coordinate[0]) > 180 || !Number.isFinite(Number(coordinate[1]))
      || Number(coordinate[1]) < -90 || Number(coordinate[1]) > 90) {
      throw invalidRouteError("OSRM 返回了无效道路坐标", "InvalidGeometry");
    }
  });
  return route;
}
