# 优化待办

本文件记录一次完整代码走查（`app.js` 1809 行 + `src/` 全部模块 + `tests/`）后确定的改进项。
所有行号对应提交 `d6bd882`，改动后请以实际代码为准。

走查时已经实际执行过的验证：

- `npm run check` —— 通过。
- `node --test tests/*.test.mjs` —— 40 个用例全部通过。
- `node --test tests` —— 失败，`Cannot find module '...\tests'`。
- `npm run build` —— 本机未执行 `npm install`，因缺少 `node_modules/leaflet/dist/images` 失败（属环境问题，非代码缺陷）。

原则：**先删死代码、再补自动化、最后才动逻辑**。第 0、1 步是纯增删、零行为变更，可以靠现有测试直接证明安全；第 2 步之后的每一项都必须带上对应的回归测试。

---

## P0 删除死代码（约 241 行，占 app.js 13%）

`src/` 目录是一次"渐进式模块边界"重构的产物，但 app.js 里对应的旧实现没有删除。
这些函数**定义了但从未被调用**，且与 `src/` 中的模块功能重复。

### P0-1 景点发现的旧实现

- 位置：`app.js:376-385`（`routeRatioAndOffset`）、`app.js:387-447`（`discoverScenicStops`）
- 重复对象：`src/api/osm.js:217` 的 `discoverScenicStops`
- 证据：`app.js:1` 必须把导入写成 `discoverScenicStops as discoverScenicStopsApi` 来避让同名函数；`app.js` 内唯一的真实调用点是 `app.js:1665` 的 `discoverScenicStopsApi`。
- 危害：两份实现的 Overpass 查询串**已经不一致**（`app.js:396` vs `src/api/osm.js:16-19` 的 `DISCOVERY`）。下次改景点发现逻辑时改错那一份的概率很高，且不会有任何测试报警。
- 做法：删除 `app.js:376-447`，把 `app.js:1` 的导入别名改回 `discoverScenicStops`。

### P0-2 在线校路/高程的旧实现

- 位置：`app.js:764-773`（`interpolateElevation`）、`app.js:775-813`（`applyOnlineGeometry`）、`app.js:815-828`（`requestOsrm`）、`app.js:830-833`（`samplePointIndices`）、`app.js:835-874`（`enrichRouteElevations`）、`app.js:876-925`（`fetchOnlineRoute`）
- 重复对象：`src/api/osrm.js`、`src/api/elevation.js:29`、`src/route/planner.js:103`
- 证据：这一组构成一个闭环，只被彼此调用，外部零引用。真实调用点是 `app.js:1697` 的 `fetchOnlineRouteModule` 和 `app.js:1701` 的 `enrichRouteElevationsModule`。
- 做法：删除 `app.js:764-833` 与 `app.js:835-925`，把 `app.js:3-4` 的导入别名改回本名。

### P0-3 GPX 转义的旧实现

- 位置：`app.js:1140-1147`（`escapeXml`）
- 重复对象：`src/gpx/exporter.js:3`
- 证据：全文件零引用。且旧版**缺少非法 XML 字符过滤**（新版 `exporter.js:5` 会先剔除 XML 1.0 不允许的控制字符），说明它是一份更早、更弱的实现。
- 做法：直接删除。

### P0-4 孤儿模块

- `src/state/store.js:28` `createGenerationStore`：零引用。`app.js:201-210` 与 `app.js:1613-1616` 把 generationId / activeController 又手写了一遍。
- `src/route/scenicScore.js`：整个文件只有 2 行，是 `export { ... } from "./scenic.js"` 的转发，零引用。
- 做法：二选一 —— 要么删除，要么让 `app.js` 真正改用 `createGenerationStore`（推荐后者，它把"过期响应不得更新 UI"这条规则收敛到了一个地方）。`scenicScore.js` 建议直接删除；若保留，需说明它服务于哪个外部消费者。

**验收**：`npm run check`、`node --test tests/*.test.mjs`、`npx playwright test` 全部通过，且 `app.js` 中不再存在同名遮蔽（导入别名全部去掉）。

---

## P1 工程化：让测试真的跑起来

现状：测试写了不少，但既跑不起来也没人跑。这是**投入产出比最高**的一块。

### P1-1 补 `npm test`

- 现状：`package.json` 里没有 `test` 脚本，40 个单测只能靠手动敲命令；`node --test tests`（传目录）直接报错 `Cannot find module '...\tests'`（已实测）。
- 做法：在 `package.json` 增加
  - `"test": "node --test \"tests/*.test.mjs\""`
  - `"test:all": "npm run check && npm test && npm run test:ui"`
- 注意 glob 必须带引号：npm 脚本在 Windows 下经 cmd.exe 执行，不会展开通配符，需要由 Node 自己展开。已实测带引号的 `node --test "tests/*.test.mjs"` 能正确跑到全部 40 个用例。
- 顺带：把单测（`*.test.mjs`）与浏览器测试（`*.spec.mjs`）分开到 `tests/unit/` 与 `tests/ui/`，避免 `node --test` 误扫到依赖 `@playwright/test` 的文件。

