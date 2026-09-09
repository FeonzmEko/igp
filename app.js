import { discoverScenicStops as discoverScenicStopsApi, queryRouteAmenities } from "./src/api/osm.js";
import { calculateScenicScore } from "./src/route/scenic.js";
import { fetchOnlineRoute as fetchOnlineRouteModule } from "./src/route/planner.js";
import { enrichRouteElevations as enrichRouteElevationsModule } from "./src/api/elevation.js";
import { renderScenicDetails, renderSupplies } from "./src/route/presentation.js";
import { loadSettings, saveSettings } from "./src/state/store.js";
import { createStreetMap } from "./src/map/map.js";
import { buildGpxDocument } from "./src/gpx/exporter.js";

(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const cityPresets = {
    "杭州西湖": { lat: 30.241, lon: 120.149 },
    杭州: { lat: 30.274, lon: 120.155 },
    千岛湖: { lat: 29.608, lon: 119.024 },
    上海: { lat: 31.230, lon: 121.473 },
    "上海站": { lat: 31.24981, lon: 121.45522 },
    "上海火车站": { lat: 31.24981, lon: 121.45522 },
    "上海铁路站": { lat: 31.24981, lon: 121.45522 },
    "海盐县": { lat: 30.52549, lon: 120.94638 },
    "海盐": { lat: 30.52549, lon: 120.94638 },
    // WGS84 coordinates verified against Photon's OpenStreetMap result.
    "澉浦镇": { lat: 30.3935, lon: 120.889725 },
    "澉浦": { lat: 30.3935, lon: 120.889725 },
    苏州: { lat: 31.299, lon: 120.585 },
    南京: { lat: 32.060, lon: 118.796 },
    北京: { lat: 39.904, lon: 116.407 },
    成都: { lat: 30.572, lon: 104.066 },
    重庆: { lat: 29.563, lon: 106.551 },
    厦门: { lat: 24.479, lon: 118.089 },
    福州: { lat: 26.074, lon: 119.296 },
    广州: { lat: 23.129, lon: 113.264 },
    桂林: { lat: 25.274, lon: 110.299 },
    昆明: { lat: 25.038, lon: 102.718 },
    西安: { lat: 34.341, lon: 108.940 },
    黄山: { lat: 29.715, lon: 118.338 },
    青岛: { lat: 36.067, lon: 120.382 },
    拉萨: { lat: 29.652, lon: 91.172 },
    大理: { lat: 25.607, lon: 100.267 },
    三亚: { lat: 18.252, lon: 109.512 },
  };

  // These are research leads for the built-in Hangzhou -> Qiandao Lake example.
  // They are intentionally labelled as leads: social posts are useful for discovery,
  // while the rider still needs to confirm access, opening hours and current road conditions.
  const researchedScenicStops = [
    {
      name: "龙井茶园边线",
      type: "茶山风景",
      note: "从西湖出发后的茶山视野，适合清晨慢骑",
      lat: 30.2364,
      lon: 120.1338,
      source: "公开骑行笔记线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E6%9D%AD%E5%B7%9E%20%E8%A5%BF%E6%B9%96%20%E9%BE%99%E4%BA%95%E8%8C%B6%E5%9B%AD%20%E9%AA%91%E8%A1%8C",
    },
    {
      name: "富春江江面观景段",
      type: "江景路段",
      note: "沿江开阔视野，作为中途补水和拍照点",
      lat: 29.7925,
      lon: 119.5700,
      source: "公开骑行路线线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E5%AF%8C%E6%98%A5%E6%B1%9F%20%E9%AA%91%E8%A1%8C%20%E6%9D%AD%E5%B7%9E%E5%8D%83%E5%B2%9B%E6%B9%96",
    },
    {
      name: "小金山观景台",
      type: "湖景观景台",
      note: "环湖公路常见打卡点，视野开阔，适合短停",
      lat: 29.7750,
      lon: 119.0260,
      source: "小红书 / 抖音公开攻略线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E5%8D%83%E5%B2%9B%E6%B9%96%20%E5%B0%8F%E9%87%91%E5%B1%B1%E8%A7%82%E6%99%AF%E5%8F%B0%20%E9%AA%91%E8%A1%8C",
    },
    {
      name: "芹川古村",
      type: "古村人文",
      note: "古村落停留点，建议确认当天开放与补给条件",
      lat: 29.5480,
      lon: 118.9040,
      source: "小红书 / 抖音公开攻略线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E5%8D%83%E5%B2%9B%E6%B9%96%20%E8%8A%B9%E5%B7%9D%E5%8F%A4%E6%9D%91%20%E9%AA%91%E8%A1%8C",
    },
  ];

  // Publicly indexed scenic leads for the Shanghai Station -> Haiyan corridor.
  // Coordinates are WGS84 estimates; the rider should confirm access and road status.
  const researchedShanghaiHaiyanStops = [
    {
      name: "金山城市沙滩",
      type: "海岸风景",
      note: "杭州湾北岸的开阔海景，适合作为第一段补给和拍照点",
      lat: 30.7245,
      lon: 121.3312,
      source: "小红书 / 抖音公开骑行攻略线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E9%87%91%E5%B1%B1%E5%9F%8E%E5%B8%82%E6%B2%99%E6%BB%A9%20%E9%AA%91%E8%A1%8C",
    },
    {
      name: "乍浦九龙山",
      type: "山海观景",
      note: "山海相接的短停点，建议避开景区车流高峰",
      lat: 30.6282,
      lon: 121.1065,
      source: "公开骑行路线与短视频攻略线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E4%B9%8D%E6%B5%A6%E4%B9%9D%E9%BE%99%E5%B1%B1%20%E9%AA%91%E8%A1%8C",
    },
    {
      name: "南北湖",
      type: "湖畔风景",
      note: "海盐境内的湖山组合，适合收尾前绕行与休息",
      lat: 30.5746,
      lon: 120.8255,
      source: "小红书 / 抖音公开攻略线索",
      sourceUrl: "https://www.baidu.com/s?wd=%E6%B5%B7%E7%9B%90%E5%8D%97%E5%8C%97%E6%B9%96%20%E9%AA%91%E8%A1%8C",
    },
  ];

  const demoScenicNames = [
    ["湖岸观景台", "水岸视野", "演示占位点，请出发前自行核对"],
    ["林道驿站", "林荫缓坡", "演示占位点，请出发前自行核对"],
    ["古镇骑行码头", "人文停留", "演示占位点，请出发前自行核对"],
    ["山脊风口", "开阔山景", "演示占位点，请出发前自行核对"],
    ["溪谷慢行段", "溪流相伴", "演示占位点，请出发前自行核对"],
    ["田野观景台", "乡野视野", "演示占位点，请出发前自行核对"],
  ];

  const runtimeConfig = window.JINGXIAN_CONFIG || {};
  const OSRM_BASE_URL = runtimeConfig.osrmBaseUrl || "https://routing.openstreetmap.de/routed-bike";
  const OSRM_TIMEOUT_MS = Number(runtimeConfig.osrmTimeoutMs) || 12000;
  const GEOCODER_BASE_URL = runtimeConfig.geocoderBaseUrl || "https://nominatim.openstreetmap.org/search";
  const GEOCODER_FALLBACK_BASE_URL = runtimeConfig.geocoderFallbackBaseUrl || "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
  const GEOCODER_PHOTON_BASE_URL = runtimeConfig.geocoderPhotonBaseUrl || "https://photon.komoot.io/api/";
  const GEOCODER_TIMEOUT_MS = Number(runtimeConfig.geocoderTimeoutMs) || 8000;
  const OVERPASS_BASE_URL = runtimeConfig.overpassBaseUrl || "https://overpass-api.de/api/interpreter";
  const OVERPASS_TIMEOUT_MS = Number(runtimeConfig.overpassTimeoutMs) || 10000;
  const ELEVATION_BASE_URL = runtimeConfig.elevationBaseUrl || "https://api.open-elevation.com/api/v1/lookup";
  const ELEVATION_TIMEOUT_MS = Number(runtimeConfig.elevationTimeoutMs) || 14000;
  const geocodeCache = new Map();

  const refs = {
    form: document.querySelector("#route-form"),
    start: document.querySelector("#start-input"),
    end: document.querySelector("#end-input"),
    locateButton: document.querySelector("#locate-button"),
    swapLocations: document.querySelector("#swap-locations"),
    startSource: document.querySelector("#start-source"),
    endSource: document.querySelector("#end-source"),
    scenic: document.querySelector("#scenic-range"),
    scenicOutput: document.querySelector("#scenic-output"),
    detour: document.querySelector("#detour-input"),
    bikeFriendly: document.querySelector("#bike-friendly"),
    onlineRouting: document.querySelector("#online-routing"),
    waypointName: document.querySelector("#waypoint-name-input"),
    waypointLocation: document.querySelector("#waypoint-location-input"),
    addWaypoint: document.querySelector("#add-waypoint-button"),
    mapAddToggle: document.querySelector("#map-add-toggle"),
    waypointsList: document.querySelector("#waypoints-list"),
    mapStage: document.querySelector("#map-stage"),
    status: document.querySelector("#form-status"),
    sampleButton: document.querySelector("#sample-button"),
    generateButton: document.querySelector("#generate-button"),
    generateButtonLabel: document.querySelector("#generate-button-label"),
    cancelRouteButton: document.querySelector("#cancel-route-button"),
    importButton: document.querySelector("#import-button"),
    importButtonLabel: document.querySelector("#import-button-label"),
    gpxFileInput: document.querySelector("#gpx-file-input"),
    importStatus: document.querySelector("#import-status"),
    routeTitle: document.querySelector("#route-title"),
    routeKind: document.querySelector("#route-kind"),
    routePointCount: document.querySelector("#route-point-count"),
    routeSource: document.querySelector("#route-source"),
    routeScore: document.querySelector("#route-score"),
    distance: document.querySelector("#distance-value"),
    directDistance: document.querySelector("#direct-distance-value"),
    detourPercent: document.querySelector("#detour-value"),
    elevation: document.querySelector("#elevation-value"),
    stops: document.querySelector("#stops-value"),
    stopsCaption: document.querySelector("#stops-caption"),
    rideTime: document.querySelector("#ride-time-value"),
    fuelPlan: document.querySelector("#fuel-plan-value"),
    stopsList: document.querySelector("#stops-list"),
    exportButton: document.querySelector("#export-button"),
    shareButton: document.querySelector("#share-button"),
    exportDatum: document.querySelector("#export-datum"),
    exportDatumNote: document.querySelector("#export-datum-note"),
    exportNote: document.querySelector("#export-note-text"),
    exportStatus: document.querySelector("#export-status"),
    streetMap: document.querySelector("#street-map"),
    routeMap: document.querySelector("#route-map"),
    mapBackdrop: document.querySelector("#map-backdrop"),
    mapRoads: document.querySelector("#map-roads"),
    mapRoute: document.querySelector("#map-route"),
    mapPoints: document.querySelector("#map-points"),
    mapLabels: document.querySelector("#map-labels"),
    profileGrid: document.querySelector("#profile-grid"),
    profileArea: document.querySelector("#profile-area"),
    profileLine: document.querySelector("#profile-line"),
    profileMarkers: document.querySelector("#profile-markers"),
    profileMid: document.querySelector("#profile-mid"),
    profileCaption: document.querySelector(".profile-caption"),
    mapNoteText: document.querySelector("#map-note-text"),
  };

  let currentRoute = null;
  let routeSeed = 1;
  let generationId = 0;
  let waypointId = 1;
  let manualWaypoints = [];
  let mapAddMode = false;
  let streetMapAdapter = null;
  let activeController = null;
  const MAX_GPX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_GPX_ROUTE_POINTS = 50000;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function persistSettings() {
    saveSettings({
        start: refs.start.value,
        end: refs.end.value,
        scenic: refs.scenic.value,
        detour: refs.detour.value,
        bikeFriendly: refs.bikeFriendly.checked,
        onlineRouting: refs.onlineRouting.checked,
        exportDatum: refs.exportDatum.value,
        manualWaypoints,
      });
  }

  function setFormMessage(message, warning = false) {
    refs.status.className = warning ? "form-status warning" : "form-status";
    refs.status.textContent = message;
  }

  function setPlanningState(isPlanning, label = "生成风景路线") {
    if (refs.generateButton) refs.generateButton.disabled = isPlanning;
    if (refs.generateButtonLabel) refs.generateButtonLabel.textContent = isPlanning ? label : "生成风景路线";
    if (refs.cancelRouteButton) refs.cancelRouteButton.hidden = !isPlanning;
    refs.form?.classList.toggle("is-planning", isPlanning);
  }

  function cancelRouteGeneration() {
    generationId += 1;
    activeController?.abort();
    activeController = null;
    setPlanningState(false);
    setFormMessage("已取消规划，可以修改地点后重试。", true);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setFormMessage("当前浏览器不支持定位，请直接输入城市或纬度,经度。", true);
      return;
    }
    const button = refs.locateButton;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    setFormMessage("正在读取手机当前位置…");
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      refs.start.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      if (refs.startSource) refs.startSource.textContent = "手机当前位置";
      persistSettings();
      setFormMessage("已使用当前位置，点击“生成风景路线”开始规划。");
      refs.start.focus();
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }, (error) => {
      const message = error?.code === 1
        ? "定位权限被拒绝，请允许浏览器定位，或手动输入地点。"
        : "暂时无法获取当前位置，请检查手机定位后重试。";
      setFormMessage(message, true);
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  function swapLocations() {
    const start = refs.start.value;
    refs.start.value = refs.end.value;
    refs.end.value = start;
    const startSource = refs.startSource?.textContent || "";
    if (refs.startSource) refs.startSource.textContent = refs.endSource?.textContent || "待定位";
    if (refs.endSource) refs.endSource.textContent = startSource || "待定位";
    persistSettings();
    routeSeed += 1;
    setFormMessage("已交换起终点，正在重新规划…");
    void generateRoute();
  }

  function restoreSettings() {
    try {
      const stored = loadSettings();
      if (!stored || typeof stored !== "object") return;
      if (typeof stored.start === "string" && stored.start.trim()) refs.start.value = stored.start;
      if (typeof stored.end === "string" && stored.end.trim()) refs.end.value = stored.end;
      if (stored.scenic !== undefined) refs.scenic.value = String(clamp(Number(stored.scenic) || 72, 0, 100));
      if (stored.detour !== undefined) refs.detour.value = String(clamp(Number(stored.detour) || 30, 0, 60));
      if (typeof stored.bikeFriendly === "boolean") refs.bikeFriendly.checked = stored.bikeFriendly;
      if (typeof stored.onlineRouting === "boolean") refs.onlineRouting.checked = stored.onlineRouting;
      if (stored.exportDatum === "wgs84" || stored.exportDatum === "gcj02") refs.exportDatum.value = stored.exportDatum;
      if (Array.isArray(stored.manualWaypoints)) {
        manualWaypoints = stored.manualWaypoints.filter((waypoint) => waypoint && typeof waypoint === "object" && typeof waypoint.name === "string" && typeof waypoint.location === "string").map((waypoint) => ({
          id: Number(waypoint.id) || waypointId++,
          name: waypoint.name.slice(0, 80),
          location: waypoint.location.slice(0, 160),
          lat: Number.isFinite(Number(waypoint.lat)) ? Number(waypoint.lat) : undefined,
          lon: Number.isFinite(Number(waypoint.lon)) ? Number(waypoint.lon) : undefined,
          source: "用户添加",
        }));
        waypointId = Math.max(waypointId, ...manualWaypoints.map((waypoint) => waypoint.id + 1), 1);
      }
    } catch (_error) { /* malformed settings are ignored by the store */ }
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seeded(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
      state = Math.imul(1664525, state) + 1013904223;
      return (state >>> 0) / 4294967296;
    };
  }

  function parseLocation(raw) {
    const value = String(raw || "").trim();
    const coordinateMatch = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]);
      const lon = Number(coordinateMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { label: value, lat, lon, exact: true };
      }
    }

    const exact = cityPresets[value];
    if (exact) return { label: value, ...exact, exact: true, source: "本地地点库" };
    const normalized = value.replace(/[\s,，]/g, "").toLowerCase();
    const matchedKey = Object.keys(cityPresets).sort((a, b) => b.length - a.length).find((key) => {
      const normalizedKey = key.replace(/[\s,，]/g, "").toLowerCase();
      // A specific address containing a city name still needs geocoding.
      // Longer suffixes make “海盐澉浦镇” resolve to the town, not Haiyan city.
      return normalized === normalizedKey || normalized === `${normalizedKey}市` || normalized.endsWith(normalizedKey);
    });
    if (matchedKey) return { label: value, ...cityPresets[matchedKey], exact: true, source: "本地地点库" };

    return { label: value || "未命名地点", exact: false, source: "待定位" };
  }

  async function geocodeLocation(raw, fallbackSeed) {
    const value = String(raw || "").trim();
    const parsed = parseLocation(value, fallbackSeed);
    if (parsed.exact) return parsed;
    if (!value) return parsed;
    const cacheKey = value.toLocaleLowerCase();
    const cached = geocodeCache.get(cacheKey);
    if (cached) return { ...cached, label: value };

    // Use short independent attempts so a stalled Nominatim request does not
    // prevent the fallback provider from resolving a perfectly valid town.
    const attemptTimeoutMs = Math.max(2000, Math.floor(GEOCODER_TIMEOUT_MS / 3));
    async function requestJson(url, params) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const response = await fetch(`${url}?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally {
        window.clearTimeout(timeout);
      }
    }

    let lastError = null;
    try {
      const params = new URLSearchParams({
        // countrycodes already restricts the search. Avoid appending a translated
        // country name, which causes poor matches for Chinese township names.
        q: value,
        format: "jsonv2",
        limit: "1",
        countrycodes: "cn",
        "accept-language": "zh-CN",
      });
      const results = await requestJson(GEOCODER_BASE_URL, params);
      const result = Array.isArray(results) ? results[0] : null;
      const lat = result ? Number(result.lat) : NaN;
      const lon = result ? Number(result.lon) : NaN;
      if (!result || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("没有匹配的地点");
      const resolved = {
        label: value,
        lat,
        lon,
        exact: true,
        geocoded: true,
        source: "公开地图地理编码",
        displayName: String(result.display_name || "").slice(0, 180),
      };
      geocodeCache.set(cacheKey, resolved);
      return resolved;
    } catch (error) {
      lastError = error;
    }

    // Photon is a second OpenStreetMap-backed provider. It is useful when the
    // shared Nominatim service is rate-limited, and returns GeoJSON features.
    try {
      const params = new URLSearchParams({ q: `${value}, 中国`, limit: "1", lang: "zh" });
      const payload = await requestJson(GEOCODER_PHOTON_BASE_URL, params);
      const feature = Array.isArray(payload?.features)
        ? payload.features.find((item) => Array.isArray(item?.geometry?.coordinates) && item.geometry.coordinates.length >= 2)
        : null;
      const lon = feature ? Number(feature.geometry.coordinates[0]) : NaN;
      const lat = feature ? Number(feature.geometry.coordinates[1]) : NaN;
      if (!feature || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("没有匹配的地点");
      const properties = feature.properties || {};
      const displayName = [properties.name, properties.city, properties.state, properties.country]
        .filter(Boolean).join(", ");
      const resolved = {
        label: value,
        lat,
        lon,
        exact: true,
        geocoded: true,
        source: "OpenStreetMap 备用地理编码",
        displayName: String(displayName).slice(0, 180),
      };
      geocodeCache.set(cacheKey, resolved);
      return resolved;
    } catch (error) {
      lastError = error;
    }

    // ArcGIS' public endpoint is CORS-enabled and often remains available when
    // the shared Nominatim service is rate-limited. It also handles Chinese
    // administrative names such as “澉浦镇” well.
    try {
      const params = new URLSearchParams({
        SingleLine: `${value}, 中国`,
        f: "json",
        maxLocations: "1",
        langCode: "CHS",
        sourceCountry: "CHN",
        outSR: "4326",
      });
      const payload = await requestJson(GEOCODER_FALLBACK_BASE_URL, params);
      const candidate = Array.isArray(payload?.candidates)
        ? payload.candidates.find((item) => Number(item?.score) >= 85 && Number.isFinite(Number(item?.location?.y)) && Number.isFinite(Number(item?.location?.x)))
        : null;
      const lat = candidate ? Number(candidate.location.y) : NaN;
      const lon = candidate ? Number(candidate.location.x) : NaN;
      if (!candidate || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("没有匹配的地点");
      const resolved = {
        label: value,
        lat,
        lon,
        exact: true,
        geocoded: true,
        source: "备用地图地理编码",
        displayName: String(candidate.address || "").slice(0, 180),
      };
      geocodeCache.set(cacheKey, resolved);
      return resolved;
    } catch (error) {
      const timeout = lastError?.name === "AbortError" || error?.name === "AbortError";
      const message = timeout ? "公开地图定位超时" : (error?.message || lastError?.message || "公开地图定位失败");
      return { ...parsed, geocodeError: message };
    }
  }

  function routeRatioAndOffset(start, end, point) {
    const latitudeScale = Math.cos((((start.lat + end.lat) / 2) * Math.PI) / 180) || 1;
    const dx = (end.lon - start.lon) * latitudeScale;
    const dy = end.lat - start.lat;
    const lengthSquared = dx * dx + dy * dy || 1;
    const pointX = (point.lon - start.lon) * latitudeScale;
    const ratio = clamp((pointX * dx + (point.lat - start.lat) * dy) / lengthSquared, 0, 1);
    const projected = { lon: start.lon + (dx * ratio) / latitudeScale, lat: start.lat + dy * ratio };
    return { ratio, offsetKm: haversineKm(point, projected) };
  }

  async function discoverScenicStops(start, end, scenic = 50) {
    const straightDistanceKm = haversineKm(start, end);
    // Very large bounding boxes are noisy and expensive; curated leads still cover the main long routes.
    if (!Number.isFinite(straightDistanceKm) || straightDistanceKm > 350) return { stops: [], skipped: true };
    const padding = clamp(0.08 + straightDistanceKm / 1800, 0.08, 0.28);
    const south = Math.min(start.lat, end.lat) - padding;
    const north = Math.max(start.lat, end.lat) + padding;
    const west = Math.min(start.lon, end.lon) - padding;
    const east = Math.max(start.lon, end.lon) + padding;
    const query = `[out:json][timeout:8];(nwr["tourism"~"attraction|viewpoint|museum|theme_park"](${south},${west},${north},${east});nwr["historic"](${south},${west},${north},${east});nwr["natural"~"beach|water|peak|wood"](${south},${west},${north},${east}););out center tags;`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(`${OVERPASS_BASE_URL}?data=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const elements = Array.isArray(payload?.elements) ? payload.elements : [];
      const candidates = elements.map((element) => {
        const tags = element.tags || {};
        const lat = Number(element.lat ?? element.center?.lat);
        const lon = Number(element.lon ?? element.center?.lon);
        const name = String(tags["name:zh"] || tags["name:zh-Hans"] || tags.name || "").trim();
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const position = routeRatioAndOffset(start, end, { lat, lon });
        const type = tags.tourism === "viewpoint" ? "观景台" : tags.natural === "water" ? "水岸风景" : tags.historic ? "历史人文" : "沿线景点";
        const sceneryWeight = tags.tourism === "viewpoint" || tags.natural ? 3 : tags.historic ? 2 : 1;
        return {
          name: name.slice(0, 70),
          type,
          note: "公开地图 POI，建议出发前核对开放与骑行可达性",
          source: "OpenStreetMap 公共 POI",
          sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
          lat,
          lon,
          ratio: position.ratio,
          offsetKm: position.offsetKm,
          sceneryWeight,
          candidateScore: sceneryWeight * (0.6 + scenic / 100) - position.offsetKm / Math.max(straightDistanceKm, 1),
        };
      }).filter(Boolean)
        .filter((candidate) => candidate.offsetKm <= Math.max(9, straightDistanceKm * 0.12))
        .sort((a, b) => (b.candidateScore - a.candidateScore) || (a.offsetKm - b.offsetKm) || (a.ratio - b.ratio));
      const unique = [];
      const seen = new Set();
      candidates.forEach((candidate) => {
        const key = candidate.name.replace(/\s+/g, "").toLowerCase();
        if (!seen.has(key) && unique.length < 8) {
          seen.add(key);
          unique.push(candidate);
        }
      });
      return { stops: unique, skipped: false };
    } catch (_error) {
      return { stops: [], skipped: false };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function haversineKm(a, b) {
    const radius = 6371;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  function localNameIs(node, name) {
    return String(node.localName || node.nodeName || "").split(":").pop().toLowerCase() === name;
  }

  function elementsNamed(root, name) {
    return Array.from(root.getElementsByTagName("*")).filter((node) => localNameIs(node, name));
  }

  function directChildText(node, name, maxLength = 500) {
    const child = Array.from(node.children || []).find((item) => localNameIs(item, name));
    return child ? child.textContent.trim().slice(0, maxLength) : "";
  }

  function parseGpxPoint(node, kind, index) {
    const rawLat = node.getAttribute("lat");
    const rawLon = node.getAttribute("lon");
    const lat = rawLat === null || rawLat.trim() === "" ? NaN : Number(rawLat);
    const lon = rawLon === null || rawLon.trim() === "" ? NaN : Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`${kind} 第 ${index + 1} 个点的经纬度无效。`);
    }
    const rawElevation = directChildText(node, "ele", 40);
    const parsedElevation = rawElevation === "" ? NaN : Number(rawElevation);
    return {
      lat,
      lon,
      ele: Number.isFinite(parsedElevation) ? parsedElevation : null,
      hasElevation: Number.isFinite(parsedElevation),
      name: directChildText(node, "name", 80),
      description: directChildText(node, "desc", 500) || directChildText(node, "cmt", 500),
      gpxType: directChildText(node, "type", 80),
    };
  }

  function fillMissingElevations(points) {
    // Missing GPX elevation remains missing. The profile renderer can display a
    // neutral chart, but export must never turn an unknown value into measured 0m.
    points.forEach((point) => {
      if (!point.hasElevation) point.ele = null;
    });
  }

  function cumulativeDistances(points) {
    const distances = [0];
    for (let i = 1; i < points.length; i += 1) distances.push(distances[i - 1] + haversineKm(points[i - 1], points[i]));
    return distances;
  }

  function parseGpxDocument(source, fileName) {
    const xml = new DOMParser().parseFromString(source, "application/xml");
    if (xml.getElementsByTagName("parsererror").length || !xml.documentElement || !localNameIs(xml.documentElement, "gpx")) {
      throw new Error("文件不是有效的 GPX XML。");
    }
    const version = (xml.documentElement.getAttribute("version") || "").trim();
    if (version && version !== "1.1") throw new Error(`仅支持 GPX 1.1，当前文件版本为 ${version}。`);

    const trackNodes = elementsNamed(xml, "trkpt");
    const routeNodes = elementsNamed(xml, "rtept");
    const waypointNodes = elementsNamed(xml, "wpt");
    const tracks = trackNodes.map((node, index) => parseGpxPoint(node, "trkpt", index));
    const routePoints = routeNodes.map((node, index) => parseGpxPoint(node, "rtept", index));
    const waypoints = waypointNodes.map((node, index) => parseGpxPoint(node, "wpt", index));
    const points = tracks.length >= 2 ? tracks : routePoints;
    const sourceKind = tracks.length >= 2 ? "轨迹" : "路线";
    if (points.length < 2) throw new Error("GPX 至少需要 2 个 trkpt 或 rtept 才能形成路线。");
    if (points.length > MAX_GPX_ROUTE_POINTS) throw new Error(`路线包含 ${points.length.toLocaleString("zh-CN")} 个点，超过 ${MAX_GPX_ROUTE_POINTS.toLocaleString("zh-CN")} 点的导入上限。`);

    fillMissingElevations(points);
    const distances = cumulativeDistances(points);
    let elevationGain = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Number.isFinite(points[i].ele) && Number.isFinite(points[i - 1].ele)) elevationGain += Math.max(0, points[i].ele - points[i - 1].ele);
    }
    const containers = tracks.length >= 2 ? elementsNamed(xml, "trk") : elementsNamed(xml, "rte");
    const metadata = elementsNamed(xml, "metadata")[0];
    const fallbackName = String(fileName || "导入路线").replace(/\.gpx$/i, "").slice(0, 120) || "导入路线";
    const routeName = (containers[0] && directChildText(containers[0], "name", 120)) || (metadata && directChildText(metadata, "name", 120)) || fallbackName;
    const stops = waypoints.map((waypoint, index) => {
      const pointIndex = nearestPointIndex(points, waypoint);
      return {
        id: index + 1,
        index: pointIndex,
        name: waypoint.name || `航点 ${index + 1}`,
        type: waypoint.gpxType || "GPX 航点",
        note: waypoint.description || "导入文件中的沿途航点",
        description: waypoint.description,
        gpxType: waypoint.gpxType,
        lat: waypoint.lat,
        lon: waypoint.lon,
        ele: waypoint.hasElevation ? waypoint.ele : points[pointIndex].ele,
        hasElevation: waypoint.hasElevation,
        km: distances[pointIndex],
      };
    });
    const first = points[0];
    const last = points[points.length - 1];
    return {
      start: { label: first.name || "GPX 起点", lat: first.lat, lon: first.lon, exact: true, source: "GPX 文件" },
      end: { label: last.name || "GPX 终点", lat: last.lat, lon: last.lon, exact: true, source: "GPX 文件" },
      points,
      stops,
      distanceKm: distances[distances.length - 1],
      elevationGain: Math.round(elevationGain),
      score: "GPX",
      kind: "GPX 导入",
      routeName,
      scenic: 50,
      detour: 0,
      bikeFriendly: false,
      seed: hashString(`${fileName}|${points.length}|${first.lat}|${last.lon}`),
      imported: true,
      sourceKind,
      sourceFileName: fileName,
      researched: false,
      scenicSource: "GPX 文件航点",
      elevationSource: points.some((point) => point.hasElevation) ? "GPX 文件" : "无高程数据",
      source: "gpx",
      scenicScore: { score: null, details: {}, features: [], status: "offline", counts: {}, dataSource: "gpx" },
      supplies: { status: "offline", items: [], dataSource: "gpx" },
    };
  }

  function selectScenicDescriptors(start, end, scenic, detour, manualStops, discoveredStops, random) {
    if (manualStops.length) return manualStops.map((stop) => ({ ...stop, source: "用户添加" }));
    const isHangzhouQiandao = /杭州|西湖/.test(start.label) && /千岛湖/.test(end.label);
    const isShanghaiHaiyan = /上海|上海站|上海火车站/.test(start.label) && /海盐/.test(end.label);
    const targetCount = scenic >= 78 ? 4 : scenic >= 52 ? 3 : 2;
    if (isHangzhouQiandao) {
      return researchedScenicStops
        .filter((stop) => detour >= 30 || stop.name !== "芹川古村")
        .slice(0, targetCount);
    }
    if (isShanghaiHaiyan) {
      return researchedShanghaiHaiyanStops
        .filter((stop) => detour >= 18 || stop.name !== "乍浦九龙山")
        .slice(0, Math.min(targetCount, researchedShanghaiHaiyanStops.length));
    }
    if (discoveredStops.length) return discoveredStops.slice(0, targetCount);
    return [0.2, 0.43, 0.67, 0.84].map((ratio, stopIndex) => {
      const descriptor = demoScenicNames[(Math.floor(random() * demoScenicNames.length) + stopIndex) % demoScenicNames.length];
      return { name: descriptor[0], type: descriptor[1], note: descriptor[2], source: "离线演示占位", sourceUrl: "", ratio };
    }).slice(0, targetCount);
  }

  function insertScenicPoints(points, stops, preserveOrder = false) {
    const exactStops = stops.filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lon)));
    const inserts = exactStops.map((stop, index) => ({
      stop,
      index: preserveOrder ? Math.round(((index + 1) / (exactStops.length + 1)) * (points.length - 1)) : nearestPointIndex(points, stop),
    })).sort((a, b) => b.index - a.index);
    inserts.forEach(({ stop, index }) => {
      const anchor = points[Math.min(index, points.length - 1)];
      points.splice(index + 1, 0, {
        lat: Number(stop.lat),
        lon: Number(stop.lon),
        ele: Number.isFinite(anchor?.ele) ? anchor.ele : null,
        hasElevation: false,
        elevationSource: "示意",
      });
    });
    return points;
  }

  function buildRoute(start, end, scenic, detour, bikeFriendly, manualStops = [], discoveredStops = []) {
    const seed = hashString(`${start.label}|${end.label}|${scenic}|${detour}|${routeSeed}`);
    const random = seeded(seed);
    const pointCount = 54;
    const midLat = (start.lat + end.lat) / 2;
    const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
    const dx = (end.lon - start.lon) * lonScale;
    const dy = end.lat - start.lat;
    const length = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
    const perpendicular = { x: -dy / length, y: dx / length };
    const detourAmount = Math.max(0.006, length * (0.018 + (detour / 100) * 0.12) * (0.4 + scenic / 100));
    const phase = random() * Math.PI * 2;
    let points = [];
    let previous = null;
    let distanceKm = 0;
    let elevation = 42 + random() * 34;
    let minEle = elevation;
    let maxEle = elevation;

    for (let i = 0; i < pointCount; i += 1) {
      const t = i / (pointCount - 1);
      const wave = Math.sin(t * Math.PI * (1.25 + scenic / 125) + phase) * detourAmount;
      const secondary = Math.sin(t * Math.PI * 4 + phase * 0.7) * detourAmount * 0.23;
      const localX = dx * t + perpendicular.x * (wave + secondary);
      const localY = dy * t + perpendicular.y * (wave + secondary);
      let lat = start.lat + localY;
      let lon = start.lon + localX / lonScale;
      if (i === 0) ({ lat, lon } = start);
      if (i === pointCount - 1) ({ lat, lon } = end);

      const slope = Math.sin(t * Math.PI * 2.2 + phase) * (23 + scenic * 0.22);
      const texture = Math.sin(t * Math.PI * 9 + phase * 1.2) * 7;
      elevation = clamp(elevation + slope * 0.05 + texture * 0.04 + (random() - 0.48) * 4, 18, 820);
      minEle = Math.min(minEle, elevation);
      maxEle = Math.max(maxEle, elevation);
      const point = { lat, lon, ele: elevation, hasElevation: false, elevationSource: "示意" };
      if (previous) distanceKm += haversineKm(previous, point);
      points.push(point);
      previous = point;
    }

    const selectedStops = selectScenicDescriptors(start, end, scenic, detour, manualStops, discoveredStops, random);
    const isHangzhouQiandao = /杭州|西湖/.test(start.label) && /千岛湖/.test(end.label);
    const isShanghaiHaiyan = /上海|上海站|上海火车站/.test(start.label) && /海盐/.test(end.label);
    points = insertScenicPoints(points, selectedStops, manualStops.length > 0);
    const stops = selectedStops.map((descriptor, stopIndex) => {
      const hasExactPosition = Number.isFinite(Number(descriptor.lat)) && Number.isFinite(Number(descriptor.lon));
      const index = hasExactPosition
        ? nearestPointIndex(points, descriptor)
        : Math.round((descriptor.ratio || 0) * (points.length - 1));
      const point = points[index];
      const lat = descriptor.lat === undefined ? point.lat : descriptor.lat;
      const lon = descriptor.lon === undefined ? point.lon : descriptor.lon;
      return {
        ...descriptor,
        id: stopIndex + 1,
        index,
        name: descriptor.name,
        type: descriptor.type,
        note: descriptor.note,
        source: descriptor.source || "公开资料线索",
        sourceUrl: descriptor.sourceUrl || "",
        lat,
        lon,
        ele: descriptor.ele === undefined ? point.ele : descriptor.ele,
        hasElevation: descriptor.hasElevation === true,
        km: routeDistance(points, index),
      };
    });

    distanceKm = routeDistance(points);
    minEle = Math.min(...points.map((point) => Number.isFinite(point.ele) ? point.ele : elevation));
    maxEle = Math.max(...points.map((point) => Number.isFinite(point.ele) ? point.ele : elevation));

    const scenicFactor = scenic / 100;
    const score = Math.round(clamp(67 + scenicFactor * 28 - (detour < 8 ? 4 : 0) + (bikeFriendly ? 3 : 0), 0, 99));
    const kind = scenic >= 78 ? "风景优先" : scenic >= 52 ? "风景均衡" : "效率优先";
    const routeName = `${start.label} → ${end.label} · ${kind}`;
    return {
      start,
      end,
      points,
      stops,
      candidateStops: [...manualStops, ...discoveredStops],
      distanceKm,
      directDistanceKm: haversineKm(start, end),
      detourPercent: haversineKm(start, end) > 0 ? ((distanceKm / haversineKm(start, end)) - 1) * 100 : 0,
      elevationGain: Math.max(38, Math.round((maxEle - minEle) * (0.74 + scenicFactor * 0.28))),
      score,
      kind,
      routeName,
      scenic,
      detour,
      bikeFriendly,
      seed,
      source: "offline",
      researched: isHangzhouQiandao || isShanghaiHaiyan,
      scenicSource: manualStops.length ? "用户添加途经点" : isHangzhouQiandao || isShanghaiHaiyan ? "公开骑行内容线索" : discoveredStops.length ? "OpenStreetMap 公共 POI" : "离线演示占位",
      elevationSource: "示意",
      scenicScore: { score: null, details: {}, features: [], status: "offline", counts: {}, dataSource: "offline" },
      supplies: { status: "offline", items: [], dataSource: "offline" },
    };
  }

  function routeDistance(points, endIndex = points.length - 1) {
    let distanceKm = 0;
    for (let index = 1; index <= endIndex && index < points.length; index += 1) {
      distanceKm += haversineKm(points[index - 1], points[index]);
    }
    return distanceKm;
  }

  function nearestPointIndex(points, target) {
    let nearest = 0;
    let bestDistance = Infinity;
    points.forEach((point, index) => {
      const distance = haversineKm(point, target);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = index;
      }
    });
    return nearest;
  }

  function interpolateElevation(points, ratio) {
    if (!points.length) return 0;
    const scaled = clamp(ratio, 0, 1) * (points.length - 1);
    const lower = Math.floor(scaled);
    const upper = Math.min(points.length - 1, lower + 1);
    const fraction = scaled - lower;
    const lowerElevation = Number.isFinite(points[lower].ele) ? points[lower].ele : 0;
    const upperElevation = Number.isFinite(points[upper].ele) ? points[upper].ele : lowerElevation;
    return lowerElevation + (upperElevation - lowerElevation) * fraction;
  }

  function applyOnlineGeometry(route, coordinates, distanceMeters) {
    const points = coordinates.map(([lon, lat], index) => ({
      lat: Number(lat),
      lon: Number(lon),
      ele: interpolateElevation(route.points, coordinates.length > 1 ? index / (coordinates.length - 1) : 0),
      hasElevation: false,
      elevationSource: "示意",
    }));
    if (points.length < 2 || points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon))) {
      throw new Error("OSRM 返回的道路几何无效");
    }

    const stops = route.stops.map((stop) => {
      const index = nearestPointIndex(points, stop);
      const point = points[index];
      return {
        ...stop,
        index,
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        hasElevation: false,
        km: routeDistance(points, index),
      };
    });
    const elevationGain = points.reduce((sum, point, index) => {
      if (!index) return sum;
      return sum + Math.max(0, point.ele - points[index - 1].ele);
    }, 0);
    return {
      ...route,
      points,
      stops,
      distanceKm: Number.isFinite(Number(distanceMeters)) ? Number(distanceMeters) / 1000 : routeDistance(points),
      elevationGain: Math.max(0, Math.round(elevationGain)),
      source: "osrm",
      provider: "OpenStreetMap 骑行路由",
    };
  }

  async function requestOsrm(locations, signal, options = {}) {
    const coordinates = locations.map((point) => `${point.lon},${point.lat}`).join(";");
    const params = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "false" });
    if (options.exclude) params.set("exclude", options.exclude);
    const url = `${OSRM_BASE_URL}/route/v1/cycling/${coordinates}?${params.toString()}`;
    const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP ${response.status}${payload?.code ? ` · ${payload.code}` : ""}${payload?.message ? ` · ${payload.message}` : ""}`);
    const geometry = payload?.routes?.[0]?.geometry?.coordinates;
    if (payload?.code !== "Ok" || !Array.isArray(geometry)) {
      throw new Error(payload?.message || "未找到可骑行道路");
    }
    return payload.routes[0];
  }

  function samplePointIndices(length, maxSamples = 50) {
    if (length <= maxSamples) return Array.from({ length }, (_, index) => index);
    return Array.from({ length: maxSamples }, (_, index) => Math.round((index / (maxSamples - 1)) * (length - 1)));
  }

  async function enrichRouteElevations(route, signal) {
    const indices = samplePointIndices(route.points.length, 100);
    const samples = [];
    for (let offset = 0; offset < indices.length; offset += 50) {
      const batch = indices.slice(offset, offset + 50);
      const locations = batch.map((index) => `${route.points[index].lat},${route.points[index].lon}`).join("|");
      const response = await fetch(`${ELEVATION_BASE_URL}?locations=${encodeURIComponent(locations)}`, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`高程服务 HTTP ${response.status}`);
      const payload = await response.json();
      const results = Array.isArray(payload?.results) ? payload.results : [];
      if (results.length !== batch.length) throw new Error("高程服务返回点数不完整");
      results.forEach((result, index) => {
        const elevation = Number(result.elevation);
        if (Number.isFinite(elevation)) samples.push({ index: batch[index], elevation });
      });
    }
    if (samples.length < 2) throw new Error("没有可用的高程数据");
    const points = route.points.map((point, index) => {
      let left = samples[0];
      let right = samples[samples.length - 1];
      for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
        if (samples[sampleIndex].index >= index) {
          right = samples[sampleIndex];
          left = samples[sampleIndex - 1];
          break;
        }
      }
      const span = Math.max(right.index - left.index, 1);
      const ratio = clamp((index - left.index) / span, 0, 1);
      const ele = left.elevation + (right.elevation - left.elevation) * ratio;
      return { ...point, ele, hasElevation: true, elevationSource: "Open-Elevation" };
    });
    let elevationGain = 0;
    for (let index = 1; index < points.length; index += 1) elevationGain += Math.max(0, points[index].ele - points[index - 1].ele);
    const stops = route.stops.map((stop) => {
      const index = nearestPointIndex(points, stop);
      return { ...stop, index, lat: points[index].lat, lon: points[index].lon, ele: points[index].ele, hasElevation: true, km: routeDistance(points, index) };
    });
    return { ...route, points, stops, elevationGain: Math.round(elevationGain), elevationSource: "Open-Elevation" };
  }

  async function fetchOnlineRoute(route, signal) {
    const routingOptions = route.bikeFriendly ? { exclude: "motorway,trunk" } : {};
    let exclusionFallback = false;
    const requestRoute = async (locations) => {
      try {
        return await requestOsrm(locations, signal, exclusionFallback ? {} : routingOptions);
      } catch (error) {
        if (!routingOptions.exclude || exclusionFallback) throw error;
        exclusionFallback = true;
        return requestOsrm(locations, signal, {});
      }
    };
    const baseline = await requestRoute([route.start, route.end]);
    const baselineDistanceKm = Number(baseline.distance) / 1000;
    const maxDistanceKm = baselineDistanceKm * (1 + route.detour / 100);
    let candidateStops = route.stops.slice();
    let selectedPayload = null;
    let selectedStops = candidateStops;
    let droppedStops = 0;
    while (candidateStops.length >= 0) {
      try {
        const payload = await requestRoute([route.start, ...candidateStops, route.end]);
        const distanceKm = Number(payload.distance) / 1000;
        if (distanceKm <= maxDistanceKm || candidateStops.length === 0) {
          selectedPayload = payload;
          selectedStops = candidateStops;
          droppedStops = route.stops.length - candidateStops.length;
          break;
        }
      } catch (error) {
        if (candidateStops.length === 0) throw error;
      }
      candidateStops = candidateStops.slice(0, -1);
    }
    let onlineRoute = applyOnlineGeometry({ ...route, stops: selectedStops }, selectedPayload.geometry.coordinates, selectedPayload.distance);
    onlineRoute.directDistanceKm = baselineDistanceKm;
    onlineRoute.detourPercent = baselineDistanceKm > 0 ? ((onlineRoute.distanceKm / baselineDistanceKm) - 1) * 100 : 0;
    onlineRoute.droppedStops = droppedStops;
    const warnings = [];
    if (droppedStops) warnings.push(`已按最多绕行 ${route.detour}% 调整，移除 ${droppedStops} 个较远景点。`);
    if (exclusionFallback) warnings.push("当前骑行路由服务不支持道路排除参数，请出发前核对道路类型。");
    onlineRoute.routingWarning = warnings.join(" ");
    try {
      onlineRoute = await enrichRouteElevations(onlineRoute, signal);
    } catch (error) {
      onlineRoute.elevationSource = "示意";
      onlineRoute.elevationWarning = error?.name === "AbortError" ? "高程服务超时，已保留路线。" : "高程服务不可用，已保留路线。";
    }
    return onlineRoute;
  }

  function svgElement(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function projectFactory(points, width, height, padding = 75) {
    const lats = points.map((point) => point.lat);
    const lons = points.map((point) => point.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latSpan = Math.max(maxLat - minLat, 0.01);
    const lonSpan = Math.max(maxLon - minLon, 0.01);
    const scale = Math.min((width - padding * 2) / lonSpan, (height - padding * 2) / latSpan);
    const usedWidth = lonSpan * scale;
    const usedHeight = latSpan * scale;
    const offsetX = (width - usedWidth) / 2;
    const offsetY = (height - usedHeight) / 2;
    const project = (point) => ({
      x: offsetX + (point.lon - minLon) * scale,
      y: height - offsetY - (point.lat - minLat) * scale,
    });
    project.inverse = (x, y) => ({
      lon: minLon + (x - offsetX) / scale,
      lat: minLat + (height - offsetY - y) / scale,
    });
    return project;
  }

  function initStreetMap() {
    // createStreetMap converts the GCJ-02 Leaflet click back to WGS-84 before
    // invoking this callback, so waypoints remain compatible with OSRM/GPX.
    streetMapAdapter = createStreetMap({ element: refs.streetMap, mapStage: refs.mapStage, onMapClick: (payload) => addWaypointFromMap(payload) });
  }

  function renderStreetMap(route) {
    streetMapAdapter?.render(route);
  }

  function renderMap(route) {
    renderStreetMap(route);
    clear(refs.mapBackdrop);
    clear(refs.mapRoads);
    clear(refs.mapRoute);
    clear(refs.mapPoints);
    clear(refs.mapLabels);
    const project = projectFactory(route.points, 900, 560, 82);
    const startPoint = project(route.points[0]);
    const endPoint = project(route.points[route.points.length - 1]);
    const all = route.points.map(project);
    const routePath = all.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");

    // Soft terrain and water shapes make the route legible without requiring a map service.
    const spanX = Math.max(...all.map((point) => point.x)) - Math.min(...all.map((point) => point.x));
    const spanY = Math.max(...all.map((point) => point.y)) - Math.min(...all.map((point) => point.y));
    const water = svgElement("path", {
      class: "map-water",
      d: `M -30 ${Math.max(280, endPoint.y + 75).toFixed(1)} C 170 ${(endPoint.y + 15).toFixed(1)}, 300 ${(endPoint.y + 120).toFixed(1)}, 480 ${(endPoint.y + 46).toFixed(1)} S 780 ${(endPoint.y + 32).toFixed(1)}, 930 ${(endPoint.y + 90).toFixed(1)} L 930 590 L -30 590 Z`,
    });
    refs.mapBackdrop.appendChild(water);
    const hillPath = svgElement("path", {
      class: "map-hill",
      d: `M -20 ${(startPoint.y - 82).toFixed(1)} C 160 ${(startPoint.y - 155).toFixed(1)}, 245 ${(startPoint.y - 30).toFixed(1)}, 405 ${(startPoint.y - 106).toFixed(1)} S 710 ${(startPoint.y - 160).toFixed(1)}, 920 ${(startPoint.y - 62).toFixed(1)} L 920 -20 L -20 -20 Z`,
    });
    refs.mapBackdrop.appendChild(hillPath);

    const random = seeded(route.seed ^ 0x9e3779b9);
    for (let i = 0; i < 10; i += 1) {
      const x = 25 + random() * 850;
      const y = 34 + random() * 490;
      const bend = 45 + random() * 110;
      const d = `M ${x.toFixed(1)} ${(y + bend).toFixed(1)} C ${(x + 90).toFixed(1)} ${(y - bend).toFixed(1)}, ${(x + 190).toFixed(1)} ${(y + bend * .8).toFixed(1)}, ${(x + 295).toFixed(1)} ${(y - bend * .5).toFixed(1)}`;
      refs.mapRoads.appendChild(svgElement("path", { class: i % 3 === 0 ? "map-road" : "map-road secondary", d }));
    }

    refs.mapRoute.appendChild(svgElement("path", { class: "route-halo", d: routePath }));
    refs.mapRoute.appendChild(svgElement("path", { class: "route-line", d: routePath }));
    refs.mapRoute.appendChild(svgElement("path", { class: "route-line-inner", d: routePath }));

    const drawMarker = (point, label, kind, anchor) => {
      const marker = svgElement("circle", { class: `route-marker ${kind}`, cx: point.x, cy: point.y, r: 8 });
      marker.appendChild(svgElement("title")).textContent = label;
      refs.mapPoints.appendChild(marker);
      const text = svgElement("text", { class: "route-label", x: point.x + (anchor === "start" ? 14 : -14), y: point.y - 13, "text-anchor": anchor === "start" ? "start" : "end" });
      text.textContent = label;
      refs.mapLabels.appendChild(text);
    };
    drawMarker(startPoint, route.start.label, "start", "start");
    drawMarker(endPoint, route.end.label, "end", "end");

    route.stops.forEach((stop) => {
      const point = project(stop);
      const group = svgElement("g", { class: "scenic-marker-group", tabindex: "0", role: "button", "aria-label": stop.name });
      const pin = svgElement("path", { class: "scenic-pin", d: `M ${point.x} ${(point.y + 10).toFixed(1)} C ${(point.x - 11).toFixed(1)} ${(point.y - 3).toFixed(1)}, ${(point.x - 8).toFixed(1)} ${(point.y - 13).toFixed(1)}, ${point.x} ${(point.y - 13).toFixed(1)} C ${(point.x + 8).toFixed(1)} ${(point.y - 13).toFixed(1)}, ${(point.x + 11).toFixed(1)} ${(point.y - 3).toFixed(1)}, ${point.x} ${(point.y + 10).toFixed(1)} Z` });
      const core = svgElement("circle", { class: "scenic-pin-core", cx: point.x, cy: point.y - 4, r: 3 });
      group.appendChild(pin);
      group.appendChild(core);
      const labelWidth = Math.max(52, stop.name.length * 11 + 15);
      const labelX = clamp(point.x - labelWidth / 2, 6, 894 - labelWidth);
      const labelY = point.y < 85 ? point.y + 24 : point.y - 34;
      group.appendChild(svgElement("rect", { class: "scenic-label-bg", x: labelX, y: labelY, width: labelWidth, height: 20, rx: 2 }));
      const text = svgElement("text", { class: "scenic-label", x: labelX + labelWidth / 2, y: labelY + 13, "text-anchor": "middle" });
      text.textContent = stop.name;
      group.appendChild(text);
      group.addEventListener("click", () => highlightStop(stop.id));
      group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); highlightStop(stop.id); } });
      refs.mapPoints.appendChild(group);
    });
  }

  function renderStops(route) {
    clear(refs.stopsList);
    route.stops.forEach((stop) => {
      const item = document.createElement("li");
      item.className = "stop-item";
      item.dataset.stopId = String(stop.id);
      const number = document.createElement("span");
      number.className = "stop-number";
      number.textContent = String(stop.id).padStart(2, "0");
      const copy = document.createElement("span");
      copy.className = "stop-copy";
      const name = document.createElement("strong");
      name.textContent = stop.name;
      const note = document.createElement("small");
      note.textContent = `${stop.type} · ${stop.note}`;
      copy.append(name, note);
      if (stop.source) {
        const source = document.createElement("small");
        source.className = "stop-source";
        source.textContent = `线索：${stop.source}`;
        copy.append(source);
      }
      if (stop.sourceUrl) {
        const sourceLink = document.createElement("a");
        sourceLink.className = "stop-source-link";
        sourceLink.href = stop.sourceUrl;
        sourceLink.target = "_blank";
        sourceLink.rel = "noreferrer noopener";
        sourceLink.textContent = "查看公开线索";
        sourceLink.addEventListener("click", (event) => event.stopPropagation());
        copy.append(sourceLink);
      }
      const distance = document.createElement("span");
      distance.className = "stop-distance";
      distance.textContent = `${stop.km.toFixed(0)} km`;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `在地图上查看${stop.name}`);
      button.addEventListener("click", () => highlightStop(stop.id));
      item.append(number, copy, distance, button);
      refs.stopsList.appendChild(item);
    });
  }

  function highlightStop(stopId) {
    document.querySelectorAll(".stop-item").forEach((item) => item.classList.toggle("is-highlighted", item.dataset.stopId === String(stopId)));
    document.querySelectorAll(".scenic-marker-group").forEach((group) => group.classList.remove("is-highlighted"));
    const groups = document.querySelectorAll(".scenic-marker-group");
    const index = Number(stopId) - 1;
    if (groups[index]) groups[index].classList.add("is-highlighted");
    const item = document.querySelector(`.stop-item[data-stop-id="${String(stopId)}"]`);
    if (item) item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderProfile(route) {
    clear(refs.profileGrid);
    clear(refs.profileMarkers);
    const hasElevation = route.elevationSource === "示意" || route.points.some((point) => Number.isFinite(point.ele) && point.hasElevation !== false);
    const values = route.points.map((point) => Number.isFinite(point.ele) ? point.ele : 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 1);
    const width = 900;
    const chartTop = 18;
    const chartBottom = 183;
    const coords = values.map((value, index) => ({
      x: (index / (values.length - 1)) * width,
      y: chartBottom - ((value - min) / span) * (chartBottom - chartTop),
    }));
    const line = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    refs.profileLine.setAttribute("d", line);
    refs.profileArea.setAttribute("d", `${line} L ${width} ${chartBottom} L 0 ${chartBottom} Z`);
    [0, .5, 1].forEach((ratio) => {
      const y = chartBottom - ratio * (chartBottom - chartTop);
      refs.profileGrid.appendChild(svgElement("line", { class: "profile-grid-line", x1: 0, y1: y, x2: width, y2: y }));
      const label = svgElement("text", { class: "profile-grid-label", x: 7, y: y - 5 });
      label.textContent = `${Math.round(min + span * ratio)}m`;
      refs.profileGrid.appendChild(label);
    });
    route.stops.forEach((stop) => {
      const index = stop.index;
      const point = coords[index];
      if (point) refs.profileMarkers.appendChild(svgElement("circle", { class: "profile-marker", cx: point.x, cy: point.y, r: 4 }));
    });
    refs.profileMid.textContent = `${route.distanceKm / 2 < 10 ? route.distanceKm.toFixed(1) : (route.distanceKm / 2).toFixed(0)} km`;
    if (refs.profileCaption) refs.profileCaption.textContent = hasElevation
      ? route.elevationSource === "示意" ? "相对海拔 · 示意" : `实测高程 · ${route.elevationSource || "GPX"}`
      : "无高程数据 · 不参与导出";
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

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

  function wgs84ToGcj02(point) {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || outOfChina(lat, lon)) return { lat, lon };
    const dLat = transformLatitude(lon - 105, lat - 35);
    const dLon = transformLongitude(lon - 105, lat - 35);
    const radLat = lat / 180 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    return {
      lat: lat + (dLat * 180) / ((AXIS * (1 - EE)) / (magic * sqrtMagic) * PI),
      lon: lon + (dLon * 180) / (AXIS / sqrtMagic * Math.cos(radLat) * PI),
    };
  }

  function serializeCoordinate(point, datum) {
    const converted = datum === "gcj02" ? wgs84ToGcj02(point) : point;
    return { lat: converted.lat.toFixed(6), lon: converted.lon.toFixed(6) };
  }

  function buildGpx(route, datum = "wgs84") {
    return buildGpxDocument(route, { datum, serializeCoordinate, supportStops: getSupportStops(route) });
  }

  function formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) return `${rest} 分钟`;
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }

  function buildRidePlan(route) {
    const distanceKm = Math.max(0, Number(route.distanceKm) || 0);
    const elevationGain = Math.max(0, Number(route.elevationGain) || 0);
    const scenic = clamp(Number(route.scenic) || 50, 0, 100);
    const baseSpeed = clamp(25 - scenic * 0.045 + (route.bikeFriendly ? 1.2 : 0), 15, 27);
    const climbPenalty = Math.min(6, (elevationGain / Math.max(distanceKm, 1)) * 0.55);
    const movingSpeed = clamp(baseSpeed - climbPenalty, 11, 27);
    const movingMinutes = distanceKm > 0 ? (distanceKm / movingSpeed) * 60 : 0;
    const fuelCount = Math.max(0, Math.ceil(distanceKm / 40) - 1);
    const scenicBreakCount = Math.min(3, Array.isArray(route.stops) ? route.stops.length : 0);
    const breakMinutes = fuelCount * 8 + scenicBreakCount * 5;
    return {
      movingSpeed,
      movingMinutes,
      fuelCount,
      totalMinutes: movingMinutes + breakMinutes,
      fuelIntervalKm: 40,
    };
  }

  function pointAtDistance(points, targetKm) {
    if (!Array.isArray(points) || !points.length) return null;
    if (targetKm <= 0) return points[0];
    let travelled = 0;
    for (let index = 1; index < points.length; index += 1) {
      const segment = haversineKm(points[index - 1], points[index]);
      if (travelled + segment >= targetKm) {
        const ratio = segment > 0 ? (targetKm - travelled) / segment : 0;
        return {
          lat: points[index - 1].lat + (points[index].lat - points[index - 1].lat) * ratio,
          lon: points[index - 1].lon + (points[index].lon - points[index - 1].lon) * ratio,
          ele: Number.isFinite(points[index - 1].ele) && Number.isFinite(points[index].ele)
            ? points[index - 1].ele + (points[index].ele - points[index - 1].ele) * ratio
            : undefined,
          hasElevation: Boolean(points[index - 1].hasElevation && points[index].hasElevation),
        };
      }
      travelled += segment;
    }
    return points[points.length - 1];
  }

  function getSupportStops(route) {
    if (route.supplies?.status === "ready" || route.supplies?.status === "partial") {
      return (route.supplies.items || []).map((item, index) => ({
        id: item.id || `supply-${index + 1}`,
        index: Number.isFinite(item.index) ? item.index : nearestPointIndex(route.points, item),
        name: item.name || "补给点",
        type: item.type === "cafe" ? "咖啡店" : item.type === "restaurant" ? "餐厅" : item.type === "fuel" ? "加油站" : "便利店",
        note: `距路线约 ${Math.round(item.distance || 0)} 米`,
        source: "OpenStreetMap 公共 POI",
        sourceUrl: item.sourceUrl || "",
        gpxType: item.type || "shop",
        lat: item.lat,
        lon: item.lon,
        ele: item.ele,
        hasElevation: Boolean(item.hasElevation),
        km: Number(item.km) || 0,
      }));
    }
    const hasExistingSupportStop = (route.stops || []).some((stop) => {
      const gpxType = String(stop.gpxType || "").toLowerCase();
      return gpxType === "fuel" || stop.type === "骑行补给";
    });
    if (hasExistingSupportStop) return [];
    const plan = buildRidePlan(route);
    const supportStops = [];
    for (let index = 1; index <= plan.fuelCount; index += 1) {
      const km = index * plan.fuelIntervalKm;
      const point = pointAtDistance(route.points, km);
      if (!point) continue;
      const nearScenic = (route.stops || []).some((stop) => haversineKm(stop, point) < 3);
      if (nearScenic) continue;
      supportStops.push({
        id: `fuel-${index}`,
        index: nearestPointIndex(route.points, point),
        name: `补给建议 ${km} km`,
        type: "骑行补给",
        note: "建议在此里程前后补水、补充能量；请出发前确认店铺或水源。",
        source: "按里程估算",
        sourceUrl: "",
        gpxType: "fuel",
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        hasElevation: point.hasElevation,
        km,
      });
    }
    return supportStops;
  }

  function getSupportStopCount(route) {
    const existing = (route.stops || []).filter((stop) => {
      const gpxType = String(stop.gpxType || "").toLowerCase();
      return gpxType === "fuel" || stop.type === "骑行补给";
    }).length;
    return existing || getSupportStops(route).length;
  }

  function safeFileStem(value, fallback) {
    return String(value || "").replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || fallback;
  }

  function exportGpx() {
    if (!currentRoute) return;
    const datum = refs.exportDatum.value === "gcj02" ? "gcj02" : "wgs84";
    const blob = new Blob([buildGpx(currentRoute, datum)], { type: "application/gpx+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const importedName = currentRoute.imported ? safeFileStem(String(currentRoute.sourceFileName || "").replace(/\.gpx$/i, ""), "route") : "";
    const safeStart = safeFileStem(currentRoute.start.label, "start");
    const safeEnd = safeFileStem(currentRoute.end.label, "end");
    anchor.href = url;
    anchor.download = importedName ? `${importedName}.gpx` : `jingxian-${safeStart}-${safeEnd}.gpx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const supportCount = getSupportStopCount(currentRoute);
    refs.exportStatus.textContent = `GPX 已生成（${datum === "gcj02" ? "GCJ-02" : "WGS84"}），含 ${supportCount} 个补给建议航点，可在 IGP 中导入。`;
  }

  async function shareGpx() {
    if (!currentRoute) return;
    const datum = refs.exportDatum.value === "gcj02" ? "gcj02" : "wgs84";
    const importedName = currentRoute.imported ? safeFileStem(String(currentRoute.sourceFileName || "").replace(/\.gpx$/i, ""), "route") : "";
    const safeStart = safeFileStem(currentRoute.start.label, "start");
    const safeEnd = safeFileStem(currentRoute.end.label, "end");
    const fileName = importedName ? `${importedName}.gpx` : `jingxian-${safeStart}-${safeEnd}.gpx`;
    const file = new File([buildGpx(currentRoute, datum)], fileName, { type: "application/gpx+xml" });
    if (typeof navigator.share === "function") {
      try {
        if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error("File sharing is unavailable");
        await navigator.share({ title: currentRoute.routeName, text: "景线骑行路线 GPX，可在 iGPSPORT 中导入", files: [file] });
        refs.exportStatus.textContent = "已打开系统分享面板，请选择 iGPSPORT 导入路线。";
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    exportGpx();
    refs.exportStatus.textContent = `浏览器不支持直接分享，GPX 已下载（含 ${getSupportStopCount(currentRoute)} 个补给建议航点）；在 iGPSPORT 中选择该文件导入。`;
  }

  function setImportStatus(message, isError = false) {
    refs.importStatus.className = isError ? "import-status error" : "import-status";
    refs.importStatus.textContent = message;
  }

  function renderWaypointEditor() {
    clear(refs.waypointsList);
    manualWaypoints.forEach((waypoint, index) => {
      const item = document.createElement("li");
      item.className = "waypoint-item";
      const number = document.createElement("span");
      number.className = "waypoint-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const copy = document.createElement("span");
      copy.className = "waypoint-copy";
      const name = document.createElement("strong");
      name.textContent = waypoint.name || `途经点 ${index + 1}`;
      const location = document.createElement("small");
      location.textContent = waypoint.location;
      copy.append(name, location);
      const actions = document.createElement("span");
      actions.className = "waypoint-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.title = "上移";
      up.setAttribute("aria-label", `上移${name.textContent}`);
      up.disabled = index === 0;
      up.addEventListener("click", () => moveWaypoint(index, -1));
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.title = "下移";
      down.setAttribute("aria-label", `下移${name.textContent}`);
      down.disabled = index === manualWaypoints.length - 1;
      down.addEventListener("click", () => moveWaypoint(index, 1));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "删除";
      remove.setAttribute("aria-label", `删除${name.textContent}`);
      remove.addEventListener("click", () => {
        manualWaypoints.splice(index, 1);
        persistSettings();
        renderWaypointEditor();
      });
      actions.append(up, down, remove);
      item.append(number, copy, actions);
      refs.waypointsList.appendChild(item);
    });
  }

  function moveWaypoint(index, delta) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= manualWaypoints.length) return;
    const [waypoint] = manualWaypoints.splice(index, 1);
    manualWaypoints.splice(targetIndex, 0, waypoint);
    persistSettings();
    renderWaypointEditor();
  }

  function addManualWaypoint(nameValue, locationValue, point = null) {
    const location = String(locationValue || "").trim();
    if (!location) return false;
    const name = String(nameValue || "").trim() || location;
    manualWaypoints.push({
      id: waypointId++,
      name: name.slice(0, 80),
      location: location.slice(0, 160),
      lat: point && Number.isFinite(point.lat) ? point.lat : undefined,
      lon: point && Number.isFinite(point.lon) ? point.lon : undefined,
      source: "用户添加",
    });
    persistSettings();
    renderWaypointEditor();
    return true;
  }

  async function resolveManualWaypoints(online) {
    const resolved = [];
    const warnings = [];
    for (const waypoint of manualWaypoints) {
      let location = Number.isFinite(waypoint.lat) && Number.isFinite(waypoint.lon)
        ? { label: waypoint.location, lat: waypoint.lat, lon: waypoint.lon, exact: true }
        : parseLocation(waypoint.location, waypoint.id);
      if (online && !location.exact) location = await geocodeLocation(waypoint.location, waypoint.id);
      if (location.exact && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
        resolved.push({
          ...waypoint,
          lat: location.lat,
          lon: location.lon,
          type: "用户途经点",
          note: "用户指定途经点，出发前请确认可达性",
          source: "用户添加",
          sourceUrl: "",
        });
      } else {
        warnings.push(`途经点“${waypoint.name}”无法定位，已暂时跳过。`);
      }
    }
    return { resolved, warnings };
  }

  function toggleMapAddMode() {
    mapAddMode = !mapAddMode;
    refs.mapAddToggle.textContent = mapAddMode ? "退出地图加点" : "地图加点";
    refs.mapAddToggle.classList.toggle("is-active", mapAddMode);
    refs.mapStage.classList.toggle("is-adding", mapAddMode);
    refs.status.textContent = mapAddMode ? "请点击路线地图上的位置加入途经点。" : "";
  }

  function addWaypointFromMap(event) {
    if (!mapAddMode || !currentRoute) return;
    if (event.target?.closest?.(".scenic-marker-group")) return;
    let point;
    if (Number.isFinite(event?.lat) && Number.isFinite(event?.lon)) {
      point = { lat: event.lat, lon: event.lon };
    } else if (event.latlng && Number.isFinite(event.latlng.lat) && Number.isFinite(event.latlng.lng)) {
      point = { lat: event.latlng.lat, lon: event.latlng.lng };
    } else {
      const rect = refs.routeMap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((event.clientX - rect.left) / rect.width) * 900;
      const y = ((event.clientY - rect.top) / rect.height) * 560;
      const project = projectFactory(currentRoute.points, 900, 560, 82);
      point = project.inverse(x, y);
    }
    addManualWaypoint(`地图点 ${manualWaypoints.length + 1}`, `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`, point);
    toggleMapAddMode();
    routeSeed += 1;
    setFormMessage("已加入地图途经点，正在重新规划…");
    void generateRoute();
  }

  async function importGpxFile(file) {
    if (!file) return;
    if (file.size > MAX_GPX_FILE_SIZE) {
      setImportStatus(`文件过大，请选择不超过 ${MAX_GPX_FILE_SIZE / (1024 * 1024)} MB 的 GPX。`, true);
      return;
    }
    refs.importButton.disabled = true;
    refs.importButtonLabel.textContent = "读取中…";
    setImportStatus("正在读取 GPX…");
    try {
      const source = await file.text();
      const route = parseGpxDocument(source, file.name);
      render(route, []);
      const waypointText = route.stops.length ? `，含 ${route.stops.length} 个航点` : "";
      setImportStatus(`已导入 ${route.sourceKind} ${route.points.length} 个点${waypointText}，可直接重新导出。`);
      refs.exportStatus.textContent = "导入路线已就绪，导出文件会保留轨迹和航点。";
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取这个 GPX 文件。";
      setImportStatus(message, true);
    } finally {
      refs.importButton.disabled = false;
      refs.importButtonLabel.textContent = "导入 GPX";
      refs.gpxFileInput.value = "";
    }
  }

  function scenicLabel(value) {
    if (value >= 78) return "风景优先";
    if (value >= 52) return "风景均衡";
    return "效率优先";
  }

  function formatLocationSource(location) {
    if (location?.source === "GPX 文件") return "GPX 文件";
    if (location?.geocoded) return "公开地图已定位";
    if (location?.source === "本地地点库") return "本地地点库";
    if (location?.exact) return "坐标输入";
    if (location?.geocodeError) return "定位失败 · 可改用坐标";
    return "等待定位";
  }

  function updateSlider() {
    const value = Number(refs.scenic.value);
    refs.scenicOutput.textContent = `${value} / 100`;
    const percent = `${value}%`;
    refs.scenic.style.background = `linear-gradient(90deg, var(--forest) 0%, var(--orange) ${percent}, #d9d4c9 ${percent})`;
    document.querySelectorAll(".quick-value").forEach((button) => {
      button.classList.toggle("is-active", Math.abs(Number(button.dataset.scenic) - value) <= 4);
    });
  }

  function render(route, warnings) {
    currentRoute = route;
    refs.routeTitle.textContent = `${route.start.label} → ${route.end.label}`;
    refs.routeKind.textContent = route.kind;
    refs.routePointCount.textContent = `${route.points.length} 个轨迹点`;
    const online = route.source === "osrm";
    const imported = route.source === "gpx";
    refs.routeSource.textContent = online ? "骑行道路轨迹" : imported ? "GPX 导入" : "离线示意";
    refs.routeSource.classList.toggle("online", online);
    refs.mapNoteText.textContent = online ? "OpenStreetMap 骑行道路 · 可导入 IGP" : imported ? "GPX 导入轨迹 · 可重新导出" : "离线示意路线 · 仅供预览";
    refs.routeScore.textContent = `${route.score}`;
    refs.distance.textContent = route.distanceKm < 10 ? route.distanceKm.toFixed(1) : route.distanceKm.toFixed(0);
    if (refs.directDistance) {
      const direct = Number.isFinite(Number(route.directDistanceKm)) ? Number(route.directDistanceKm) : haversineKm(route.start, route.end);
      refs.directDistance.textContent = direct < 10 ? direct.toFixed(1) : direct.toFixed(0);
    }
    if (refs.detourPercent) {
      const detourPercent = Number.isFinite(Number(route.detourPercent)) ? Number(route.detourPercent) : 0;
      refs.detourPercent.textContent = `${Math.max(0, detourPercent).toFixed(0)}%`;
    }
    if (refs.startSource) refs.startSource.textContent = formatLocationSource(route.start);
    if (refs.endSource) refs.endSource.textContent = formatLocationSource(route.end);
    refs.elevation.textContent = route.elevationGain.toLocaleString("zh-CN");
    refs.stops.textContent = String(route.stops.length);
    const ridePlan = buildRidePlan(route);
    if (refs.rideTime) refs.rideTime.textContent = formatDuration(ridePlan.totalMinutes);
    if (refs.fuelPlan) refs.fuelPlan.textContent = ridePlan.fuelCount
      ? `${ridePlan.fuelCount} 次 · 每 ${ridePlan.fuelIntervalKm} km`
      : "出发前补足水和能量";
    refs.stopsCaption.textContent = route.scenic >= 78 ? "风景偏好精选" : "自动挑选";
    const exportable = Boolean(route.imported || route.source === "osrm");
    refs.exportButton.disabled = !exportable;
    if (refs.shareButton) refs.shareButton.disabled = !exportable;
    if (refs.exportDatumNote) refs.exportDatumNote.textContent = refs.exportDatum.value === "gcj02"
      ? "标准 GPX 1.1 · UTF-8 · GCJ-02 坐标"
      : "标准 GPX 1.1 · UTF-8 · WGS84 坐标";
    refs.exportStatus.textContent = "";
    if (refs.exportNote) refs.exportNote.textContent = exportable
      ? "包含完整道路轨迹、景点和补给建议，可直接导入 IGP"
      : route.source === "offline"
        ? "当前是离线示意，仅供预览；开启在线道路校路后才能导出"
        : "当前路线不可导出，请先生成有效道路轨迹";
    renderMap(route);
    renderStops(route);
    renderProfile(route);
    renderScenicDetails(route);
    renderSupplies(route);
    if (route.elevationWarning) warnings.push(route.elevationWarning);
    if (route.source === "offline" && route.detourPercent > route.detour + 1) warnings.push(`离线示意绕行约 ${route.detourPercent.toFixed(0)}%，超过预算 ${route.detour}%；在线校路后会按预算调整。`);
    refs.status.className = warnings.length ? "form-status warning" : "form-status";
    const researchText = route.scenicSource === "OpenStreetMap 公共 POI"
      ? "沿线景点来自公开地图 POI，仍需出发前核对"
      : route.scenicSource === "用户添加途经点"
        ? "沿线途经点由你指定，仍需出发前核对可达性"
      : route.researched
        ? "沿线景点来自公开骑行内容线索，仍需出发前核对"
        : route.imported
          ? "航点来自导入的 GPX 文件"
          : "景点为离线演示占位";
    const routingText = route.routingWarning ? ` ${route.routingWarning}` : "";
    const summaryText = `${online ? "已按 OpenStreetMap 骑行道路校路" : "已生成离线示意路线"}：${route.points.length} 个轨迹点和 ${route.stops.length} 个风景航点。${researchText}。`;
    refs.status.textContent = `${warnings.join(" ")}${warnings.length ? " " : ""}${summaryText}${routingText}`.trim();
  }

  async function generateRoute() {
    activeController?.abort();
    const thisGeneration = ++generationId;
    const generationController = new AbortController();
    activeController = generationController;
    setPlanningState(true, "正在准备路线…");
    const startInput = String(refs.start.value || "").trim();
    const endInput = String(refs.end.value || "").trim();
    if (!startInput || !endInput) {
      generationController.abort();
      if (activeController === generationController) activeController = null;
      setPlanningState(false);
      setFormMessage("请先填写出发地和目的地。", true);
      return;
    }
    let start = parseLocation(startInput, 11);
    let end = parseLocation(endInput, 29);
    const scenic = clamp(Number(refs.scenic.value) || 0, 0, 100);
    const detour = clamp(Number(refs.detour.value) || 0, 0, 60);
    refs.detour.value = String(detour);
    persistSettings();

    if (refs.onlineRouting.checked && (!start.exact || !end.exact)) {
      setPlanningState(true, "正在定位地点…");
      setFormMessage("正在查找地点坐标…");
      const [resolvedStart, resolvedEnd] = await Promise.all([
        geocodeLocation(startInput, 11),
        geocodeLocation(endInput, 29),
      ]);
      if (thisGeneration !== generationId) return;
      start = resolvedStart;
      end = resolvedEnd;
    }
    if (!start.exact || !end.exact) {
      if (refs.startSource) refs.startSource.textContent = formatLocationSource(start);
      if (refs.endSource) refs.endSource.textContent = formatLocationSource(end);
      const failures = [start, end].filter((location) => !location.exact).map((location) => (
        `“${location.label}”${location.geocodeError ? `定位失败（${location.geocodeError}）` : "尚未定位"}`
      ));
      const suggestion = refs.onlineRouting.checked
        ? "请补充所在城市或县名，或输入纬度,经度后重试。"
        : "请开启在线校路以查找地点，或输入纬度,经度。";
      if (activeController === generationController) activeController = null;
      setPlanningState(false);
      setFormMessage(`${failures.join("；")}。${suggestion}`, true);
      return;
    }
    const manualResolution = await resolveManualWaypoints(refs.onlineRouting.checked);
    if (thisGeneration !== generationId) return;
    let discoveredStops = [];
    if (!manualResolution.resolved.length && refs.onlineRouting.checked && start.exact && end.exact && !(/杭州|西湖/.test(start.label) && /千岛湖/.test(end.label)) && !(/上海|上海站|上海火车站/.test(start.label) && /海盐/.test(end.label))) {
      setPlanningState(true, "正在寻找风景点…");
      refs.status.textContent = "正在查找沿线公开景点…";
      const discovery = await discoverScenicStopsApi(start, end, scenic, generationController.signal);
      if (thisGeneration !== generationId) return;
      discoveredStops = (discovery.stops || []).map((element) => {
        const tags = element.tags || {};
        const name = String(tags["name:zh"] || tags.name || "沿线景点").slice(0, 70);
        return { ...element, name, type: tags.tourism === "viewpoint" ? "观景台" : "沿线景点", note: "OpenStreetMap 景点，请确认开放与可达性", source: "OpenStreetMap 公共 POI", sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`, scenicValue: tags.tourism === "viewpoint" ? 30 : tags.natural === "water" ? 25 : tags.natural === "wood" ? 20 : 15 };
      });
    }
    const route = buildRoute(start, end, scenic, detour, refs.bikeFriendly.checked, manualResolution.resolved, discoveredStops);
    const warnings = manualResolution.warnings.slice();
    if (start.geocodeError) warnings.push(`出发地“${start.label}”定位失败（${start.geocodeError}）。`);
    if (end.geocodeError) warnings.push(`目的地“${end.label}”定位失败（${end.geocodeError}）。`);
    if (!start.exact && !start.geocodeError) warnings.push(`无法定位“${start.label}”，请换一个更具体的名称或输入纬度,经度。`);
    if (!end.exact && !end.geocodeError) warnings.push(`无法定位“${end.label}”，请换一个更具体的名称或输入纬度,经度。`);
    render(route, warnings);

    if (!refs.onlineRouting.checked) {
      if (activeController === generationController) activeController = null;
      setPlanningState(false);
      return;
    }
    if (!start.exact || !end.exact) {
      if (activeController === generationController) activeController = null;
      setPlanningState(false);
      setFormMessage(`${warnings.join(" ")} 无法在线校路，请输入更具体的地点或纬度,经度。`, true);
      return;
    }

    setPlanningState(true, "正在校路…");
    setFormMessage("正在请求骑行道路轨迹，完成后会替换示意路线…");
    try {
      let onlineRoute = await fetchOnlineRouteModule(route, generationController.signal);
      if (thisGeneration !== generationId) return;
      setPlanningState(true, "正在评估风景与补给…");
      const [elevationResult, environment] = await Promise.all([
        enrichRouteElevationsModule(onlineRoute, generationController.signal).catch(() => null),
        queryRouteAmenities(onlineRoute, generationController.signal),
      ]);
      if (thisGeneration !== generationId) return;
      if (elevationResult) onlineRoute = elevationResult;
      const scenicResult = calculateScenicScore(onlineRoute, environment);
      const details = Object.fromEntries(Object.entries(scenicResult.details || {}).map(([key, value]) => [key, typeof value === "object" ? value.contribution : value]));
      details.negative = Number(details.negative) || 0;
      onlineRoute.scenicScore = { ...scenicResult, details, features: [
        scenicResult.counts?.water ? "湖边骑行" : "",
        scenicResult.counts?.forest ? "林间道路" : "",
        scenicResult.counts?.park ? "公园绿地" : "",
        scenicResult.counts?.nature_reserve ? "自然保护区" : "",
        scenicResult.counts?.viewpoint ? `观景点 ${scenicResult.counts.viewpoint} 个` : "",
      ].filter(Boolean) };
      onlineRoute.score = scenicResult.score === null ? "未评估" : scenicResult.score;
      onlineRoute.scenicSource = environment.status === "ready" || environment.status === "partial"
        ? "OpenStreetMap 公共 POI"
        : "在线环境查询不可用";
      const supplyItems = (environment.features || []).filter((feature) => ["cafe", "restaurant", "fuel"].includes(feature.tags?.amenity) || ["convenience", "supermarket"].includes(feature.tags?.shop)).map((feature) => {
        const index = nearestPointIndex(onlineRoute.points, feature);
        return { id: `${feature.type}-${feature.id}`, type: feature.tags.amenity || feature.tags.shop, name: feature.tags["name:zh"] || feature.tags.name || "未命名补给点", lat: feature.lat, lon: feature.lon, distance: haversineKm(onlineRoute.points[index], feature) * 1000, km: routeDistance(onlineRoute.points, index), sourceUrl: `https://www.openstreetmap.org/${feature.type}/${feature.id}` };
      }).filter((supply) => Number.isFinite(supply.distance) && supply.distance <= 500);
      onlineRoute.supplies = { status: environment.status === "ok" ? "ready" : environment.status, items: supplyItems };
      render(onlineRoute, []);
    } catch (error) {
      if (thisGeneration !== generationId) return;
      const message = error?.name === "AbortError" ? "请求超时" : (error?.message || "网络不可用");
      render(route, [`在线道路校路失败（${message}），已保留离线示意路线。`]);
    } finally {
      if (activeController === generationController) activeController = null;
      if (thisGeneration === generationId) setPlanningState(false);
    }
  }

  refs.form.addEventListener("submit", (event) => {
    event.preventDefault();
    routeSeed += 1;
    void generateRoute();
  });
  refs.locateButton?.addEventListener("click", useCurrentLocation);
  refs.swapLocations?.addEventListener("click", swapLocations);
  refs.cancelRouteButton?.addEventListener("click", cancelRouteGeneration);
  refs.start.addEventListener("change", persistSettings);
  refs.end.addEventListener("change", persistSettings);
  refs.scenic.addEventListener("input", updateSlider);
  refs.detour.addEventListener("change", persistSettings);
  refs.bikeFriendly.addEventListener("change", persistSettings);
  refs.onlineRouting.addEventListener("change", () => { persistSettings(); void generateRoute(); });
  refs.exportDatum.addEventListener("change", () => {
    persistSettings();
    if (refs.exportDatumNote) refs.exportDatumNote.textContent = refs.exportDatum.value === "gcj02"
      ? "标准 GPX 1.1 · UTF-8 · GCJ-02 坐标"
      : "标准 GPX 1.1 · UTF-8 · WGS84 坐标";
  });
  refs.exportButton.addEventListener("click", exportGpx);
  refs.shareButton?.addEventListener("click", () => { void shareGpx(); });
  refs.addWaypoint.addEventListener("click", () => {
    if (addManualWaypoint(refs.waypointName.value, refs.waypointLocation.value)) {
      refs.waypointName.value = "";
      refs.waypointLocation.value = "";
      refs.waypointLocation.focus();
      refs.status.textContent = "途经点已加入，生成路线后会按列表顺序经过。";
    } else {
      refs.status.className = "form-status warning";
      refs.status.textContent = "请填写途经点的位置或坐标。";
    }
  });
  refs.waypointLocation.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      refs.addWaypoint.click();
    }
  });
  refs.mapAddToggle.addEventListener("click", toggleMapAddMode);
  refs.routeMap.addEventListener("click", addWaypointFromMap);
  refs.importButton.addEventListener("click", () => refs.gpxFileInput.click());
  refs.gpxFileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    importGpxFile(file);
  });
  refs.sampleButton.addEventListener("click", () => {
    refs.start.value = "杭州西湖";
    refs.end.value = "千岛湖";
    refs.scenic.value = "72";
    refs.detour.value = "30";
    refs.bikeFriendly.checked = true;
    refs.onlineRouting.checked = true;
    manualWaypoints = [];
    renderWaypointEditor();
    updateSlider();
    persistSettings();
    routeSeed += 1;
    void generateRoute();
    refs.start.focus();
  });
  document.querySelectorAll(".quick-value").forEach((button) => {
    button.addEventListener("click", () => {
      refs.scenic.value = button.dataset.scenic;
      updateSlider();
      persistSettings();
    });
  });

  restoreSettings();
  initStreetMap();
  renderWaypointEditor();
  updateSlider();
  void generateRoute();
})();
