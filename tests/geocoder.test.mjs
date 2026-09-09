import assert from "node:assert/strict";
import test from "node:test";
import { createGeocoder } from "../src/api/geocoder.js";

const config = { geocoderTimeoutMs: 250, geocoderTotalTimeoutMs: 500, geocoderFallbackDelayMs: 5 };
const json = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const photon = (name, lon = 116.3727527, lat = 39.8635548, properties = {}) => ({
  type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { name, countrycode: "CN", city: "北京市", osm_key: "railway", osm_value: "station", ...properties },
});
const waitForAbort = (_url, { signal }) => new Promise((_resolve, reject) => {
  const cancel = () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
});
const emptyProvider = (url) => new URL(url).hostname.includes("photon") ? { features: [] }
  : new URL(url).hostname.includes("arcgis") ? { candidates: [] } : [];
const mockStorage = () => {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) };
};

test("Chinese Photon requests omit unsupported lang and prefer the train station over a same-name bus stop", async () => {
  const requested = [];
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url) => {
    requested.push(new URL(url));
    return json({ features: [
      photon("北京南站", 116.3709305, 39.8645541, { osm_key: "highway", osm_value: "bus_stop" }),
      photon("北京南站路", 116.3666418, 39.8566965, { osm_key: "highway", osm_value: "tertiary" }),
      photon("北京南站"),
    ] });
  } });
  const point = await geocode("北京南站");
  assert.equal(requested.length, 1);
  assert.equal(requested[0].searchParams.get("q"), "北京南站");
  assert.equal(requested[0].searchParams.has("lang"), false);
  assert.equal(requested[0].searchParams.get("limit"), "8");
  assert.equal(point.lon, 116.3727527);
  assert.equal(point.lat, 39.8635548);
  assert.equal(point.source, "Photon 地点搜索");
});

test("landmark search prefers the exact attraction over a shop sharing its prefix", async () => {
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async () => json({ features: [
    photon("天津之眼夜市", 117.1809842, 39.1517509, { city: "红桥区", state: "天津", osm_key: "amenity", osm_value: "marketplace" }),
    photon("天津之眼", 117.1804081, 39.1533766, { city: "红桥区", state: "天津", osm_key: "tourism", osm_value: "attraction" }),
  ] }) });
  const point = await geocode("天津之眼");
  assert.equal(point.lon, 117.1804081);
  assert.equal(point.lat, 39.1533766);
});

test("a fast fallback resolves without waiting for a stalled primary and cancels that request", async () => {
  let primarySignal;
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url, options) => {
    if (new URL(url).hostname.includes("photon")) { primarySignal = options.signal; return waitForAbort(url, options); }
    return json({ candidates: [{ address: "天津之眼", location: { x: 117.1804081, y: 39.1533766 }, score: 100, attributes: { PlaceName: "天津之眼", Addr_type: "POI", Country: "CHN" } }] });
  } });
  const point = await geocode("天津之眼");
  assert.equal(point.source, "ArcGIS 地址与地点搜索");
  assert.equal(primarySignal.aborted, true);
});

test("Nominatim remains available when both dedicated search services fail", async () => {
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url) => {
    if (!new URL(url).hostname.includes("nominatim")) return json({}, 503);
    return json([{ lat: "30.3935", lon: "120.889725", name: "澉浦镇", display_name: "澉浦镇, 海盐县, 嘉兴市, 中国", address: { country_code: "cn" } }]);
  } });
  assert.equal((await geocode("澉浦镇")).source, "OpenStreetMap 地理编码");
});

test("a specific station query cannot silently become the city centre", async () => {
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url) => {
    if (new URL(url).hostname.includes("photon")) return json({ features: [photon("北京", 116.4, 39.9)] });
    if (new URL(url).hostname.includes("arcgis")) return json({ candidates: [{ address: "北京市", location: { x: 116.4, y: 39.9 }, score: 100, attributes: { Addr_type: "Locality", Country: "CHN" } }] });
    return json([{ lat: "39.9", lon: "116.4", name: "北京市", display_name: "北京市, 中国", address: { country_code: "cn" } }]);
  } });
  await assert.rejects(geocode("北京南站"), { code: "NoMatch" });
});

test("city-qualified POI input requires the returned city to match", async () => {
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async () => json({ features: [
    photon("人民公园", 113.264, 23.13, { city: "广州市" }),
    photon("人民公园", 121.472, 31.233, { city: "上海市" }),
  ] }) });
  const point = await geocode("上海市人民公园");
  assert.equal(point.lon, 121.472);
});

