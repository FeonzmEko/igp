const GPX_NS = "http://www.topografix.com/GPX/1/1";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serialize a validated route using the GPX 1.1 track contract. */
export function buildGpxDocument(route = {}, { datum = "wgs84", serializeCoordinate = (point) => ({ lat: Number(point.lat).toFixed(6), lon: Number(point.lon).toFixed(6) }), supportStops = [] } = {}) {
  const points = Array.isArray(route.points) ? route.points : [];
  const elevationTag = (point) => point.hasElevation && Number.isFinite(point.ele) ? `<ele>${point.ele.toFixed(1)}</ele>` : "";
  const pointTag = (point, kind) => { const coordinate = serializeCoordinate(point, datum); return `      <${kind} lat="${coordinate.lat}" lon="${coordinate.lon}">${elevationTag(point)}</${kind}>`; };
  const track = points.map((point) => pointTag(point, "trkpt")).join("\n");
  const routePoints = points.filter((_, index) => index % 4 === 0 || index === points.length - 1).map((point) => pointTag(point, "rtept")).join("\n");
  const waypoints = [...(route.stops || []), ...supportStops].map((stop) => {
    const coordinate = serializeCoordinate(stop, datum);
    const link = stop.sourceUrl ? `\n    <link href="${escapeXml(stop.sourceUrl)}"><text>${escapeXml(stop.source || "公开资料线索")}</text></link>` : "";
    return `  <wpt lat="${coordinate.lat}" lon="${coordinate.lon}">${elevationTag(stop)}\n    <name>${escapeXml(stop.name)}</name>\n    <desc>${escapeXml(`${stop.type} · ${stop.note} · 线索：${stop.source || "公开资料"}`)}</desc>${link}\n    <type>${escapeXml(stop.gpxType || "scenic")}</type>\n  </wpt>`;
  }).join("\n");
  const name = escapeXml(route.routeName || "Scenic route");
  const description = escapeXml(`风景偏好 ${route.scenic}/100 · 最多绕行 ${route.detour}% · ${route.bikeFriendly ? "偏好骑行道路" : "常规道路"} · 坐标基准 ${datum === "gcj02" ? "GCJ-02" : "WGS84"}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Jingxian IGP Scenic Route Lab" xmlns="${GPX_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${GPX_NS} ${GPX_NS}/gpx.xsd">\n  <metadata><name>${name}</name><desc>${description}</desc><time>${new Date().toISOString()}</time></metadata>\n${waypoints}\n  <rte><name>${name}</name><type>cycling</type>\n${routePoints}\n  </rte>\n  <trk><name>${name}</name><type>cycling</type><trkseg>\n${track}\n  </trkseg></trk>\n</gpx>\n`;
}

export { escapeXml };
