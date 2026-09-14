// sw.js
importScripts("/testprox/scramjet/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never let Scramjet break its own static files
  const isOwnAsset =
    url.pathname.startsWith("/testprox/baremux/") ||
    url.pathname.startsWith("/testprox/epoxy/") ||
    url.pathname.startsWith("/testprox/scramjet/") ||
    url.pathname === "/testprox/sw.js" ||
    url.pathname === "/testprox/" ||
    url.pathname === "/testprox/index.html";

  if (isOwnAsset) {
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
        console.warn("[SW] Scramjet error, falling back to network:", err);
      }
      return fetch(event.request);
    })()
  );
});