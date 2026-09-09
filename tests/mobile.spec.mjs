import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_URL || "http://localhost:4173";

const GPX_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>手机测试路线</name></metadata>
  <wpt lat="30.25" lon="120.16"><name>补给点</name><type>fuel</type></wpt>
  <trk><name>手机测试路线</name><trkseg>
    <trkpt lat="30.25" lon="120.16"><ele>12</ele></trkpt>
    <trkpt lat="30.30" lon="120.40"><ele>52</ele></trkpt>
  </trkseg></trk>
</gpx>`;

function osrmPayload() {
  return {
    code: "Ok",
    routes: [{
      distance: 28600,
      duration: 4200,
      geometry: {
        coordinates: [
          [120.16, 30.25],
          [120.22, 30.27],
          [120.30, 30.29],
          [120.40, 30.30],
        ],
      },
    }],
  };
}

async function mockServices(page, { slowRouting = false } = {}) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.hostname.includes("nominatim")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ lat: "30.25000", lon: "120.16000", display_name: "测试地点" }]),
      });
      return;
    }
    if (url.hostname.includes("router.project-osrm.org") || url.pathname.includes("/route/v1/")) {
      if (slowRouting) await new Promise((resolve) => setTimeout(resolve, 1800));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(osrmPayload()) });
      return;
    }
    if (url.hostname.includes("overpass")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ elements: [] }) });
      return;
    }
    if (url.hostname.includes("open-elevation")) {
      const locations = url.searchParams.get("locations") || "";
      const count = locations ? locations.split("|").length : 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results: Array.from({ length: count }, (_, index) => ({ elevation: 20 + index })) }),
      });
      return;
    }
    if (url.hostname.includes("autonavi.com")) {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b0mUAAAAASUVORK5CYII=", "base64") });
      return;
    }
    if (url.hostname.includes("tile.openstreetmap.org")) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function openPlanner(browser, viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    geolocation: { latitude: 30.25123, longitude: 120.16123 },
    permissions: ["geolocation"],
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.__lastShare = { title: data.title, fileName: data.files?.[0]?.name || "" };
      },
    });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  });
  const page = await context.newPage();
  await mockServices(page, options);
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#route-form")).toBeVisible();
  return { context, page };
}

test.describe("responsive route planner", () => {
  test("has no horizontal overflow on phone and desktop, with a Leaflet street map", async ({ browser }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      const { context, page } = await openPlanner(browser, viewport);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await expect(page.locator("#street-map")).toBeVisible();
      await expect(page.locator("#street-map")).toHaveClass(/leaflet-container/);
      await context.close();
    }
  });

  test("uses the permitted geolocation as the start location", async ({ browser }) => {
    const { context, page } = await openPlanner(browser, { width: 390, height: 844 });
    await page.locator("#locate-button").click();
    await expect(page.locator("#start-input")).toHaveValue("30.25123, 120.16123");
    await expect(page.locator("#start-source")).toHaveText("手机当前位置");
    await context.close();
  });

  test("swaps both locations while preserving the waypoint editor", async ({ browser }) => {
    const { context, page } = await openPlanner(browser, { width: 390, height: 844 });
    await page.locator("#start-input").fill("起点测试");
    await page.locator("#end-input").fill("终点测试");
    await page.locator("#waypoint-name-input").fill("中途补给");
    await page.locator("#waypoint-location-input").fill("30.27000, 120.22000");
    await page.locator("#add-waypoint-button").click();
    await expect(page.locator("#waypoints-list li")).toHaveCount(1);
    await page.locator("#swap-locations").click();
    await expect(page.locator("#start-input")).toHaveValue("终点测试");
    await expect(page.locator("#end-input")).toHaveValue("起点测试");
    await expect(page.locator("#waypoints-list li")).toContainText("中途补给");
    await context.close();
  });

  test("shows loading and allows an in-flight route request to be cancelled", async ({ browser }) => {
    const { context, page } = await openPlanner(browser, { width: 390, height: 844 }, { slowRouting: true });
    await page.locator("#start-input").fill("30.25000, 120.16000");
    await page.locator("#end-input").fill("30.30000, 120.40000");
    await page.locator("#route-form").locator("button[type=submit]").click();
    await expect(page.locator("#cancel-route-button")).toBeVisible();
    await expect(page.locator("#form-status")).toContainText(/正在|规划/);
    await page.locator("#cancel-route-button").click();
    await expect(page.locator("#cancel-route-button")).toBeHidden();
    await expect(page.locator("#form-status")).toContainText(/取消/);
    await context.close();
  });

  test("imports a GPX and invokes the iGPSPORT share fallback", async ({ browser }) => {
    const { context, page } = await openPlanner(browser, { width: 390, height: 844 });
    await page.locator("#gpx-file-input").setInputFiles({
      name: "phone-route.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(GPX_FIXTURE),
    });
    await expect(page.locator("#import-status")).toContainText("已导入");
    await expect(page.locator("#export-button")).toBeEnabled();
    await expect(page.locator("#share-button")).toBeEnabled();
    await page.locator("#share-button").click();
    await expect.poll(() => page.evaluate(() => window.__lastShare?.fileName || "")).toContain("phone-route");
    await context.close();
  });
});
