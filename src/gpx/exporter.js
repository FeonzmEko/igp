const GPX_NS = "http://www.topografix.com/GPX/1/1";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceMeters(a, b) {
  const latA = finiteNumber(a?.lat);
  const lonA = finiteNumber(a?.lon);
  const latB = finiteNumber(b?.lat);
  const lonB = finiteNumber(b?.lon);
  if ([latA, lonA, latB, lonB].some((number) => number === null)) return Infinity;
  const radians = Math.PI / 180;
  const h = Math.sin((latB - latA) * radians / 2) ** 2
    + Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin((lonB - lonA) * radians / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function cumulativeMeters(points) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + distanceMeters(points[index - 1], points[index]));
  }
  return distances;
}

// Choose a vertex already present in the track. Never route through a POI's
// original coordinate: an independent waypoint may be across a river or off-road.
function matchTrackPoint(stop, points, distances, minimumPosition = 0) {
  let closest = Infinity;
  let matches = [];
  for (let index = Math.min(Math.floor(minimumPosition), points.length - 2); index >= 0 && index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const scale = Math.cos((a.lat + b.lat) * Math.PI / 360);
    const dx = (b.lon - a.lon) * scale;
    const dy = b.lat - a.lat;
    const dot = (stop.lon - a.lon) * scale * dx + (stop.lat - a.lat) * dy;
    const ratio = Math.max(Math.max(0, minimumPosition - index), Math.min(1, dot / (dx * dx + dy * dy || 1)));
    const projected = { lat: a.lat + (b.lat - a.lat) * ratio, lon: a.lon + (b.lon - a.lon) * ratio };
    const distance = distanceMeters(stop, projected);
    if (!Number.isFinite(distance)) continue;
    if (distance < closest) {
      closest = distance;
      matches = matches.filter((match) => match.distance <= closest + 1);
    }
    if (distance <= closest + 1) matches.push({
      index: index + (ratio < 0.5 ? 0 : 1),
      position: index + ratio,
      alongMeters: distances[index] + (distances[index + 1] - distances[index]) * ratio,
      distance,
    });
  }
  if (!matches.length) return null;
  const km = finiteNumber(stop.km);
  const indexHint = finiteNumber(stop.index);
  // Progress hints only break spatial ties. Forward matching takes precedence
  // over stale indices pointing to an earlier pass through a loop.
  const validKm = km !== null && km * 1000 >= distances[Math.floor(minimumPosition)] && km * 1000 <= distances.at(-1) + 1;
  const validIndex = Number.isInteger(indexHint) && indexHint >= Math.floor(minimumPosition) && indexHint < points.length;
  matches.sort((a, b) => {
    if (validKm) {
      const difference = Math.abs(a.alongMeters - km * 1000) - Math.abs(b.alongMeters - km * 1000);
      if (difference) return difference;
    }
    if (validIndex) {
      const difference = Math.abs(a.index - indexHint) - Math.abs(b.index - indexHint);
      if (difference) return difference;
    }
    return a.distance - b.distance || a.position - b.position;
  });
  return matches[0];
}

function buildPointAnnotations(route, points, supportStops) {
  const annotations = new Map();
  const distances = cumulativeMeters(points);
  const add = (index, name, description = "") => {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) return;
    const entry = annotations.get(index) || { names: [], descriptions: [] };
    if (!entry.names.includes(trimmed)) entry.names.push(trimmed);
    if (description && !entry.descriptions.includes(description)) entry.descriptions.push(description);
    annotations.set(index, entry);
  };
  points.forEach((point, index) => add(index, point.name, point.description));
  if (points.length) {
    if (!points[0].name) add(0, route.start?.label);
    if (!points.at(-1).name) add(points.length - 1, route.end?.label);
  }
  let minimumPosition = 0;
  const addStop = (stop, ordered) => {
    const match = matchTrackPoint(stop, points, distances, ordered ? minimumPosition : 0);
    if (!match) return;
    // A fallback route may retain a POI that could not be connected to the
    // road geometry. Keep its independent <wpt>, but do not make the device
    // display it as if the track actually passed there.
    if (match.distance > 500) return;
    if (ordered) minimumPosition = match.position;
    const description = [stop.type, stop.note || stop.description].filter(Boolean).join(" · ");
    const offset = match.distance > 20
      ? `路线附近提示：${stop.name || "航点"}距道路轨迹约 ${Math.round(match.distance)} 米，实际位置见独立航点。`
      : "";
    add(match.index, offset ? `附近：${stop.name || "航点"}` : stop.name, [description, offset].filter(Boolean).join(" · "));
  };
  // Planned stops are ordered by the requested journey. Imported independent
  // wpt elements and supply discoveries need not be sorted by travel order.
  (Array.isArray(route.stops) ? route.stops : []).forEach((stop) => addStop(stop, !route.imported && route.source !== "gpx"));
  supportStops.forEach((stop) => addStop(stop, false));
  return annotations;
}

/** GPX 1.1: full geometry in both rte/trk, with standard point names and wpt POIs. */
export function buildGpxDocument(route = {}, { datum = "wgs84", serializeCoordinate = (point) => ({ lat: Number(point.lat).toFixed(6), lon: Number(point.lon).toFixed(6) }), supportStops = [] } = {}) {
  const points = Array.isArray(route.points) ? route.points : [];
  const annotations = buildPointAnnotations(route, points, supportStops);
  const elevationTag = (point) => point.hasElevation && Number.isFinite(point.ele) ? `<ele>${point.ele.toFixed(1)}</ele>` : "";
  const pointTag = (point, kind, index) => {
    const coordinate = serializeCoordinate(point, datum);
    const annotation = annotations.get(index);
    const name = annotation?.names.length ? `<name>${escapeXml(annotation.names.join(" / "))}</name>` : "";
    const description = annotation?.descriptions.length ? `<desc>${escapeXml(annotation.descriptions.join("；"))}</desc>` : "";
    return `      <${kind} lat="${escapeXml(coordinate.lat)}" lon="${escapeXml(coordinate.lon)}">${elevationTag(point)}${name}${description}</${kind}>`;
  };
  const track = points.map((point, index) => pointTag(point, "trkpt", index)).join("\n");
  const routePoints = points.map((point, index) => pointTag(point, "rtept", index)).join("\n");
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
