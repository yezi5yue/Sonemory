import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { validatePack } from "../src/content.js";
import { samplePack } from "../src/sample-pack.js";

const required = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "src/app.js",
  "src/content.js",
  "src/engine.js",
  "src/notation.js",
  "src/speech.js",
  "src/storage.js",
  "src/styles.css",
  "README.md",
  "LICENSE",
  "TRADEMARKS.md"
];

const missing = required.filter((file) => !existsSync(file));
if (missing.length) throw new Error(`Missing required files: ${missing.join(", ")}`);

for (const file of required.filter((path) => path.endsWith(".js") || path.endsWith(".mjs"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${file} failed syntax check:\n${result.stderr}`);
}

const html = readFileSync("index.html", "utf8");
for (const id of ["start-session", "pause-session", "pack-form", "csv-input", "history-list"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`index.html is missing #${id}`);
}

const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
if (manifest.name !== "Sonemory · 声声入忆") throw new Error("Unexpected manifest name");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const serviceWorker = readFileSync("service-worker.js", "utf8");
const versionTag = `v=${packageJson.version}`;
if (!html.includes(versionTag)) throw new Error("index.html asset version does not match package.json");
if (!serviceWorker.includes(`sonemory-v${packageJson.version}`)) {
  throw new Error("service-worker cache version does not match package.json");
}
if (!serviceWorker.includes(versionTag)) throw new Error("service-worker assets are missing the current version tag");
validatePack(samplePack);

console.log(`Static checks passed (${required.length} required files, valid sample pack).`);
