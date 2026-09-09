const CACHE_PREFIX = "jingxian-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const APP_SHELL = [
  "/index.html",
  "/styles.css",
  "/config.js",
  "/config.example.js",
  "/app.js",
  "/src/api/http.js",
  "/src/api/osm.js",
  "/src/api/osrm.js",
  "/src/api/elevation.js",
  "/src/route/planner.js",
  "/src/route/scenic.js",
  "/src/route/presentation.js",
  "/src/gpx/exporter.js",
  "/src/map/map.js",
  "/src/state/store.js",
  "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/images/layers.png",
  "/vendor/leaflet/images/layers-2x.png",
  "/vendor/leaflet/images/marker-icon.png",
  "/vendor/leaflet/images/marker-icon-2x.png",
  "/vendor/leaflet/images/marker-shadow.png",
  "/manifest.webmanifest",
  "/icon.svg",
];
const SHELL_PATHS = new Set(APP_SHELL);

self.addEventListener("install", (event) => {
  const requests = APP_SHELL.map((path) => new Request(new URL(path, self.location.origin), { cache: "reload" }));
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

async function networkFirst(request, fallbackPath, navigation) {
  let response;
  try {
    response = await fetch(request, { cache: "no-cache" });
  } catch (_error) {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(fallbackPath)) || Response.error();
  }

  const isHtml = (response.headers.get("Content-Type") || "").toLowerCase().includes("text/html");
  if (response.ok && isHtml === navigation) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(fallbackPath, response.clone());
    } catch (_error) {
      // A full or unavailable cache must not hide a successful network response.
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "/index.html", true));
  } else if (SHELL_PATHS.has(url.pathname) && url.pathname !== "/index.html") {
    event.respondWith(networkFirst(event.request, url.pathname, false));
  }
});
