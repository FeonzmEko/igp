import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");
const origin = "https://jingxian.example";
const currentCache = "jingxian-shell-v4";
const keyOf = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
const html = (body) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const javascript = (body) => new Response(body, { headers: { "Content-Type": "application/javascript" } });

function harness() {
  const listeners = new Map();
  const stores = new Map();
  const fetched = [];
  const precached = [];
  const deleted = [];
  let claimed = false;
  let skipped = false;
  let fetchResponse = async () => html("fresh page");
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      addAll: async (requests) => {
        precached.push(...requests);
      },
      match: async (request) => store.get(keyOf(request))?.clone(),
      put: async (request, response) => store.set(keyOf(request), response.clone()),
    };
  };
  vm.runInNewContext(source, {
    self: {
      location: { origin },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async (name) => cacheFor(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => { deleted.push(name); return stores.delete(name); },
    },
    fetch: async (request, options) => {
      fetched.push({ request, options });
      return fetchResponse(request);
    },
    Request, Response, URL,
  });
  return {
    fetched, precached, deleted,
    get claimed() { return claimed; },
    get skipped() { return skipped; },
    setFetch: (handler) => { fetchResponse = handler; },
    seed: async (path, response, name = currentCache) => cacheFor(name).put(path, response),
    cached: (path, name = currentCache) => cacheFor(name).match(path),
    lifecycle: async (name) => {
      let pending;
      listeners.get(name)({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    request: async (path, { mode = "cors", method = "GET" } = {}) => {
      let pending;
      listeners.get("fetch")({
        request: { url: new URL(path, origin).href, mode, method },
        respondWith: (promise) => { pending = promise; },
      });
      return pending ? await pending : null;
    },
  };
}

test("install revalidates the application shell and activates the new worker", async () => {
  const worker = harness();
  await worker.lifecycle("install");
  assert.ok(worker.precached.some((request) => new URL(request.url).pathname === "/index.html"));
  assert.ok(worker.precached.some((request) => new URL(request.url).pathname === "/src/api/geocoder.js"));
  assert.ok(worker.precached.every((request) => request.cache === "reload"));
  assert.equal(worker.skipped, true);
});

test("activation only deletes old caches owned by this application", async () => {
  const worker = harness();
  await worker.seed("/index.html", html("old"), "jingxian-shell-v1");
  await worker.seed("/index.html", html("new"));
  await worker.seed("/index.html", html("unrelated"), "another-app-cache");
  await worker.lifecycle("activate");
  assert.deepEqual(worker.deleted, ["jingxian-shell-v1"]);
  assert.equal(await (await worker.cached("/index.html", "another-app-cache")).text(), "unrelated");
  assert.equal(worker.claimed, true);
});

test("online navigation replaces a cached page with the latest response", async () => {
  const worker = harness();
  await worker.seed("/index.html", html("old page"));
  const response = await worker.request("/", { mode: "navigate" });
  assert.equal(await response.text(), "fresh page");
  assert.equal(await (await worker.cached("/index.html")).text(), "fresh page");
  assert.equal(worker.fetched[0].options.cache, "no-cache");
});

test("versioned assets use the network first and retain a canonical offline copy", async () => {
  const worker = harness();
  await worker.seed("/app.js", javascript("old script"));
  worker.setFetch(async () => javascript("fresh script"));
  assert.equal(await (await worker.request("/app.js?v=3")).text(), "fresh script");
  worker.setFetch(async () => { throw new Error("offline"); });
  assert.equal(await (await worker.request("/app.js?v=4")).text(), "fresh script");
});

test("only navigations fall back to index.html when offline", async () => {
  const worker = harness();
  await worker.seed("/index.html", html("offline page"));
  worker.setFetch(async () => { throw new Error("offline"); });
  assert.equal(await (await worker.request("/ride", { mode: "navigate" })).text(), "offline page");
  const script = await worker.request("/app.js");
  const stylesheet = await worker.request("/styles.css");
  assert.equal(script.type, "error");
  assert.equal(stylesheet.type, "error");
  assert.equal(await script.text(), "");
});

test("HTML and failed HTTP responses cannot poison a cached script", async () => {
  const worker = harness();
  await worker.seed("/app.js", javascript("valid script"));
  worker.setFetch(async () => html("incorrect asset fallback"));
  await worker.request("/app.js");
  assert.equal(await (await worker.cached("/app.js")).text(), "valid script");
  worker.setFetch(async () => new Response("unavailable", { status: 503 }));
  assert.equal((await worker.request("/app.js")).status, 503);
  assert.equal(await (await worker.cached("/app.js")).text(), "valid script");
});

test("cross-origin, non-GET and non-shell requests are not intercepted", async () => {
  const worker = harness();
  assert.equal(await worker.request("https://jingxian.example.evil.test/app.js"), null);
  assert.equal(await worker.request("/app.js", { method: "POST" }), null);
  assert.equal(await worker.request("/api/route"), null);
  assert.equal(worker.fetched.length, 0);
});

test("headers permit same-origin location and revalidation of stable resource URLs", () => {
  assert.match(headers, /Permissions-Policy:\s*geolocation=\(self\),\s*microphone=\(\),\s*camera=\(\)/);
  assert.match(headers, /Cache-Control:\s*no-cache/);
});
