const SCORE_LABELS = {
  water: "水域",
  forest: "森林",
  viewpoint: "观景点",
  park: "公园",
  nature_reserve: "自然保护区",
  negative: "负面环境",
};

const SUPPLY_LABELS = {
  cafe: "咖啡店",
  restaurant: "餐厅",
  fuel: "加油站",
  shop: "便利店",
};

const SCENIC_STATUSES = new Set(["ready", "partial", "unavailable", "offline"]);
const SUPPLY_STATUSES = new Set(["ready", "partial", "unavailable", "offline"]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeSourceUrl(value) {
  try {
    const url = new URL(String(value), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function statusLabel(status, hasScore) {
  if (status === "partial") return hasScore ? "部分数据 · 风景指数" : "部分数据 · 未评估";
  if (status === "offline") return "离线预览 · 未评估";
  if (status === "unavailable") return "数据不可用 · 未评估";
  return hasScore ? "风景指数" : "未评估";
}

function scoreStars(score) {
  if (!Number.isFinite(score)) return "☆☆☆☆☆";
  const filled = Math.max(0, Math.min(5, Math.ceil(score / 20)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

function clear(element) {
  if (element) element.replaceChildren();
}

/** Render the route scenic score, features and expandable contribution details. */
export function renderScenicDetails(route = {}) {
  const panel = document.querySelector("#scenic-score-panel");
  if (!panel) return;
  const stars = document.querySelector("#scenic-score-stars");
  const value = document.querySelector("#scenic-score-value");
  const statusNode = document.querySelector("#scenic-score-status");
  const featureList = document.querySelector("#scenic-features-list");
  const breakdown = document.querySelector("#scenic-score-breakdown");
  const legacyScore = document.querySelector("#route-score");
  const scenic = route.scenicScore && typeof route.scenicScore === "object" ? route.scenicScore : {};
  const status = SCENIC_STATUSES.has(scenic.status) ? scenic.status : "unavailable";
  const score = (status === "ready" || status === "partial") ? finiteNumber(scenic.score) : null;

  panel.hidden = false;
  if (stars) stars.textContent = score === null ? "☆☆☆☆☆" : scoreStars(score);
  if (value) value.textContent = score === null ? "未评估" : String(Math.round(score));
  if (statusNode) statusNode.textContent = statusLabel(status, score !== null);
  if (legacyScore) legacyScore.textContent = score === null ? "未评估" : String(Math.round(score));

  clear(featureList);
  const features = Array.isArray(scenic.features) ? scenic.features : [];
  if (featureList) {
    if (features.length) {
      features.slice(0, 6).forEach((feature) => {
        const item = document.createElement("li");
        item.textContent = String(feature);
        featureList.appendChild(item);
      });
    } else {
      const item = document.createElement("li");
      item.className = "scenic-empty-note";
      item.textContent = score === null ? "路线风景数据暂不可用" : "暂无明显风景特征";
      featureList.appendChild(item);
    }
  }

  clear(breakdown);
  const details = scenic.details && typeof scenic.details === "object" ? scenic.details : {};
  if (breakdown) {
    const keys = Object.keys(SCORE_LABELS);
    if (score === null || status === "offline" || status === "unavailable") {
      const item = document.createElement("li");
      item.className = "scenic-empty-note";
      item.textContent = "查询完成后显示各项贡献";
      breakdown.appendChild(item);
    } else {
      keys.forEach((key) => {
        const amount = finiteNumber(details[key]);
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = SCORE_LABELS[key];
        const contribution = document.createElement("strong");
        contribution.textContent = amount === null ? "—" : `${amount > 0 ? "+" : ""}${amount}`;
        item.append(label, contribution);
        breakdown.appendChild(item);
      });
    }
  }
}

function supplyStatusLabel(status, count) {
  if (status === "unqueried") return "未查询";
  if (status === "offline") return "离线预览 · 未查询";
  if (status === "unavailable") return "查询失败";
  if (status === "partial") return count ? "部分数据" : "部分查询 · 无结果";
  return count ? `${count} 个点` : "查询完成 · 无结果";
}

/** Render route-nearby supply POIs while preserving the estimated ride-plan text. */
export function renderSupplies(route = {}) {
  const panel = document.querySelector("#supplies-panel");
  if (!panel) return;
  const statusNode = document.querySelector("#supplies-status");
  const list = document.querySelector("#supplies-list");
  const supplies = route.supplies && typeof route.supplies === "object" ? route.supplies : {};
  const status = SUPPLY_STATUSES.has(supplies.status) ? supplies.status : "unqueried";
  const items = Array.isArray(supplies.items) ? supplies.items.slice() : [];
  items.sort((a, b) => (finiteNumber(a.km) ?? Infinity) - (finiteNumber(b.km) ?? Infinity));
  panel.hidden = false;
  if (statusNode) statusNode.textContent = supplyStatusLabel(status, items.length);
  clear(list);
  if (!list) return;
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "supplies-empty";
    empty.textContent = status === "unqueried" ? "生成路线后查询沿线补给" : status === "offline" ? "在线查询关闭，暂无沿线补给数据" : status === "unavailable" ? "补给查询失败，请稍后重试" : "500 米范围内未找到补给点";
    list.appendChild(empty);
    return;
  }
  items.forEach((supply) => {
    const item = document.createElement("div");
    item.className = "supply-item";
    const km = finiteNumber(supply.km);
    const distance = finiteNumber(supply.distance);
    const marker = document.createElement("span");
    marker.className = "supply-km";
    marker.textContent = km === null ? "—" : `${km.toFixed(km < 10 ? 1 : 0)} km`;
    const copy = document.createElement("span");
    copy.className = "supply-copy";
    const name = document.createElement("strong");
    name.textContent = supply.name ? String(supply.name) : "未命名补给点";
    const meta = document.createElement("small");
    meta.textContent = `${SUPPLY_LABELS[supply.type] || "补给点"} · 距路线 ${distance === null ? "—" : `${Math.round(distance)} 米`}`;
    copy.append(name, meta);
    const sourceUrl = safeSourceUrl(supply.sourceUrl);
    if (sourceUrl) {
      const link = document.createElement("a");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "来源";
      copy.appendChild(link);
    }
    item.append(marker, copy);
    list.appendChild(item);
  });
}
