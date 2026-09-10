import { fetchJson, getConfig } from "./http.js";

const CACHE_KEY = "jingxian:geocoder:wgs84:v1";
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 200;
const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/[\s,，·。()（）]/g, "");
const administrativeName = (value) => normalize(value).replace(/(特别行政区|自治区|自治州|省|市|区|县)$/u, "");
// Photon/OSM often indexes a POI by its local name and returns no result when
// every containing province/city/county is repeated in the query. Keep the
// original query available for address providers, but use this local-name
// variant for POI search (e.g. “浙江省嘉兴市海盐县澉浦镇” -> “澉浦镇 嘉兴市”).
function localPlaceName(value) {
  const original = String(value || "").trim();
  const stripped = original.replace(/^(?:中华人民共和国|中国)?(?:[\u4e00-\u9fa5]{1,12}(?:省|市|县|区|旗|州))+/, "").trim();
  return stripped && stripped !== original ? stripped : original;
}

function localPlaceQuery(value) {
  const original = String(value || "").trim();
  const stripped = localPlaceName(original);
  if (!stripped || stripped === original) return original;
  // Keep the nearest city as a disambiguation token. Photon ranks “人民公园”
  // in Guangzhou before Shanghai, while “人民公园 上海市” returns the exact
  // Shanghai park within the same request.
  const withoutProvince = original.replace(/^(?:中华人民共和国|中国)?[\u4e00-\u9fa5]{1,12}?省/u, "");
  const cityMatches = withoutProvince.match(/[\u4e00-\u9fa5]{1,12}?市/gu) || [];
  const city = cityMatches.at(-1) || "";
  return city && !stripped.includes(city) ? `${stripped} ${city}` : stripped;
}

function geocoderError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() {
  const error = new Error("定位已取消");
  error.name = "AbortError";
  return error;
}

function isCoordinate(lat, lon) {
  return lat !== null && lat !== "" && lon !== null && lon !== ""
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
    && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
}

