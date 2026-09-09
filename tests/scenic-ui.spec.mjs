import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_URL || "http://localhost:4173";

async function loadPresentation(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#route-form")).toBeVisible();
  return page.evaluate(async () => {
    const module = await import("/src/route/presentation.js");
    module.renderScenicDetails(window.__fixtureRoute);
    module.renderSupplies(window.__fixtureRoute);
  });
}

test.describe("scenic route presentation", () => {
  test("renders real scenic contributions and nearby supplies safely", async ({ page }) => {
    await page.addInitScript(() => {
      window.__fixtureRoute = {
        scenicScore: {
          score: 86,
          status: "ready",
          details: { water: 25, forest: 20, viewpoint: 30, park: 15, nature_reserve: 0, negative: -4 },
          features: ["湖边骑行", "林间道路", "观景点 3 个"],
          counts: { viewpoint: 3 },
        },
        supplies: {
          status: "ready",
          items: [{ type: "shop", name: "湖畔便利店", distance: 300, km: 30.2, sourceUrl: "https://www.openstreetmap.org/node/1" }],
        },
      };
    });
    await loadPresentation(page);
    await expect(page.locator("#scenic-score-value")).toHaveText("86");
    await expect(page.locator("#scenic-score-stars")).toHaveText("★★★★★");
    await expect(page.locator("#scenic-features-list")).toContainText("湖边骑行");
    await page.locator("#scenic-score-details summary").click();
    await expect(page.locator("#scenic-score-breakdown")).toContainText("水域");
    await expect(page.locator("#supplies-list")).toContainText("湖畔便利店");
    await expect(page.locator("#supplies-list")).toContainText("300 米");
  });

  test("marks unavailable and offline data as unevaluated", async ({ page }) => {
    await page.addInitScript(() => {
      window.__fixtureRoute = {
        scenicScore: { score: null, status: "offline", details: {}, features: [] },
        supplies: { status: "unavailable", items: [] },
      };
    });
    await loadPresentation(page);
    await expect(page.locator("#scenic-score-value")).toHaveText("未评估");
    await expect(page.locator("#scenic-score-stars")).toHaveText("☆☆☆☆☆");
    await expect(page.locator("#scenic-score-status")).toContainText("离线");
    await expect(page.locator("#supplies-list")).toContainText("查询失败");
  });

  test("fits the narrow summary column", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__fixtureRoute = { scenicScore: { score: 72, status: "partial", details: { water: 25 }, features: ["湖边骑行"] }, supplies: { status: "ready", items: [] } };
    });
    await loadPresentation(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

