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
