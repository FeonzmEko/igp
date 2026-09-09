import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const [html, source] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
]);

const requiredIds = [
  "route-form",
  "street-map",
  "locate-button",
  "swap-locations",
  "cancel-route-button",
  "waypoints-list",
  "map-add-toggle",
  "export-datum",
  "route-map",
  "export-button",
];

for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required element #${id}`);
  if (!source.includes(`#${id}`)) throw new Error(`app.js does not bind #${id}`);
}

if (!html.includes('src="config.js') || !html.includes('src="app.js')) throw new Error("Runtime scripts are not wired");
console.log("Static bindings and runtime scripts look valid");
