/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const CACHE = "sonemory-v0.1.1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./src/styles.css?v=0.1.1",
  "./src/app.js?v=0.1.1",
  "./src/content.js?v=0.1.1",
  "./src/engine.js?v=0.1.1",
  "./src/notation.js?v=0.1.1",
  "./src/sample-pack.js?v=0.1.1",
  "./src/speech.js?v=0.1.1",
  "./src/storage.js?v=0.1.1"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          return (await caches.match("./index.html")) ?? Response.error();
        }
        return Response.error();
      })
  );
});

