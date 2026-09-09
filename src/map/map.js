const TILE_SOURCES = [
  { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "© OpenStreetMap contributors © CARTO" },
  { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors" },
];

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pointLatLng(point) {
  const lat = finiteCoordinate(point?.lat);
  const lon = finiteCoordinate(point?.lon);
  return lat === null || lon === null ? null : [lat, lon];
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
  let tileLayer = null;
  const routeLayer = leaflet.layerGroup().addTo(map);
  const stopLayer = leaflet.layerGroup().addTo(map);
  const clickHandler = (event) => {
    if (typeof onMapClick === "function" && event?.latlng) onMapClick({ lat: event.latlng.lat, lon: event.latlng.lng, event });
  };
  map.on("click", clickHandler);
  mapStage?.classList.add("has-street-map");

  // The route SVG is the reliable fallback when a tile provider is blocked,
  // rate-limited, or unavailable. Keep the Leaflet container mounted so the
  // map can recover if tiles become available again.
  let tileErrors = 0;
  let loadedTiles = 0;
  let sourceIndex = 0;
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
      sourceIndex += 1;
      clearSourceTimer();
      tileErrors = 0;
      loadedTiles = 0;
      if (tileLayer) {
        // Keep the existing Leaflet layer mounted. Removing a layer while
        // failed image requests are still settling can race Leaflet's view
        // reset and leave the map pane detached.
        tileLayer.setUrl(TILE_SOURCES[sourceIndex].url);
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
      attribution: "© OpenStreetMap contributors © CARTO",
      crossOrigin: true,
    });
    tileLayer.on("tileerror", (event) => {
      tileErrors += 1;
      // Try a second public provider before exposing the SVG fallback.
      if (tileErrors >= 3) switchTileSource(event?.error || event);
    });
    tileLayer.on("tileload", () => {
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

  function render(route = {}) {
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    const points = samplePoints(route.points);
    const latLngs = points.map(pointLatLng).filter(Boolean);
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

    const start = pointLatLng(route.start || points[0]);
    const end = pointLatLng(route.end || points[points.length - 1]);
    if (start) leaflet.circleMarker(start, { radius: 8, color: "#fbfaf7", weight: 3, fillColor: "#315a4a", fillOpacity: 1 }).bindTooltip(createLabelNode(route.start?.label || "出发地"), { direction: "top", offset: [0, -8] }).addTo(stopLayer);
    if (end) leaflet.circleMarker(end, { radius: 8, color: "#fbfaf7", weight: 3, fillColor: "#c86e3f", fillOpacity: 1 }).bindTooltip(createLabelNode(route.end?.label || "目的地"), { direction: "top", offset: [0, -8] }).addTo(stopLayer);
    (Array.isArray(route.stops) ? route.stops : []).forEach((stop) => {
      const point = pointLatLng(stop);
      if (!point) return;
      leaflet.circleMarker(point, { radius: 6, color: "#fbfaf7", weight: 2, fillColor: "#c86e3f", fillOpacity: 1 })
        .bindPopup(createPopupNode(stop))
        .addTo(stopLayer);
    });
    const bounds = leaflet.latLngBounds(latLngs);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13, animate: false });
    globalThis.setTimeout(() => map.invalidateSize(), 0);
  }

  function panTo(point) {
    const latLng = pointLatLng(point);
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
