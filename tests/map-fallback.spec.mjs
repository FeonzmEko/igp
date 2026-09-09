import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_URL || "http://localhost:4173";
const TILE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b0mUAAAAASUVORK5CYII=", "base64");

async function openMap(page, { available = "amap" } = {}) {
  const calls = { amap: 0, carto: 0, osm: 0 };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const provider = url.hostname.includes("autonavi.com") ? "amap" : url.hostname.includes("cartocdn") ? "carto" : url.hostname.includes("tile.openstreetmap.org") ? "osm" : null;
    if (provider) {
      calls[provider] += 1;
      if (provider === available) await route.fulfill({ contentType: "image/png", body: TILE_PNG });
      else await route.abort();
      return;
    }
    if (url.pathname.includes("/route/v1/")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: "Ok", routes: [{ distance: 28600, duration: 4200, geometry: { coordinates: [[120.16, 30.25], [120.22, 30.27], [120.30, 30.29], [120.40, 30.30]] } }] }) });
      return;
    }
    if (url.hostname.includes("overpass")) { await route.fulfill({ contentType: "application/json", body: '{"elements":[]}' }); return; }
    if (url.hostname.includes("open-elevation")) { await route.fulfill({ contentType: "application/json", body: '{"results":[]}' }); return; }
    await route.continue();
  });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  return calls;
}

for (const [provider, attribution] of [["amap", "高德地图"], ["carto", "CARTO"], ["osm", "OpenStreetMap contributors"]]) {
  test(`loads ${provider} with matching attribution and automatic provider fallback`, async ({ page }) => {
    const calls = await openMap(page, { available: provider });
    await expect.poll(() => calls[provider]).toBeGreaterThan(0);
    await expect.poll(() => page.locator(".leaflet-tile-loaded").count()).toBeGreaterThan(0);
    await expect(page.locator("#map-stage")).not.toHaveClass(/tile-fallback/);
    await expect(page.locator("#street-map")).toBeVisible();
    await expect(page.locator(".leaflet-control-attribution")).toContainText(attribution);
    if (provider === "amap") {
      expect(calls.carto).toBe(0);
      expect(calls.osm).toBe(0);
      await expect(page.locator(".leaflet-tile-loaded").first()).toHaveAttribute("src", /autonavi\.com\/appmaptile\?lang=zh_cn.+style=7/);
    }
    if (provider === "osm") await expect(page.locator(".leaflet-control-attribution")).not.toContainText("CARTO");
  });
}

test("keeps the route visible on phone and desktop when every tile provider fails", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls = await openMap(page, { available: null });
    await expect(page.locator("#map-stage")).toHaveClass(/tile-fallback/);
    await expect(page.locator("#route-map")).toBeVisible();
    await expect(page.locator("#map-route .route-line")).toHaveAttribute("d", /M.+L/);
    await expect.poll(() => page.locator("#map-stage").evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(150);
    expect(errors).toEqual([]);
    expect(calls.amap).toBeGreaterThan(0);
    expect(calls.carto).toBeGreaterThan(0);
    expect(calls.osm).toBeGreaterThan(0);
    await context.close();
  }
});

