import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const baseURL = process.env.TEST_URL || "http://localhost:4173";
const tile = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b0mUAAAAASUVORK5CYII=", "base64");

async function setup(page, settings = {}) {
  await page.addInitScript((settings) => {
    localStorage.setItem("jingxian-route-settings-v1", JSON.stringify({ start: "上海站", end: "澉浦镇", scenic: 72, detour: 30, onlineRouting: true, ...settings }));
  }, settings);
  const requests = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (/autonavi|cartocdn|tile.openstreetmap/.test(url.hostname)) return route.fulfill({ contentType: "image/png", body: tile });
    if (/overpass/.test(url.hostname)) return route.fulfill({ contentType: "application/json", body: '{"elements":[]}' });
    if (/open-elevation/.test(url.hostname)) return route.fulfill({ status: 503, body: "Unavailable" });
    if (url.pathname.includes("/route/v1/")) {
      const coordinates = url.pathname.split("/").at(-1).split(";").map((pair) => pair.split(",").map(Number));
      requests.push(coordinates);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: "Ok", routes: [{ distance: coordinates.length > 2 ? 120000 : 100000, geometry: { type: "LineString", coordinates } }] }) });
    }
    return route.continue();
  });
  await page.goto(baseURL);
  return requests;
}

async function downloadXml(page) {
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const download = await downloadEvent;
  return readFile(await download.path(), "utf8");
}

async function inspectXml(page, source) {
  return page.evaluate((source) => {
    const xml = new DOMParser().parseFromString(source, "application/xml");
    const get = (kind) => Array.from(xml.getElementsByTagName(kind)).map((point) => ({
      lat: Number(point.getAttribute("lat")), lon: Number(point.getAttribute("lon")),
      name: point.querySelector("name")?.textContent || "",
    }));
    return { errors: xml.getElementsByTagName("parsererror").length, wpt: get("wpt"), rtept: get("rtept"), trkpt: get("trkpt") };
  }, source);
}

test("Shanghai to Ganpu keeps selected stops on the map, GPX and reimport", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = await setup(page);
  await expect(page.locator("#route-source")).toHaveText("骑行道路轨迹");
  const expectedNames = ["金山城市沙滩", "乍浦九龙山", "南北湖东大门"];
  await expect(page.locator("#stops-value")).toHaveText("3");
  for (const name of expectedNames) {
    await expect(page.locator("#stops-list")).toContainText(name);
    await expect(page.locator("#street-map .route-point-tooltip").filter({ hasText: name })).toBeVisible();
  }
  await page.getByRole("button", { name: "在地图上查看南北湖东大门", exact: true }).click();
  await expect(page.locator(".leaflet-popup-content")).toContainText("南北湖东大门");
  expect(requests.at(-1)).toHaveLength(5);
  const xml = await downloadXml(page);
  const parsed = await inspectXml(page, xml);
  expect(parsed.errors).toBe(0);
  expect(parsed.trkpt.map(({ lon, lat }) => [lon, lat])).toEqual(requests.at(-1).map((point) => point.map((value) => Number(value.toFixed(6)))));
  for (const name of expectedNames) {
    for (const kind of ["wpt", "rtept", "trkpt"]) expect(parsed[kind].some((point) => point.name.includes(name))).toBe(true);
  }
  await page.locator("#gpx-file-input").setInputFiles({ name: "roundtrip.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(xml) });
  await expect(page.locator("#route-source")).toHaveText("GPX 导入");
  await expect(page.locator("#stops-list .stop-item")).toHaveCount(3);
  await expect(page.locator("#form-status")).not.toContainText("离线示意");
  expect((await inspectXml(page, await downloadXml(page))).wpt.map((point) => point.name)).toEqual(parsed.wpt.map((point) => point.name));
  expect(errors).toEqual([]);
});

test("over-budget manual stops remain in the actual exported geometry", async ({ page }) => {
  const requests = await setup(page, { detour: 0, manualWaypoints: [{ id: 1, name: "途中会合点", location: "30.7, 121.2", lat: 30.7, lon: 121.2 }] });
  await expect(page.locator("#route-source")).toHaveText("骑行道路轨迹");
  await expect(page.locator("#form-status")).toContainText("手动途经点超过绕行预算");
  await expect(page.locator("#stops-caption")).toHaveText("按指定顺序经过");
  const parsed = await inspectXml(page, await downloadXml(page));
  expect(parsed.trkpt.map(({ lon, lat }) => [lon, lat])).toEqual(requests.at(-1));
  expect(parsed.trkpt.some((point) => point.lat === 30.7 && point.lon === 121.2 && point.name.includes("途中会合点"))).toBe(true);
});

test("named route and track points import even without independent waypoints", async ({ page }) => {
  await setup(page, { onlineRouting: false });
  const source = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>命名路线</name>
    <rtept lat="30" lon="120"><name>出发</name></rtept><rtept lat="30.01" lon="120.01"><name>河边 &amp; 公园</name></rtept><rtept lat="30.02" lon="120.02"><name>终点</name></rtept>
    </rte><trk><trkseg><trkpt lat="30" lon="120"/><trkpt lat="30.01" lon="120.01"><name>河边 &amp; 公园</name></trkpt><trkpt lat="30.02" lon="120.02"/></trkseg></trk></gpx>`;
  await page.locator("#gpx-file-input").setInputFiles({ name: "names.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(source) });
  await expect(page.locator("#stops-list .stop-item")).toHaveCount(1);
  await expect(page.locator("#route-title")).toHaveText("出发 → 终点");
  await expect(page.locator("#stops-list")).toContainText("河边 & 公园");
  const parsed = await inspectXml(page, await downloadXml(page));
  expect(parsed.errors).toBe(0);
  expect(parsed.wpt).toHaveLength(1);
  expect(parsed.rtept[1].name).toContain("河边 & 公园");
  expect(parsed.trkpt[1].name).toContain("河边 & 公园");
});