### P1-2 补 `playwright.config.js`

- 现状：仓库里**没有** playwright 配置，也没有 `webServer`，所以 4 个 spec 必须自己先起 4173 端口才能跑。
- 现状：`package.json:11` 只跑 `tests/mobile.spec.mjs`，以下 4 个 spec **没有任何入口**：
  `tests/waypoints.spec.mjs`、`tests/map-fallback.spec.mjs`、`tests/map-waypoint-labels.spec.mjs`、`tests/scenic-ui.spec.mjs`。
- 做法：新增配置，`webServer` 指向 `npm run dev`（`http://localhost:4173`，`reuseExistingServer: true`），`test:ui` 改为跑全部 spec。

### P1-3 补 CI

- 现状：没有 `.github/workflows/`，而 `wrangler.toml` 连接 master 自动部署 —— **push 即上生产，中间零校验**。
- 做法：新增 GitHub Actions，在 push / PR 上执行 `npm ci` → `npm run check` → `npm test` → `npx playwright install --with-deps chromium` → `npm run test:ui`。

### P1-4 补文档

- `README.md` 只介绍了 `npm run check` 与 `npm run build`，完全没有"如何跑测试"一节。
- 做法：在 README 增加"开发与测试"小节，列出上述命令。

**验收**：新克隆的仓库执行 `npm ci && npm test && npm run test:ui` 能全绿；PR 上能看到 CI 结果。

---

## P2 消除重复实现

### P2-1 抽取 `src/geo/distance.js`

同一份 haversine 被抄了 **6 遍**，地球半径还有 3 种写法：

| 位置 | 半径写法 |
|---|---|
| `app.js:449` `haversineKm` | 6371 |
| `src/api/elevation.js:8` `haversineKm` | 6371 |
| `src/api/osm.js:53` `hav` | 12742 ÷ 2 |
| `src/route/planner.js:6` `haversineKm` | 6371 |
| `src/route/scenic.js:17` `haversine` | 6371.0088 |
| `src/gpx/exporter.js:19` `distanceMeters` | 12742000 ÷ 2 |

做法：统一到一个模块，对外暴露 `distanceKm(a, b)` / `distanceMeters(a, b)`，半径用 `6371.0088`（`scenic.js` 已经在用的那个），并确保单位换算只在一处发生。
注意 `src/api/osm.js:67`（`111320`）与 `src/route/scenic.js` 的 `segmentDistanceKm`（`111.32`）用的是等距圆柱近似而非 haversine，属于另一族函数，可以一并收进该模块但不要混为一谈。

### P2-2 抽取 `src/geo/datum.js`

- 位置：`app.js:1149-1187` 与 `src/map/map.js:14-58` —— `AXIS` / `EE` / `outOfChina` / `transformLatitude` / `transformLongitude` / `wgs84ToGcj02` **逐字相同**。
- 做法：`map.js` 已经导出了 `wgs84ToGcj02`（`map.js:45`）与 `gcj02ToWgs84`（`map.js:61`），把这两个搬到 `src/geo/datum.js`，`app.js` 改为导入，删掉自己那一份。

### P2-3 收敛默认配置

- `config.js`、`config.example.js`、`src/api/http.js:1` `DEFAULT_CONFIG` 是**三份内容相同**的默认值，必须手工同步。
- 且 `config.js` 与 `config.example.js` 现在**逐字相同**，example 作为"模板"的意义已经消失。
- 做法：`http.js` 的 `DEFAULT_CONFIG` 作为唯一事实来源；`config.js` 只保留需要覆盖的键；`config.example.js` 改为带注释的说明性模板，或直接删除并在 README 记录可用键。

### P2-4 顺带

- `src/api/geocoder.js:210` `const config = runtimeConfig;` 是无意义的别名，直接用 `runtimeConfig`。
- `scripts/build.mjs:24` 会把整个 `src/` 原样复制进 `dist/`，包括零引用的模块。P0 清理后建议加一道检查，避免死文件重新混进产物。

---

## P3 性能与健壮性

### P3-1 消除大数组展开

- 位置：`app.js:1109-1110`（`Math.min(...values)` / `Math.max(...values)`）、`app.js:938-943`（`projectFactory` 里对 lat / lon 各展开一次，即 4 次）。
- 风险：导入上限 `MAX_GPX_ROUTE_POINTS = 50000`（`app.js:210`）。5 万个实参在移动端 Safari / 低内存机型上有触发 `Maximum call stack size exceeded` 的现实风险，且这是**打开大 GPX 文件时立刻触发**的路径。
- 做法：改成单遍 for 循环求 min/max。这类计算没有理由用展开。

### P3-2 SVG 路线图做抽稀