test("keeps Shanghai overlays and clicks aligned across GCJ-02 and WGS-84 providers", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openMap(page);
  const wgs = [[31.24981, 121.45522], [31.23, 121.473], [31.24, 121.46], [31.235, 121.47]];
  // Fixed Shanghai GCJ-02 reference values, independent of the functions under
  // test. Verify the actual Leaflet overlays, not just a conversion roundtrip.
  const gcj = [[31.2479225, 121.4597997], [31.2280595, 121.4775253], [31.2380972, 121.4645658], [31.2330698, 121.4745353]];
  await page.evaluate(async (coordinates) => {
    const { createStreetMap } = await import("/src/map/map.js");
    const stage = document.createElement("div");
    stage.id = "datum-fixture";
    stage.style.cssText = "position:fixed;inset:10px;z-index:9999;background:white";
    const element = document.createElement("div");
    element.style.cssText = "width:100%;height:100%";
    stage.append(element);
    document.body.append(stage);
    const [start, end, stop, supply] = coordinates.map(([lat, lon]) => ({ lat, lon }));
    const route = {
      source: "osrm", points: [start, stop, end], start, end,
      stops: [{ ...stop, name: "观景点" }],
      supplies: { status: "ready", items: [{ ...supply, type: "cafe", name: "咖啡店", distance: 100 }] },
    };
    const before = JSON.stringify(route);
    function deepFreeze(value) {
      Object.values(value).forEach((child) => { if (child && typeof child === "object") deepFreeze(child); });
      return Object.freeze(value);
    }
    deepFreeze(route);
    const clicks = [];
    const adapter = createStreetMap({ element, mapStage: stage, onMapClick: ({ lat, lon }) => clicks.push([lat, lon]) });
    adapter.render(route);
    window.__datumFixture = { adapter, route, before, clicks };
  }, wgs);
  const readOverlays = () => page.evaluate(() => {
    const { adapter, route, before, clicks } = window.__datumFixture;
    const polylines = [], markers = [];
    adapter.map.eachLayer((layer) => {
      if (layer instanceof L.Polyline) polylines.push(layer.getLatLngs().map(({ lat, lng }) => [lat, lng]));
      if (layer instanceof L.CircleMarker) markers.push([layer.getLatLng().lat, layer.getLatLng().lng]);
    });
    return { polylines, markers, clicks, unchanged: JSON.stringify(route) === before };
  });
  function expectCoordinates(actual, expected) {
    expect(actual).toHaveLength(expected.length);
    actual.forEach(([lat, lon], index) => {
      expect(lat).toBeCloseTo(expected[index][0], 6);
      expect(lon).toBeCloseTo(expected[index][1], 6);
    });
  }
  await expect(page.locator("#datum-fixture .leaflet-tile-loaded").first()).toBeVisible();
  await expect(page.locator("#datum-fixture .leaflet-control-attribution")).toContainText("高德地图");
  const primary = await readOverlays();
  expect(primary.polylines).toHaveLength(1);
  expectCoordinates(primary.polylines[0], [gcj[0], gcj[2], gcj[1]]);
  expectCoordinates(primary.markers, gcj);
  await page.evaluate(([lat, lon]) => window.__datumFixture.adapter.map.fire("click", { latlng: L.latLng(lat, lon) }), gcj[0]);
  expectCoordinates((await readOverlays()).clicks, [wgs[0]]);

  // Make the mounted AMap layer fail through real image requests. The adapter
  // must switch providers, reproject every overlay, and update the click datum.
  await page.route("**/*.is.autonavi.com/**", (route) => route.abort());
  await page.route("**/*.basemaps.cartocdn.com/**", (route) => route.fulfill({ contentType: "image/png", body: TILE_PNG }));
  await page.evaluate(() => window.__datumFixture.adapter.map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) layer.redraw();
  }));
  await expect(page.locator("#datum-fixture .leaflet-control-attribution")).toContainText("CARTO");
  await expect(page.locator("#datum-fixture .leaflet-tile-loaded").first()).toBeVisible();
  const fallback = await readOverlays();
  expect(fallback.polylines).toHaveLength(1);
  expectCoordinates(fallback.polylines[0], [wgs[0], wgs[2], wgs[1]]);
  expectCoordinates(fallback.markers, wgs);
  await page.evaluate(([lat, lon]) => window.__datumFixture.adapter.map.fire("click", { latlng: L.latLng(lat, lon) }), wgs[0]);
  const finalState = await readOverlays();
  expectCoordinates(finalState.clicks, [wgs[0], wgs[0]]);
  expect(finalState.unchanged).toBe(true);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__datumFixture.adapter.destroy());
});
