/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

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
  "LICENSING.md",
  "COMMERCIAL-LICENSE.md",
  "CLA.md",
  ".github/pull_request_template.md",
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
if (packageJson.license !== "AGPL-3.0-only") throw new Error("Unexpected package license");

const license = readFileSync("LICENSE", "utf8");
if (!license.startsWith("GNU AFFERO GENERAL PUBLIC LICENSE") ||
    !license.includes("Version 3, 19 November 2007")) {
  throw new Error("LICENSE is not the canonical GNU AGPL v3 text");
}

const licensing = readFileSync("LICENSING.md", "utf8");
if (!licensing.includes("AGPL-3.0-only") || !/commercial license/i.test(licensing)) {
  throw new Error("LICENSING.md is missing the dual-license paths");
}

const serviceWorker = readFileSync("service-worker.js", "utf8");
const versionTag = `v=${packageJson.version}`;
if (!html.includes(versionTag)) throw new Error("index.html asset version does not match package.json");
for (const file of required.filter((path) => path.startsWith("src/") && path.endsWith(".js"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\?v=([\d.]+)/g)) {
    if (match[1] !== packageJson.version) {
      throw new Error(`${file} imports asset version ${match[1]}, expected ${packageJson.version}`);
    }
  }
}
if (!serviceWorker.includes(`sonemory-v${packageJson.version}`)) {
  throw new Error("service-worker cache version does not match package.json");
}
if (!serviceWorker.includes(versionTag)) throw new Error("service-worker assets are missing the current version tag");
validatePack(samplePack);

console.log(`Static checks passed (${required.length} required files, valid sample pack).`);
