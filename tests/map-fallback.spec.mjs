import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_URL || "http://localhost:4173";
const TILE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b0mUAAAAASUVORK5CYII=", "base64");

async function openMap(page, { secondaryAvailable } = {}) {
  const calls = { primary: 0, secondary: 0 };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname.includes("cartocdn")) {
      calls.primary += 1;
      await route.abort();
      return;
    }
    if (url.hostname.includes("tile.openstreetmap.org")) {
      calls.secondary += 1;
      if (secondaryAvailable) await route.fulfill({ contentType: "image/png", body: TILE_PNG });
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

test("tries the secondary tile provider before falling back", async ({ page }) => {
  const calls = await openMap(page, { secondaryAvailable: true });
  await expect.poll(() => calls.secondary).toBeGreaterThan(0);
  await expect.poll(() => page.locator(".leaflet-tile-loaded").count()).toBeGreaterThan(0);
  await expect(page.locator("#map-stage")).not.toHaveClass(/tile-fallback/);
  await expect(page.locator("#street-map")).toBeVisible();
  await expect(page.locator(".leaflet-control-attribution")).toContainText("CARTO");
});

test("keeps the route visible on phone and desktop when both tile providers fail", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openMap(page, { secondaryAvailable: false });
    await expect(page.locator("#map-stage")).toHaveClass(/tile-fallback/);
    await expect(page.locator("#route-map")).toBeVisible();
    await expect(page.locator("#map-route .route-line")).toHaveAttribute("d", /M.+L/);
    await expect.poll(() => page.locator("#map-stage").evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(150);
    expect(errors).toEqual([]);
    await context.close();
  }
});
