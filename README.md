# 景线 / IGP 风景骑行路线

一个浏览器端的风景优先骑行路线规划器。输入起点和终点后，工具会先定位地点，再用 OpenStreetMap 骑行路由生成道路轨迹；路线可以加入自动发现或手动排序的途经点，并把景点写入 GPX 航点，方便导入 IGP。

## 使用

直接双击 `index.html` 即可使用离线预览。完整在线能力建议使用本地静态服务器：

```powershell
npm install
npm run dev
```

访问 `http://localhost:4173`。发布前可运行：

```powershell
npm run check
npm run build
```

## 部署到 Cloudflare Pages

项目已经包含 `wrangler.toml`，Cloudflare Pages 的构建目录是 `dist`。推荐连接 GitHub，让每次推送自动部署。

### 方式一：连接 GitHub 自动部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages**。
2. 点击 **Create application → Pages → Connect to Git**。
3. 授权 GitHub，并选择仓库 `FeonzmEko/igp`。
4. 选择生产分支 `master`。
5. 在构建设置中填写：

   ```text
   Framework preset: None
   Build command: npm run build
   Build output directory: dist
   Root directory: /
   ```

6. 点击 **Save and Deploy**，等待构建完成。

项目不需要 Cloudflare Functions、数据库或环境变量。构建会把 Leaflet 地图资源、PWA 文件和 `_headers` 一起复制到 `dist`。部署完成后，使用 Cloudflare 提供的 `https://<项目名>.pages.dev` 地址访问；手机定位、系统文件分享和安装到主屏都必须使用 HTTPS。

后续只要执行：

```powershell
git add .
git commit -m "更新路线规划"
git push origin master
```

Cloudflare 会自动创建新的部署。可在 **Workers & Pages → 项目 → Deployments** 查看构建日志和回滚历史。

### 方式二：使用 Wrangler 命令部署

先在本机安装依赖并登录 Cloudflare：

```powershell
npm install
npx wrangler login
```

浏览器授权完成后，在项目目录执行：

```powershell
npm run cf:dev
npm run cf:deploy
```

`npm run cf:dev` 用于本地模拟 Pages，`npm run cf:deploy` 会先运行构建，再上传 `dist`。首次部署时 Wrangler 会提示创建 Pages 项目，项目名默认是 `jingxian-igp`；如果已有同名项目，选择对应项目即可。

### 部署后检查

- 能打开首页，并且浏览器地址以 `https://` 开头。
- 地图默认显示高德中文道路底图，右下角标注“© 高德地图”；浏览器开发者工具中 `/vendor/leaflet/leaflet.js` 返回 200。
- 输入“杭州西湖”和“千岛湖”，点击生成，路线来源显示为在线道路或明确的离线预览。
- 手机点击定位按钮时允许定位权限；点击“发送到 iGPSPORT”时选择系统分享面板中的 iGPSPORT。
- 在浏览器菜单中选择“添加到主屏幕”，重新打开后页面仍可加载。

点击“发送到 iGPSPORT”会打开手机系统分享面板，最终是否出现 iGPSPORT 由手机系统和 iGPSPORT 的文件关联决定；不支持文件分享的浏览器会自动下载 GPX。路线服务仍由浏览器请求公开的 Nominatim、OpenStreetMap 骑行路由、Overpass 和 Open-Elevation 接口，公共服务限流或超时时页面会保留离线预览。

默认使用公开服务：Nominatim 地理编码、OpenStreetMap 骑行路由、Overpass 公共 POI 查询和 Open-Elevation 高程服务。公共服务可能限流或超时，页面会保留离线预览并明确提示。服务地址和超时可在 `config.js` 修改。

地图默认请求高德公开道路瓦片，无需在前端配置密钥。瓦片版权属于高德地图，公共端点的可用性和使用范围以高德服务条款为准；当前可访问不代表无限调用承诺。请求失败时依次切换 CARTO、OpenStreetMap，全部不可用时显示示意地图。Service Worker 只缓存本地应用文件，不缓存第三方地图瓦片。

高德底图使用 GCJ-02：显示路线、起终点和景点时转换坐标，地图点击加点时转换回 WGS84。切换到备用底图会同步还原显示坐标；路线规划和默认 GPX 导出始终保留 WGS84，避免底图偏移污染轨迹。

在线路线会在道路周边 500 米内查询水域、森林、公园、观景点、自然保护区、工业区和高速道路，并生成 0-100 风景指数；补给查询会查找咖啡店、餐厅、加油站和便利店/超市。接口失败时结果标记为未评估，不会用离线示意数据冒充真实评分。

## 输入与导出

- 地点支持城市、车站、县城、景区、地址和 `纬度, 经度`。
- 手机端可以用当前位置作为起点，也可以交换起终点；规划过程支持取消，避免重复请求。
- 可加入名称、地点或坐标形式的手动途经点，调整顺序、删除，或打开“地图加点”后直接点击路线地图。
- 地图使用可缩放的高德中文道路底图；网络不可用时会退回备用底图或示意地图，示意路线不能直接导航。
- 内置了杭州西湖 -> 千岛湖、上海站 -> 海盐县/澉浦镇的公开景点线索，南北湖使用东大门附近的入口位置。
- 其他路线会尝试从 OpenStreetMap 公共 POI 找到观景台、湖岸、自然景观和历史点位，并按风景偏好评分。
- 在线模式会按手动途经点顺序校路；偏好骑行道路时请求会排除 motorway/trunk，道路服务若不支持该参数仍会明确保留提示。
- 地图常显起终点和途经点编号、名称，右侧列表可定位到对应点并打开详情。在线校路会保留已选真实景点；手动途经点超过绕行预算时保留经过这些点的轨迹，不可达时明确报错。
- 导出的 GPX 1.1 同时包含完整 `trk` 轨迹、完整 `rte` 路线点和 `wpt` 航点。途经点名称写入标准路线点和轨迹点的 `name/desc`，原始景点坐标保留在独立航点中；不会把远离道路的 POI 坐标硬插进轨迹。
- GPX 导入会保留独立航点和命名路线点/轨迹点，自动合并重复表示。已通过 GPX 1.1 XML 结构及导出再导入测试；iGPSPORT App/码表是否展示全部航点字段仍取决于版本和设备，应使用新导出的文件核验。
- 起终点定位失败时只能预览，导出按钮会保持禁用，避免把随机示意线当成导航文件。
- 导出时可选择 WGS84 或 GCJ-02；高程只在来源真实存在时写入 GPX，不会把缺失值写成 0 米。

## 目录

- `index.html` 页面结构
- `styles.css` 响应式界面和地图/爬升图样式
- `config.js` 在线服务地址和超时配置
- `config.example.js` 可公开提交的配置模板，不放置密钥
- `app.js` 地点解析、途经点编辑、地理编码、POI 发现、骑行道路校路、高程、GPX 导入导出
- `src/api/` Overpass、OSRM、高程和请求超时适配层
- `src/route/` 风景评分、候选景点排序和结果展示
- `src/map/`、`src/state/`、`src/gpx/` 地图、状态和 GPX 的渐进式模块边界
- `scripts/build.mjs` 静态发布构建
- `scripts/smoke-check.mjs` 无依赖静态绑定检查
- `MVP_ROUTE_PLANNER.md` 路线算法、GPX 约定和风险说明
