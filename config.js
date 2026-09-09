window.JINGXIAN_CONFIG = Object.freeze({
  osrmBaseUrl: "https://routing.openstreetmap.de/routed-bike",
  geocoderBaseUrl: "https://nominatim.openstreetmap.org/search",
  // Used only when the public Nominatim endpoint is unavailable or returns no result.
  geocoderFallbackBaseUrl: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates",
  geocoderPhotonBaseUrl: "https://photon.komoot.io/api/",
  overpassBaseUrl: "https://overpass-api.de/api/interpreter",
  elevationBaseUrl: "https://api.open-elevation.com/api/v1/lookup",
  osrmTimeoutMs: 12000,
  // Per-provider timeout and overall multi-source lookup budget.
  geocoderTimeoutMs: 10000,
  geocoderTotalTimeoutMs: 15000,
  geocoderFallbackDelayMs: 400,
  geocoderCacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  overpassTimeoutMs: 10000,
  elevationTimeoutMs: 14000,
});
