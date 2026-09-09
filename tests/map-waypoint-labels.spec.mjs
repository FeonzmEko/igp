import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_URL || "http://localhost:4173";
const TILE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b0mUAAAAASUVORK5CYII=", "base64");
const LONG_NAME = "金山城市沙滩海岸观景台与骑行休息补给中心";
const GPX = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="30.7245" lon="121.3312"><name>${LONG_NAME}</name><desc>面向杭州湾，停留拍照</desc></wpt>
  <wpt lat="30.725" lon="121.3315"><name>海边咖啡店</name><desc>补水休息</desc></wpt>
  <wpt lat="30.6282" lon="121.1065"><name>九龙山观景台</name></wpt>
  <trk><name>上海站到澉浦镇</name><trkseg>
    <trkpt lat="31.24981" lon="121.45522"><name>上海站</name></trkpt>
    <trkpt lat="30.7245" lon="121.3312"/><trkpt lat="30.6282" lon="121.1065"/>
    <trkpt lat="30.3935" lon="120.889725"><name>澉浦镇</name></trkpt>
  </trkseg></trk>
</gpx>`;

test("repeated route renders and provider switches replace permanent labels immediately", async ({ page }) => {
  await page.route("**/*", (request) => {
    const url = new URL(request.request().url());
    if (url.origin !== new URL(baseURL).origin) return request.abort();
    return request.continue();
  });
  await page.goto(baseURL);
  const result = await page.evaluate(async () => {
    const { createStreetMap } = await import("/src/map/map.js");
    const stage = document.createElement("div");
    const element = document.createElement("div");
    element.style.cssText = "width:500px;height:400px";
    stage.append(element);
    document.body.append(stage);
    const start = { lat: 31.24981, lon: 121.45522, label: "上海站" };
    const end = { lat: 30.3935, lon: 120.889725, label: "澉浦镇" };
    const stop = { lat: 30.7245, lon: 121.3312, id: 1, name: "金山城市沙滩" };
    const route = { source: "offline", start, end, points: [start, stop, end], stops: [stop] };
    const adapter = createStreetMap({ element, mapStage: stage });
    const snapshots = [];
    const read = () => ({ labels: stage.querySelectorAll(".route-point-tooltip").length, popups: stage.querySelectorAll(".leaflet-popup").length, text: stage.querySelectorAll(".route-point-label-name")[2]?.textContent });
    for (let index = 0; index < 4; index += 1) {
      adapter.render({ ...route, source: index % 2 ? "osrm" : "offline" });
      snapshots.push(read());
      adapter.highlightStop(1);
    }
    let tileLayer;
    adapter.map.eachLayer((layer) => { if (layer instanceof L.TileLayer) tileLayer = layer; });
    for (let index = 0; index < 3; index += 1) tileLayer.fire("tileerror");
    snapshots.push(read());
    const attribution = stage.querySelector(".leaflet-control-attribution").textContent;
    adapter.destroy();
    return { snapshots, attribution, remaining: stage.querySelectorAll(".route-point-tooltip, .leaflet-popup").length };
  });
  expect(result.snapshots).toEqual(Array.from({ length: 5 }, () => ({ labels: 3, popups: 0, text: "金山城市沙滩" })));
  expect(result.attribution).toContain("CARTO");
  expect(result.remaining).toBe(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`keeps named numbered waypoints readable without hovering at ${viewport.width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (/autonavi|cartocdn|tile\.openstreetmap/.test(url.hostname)) return route.fulfill({ contentType: "image/png", body: TILE_PNG });
      if (url.origin !== new URL(baseURL).origin) return route.abort();
      return route.continue();
    });
    await page.goto(baseURL);
    await page.locator("#gpx-file-input").setInputFiles({ name: "shanghai-ganpu.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(GPX) });
    await expect(page.locator("#import-status")).toContainText("已导入");
    const map = page.locator("#street-map");
    await map.scrollIntoViewIfNeeded();
    const labels = map.locator(".route-point-label");
    await expect(labels).toHaveCount(5);
    await expect(map.getByRole("button", { name: "起 · 上海站，查看详情", exact: true })).toBeVisible();
    await expect(map.getByRole("button", { name: "终 · 澉浦镇，查看详情", exact: true })).toBeVisible();
    for (const [number, name] of [["01", LONG_NAME], ["02", "海边咖啡店"], ["03", "九龙山观景台"]]) {
      const label = map.getByRole("button", { name: `${number} · ${name}，查看详情`, exact: true });
      await expect(label).toBeVisible();
      await expect(label.locator(".route-point-label-number")).toHaveText(number);
      await expect(label.locator(".route-point-label-name")).toHaveText(name);
    }
    const dimensions = await map.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, labels: [...node.querySelectorAll(".route-point-label")].map((label) => {
        const rect = label.getBoundingClientRect();
        const name = label.querySelector(".route-point-label-name");
        return { left: rect.left - bounds.left, top: rect.top - bounds.top, right: rect.right - bounds.left, bottom: rect.bottom - bounds.top, width: rect.width, ellipsis: getComputedStyle(name).textOverflow, truncated: name.scrollWidth > name.clientWidth };
      }) };
    });
    for (const label of dimensions.labels) {
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.top).toBeGreaterThanOrEqual(0);
      expect(label.right).toBeLessThanOrEqual(dimensions.width);
      expect(label.bottom).toBeLessThanOrEqual(dimensions.height);
      expect(label.width).toBeLessThanOrEqual(viewport.width < 520 ? 120 : 168);
    }
    expect(dimensions.labels[2].truncated).toBe(true);
    expect(dimensions.labels[2].ellipsis).toBe("ellipsis");
    // Close-by waypoints must have separate readable labels in the overview.
    const first = dimensions.labels[2], second = dimensions.labels[3];
    expect(first.right <= second.left || first.left >= second.right || first.bottom <= second.top || first.top >= second.bottom).toBe(true);
    await map.screenshot({ path: testInfo.outputPath(`waypoints-${viewport.width}.png`) });
    await map.getByRole("button", { name: `01 · ${LONG_NAME}，查看详情`, exact: true }).click();
    await expect(map.locator(".leaflet-popup-content")).toContainText(LONG_NAME);
    await expect(map.locator(".leaflet-popup-content")).toContainText("面向杭州湾");
    await expect(page.locator('#stops-list [data-stop-id="1"]')).toHaveClass(/is-highlighted/);
    await expect(page.locator("#waypoints-list li")).toHaveCount(0);
    await map.locator(".leaflet-popup-close-button").click();
    await expect(map.locator(".leaflet-popup-content")).toHaveCount(0);
    await page.getByRole("button", { name: "在地图上查看九龙山观景台", exact: true }).click();
    await expect(map.locator(".leaflet-popup-content")).toContainText("九龙山观景台");
    await map.locator(".leaflet-popup-close-button").click();
    await map.locator(".leaflet-control-zoom-in").click();
    await expect(labels).toHaveCount(5);
    expect(errors).toEqual([]);
    await context.close();
  });
}