- 位置：`app.js:972-1041` `renderMap`，把每个轨迹点都拼进 path 字符串（`app.js:983`），5 万点会生成数百 KB 的 `d` 属性。
- 现状：`src/map/map.js:107` 已有 `samplePoints(points, 2000)`，但**只用在了 Leaflet 侧**；SVG 回退路径没用上，而回退路径恰恰是弱网/低端机才会走到的场景，最需要省性能。
- 做法：`renderMap` 复用 `samplePoints`（并把该函数提到共享模块）。注意起点、终点和所有 `route.stops` 的投影点必须保留，抽稀后要重新定位。

### P3-3 修复 SVG 地图加点的坐标偏移

- 位置：`app.js:1475-1480`。用 `(clientX - rect.left) / rect.width * 900` 做线性映射。
- 问题：`#route-map`（`index.html:196`）是 `viewBox="0 0 900 560"` + `preserveAspectRatio="xMidYMid meet"`，而容器（`styles.css:163,168`）定高 440px、宽度自适应。宽高比不等于 900:560（≈1.607）时 `meet` 会在左右留白，留白区域的点击被错误映射，途经点落在偏离点击位置的地方。
- 影响范围：仅当 SVG 图是当前可点击地图时，即 Leaflet 不可用或进入瓦片回退（`styles.css:166,187`）。
- 做法：改用 `svg.getScreenCTM().inverse()` 配合 `DOMPoint`（或 `createSVGPoint().matrixTransform(...)`）做真实变换。
- 回归：补一条 Playwright 用例 —— 在 `tile-fallback` 状态下于 SVG 已知位置点击，断言生成的途经点坐标落在预期范围内。

### P3-4 Service Worker 版本号

- `sw.js:2` `CACHE_NAME = "jingxian-shell-v4"` 依赖人工 bump。虽然 `networkFirst` 兜住了大部分情况，但这是一个纯粹的遗忘点。
- 做法：构建期把版本号注入（例如接 `package.json` 的 `version`），或在 `scripts/build.mjs` 中追加哈希。

---

## P4 代码细节

- **幽灵参数**：`parseLocation(startInput, 11)`、`parseLocation(endInput, 29)`（`app.js:1627-1628`）、`parseLocation(waypoint.location, waypoint.id)`（`app.js:1439`）—— `parseLocation`（`app.js:338`）只接收一个形参，第二个实参被静默忽略。属重构残留，阅读时非常误导，直接删除。
- **变量名与语义相反**：`app.js:1107` `const hasElevation = route.elevationSource === "示意" || ...` —— "示意高程"反而让 `hasElevation` 为真。当前分支行为是正确的，但这个名字迟早会被误改，建议改名为 `hasElevationSeries` 或按"是否有可用高程数据"重新组织判断。
- **`calculateScenicScore` 返回类型不稳定**：`src/route/scenic.js` 末行 —— 只传 1 个参数时返回 Promise，传 2 个时返回对象。当前调用点（`app.js:1706`）传了 2 个所以没暴露，但这是个"忘了传参就静默拿到 Promise"的陷阱。建议拆成 `calculateScenicScore(route, osmData)`（同步）和 `fetchAndScoreScenic(route)`（异步）两个显式函数。
- **状态栏写法不统一**：`setFormMessage()`（`app.js:229`）与直接赋值 `refs.status.className = ...`（`app.js:1463, 1595, 1764`）混用，warning 样式有走丢失的风险。统一走 `setFormMessage`。
- **`_headers` 缺少 CSP**：已有 `X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy`，但一个会加载第三方瓦片与多个公共 API 的 PWA，加 `Content-Security-Policy` 收益明显。注意 Leaflet 需要 `style-src 'unsafe-inline'`，内联的 SW 注册脚本（`index.html:332`）需要 hash 或 nonce。
- **Overpass 没有频率约束**：Nominatim 已在 `src/api/geocoder.js:267` 做了 1 req/s 限速，但 `src/api/osm.js:155-177` 的长距离分批查询会连续 POST，更容易被公共实例限流。建议加与 Nominatim 类似的节流，或明确降低 `MAX_BATCH_POINTS`。

---

## 建议执行顺序

1. **P0** —— 纯删除，零行为变更，删完跑现有测试即可确认无回归。
2. **P1** —— 把上一步的安全网变成自动的，后续每一步都有 CI 兜底。
3. **P2** —— 消除重复实现；有了 P1 的 CI，重构才敢做大。
4. **P3** —— 真正影响手机用户的三个点（大文件打开、回退图卡顿、加点偏移）。
5. **P4** —— 随手清理，可穿插进行。

## 明确不做

以下是有意保留的现状，不是待办：

- **浏览器直连 Nominatim / Overpass / Open-Elevation 公共端点**：这是当前零后端架构的前提。`README.md` 已经说明了限流与超时风险，页面也会保留离线预览并明确提示，属于已知取舍。
- **高德公开瓦片端点**：同上，`README.md` 已注明其可用性与使用范围以高德服务条款为准。
- **`config.js` 随构建发布**：其中不含任何密钥（已核对），不需要改为环境变量注入。
