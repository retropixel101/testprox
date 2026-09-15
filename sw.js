// sw.js
importScripts("/testprox/scramjet/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

const PREFIX = "/testprox/scramjet/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  // Never proxy our own static runtime files
  const isStaticAsset =
    path === "/testprox/sw.js" ||
    path.startsWith("/testprox/baremux/") ||
    path.startsWith("/testprox/epoxy/") ||
    path.startsWith("/testprox/libcurl/") ||
    path === "/testprox/scramjet/scramjet.all.js" ||
    path === "/testprox/scramjet/scramjet.sync.js" ||
    path === "/testprox/scramjet/scramjet.wasm.wasm" ||
    path === "/testprox/scramjet/scramjet.bundle.js" ||
    path.endsWith(".map");

  if (isStaticAsset) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        await scramjet.loadConfig();
        if (scramjet.route(event)) {
          return await scramjet.fetch(event);
        }
      } catch (err) {
        console.warn("[SW] Scramjet error, network fallback:", err);
      }
      return fetch(event.request);
    })()
  );
});