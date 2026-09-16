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
 * Only true double-proxy, e.g.:
 * /service/https%3A%2F%2Fretropixel101.github.io%2Ftestprox%2Fservice%2Fhttps%253A%252F%252Fplay...
 * NOT normal /service/https%3A%2F%2Fexample.com
 */
function unwrapDoubleProxy(pathname) {
  if (!pathname.startsWith(PROXY_PREFIX)) return null;

  let rest = pathname.slice(PROXY_PREFIX.length);
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }

  // Must still contain our origin + proxy prefix after one decode
  const leakPrefix = ORIGIN + PROXY_PREFIX;
  if (!decoded.startsWith(leakPrefix) && !decoded.startsWith(PROXY_PREFIX)) {
    return null; // normal proxied URL — do nothing
  }

  // Strip outer leak layer(s)
  for (let i = 0; i < 5; i++) {
    if (decoded.startsWith(leakPrefix)) {
      decoded = decoded.slice(leakPrefix.length);
      try { decoded = decodeURIComponent(decoded); } catch {}
      continue;
    }
    if (decoded.startsWith(ORIGIN + "/")) {
      // still our site but not necessarily proxy — stop
      break;
    }
    if (decoded.startsWith(PROXY_PREFIX)) {
      decoded = decoded.slice(PROXY_PREFIX.length);
      try { decoded = decodeURIComponent(decoded); } catch {}
      continue;
    }
    break;
  }

  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    // Final sanity: must NOT still be our proxy
    if (decoded.startsWith(leakPrefix) || decoded.includes(PROXY_PREFIX)) {
      return null;
    }
    return decoded;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isStaticAsset(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const unwrapped = unwrapDoubleProxy(url.pathname);
        if (unwrapped) {
          const clean =
            ORIGIN + PROXY_PREFIX + encodeURIComponent(unwrapped) + (url.hash || "");
          // Only redirect if clean is actually different (avoid loops)
          if (clean !== url.href && !url.href.includes(encodeURIComponent(unwrapped))) {
            console.warn("[SW] unwrapped double-proxy →", unwrapped);
            return Response.redirect(clean, 302);
          }
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