test("province/city/county prefixes are stripped for local town searches", async () => {
  const requests = [];
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url) => {
    requests.push(new URL(url));
    return json({ features: [photon("澉浦镇", 120.889725, 30.3935, { city: "嘉兴市", state: "浙江省", osm_key: "place", osm_value: "town" })] });
  } });
  const point = await geocode("浙江省嘉兴市海盐县澉浦镇");
  assert.equal(point.lat, 30.3935);
  assert.equal(requests[0].searchParams.get("q"), "澉浦镇");
});

test("foreign namesakes and invalid coordinates are rejected", async () => {
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url) => {
    if (!new URL(url).hostname.includes("photon")) return json(emptyProvider(url));
    return json({ features: [
      photon("北京南站", -73, 40, { countrycode: "US" }),
      photon("北京南站", 181, 39), photon("北京南站", 116, null),
    ] });
  } });
  await assert.rejects(geocode("北京南站"), { code: "NoMatch" });
});

test("low-confidence ArcGIS candidates do not create routes", async () => {
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url) => {
    if (!new URL(url).hostname.includes("arcgis")) return json(emptyProvider(url));
    return json({ candidates: [{ address: "天津之眼", location: { x: 117.18, y: 39.15 }, score: 70 }] });
  } });
  await assert.rejects(geocode("天津之眼"), { code: "NoMatch" });
});

test("successful WGS84 results persist across page reloads without more requests", async () => {
  const storage = mockStorage();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return json({ features: [photon("北京南站")] }); };
  const first = createGeocoder({ config, storage, fetchImpl });
  await first("北京南站");
  const second = createGeocoder({ config, storage, fetchImpl });
  const cached = await second("  北京南站  ");
  assert.equal(calls, 1);
  assert.equal(cached.cached, true);
  assert.equal(cached.label, "北京南站");
  assert.equal(cached.lon, 116.3727527);
});

test("expired cached coordinates are refreshed", async () => {
  const storage = mockStorage();
  let clock = 1000;
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return json({ features: [photon("北京南站")] }); };
  await createGeocoder({ config, storage, fetchImpl, now: () => clock })("北京南站");
  clock += 31 * 24 * 60 * 60 * 1000;
  await createGeocoder({ config, storage, fetchImpl, now: () => clock })("北京南站");
  assert.equal(calls, 2);
});

test("unavailable browser storage never blocks lookup", async () => {
  const storage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  const geocode = createGeocoder({ config, storage, fetchImpl: async () => json({ features: [photon("北京南站")] }) });
  assert.equal((await geocode("北京南站")).exact, true);
});

test("cancelling lookup aborts active providers and does not cache their late responses", async () => {
  const signals = [];
  const controller = new AbortController();
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async (url, options) => {
    signals.push(options.signal);
    return waitForAbort(url, options);
  } });
  const result = geocode("北京南站", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.ok(signals.length >= 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("an already cancelled lookup never accesses the network", async () => {
  const controller = new AbortController();
  controller.abort();
  const geocode = createGeocoder({ config, storage: null, fetchImpl: async () => assert.fail("network request") });
  await assert.rejects(geocode("北京南站", { signal: controller.signal }), { name: "AbortError" });
});

test("a total lookup deadline aborts every stalled request", async () => {
  const signals = [];
  const geocode = createGeocoder({ config: { ...config, geocoderTimeoutMs: 500, geocoderTotalTimeoutMs: 40 }, storage: null, fetchImpl: (url, options) => {
    signals.push(options.signal);
    return waitForAbort(url, options);
  } });
  await assert.rejects(geocode("北京南站"), { code: "GeocoderTimeout" });
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("provider deadlines are distinguished from no matching place", async () => {
  const geocode = createGeocoder({ config: { ...config, geocoderTimeoutMs: 20 }, storage: null, fetchImpl: waitForAbort });
  await assert.rejects(geocode("北京南站"), { code: "GeocoderTimeout" });
});

test("public Nominatim requests for start and end are spaced at least one second apart", async () => {
  const requests = [];
  const geocode = createGeocoder({ config: { ...config, geocoderTotalTimeoutMs: 1500 }, storage: null, fetchImpl: async (url) => {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("nominatim")) return json(emptyProvider(url));
    requests.push(Date.now());
    return json([{ lat: "39.8635548", lon: "116.3727527", name: parsed.searchParams.get("q"), address: { country_code: "cn" } }]);
  } });
  await Promise.all([geocode("北京南站"), geocode("天津之眼")]);
  assert.equal(requests.length, 2);
  assert.ok(requests[1] - requests[0] >= 990);
});
