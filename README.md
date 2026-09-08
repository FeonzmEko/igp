# 景线 / IGP 风景骑行路线

一个浏览器端的风景优先骑行路线规划器。输入起点和终点后，工具会先定位地点，再用 OSRM cycling 生成可骑行道路轨迹；路线可以加入自动发现或手动排序的途经点，并把景点写入 GPX 航点，方便导入 IGP。

## 使用

直接双击 `index.html` 即可使用离线预览。完整在线能力建议使用本地静态服务器：

```powershell
npm run dev
```

访问 `http://localhost:4173`。发布前可运行：

```powershell
npm run check
npm run build
```

默认使用公开服务：Nominatim 地理编码、OSRM cycling 道路服务、Overpass 公共 POI 查询和 Open-Elevation 高程服务。公共服务可能限流或超时，页面会保留离线预览并明确提示。服务地址和超时可在 `config.js` 修改。

## 输入与导出

- 地点支持城市、车站、县城、景区、地址和 `纬度, 经度`。
- 可加入名称、地点或坐标形式的手动途经点，调整顺序、删除，或打开“地图加点”后直接点击路线地图。
- 内置了杭州西湖 -> 千岛湖、上海站 -> 海盐县的公开景点线索。
- 其他路线会尝试从 OpenStreetMap 公共 POI 找到观景台、湖岸、自然景观和历史点位，并按风景偏好评分。
- 在线模式会按手动途经点顺序校路；偏好骑行道路时请求会排除 motorway/trunk，道路服务若不支持该参数仍会明确保留提示。
- 导出的 GPX 1.1 同时包含完整 `trk` 轨迹、抽样 `rte` 路线点和景点 `wpt` 航点。
- 起终点定位失败时只能预览，导出按钮会保持禁用，避免把随机示意线当成导航文件。
- 导出时可选择 WGS84 或 GCJ-02；高程只在来源真实存在时写入 GPX，不会把缺失值写成 0 米。

## 目录

- `index.html` 页面结构
- `styles.css` 响应式界面和地图/爬升图样式
- `config.js` 在线服务地址和超时配置
- `app.js` 地点解析、途经点编辑、地理编码、POI 发现、OSRM 校路、高程、GPX 导入导出
- `scripts/build.mjs` 静态发布构建
- `scripts/smoke-check.mjs` 无依赖静态绑定检查
- `MVP_ROUTE_PLANNER.md` 路线算法、GPX 约定和风险说明
