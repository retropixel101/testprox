// sw.js
importScripts("/testprox/scramjet/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

const BASE = "/testprox";
const PROXY_PREFIX = BASE + "/service/";
const ORIGIN = self.location.origin;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function isStaticAsset(path) {
  if (path === BASE + "/sw.js") return true;
  if (path === BASE + "/" || path === BASE + "/index.html" || path === BASE + "/app.js") return true;
  if (path.startsWith(BASE + "/baremux/")) return true;
  if (path.startsWith(BASE + "/epoxy/")) return true;
  if (path.startsWith(BASE + "/libcurl/")) return true;
  if (path.startsWith(BASE + "/scramjet/")) return true;
  if (path.endsWith(".map")) return true;
  return false;
}

/**
 * If a site leaked the real origin, the path becomes:
 * /testprox/service/https%3A%2F%2Fretropixel101.github.io%2Ftestprox%2Fservice%2Fhttps%253A%252F%252Fplay...
 * Unwrap until we get a normal https URL.
 */
function unwrapProxiedTarget(path) {
  if (!path.startsWith(PROXY_PREFIX)) return null;

  let rest = path.slice(PROXY_PREFIX.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {}

  // Keep unwrapping while it points back at our own proxy
  for (let i = 0; i < 5; i++) {
    if (rest.startsWith(ORIGIN + PROXY_PREFIX)) {
      rest = rest.slice((ORIGIN + PROXY_PREFIX).length);
      try {
        rest = decodeURIComponent(rest);
      } catch {}
      continue;
    }
    if (rest.startsWith(PROXY_PREFIX)) {
      rest = rest.slice(PROXY_PREFIX.length);
      try {
        rest = decodeURIComponent(rest);
      } catch {}
      continue;
    }
    break;
  }

  if (rest.startsWith("http://") || rest.startsWith("https://")) {
    return rest;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname + url.search + url.hash;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const unwrapped = unwrapProxiedTarget(url.pathname + url.search);
        if (unwrapped) {
          // Rebuild as a single, correct proxy request
          const clean =
            ORIGIN +
            PROXY_PREFIX +
            encodeURIComponent(unwrapped) +
            (url.hash || "");
          console.warn("[SW] unwrapped double-proxy →", unwrapped);
          return Response.redirect(clean, 302);
        }

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