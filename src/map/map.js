// 高德的公开道路瓦片使用 GCJ-02 坐标。路线数据和业务状态仍然使用
// WGS-84，只有交给 Leaflet 的显示坐标会转换成 GCJ-02。
const TILE_SOURCES = [
  {
    id: "amap",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
    subdomains: ["1", "2", "3", "4"],
    attribution: "© 高德地图",
  },
  { id: "carto", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", subdomains: ["a", "b", "c", "d"], attribution: "© OpenStreetMap contributors © CARTO" },
  { id: "osm", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", subdomains: ["a", "b", "c"], attribution: "© OpenStreetMap contributors" },
];

const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat, lon) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLatitude(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  ret += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return ret;
}

function transformLongitude(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  ret += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return ret;
}

function coordinateOf(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lon = Number(point?.lon ?? point?.lng ?? point?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Convert a WGS-84 point to the GCJ-02 datum used by AMap tiles. */
export function wgs84ToGcj02(point) {
  const coordinate = coordinateOf(point);
  if (!coordinate || outOfChina(coordinate.lat, coordinate.lon)) return coordinate;
  const dLat = transformLatitude(coordinate.lon - 105, coordinate.lat - 35);
  const dLon = transformLongitude(coordinate.lon - 105, coordinate.lat - 35);
  const radLat = coordinate.lat / 180 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    lat: coordinate.lat + (dLat * 180) / ((AXIS * (1 - EE)) / (magic * sqrtMagic) * PI),
    lon: coordinate.lon + (dLon * 180) / (AXIS / sqrtMagic * Math.cos(radLat) * PI),
  };
}

/** Convert a GCJ-02 map click back to WGS-84 for the planner and GPX export. */
export function gcj02ToWgs84(point) {
  const coordinate = coordinateOf(point);
  if (!coordinate || outOfChina(coordinate.lat, coordinate.lon)) return coordinate;
  // A short fixed-point iteration is accurate to sub-metre precision for the
  // mainland area and avoids adding a second coordinate library to the app.
  let estimate = { ...coordinate };
  for (let index = 0; index < 6; index += 1) {
    const converted = wgs84ToGcj02(estimate);
    estimate = {
      lat: estimate.lat + coordinate.lat - converted.lat,
      lon: estimate.lon + coordinate.lon - converted.lon,
    };
  }
  return estimate;
}

function safeText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function createPopupNode(stop) {
  const node = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = safeText(stop?.name, "风景点");
  const detail = document.createElement("div");
  detail.textContent = [stop?.type, stop?.note].filter(Boolean).map((value) => safeText(value)).join(" · ");
  node.append(name, detail);
  return node;
}

function createLabelNode(label) {
  const node = document.createElement("span");
  node.textContent = safeText(label);
  return node;
}

function samplePoints(points, maxSamples = 2000) {
  if (!Array.isArray(points)) return [];
  if (points.length <= maxSamples) return points;
  return Array.from({ length: maxSamples }, (_, index) => points[Math.round((index / (maxSamples - 1)) * (points.length - 1))]);
}

/** Create the optional Leaflet layer; the SVG map remains the fallback owned by app.js. */
export function createStreetMap({ element, mapStage, onMapClick, onTileError } = {}) {
  const leaflet = globalThis.L;
  if (!element || !leaflet) {
    return {
      render() {},
      panTo() {},
      destroy() {},
      available: false,
    };
  }

  const map = leaflet.map(element, { zoomControl: true, preferCanvas: true, attributionControl: true });
  leaflet.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
  let tileLayer = null;
  let currentRoute = null;
  let sourceIndex = 0;
  const routeLayer = leaflet.layerGroup().addTo(map);
  const stopLayer = leaflet.layerGroup().addTo(map);
  const fromDisplay = (point) => TILE_SOURCES[sourceIndex].id === "amap" ? gcj02ToWgs84(point) : coordinateOf(point);
  const toDisplay = (point) => {
    const coordinate = TILE_SOURCES[sourceIndex].id === "amap" ? wgs84ToGcj02(point) : coordinateOf(point);
    return coordinate ? [coordinate.lat, coordinate.lon] : null;
  };
  const clickHandler = (event) => {
    if (typeof onMapClick === "function" && event?.latlng) {
      const wgs = fromDisplay(event.latlng);
      // Expose WGS-84 to the rest of the application. Keep the original
      // Leaflet event available for callers that use pixel coordinates.
      if (wgs) onMapClick({ ...wgs, event });
    }
  };
  map.on("click", clickHandler);
  mapStage?.classList.add("has-street-map");

  // The route SVG is the reliable fallback when a tile provider is blocked,
  // rate-limited, or unavailable. Keep the Leaflet container mounted so the
  // map can recover if tiles become available again.
  let tileErrors = 0;
  let loadedTiles = 0;
  let sourceTimer = null;
  let destroyed = false;
  let fallbackEnabled = false;
  const enableFallback = (error) => {
    if (fallbackEnabled) return;
    fallbackEnabled = true;
    mapStage?.classList.add("tile-fallback");
    if (typeof onTileError === "function") onTileError(error);
  };
  const recoverFromFallback = () => {
    if (!fallbackEnabled || loadedTiles < 2) return;
    fallbackEnabled = false;
    tileErrors = 0;
    mapStage?.classList.remove("tile-fallback");
  };
  const clearSourceTimer = () => {
    if (sourceTimer !== null) globalThis.clearTimeout(sourceTimer);
    sourceTimer = null;
  };
  const switchTileSource = (error) => {
    if (destroyed) return;
    if (sourceIndex < TILE_SOURCES.length - 1) {
      const center = currentRoute && map.getCenter ? fromDisplay(map.getCenter()) : null;
      sourceIndex += 1;
      clearSourceTimer();
      tileErrors = 0;
      loadedTiles = 0;
      if (tileLayer) {
        // Keep the existing Leaflet layer mounted. Removing a layer while
        // failed image requests are still settling can race Leaflet's view
        // reset and leave the map pane detached.
        tileLayer.options.subdomains = TILE_SOURCES[sourceIndex].subdomains;
        if (map.attributionControl) {
          map.attributionControl.removeAttribution(TILE_SOURCES[sourceIndex - 1].attribution);
          map.attributionControl.addAttribution(TILE_SOURCES[sourceIndex].attribution);
        }
        tileLayer.options.attribution = TILE_SOURCES[sourceIndex].attribution;
        tileLayer.setUrl(TILE_SOURCES[sourceIndex].url);
      }
      // A fallback provider uses WGS-84. Reproject the complete overlay and
      // viewport instead of leaving a GCJ-02 route offset from its roads.
      if (currentRoute) {
        render(currentRoute, { fit: false });
        if (center) map.setView(toDisplay(center), map.getZoom(), { animate: false });
      }
      mapStage?.classList.remove("tile-fallback");
      fallbackEnabled = false;
      watchForStalledTiles();
      return;
    }
    enableFallback(error || new Error("地图底图加载失败"));
  };
  function watchForStalledTiles() {
    clearSourceTimer();
    sourceTimer = globalThis.setTimeout(() => {
      if (loadedTiles === 0) switchTileSource(new Error("地图底图加载超时"));
    }, 5000);
  }
  function attachTileLayer() {
    const source = TILE_SOURCES[sourceIndex];
    tileErrors = 0;
    loadedTiles = 0;
    tileLayer = leaflet.tileLayer(source.url, {
      maxZoom: 19,
      maxNativeZoom: 18,
      subdomains: source.subdomains,
      attribution: source.attribution,
    });
    const isCurrentSource = (event) => {
      const requestUrl = event?.tile?.currentSrc || event?.tile?.src || "";
      if (!requestUrl) return true;
      const sourceId = TILE_SOURCES[sourceIndex].id;
      return requestUrl.includes(sourceId === "amap" ? ".autonavi.com/" : sourceId === "carto" ? ".cartocdn.com/" : ".openstreetmap.org/");
    };
    tileLayer.on("tileerror", (event) => {
      if (!isCurrentSource(event)) return;
      tileErrors += 1;
      // Try every public provider before exposing the SVG fallback.
      if (tileErrors >= 3) switchTileSource(event?.error || event);
    });
    tileLayer.on("tileload", (event) => {
      if (!isCurrentSource(event)) return;
      loadedTiles += 1;
      clearSourceTimer();
      recoverFromFallback();
    });
    tileLayer.on("loading", watchForStalledTiles);
    tileLayer.addTo(map);
  }
  attachTileLayer();
  const invalidate = () => { if (!destroyed) map.invalidateSize({ pan: false, animate: false }); };
  globalThis.setTimeout(invalidate, 0);
  globalThis.setTimeout(invalidate, 120);
  globalThis.setTimeout(invalidate, 500);

  function render(route = {}, { fit = true } = {}) {
    currentRoute = route;
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    const points = samplePoints(route.points);
    const latLngs = points.map(toDisplay).filter(Boolean);
    if (!latLngs.length) return;
    const online = route.source === "osrm";
    leaflet.polyline(latLngs, {
      color: online ? "#315a4a" : "#c86e3f",
      weight: 5,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
      dashArray: online ? undefined : "8 8",
    }).addTo(routeLayer);

    const start = toDisplay(route.start || points[0]);
    const end = toDisplay(route.end || points[points.length - 1]);
    if (start) leaflet.circleMarker(start, { radius: 8, color: "#fbfaf7", weight: 3, fillColor: "#315a4a", fillOpacity: 1 }).bindTooltip(createLabelNode(route.start?.label || "出发地"), { direction: "top", offset: [0, -8] }).addTo(stopLayer);
    if (end) leaflet.circleMarker(end, { radius: 8, color: "#fbfaf7", weight: 3, fillColor: "#c86e3f", fillOpacity: 1 }).bindTooltip(createLabelNode(route.end?.label || "目的地"), { direction: "top", offset: [0, -8] }).addTo(stopLayer);
    (Array.isArray(route.stops) ? route.stops : []).forEach((stop) => {
      const point = toDisplay(stop);
      if (!point) return;
      leaflet.circleMarker(point, { radius: 6, color: "#fbfaf7", weight: 2, fillColor: "#c86e3f", fillOpacity: 1 })
        .bindPopup(createPopupNode(stop))
        .addTo(stopLayer);
    });
    const supplyTypes = { cafe: "咖啡店", restaurant: "餐厅", fuel: "加油站", convenience: "便利店", supermarket: "超市", shop: "商店" };
    (Array.isArray(route.supplies?.items) ? route.supplies.items : []).forEach((supply) => {
      const point = toDisplay(supply);
      if (!point) return;
      leaflet.circleMarker(point, { radius: 5, color: "#fbfaf7", weight: 2, fillColor: "#287db0", fillOpacity: 1 })
        .bindPopup(createPopupNode({ ...supply, name: supply.name || "补给点", type: supplyTypes[supply.type] || "补给点", note: Number.isFinite(supply.distance) ? `距路线 ${Math.round(supply.distance)} 米` : "" }))
        .addTo(stopLayer);
    });
    const bounds = leaflet.latLngBounds(latLngs);
    if (fit && bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13, animate: false });
    globalThis.setTimeout(invalidate, 0);
  }

  function panTo(point) {
    const latLng = toDisplay(point);
    if (latLng) map.panTo(latLng);
  }

  function destroy() {
    destroyed = true;
    map.off("click", clickHandler);
    clearSourceTimer();
    tileLayer.off();
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    map.remove();
    mapStage?.classList.remove("has-street-map", "tile-fallback");
  }

  return { render, panTo, destroy, available: true, map };
}
