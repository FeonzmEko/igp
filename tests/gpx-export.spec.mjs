import { test, expect } from "@playwright/test";
import { buildGpxDocument } from "../src/gpx/exporter.js";

function routeFixture() {
  const points = [
    { lat: 30, lon: 120, ele: 8, hasElevation: true },
    { lat: 30.001, lon: 120.001, ele: null, hasElevation: false },
    { lat: 30.001, lon: 120.002, ele: 12, hasElevation: true },
    { lat: 30.002, lon: 120.002, ele: 15, hasElevation: true },
    { lat: 30.002, lon: 120.003, ele: null, hasElevation: false },
    { lat: 30.003, lon: 120.003, ele: 18, hasElevation: true },
  ];
  return {
    routeName: "弯道路段",
    start: { ...points[0], label: "出发地" },
    end: { ...points.at(-1), label: "目的地" },
    points,
    stops: [{ ...points[1], index: 1, name: "沿湖停靠", type: "观景点", note: "湖边" }, { ...points[3], index: 3, name: "林间平台", type: "森林", note: "林荫" }],
    scenic: 80,
    detour: 30,
    bikeFriendly: true,
    source: "osrm",
  };
}

async function parseXml(page, xml) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    const points = (kind) => [...doc.getElementsByTagNameNS("http://www.topografix.com/GPX/1/1", kind)].map((node) => {
      const child = (tag) => [...node.children].find((element) => element.localName === tag)?.textContent || "";
      return {
        lat: Number(node.getAttribute("lat")), lon: Number(node.getAttribute("lon")),
        name: child("name"), description: child("desc"), elevation: child("ele"),
        childTags: [...node.children].map((element) => element.localName),
      };
    });
    return {
      parseErrors: doc.getElementsByTagName("parsererror").length,
      namespace: doc.documentElement.namespaceURI,
      version: doc.documentElement.getAttribute("version"),
      rte: points("rtept"), trk: points("trkpt"), wpt: points("wpt"),
      metadata: doc.getElementsByTagName("metadata")[0]?.textContent,
      extensionCount: doc.getElementsByTagName("extensions").length,
    };
  }, xml);
}

test("keeps every bend and writes stop names in both standard route and track points", async ({ page }) => {
  const route = routeFixture();
  const snapshot = structuredClone(route);
  const xml = buildGpxDocument(route);
  const parsed = await parseXml(page, xml);
  expect(parsed.parseErrors).toBe(0);
  expect(parsed.namespace).toBe("http://www.topografix.com/GPX/1/1");
  expect(parsed.version).toBe("1.1");
  const coordinates = route.points.map(({ lat, lon }) => ({ lat, lon }));
  for (const list of [parsed.rte, parsed.trk]) {
    expect(list.map(({ lat, lon }) => ({ lat, lon }))).toEqual(coordinates);
    expect(list.filter((point) => point.name).map((point) => point.name)).toEqual(["出发地", "沿湖停靠", "林间平台", "目的地"]);
    expect(list[1].elevation).toBe("");
    expect(list[3].childTags).toEqual(["ele", "name", "desc"]);
  }
  expect(parsed.wpt.map((point) => point.name)).toEqual(["沿湖停靠", "林间平台"]);
  expect(parsed.metadata).toContain("WGS84");
  expect(parsed.extensionCount).toBe(0);
  expect(route).toEqual(snapshot);
});

test("keeps an on-road stop name on a sparse straight segment without adding coordinates", async ({ page }) => {
  const route = {
    points: [{ lat: 30, lon: 120 }, { lat: 30, lon: 120.04 }, { lat: 30.01, lon: 120.04 }],
    stops: [{ lat: 30, lon: 120.025, name: "长直路途经点" }],
    source: "osrm",
  };
  const parsed = await parseXml(page, buildGpxDocument(route));
  expect(parsed.rte).toHaveLength(3);
  expect(parsed.trk).toHaveLength(3);
  expect(parsed.rte[1].name).toBe("长直路途经点");
  expect(parsed.wpt[0].lon).toBe(120.025);
  expect(parsed.rte[1].lon).toBe(120.04);
});

