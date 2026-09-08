import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const output = resolve(root, "dist");
const files = ["index.html", "styles.css", "app.js", "config.js", "README.md", "MVP_ROUTE_PLANNER.md"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map((file) => copyFile(resolve(root, file), resolve(output, file))));
console.log(`Built ${files.length} static files into ${output}`);
