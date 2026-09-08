# Scenic-first cycling route planner: MVP design

The repository started empty (only `.git` exists), so the MVP is implemented as a static browser app with no backend or account system. Open `index.html` directly or run any local static server.

## User flow

1. Enter start and end locations (or paste latitude/longitude).
2. Add, remove, and reorder scenic waypoints. The MVP can provide a curated sample list and allow map clicks; automatic POI discovery is optional.
3. Choose a route profile: `Scenic`, `Balanced`, or `Direct`. Set a maximum detour ratio (default 20%) and optional avoidances (highway, ferry, unpaved).
4. Request a road route for each consecutive leg, preview the polyline and elevation/distance summary, then download a GPX file for import into IGP.

The app should make the route's trade-off visible: total distance/time, direct-route baseline, detour percentage, and named scenic stops.

## Implemented stack

- Plain HTML/CSS/JavaScript keeps the prototype usable offline and easy to hand to a rider.
- The route preview is an inline SVG so a missing tile provider does not hide the route.
- Routing uses the public OSRM cycling endpoint when enabled; it falls back to the local preview when the network is unavailable and drops low-priority scenic stops when the requested detour budget would be exceeded.
- Users can add, remove, reorder, and map-pick explicit waypoints. Automatic POI candidates are ranked by scenery weight and distance offset.
- GPX 1.1 export and import are implemented with a small XML serializer/parser. Imported `trkpt`, `rtept`, and `wpt` elements are validated before display/export.
- Elevation is fetched from the configured Open-Elevation-compatible endpoint for online routes when available. Missing GPX elevation remains absent and is never serialized as a measured zero.
- The built-in Hangzhou -> Qiandao Lake example includes researched scenic leads from publicly indexed Xiaohongshu/Douyin and cycling-route posts. These are labelled as leads and require access/road-condition confirmation.

## Route selection algorithm

Do not ask the router for one “scenic” route; ordinary routing engines do not score scenery. Build a route from explicit waypoints:

- Get a direct baseline from start to end.
- For each selected waypoint, route start -> waypoint(s) -> end, preserving the user's order. Merge leg geometries and remove the duplicate join coordinate.
- Compute detour = `(scenicDistance / directDistance) - 1`. Reject or warn when it exceeds the selected limit.
- Rank candidate POIs with scenery weight and distance offset, then try candidates while respecting the detour budget. User-provided waypoints take precedence and keep their order.

The route response is validated before display/export: at least two coordinates, finite numeric longitude/latitude, and a successful OSRM response. If a waypoint chain cannot be routed, the planner drops lower-priority trailing stops and retries; a fully failed request remains preview-only and is clearly labelled.

## GPX export contract for IGP

Export standard GPX 1.1 in WGS84 decimal degrees. Use a track (`trk/trkseg/trkpt`) rather than only a route list so IGP and other cycling apps can follow the exact road geometry.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Scenic Cycling Planner"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1
       http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>Scenic route</name></metadata>
  <wpt lat="..." lon="..."><name>Scenic stop</name></wpt>
  <trk><name>Scenic route</name><trkseg>
    <trkpt lat="..." lon="..."><ele>...</ele></trkpt>
  </trkseg></trk>
</gpx>
```

Use XML escaping for names and descriptions. Preserve elevation only when the route or GPX source provides it; never emit `NaN` or a made-up zero elevation as if it were measured. Add waypoints (`wpt`) for scenic stops so they remain visible after import. Offer WGS84 and explicit GCJ-02 export choices, a filename ending in `.gpx`, and a UTF-8 Blob download.

China coordinate-system risk: OSM/OSRM and GPX convention use WGS84, while AMap/IGP displays GCJ-02 in mainland China. The export choice is explicit and labelled; conversion is skipped outside mainland China.

## Current module boundaries

```text
index.html                # layout and controls
styles.css                # responsive visual system
config.js                 # runtime provider endpoints
app.js                    # state wiring, route model, providers, SVG and GPX
scripts/build.mjs         # static publish build
scripts/smoke-check.mjs   # dependency-free binding check
```

The route and GPX helpers remain browser-local and validate data before rendering or export. The current plan is stored in `localStorage`; no backend is needed for this MVP.

## Run and verification

Provide `npm run dev`, `npm run build`, and `npm run check` scripts. Runtime configuration uses `config.js`, with public defaults documented. Verify with `npm run check`, then manually that a generated file:

- parses as XML and contains GPX 1.1 namespace;
- has `trkpt` coordinates in `lat/lon` order and no duplicate join explosion;
- includes scenic `wpt` entries;
- imports into an IGP test device/app and displays the expected region.

## Main risks and mitigations

- Public routing/geocoding quotas or CORS: show provider errors, debounce requests, and keep endpoints configurable; a self-hosted provider is the production path.
- Coordinate mismatch in China: make datum explicit and provide a short import note.
- Scenic ranking quality: automatic candidates are still suggestions; user-confirmed waypoints and current access checks remain necessary.
- Long routes creating huge GPX files: simplify only for display, preserve the full route for export, and cap/stream points if a provider returns an extreme count.
- Route legality and surface: show provider metadata when available and warn that the user must verify traffic restrictions, road closures, and private roads.
