const DEFAULT_CONFIG = Object.freeze({
  osrmBaseUrl: "https://routing.openstreetmap.de/routed-bike",
  geocoderBaseUrl: "https://nominatim.openstreetmap.org/search",
  overpassBaseUrl: "https://overpass-api.de/api/interpreter",
  elevationBaseUrl: "https://api.open-elevation.com/api/v1/lookup",
  geocoderFallbackBaseUrl: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates",
  geocoderPhotonBaseUrl: "https://photon.komoot.io/api/",
  osrmTimeoutMs: 12000,
  geocoderTimeoutMs: 10000,
  geocoderTotalTimeoutMs: 15000,
  geocoderFallbackDelayMs: 400,
  geocoderCacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  overpassTimeoutMs: 10000,
  elevationTimeoutMs: 14000,
});

/** Return runtime configuration without exposing the mutable global object. */
export function getConfig(overrides = {}) {
  const runtime = globalThis?.JINGXIAN_CONFIG;
  return { ...DEFAULT_CONFIG, ...(runtime && typeof runtime === "object" ? runtime : {}), ...(overrides || {}) };
}

/** Fetch JSON, checking HTTP status and supporting caller cancellation/timeouts. */
export async function fetchJson(url, options = {}) {
  const {
    signal: parentSignal,
    timeoutMs,
    fetchImpl = globalThis.fetch,
    headers = {},
    ...request
  } = options || {};
  if (typeof fetchImpl !== "function") throw new Error("fetch unavailable");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  let onAbort;
  if (controller) {
    onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort(parentSignal.reason);
      else parentSignal.addEventListener("abort", onAbort, { once: true });
    }
    if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) timer = setTimeout(() => controller.abort(), Number(timeoutMs));
  }
  try {
    const response = await fetchImpl(url, {
      ...request,
      signal: controller ? controller.signal : parentSignal,
      headers: { Accept: "application/json", ...headers },
    });
    if (!response || !response.ok) {
      const error = new Error(`HTTP ${response?.status ?? 0}`);
      error.status = response?.status ?? 0;
      error.responseStatus = response?.status ?? 0;
      error.url = String(url);
      throw error;
    }
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal && onAbort) parentSignal.removeEventListener("abort", onAbort);
  }
}

export { DEFAULT_CONFIG };
