import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const output = resolve(root, "dist");
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "README.md",
  "MVP_ROUTE_PLANNER.md",
  "_headers",
  "manifest.webmanifest",
  "icon.svg",
  "sw.js",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map((file) => copyFile(resolve(root, file), resolve(output, file))));
const leafletOutput = resolve(output, "vendor", "leaflet");
await mkdir(leafletOutput, { recursive: true });
await Promise.all([
  copyFile(resolve(root, "node_modules", "leaflet", "dist", "leaflet.js"), resolve(leafletOutput, "leaflet.js")),
  copyFile(resolve(root, "node_modules", "leaflet", "dist", "leaflet.css"), resolve(leafletOutput, "leaflet.css")),
  cp(resolve(root, "node_modules", "leaflet", "dist", "images"), resolve(leafletOutput, "images"), { recursive: true }),
]);
console.log(`Built ${files.length} static files into ${output}`);