function delay(ms, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function requestUrl(base, params) {
  const url = new URL(base, globalThis.location?.href || "https://localhost/");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function candidatesFromPhoton(payload) {
  return (Array.isArray(payload?.features) ? payload.features : []).map((feature) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    return {
      lat: coordinates[1], lon: coordinates[0],
      names: [properties.name],
      address: [properties.name, properties.street, properties.district, properties.city, properties.state, properties.country].filter(Boolean).join("，"),
      areas: [properties.city, properties.district, properties.state],
      country: properties.countrycode,
      kind: `${properties.osm_key || ""}:${properties.osm_value || ""}`,
    };
  });
}

function candidatesFromNominatim(payload) {
  return (Array.isArray(payload) ? payload : []).map((item) => ({
    lat: item.lat, lon: item.lon,
    names: [item.name, item.namedetails?.["name:zh"], item.namedetails?.name, String(item.display_name || "").split(",")[0]],
    address: item.display_name,
    areas: [item.address?.city, item.address?.town, item.address?.county, item.address?.state],
    country: item.address?.country_code,
    kind: `${item.category || item.class || ""}:${item.type || ""}`,
  }));
}

function candidatesFromArcgis(payload) {
  return (Array.isArray(payload?.candidates) ? payload.candidates : []).map((item) => ({
    lat: item.location?.y, lon: item.location?.x,
    names: [item.attributes?.PlaceName, item.address],
    address: item.attributes?.LongLabel || item.attributes?.Match_addr || item.address,
    areas: [item.attributes?.City, item.attributes?.Region],
    country: item.attributes?.Country,
    kind: item.attributes?.Addr_type || "",
    providerScore: Number(item.score),
  }));
}

function scoreCandidate(candidate, query, contextQuery = query) {
  if (!isCoordinate(candidate.lat, candidate.lon)) return -1;
  const country = String(candidate.country || "").toLowerCase();
  // All route input searches currently target China. Never accept an unrelated
  // overseas namesake when an upstream provider ignores the country filter.
  if (country && country !== "cn" && country !== "chn" && country !== "china") return -1;
  if (!country && (Number(candidate.lat) < 18 || Number(candidate.lat) > 54
    || Number(candidate.lon) < 73 || Number(candidate.lon) > 136)) return -1;
  if (Number.isFinite(candidate.providerScore) && candidate.providerScore < 85) return -1;

  // If administrative prefixes were present in the user's input, retain them
  // as a hard geographic constraint after the local POI query was shortened.
  // This prevents “上海市人民公园” from selecting the same-named Guangzhou
  // park merely because Photon returned it first.
  const contextAreas = String(contextQuery || "").match(/(?:[\u4e00-\u9fa5]{1,12}?(?:省|市|县|区|旗|州))/g) || [];
  const constrainedAreas = contextAreas.filter((area) => /(?:省|市)$/u.test(area));
  if (constrainedAreas.length && query !== contextQuery) {
    const matchingArea = constrainedAreas.some((area) => {
      const wantedArea = administrativeName(area);
      return candidate.areas.some((resultArea) => administrativeName(resultArea) === wantedArea);
    });
    if (!matchingArea) return -1;
  }

  const wanted = normalize(query).replace(/^(中华人民共和国|中国)/u, "");
  const address = normalize(candidate.address);
  let score = -1;
  for (const rawName of candidate.names) {
    const name = normalize(rawName);
    if (!name) continue;
    if (name === wanted) score = Math.max(score, 110);
    // A city prefix is accepted only when it agrees with the result's area:
    // "北京市北京南站" may match "北京南站"; a Beijing city centre may not.
    else if (name.length >= 2 && wanted.endsWith(name)) {
      const prefix = administrativeName(wanted.slice(0, -name.length));
      if (prefix && candidate.areas.some((area) => administrativeName(area) === prefix)) score = Math.max(score, 100);
    }
  }
  if (score < 0 && address.includes(wanted) && wanted.length >= 3) {
    // ArcGIS often returns an entire formatted address instead of a POI name.
    // Avoid accepting a town/city fallback as a specific station or landmark.
    const broadMatch = /^(locality|postal|region|subregion|country)$/i.test(candidate.kind);
    const accurateAddress = Number.isFinite(candidate.providerScore) && candidate.providerScore >= 90 && !broadMatch;
    if (accurateAddress) score = 95;
  }
  if (score < 0) return -1;
  if (/站$/u.test(wanted)) {
    if (candidate.kind === "railway:station") score += 12;
    else if (candidate.kind === "railway:halt") score += 10;
    else if (candidate.kind === "railway:stop") score += 5;
    else if (/bus_stop|bus_station/.test(candidate.kind)) score -= 6;
  }
  if (candidate.kind === "tourism:attraction") score += 3;
  return score;
}

function bestCandidate(candidates, query, contextQuery = query) {
  return candidates.map((candidate) => ({ candidate, score: scoreCandidate(candidate, query, contextQuery) }))
    .filter((item) => item.score >= 85).sort((a, b) => b.score - a.score)[0]?.candidate;
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch (_error) { return undefined; }
}

/**
 * Dedicated WGS84 address/POI lookup. Providers start independently so one
 * stalled connection cannot consume every other provider's time budget.
 */
export function createGeocoder(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now || Date.now;
  const runtimeConfig = getConfig(options.config);
  const configuredCacheTtlMs = Number(runtimeConfig.geocoderCacheTtlMs);
  const cacheTtlMs = Number.isFinite(configuredCacheTtlMs) && configuredCacheTtlMs >= 0
    ? configuredCacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const cache = new Map();
  let nextNominatimStart = 0;

  try {
    const saved = JSON.parse(storage?.getItem(CACHE_KEY) || "[]");
    if (Array.isArray(saved)) saved.slice(-CACHE_LIMIT).forEach(([key, record]) => {
      if (typeof key === "string" && isCoordinate(record?.value?.lat, record?.value?.lon)
        && record.value.exact === true && record.expires > now()) cache.set(key, record);
    });
  } catch (_error) { /* Broken/disabled browser storage must not block lookup. */ }

  function save(key, value) {
    cache.delete(key);
    cache.set(key, { value, expires: now() + cacheTtlMs });
    for (const [cachedKey, record] of cache) if (record.expires <= now()) cache.delete(cachedKey);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    try { storage?.setItem(CACHE_KEY, JSON.stringify([...cache])); } catch (_error) { /* Keep the in-memory cache. */ }
  }

  return async function geocode(query, { signal } = {}) {
    if (signal?.aborted) throw abortError();
    const label = String(query || "").trim();
    if (!label) throw geocoderError("请输入地点名称", "EmptyQuery");
    const key = normalize(label);
    const cached = cache.get(key);
    if (cached?.expires > now()) return { ...cached.value, label, cached: true };

    const config = runtimeConfig;
    const timeoutMs = Math.max(1, Number(config.geocoderTimeoutMs) || 10000);
    const totalTimeoutMs = Math.max(1, Number(config.geocoderTotalTimeoutMs) || 15000);
    const fallbackDelayMs = Math.max(0, Number(config.geocoderFallbackDelayMs ?? 400));
    const placeQuery = localPlaceQuery(label);
    const placeName = localPlaceName(label);
    const providers = [
      {
        name: "Photon 地点搜索", delay: 0,
        url: config.geocoderPhotonBaseUrl || "https://photon.komoot.io/api/",
        // The public Photon instance does NOT support lang=zh (HTTP 400).
        // With no lang parameter it returns the place's original Chinese name.
        params: { q: placeQuery, limit: "8" }, parse: candidatesFromPhoton,
        matchQuery: placeName,
      },
      {
        name: "ArcGIS 地址与地点搜索", delay: fallbackDelayMs,
        url: config.geocoderFallbackBaseUrl || "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates",
        params: { SingleLine: placeQuery, f: "json", maxLocations: "5", langCode: "CHS", sourceCountry: "CHN", outSR: "4326", outFields: "PlaceName,Match_addr,Addr_type,City,Region,Country" },
        parse: candidatesFromArcgis, matchQuery: placeName,
      },
      {
        name: "OpenStreetMap 地理编码", delay: fallbackDelayMs * 2,
        url: config.geocoderBaseUrl || "https://nominatim.openstreetmap.org/search",
        params: { q: placeQuery, format: "jsonv2", limit: "5", countrycodes: "cn", "accept-language": "zh-CN", addressdetails: "1", namedetails: "1" },
        parse: candidatesFromNominatim, matchQuery: placeName, nominatim: true,
      },
    ];

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const failures = [];
      let completed = 0;
      let settled = false;
      let totalTimer;
      const onAbort = () => finish(null, abortError());
      function finish(result, error) {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        signal?.removeEventListener("abort", onAbort);
        controller.abort();
        if (result) {
          save(key, result);
          resolve(result);
        } else reject(error);
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      totalTimer = setTimeout(() => finish(null, geocoderError("地点查询超时，请检查网络后重试", "GeocoderTimeout")), totalTimeoutMs);

      providers.forEach(async (provider) => {
        try {
          await delay(provider.delay, controller.signal);
          if (provider.nominatim) {
            // Respect the public Nominatim limit even when start and end are
            // resolved together. A cancelled queued call never reaches fetch.
            const startAt = Math.max(now(), nextNominatimStart);
            nextNominatimStart = startAt + 1000;
            await delay(Math.max(0, startAt - now()), controller.signal);
          }
          if (controller.signal.aborted) return;
          const payload = await fetchJson(requestUrl(provider.url, provider.params), {
            fetchImpl, signal: controller.signal, timeoutMs,
          });
          const candidate = bestCandidate(provider.parse(payload), provider.matchQuery || label, label);
          if (!candidate) throw geocoderError("没有匹配的地点", "NoMatch");
          finish({
            label, lat: Number(candidate.lat), lon: Number(candidate.lon),
            exact: true, geocoded: true, source: provider.name,
            displayName: String(candidate.address || label).slice(0, 180),
          });
        } catch (error) {
          if (!settled) failures.push(error);
        } finally {
          completed += 1;
          if (!settled && completed === providers.length) {
            const allNoMatch = failures.length > 0 && failures.every((error) => error.code === "NoMatch");
            const timedOut = failures.some((error) => error.name === "AbortError" || error.name === "TimeoutError");
            finish(null, geocoderError(
              allNoMatch ? "未找到匹配地点，请补充城市或详细名称" : timedOut ? "地点查询超时，请检查网络后重试" : "地点查询服务暂不可用，请稍后重试",
              allNoMatch ? "NoMatch" : timedOut ? "GeocoderTimeout" : "GeocoderUnavailable",
            ));
          }
        }
      });
    });
  };
}

let defaultGeocoder;
export function geocodeAddress(query, options) {
  defaultGeocoder ||= createGeocoder();
  return defaultGeocoder(query, options);
}