test("keeps off-route POIs independent and never inserts their coordinates into the route", async ({ page }) => {
  const route = routeFixture();
  const distant = { lat: 31, lon: 121, name: "河对岸景点", type: "观景点" };
  route.stops = [distant];
  const supportStops = [{ lat: 30.005, lon: 120.002, name: "附近便利店", type: "便利店" }];
  const snapshot = structuredClone({ route, supportStops });
  const parsed = await parseXml(page, buildGpxDocument(route, { supportStops }));
  expect(parsed.parseErrors).toBe(0);
  expect(parsed.wpt[0].lat).toBe(distant.lat);
  expect(parsed.wpt[0].lon).toBe(distant.lon);
  expect(parsed.rte).toHaveLength(route.points.length);
  expect(parsed.trk).toHaveLength(route.points.length);
  expect(parsed.rte.some((point) => point.lat === distant.lat && point.lon === distant.lon)).toBe(false);
  expect(parsed.rte.some((point) => point.name.includes(distant.name))).toBe(false);
  expect({ route, supportStops }).toEqual(snapshot);
});

test("matches a repeated location after the previous stop on a loop despite stale progress hints", async ({ page }) => {
  const a = { lat: 30, lon: 120 };
  const b = { lat: 30.001, lon: 120.001 };
  const route = {
    points: [{ lat: 29.999, lon: 120 }, a, { lat: 30.001, lon: 120 }, b, { lat: 30, lon: 120.001 }, a, { lat: 29.999, lon: 120 }],
    stops: [{ ...a, name: "第一次经过", index: 1 }, { ...b, name: "中途平台", index: 3 }, { ...a, name: "返程经过", index: 1, km: 0.111 }],
    source: "osrm",
  };
  const parsed = await parseXml(page, buildGpxDocument(route));
  for (const list of [parsed.rte, parsed.trk]) {
    expect(list[1].name).toBe("第一次经过");
    expect(list[3].name).toBe("中途平台");
    expect(list[5].name).toBe("返程经过");
  }
});

test("uses loop progress hints and preserves existing track names alongside co-located POIs", async ({ page }) => {
  const a = { lat: 30, lon: 120 };
  const b = { lat: 30, lon: 120.001 };
  const route = {
    points: [a, b, { ...a, name: "原有轨迹名" }],
    stops: [{ ...a, name: "后半程停靠", index: 2 }, { ...a, name: "同点补水", index: 2 }],
    source: "osrm",
  };
  const parsed = await parseXml(page, buildGpxDocument(route));
  expect(parsed.rte[0].name).toBe("");
  expect(parsed.rte[2].name).toBe("原有轨迹名 / 后半程停靠 / 同点补水");
  expect(parsed.trk[2].name).toBe(parsed.rte[2].name);
});

test("escapes all point names as valid XML and leaves explicit datum conversion opt-in", async ({ page }) => {
  const route = routeFixture();
  const trickyName = "湖边 <观景> & \"咖啡\" '店' 🚴";
  route.stops[0].name = trickyName + "\u0000\u0008";
  route.stops[0].sourceUrl = "https://example.com/?a=1&b=2";
  const seenDatums = [];
  const serializeCoordinate = (point, datum) => {
    seenDatums.push(datum);
    return { lat: point.lat.toFixed(6), lon: point.lon.toFixed(6) };
  };
  const parsed = await parseXml(page, buildGpxDocument(route, { serializeCoordinate }));
  expect(parsed.parseErrors).toBe(0);
  expect(parsed.rte[1].name).toBe(trickyName);
  expect(parsed.wpt[0].name).toBe(trickyName);
  expect(new Set(seenDatums)).toEqual(new Set(["wgs84"]));
  seenDatums.length = 0;
  buildGpxDocument(route, { datum: "gcj02", serializeCoordinate });
  expect(new Set(seenDatums)).toEqual(new Set(["gcj02"]));
});
