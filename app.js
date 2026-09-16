/* app.js */
const WISP_URL = "wss://wisp-backend-weyl.onrender.com";
const BASE = "/testprox";

const EPOXY_MODULE = BASE + "/epoxy/index.mjs";
// pick the file that actually exists after your renames:
const LIBCURL_MODULE = BASE + "/libcurl/indexmjs.js";
const BAREMUX_WORKER = BASE + "/baremux/worker.js";
const SW_URL = BASE + "/sw.js";

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
  prefix: BASE + "/service/",
  files: {
    wasm: BASE + "/scramjet/scramjet.wasm.wasm",
    all:  BASE + "/scramjet/scramjet.all.js",
    sync: BASE + "/scramjet/scramjet.sync.js",
  },
  flags: {
    captureErrors: true,
    strictRewrites: true,
    rewriterLogs: false,
  },
});

let frame = null;
let connection = null;

function setStatus(t, bad = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = t;
  el.style.color = bad ? "#ff6b6b" : "#9aa";
}

function normalizeUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "https://example.com";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return "https://" + trimmed;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(trimmed);
}

/** Only delete $scramjet if it is empty / broken — never block init forever */
async function ensureScramjetDB() {
  const dbs = await indexedDB.databases?.() ?? [];
  const existing = dbs.find((d) => d.name === "$scramjet");
  if (!existing) return;

  // Peek at object stores without deleting first
  const stores = await new Promise((resolve) => {
    const req = indexedDB.open("$scramjet");
    req.onsuccess = () => {
      const db = req.result;
      const names = [...db.objectStoreNames];
      db.close();
      resolve(names);
    };
    req.onerror = () => resolve([]);
  });

  if (stores.length > 0) return; // healthy

  // Broken empty DB — delete with timeout so we never hang
  await Promise.race([
    new Promise((resolve) => {
      const del = indexedDB.deleteDatabase("$scramjet");
      del.onsuccess = del.onerror = del.onblocked = () => resolve();
    }),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

async function setTransport() {
  connection = new BareMux.BareMuxConnection(BAREMUX_WORKER);
  try {
    await connection.setTransport(EPOXY_MODULE, [{ wisp: WISP_URL }]);
    console.log("[proxy] transport = epoxy", WISP_URL);
  } catch (err) {
    console.warn("[proxy] epoxy failed, trying libcurl", err);
    await connection.setTransport(LIBCURL_MODULE, [{ wisp: WISP_URL }]);
    console.log("[proxy] transport = libcurl", WISP_URL);
  }
}

function navigate(raw) {
  const url = normalizeUrl(raw);
  const input = document.getElementById("url");
  if (input) input.value = url;
  if (!frame) return;
  setStatus("Loading " + url);
  try {
    frame.go(url);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  }
}

function toggleDevTools() {
  const win = frame?.frame?.contentWindow;
  if (!win) {
    setStatus("No page loaded for DevTools", true);
    return;
  }
  try {
    if (win.eruda) {
      win.eruda.show();
      return;
    }
    const script = win.document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => {
      win.eruda.init();
      win.eruda.show();
    };
    win.document.documentElement.appendChild(script);
  } catch (err) {
    // Cross-origin / still loading
    setStatus("DevTools unavailable for this page yet", true);
    console.warn(err);
  }
}

function openAboutBlank() {
  const w = window.open("about:blank", "_blank");
  if (!w) {
    setStatus("Popup blocked — allow popups", true);
    return;
  }

  // Clone current browser UI into about:blank so the address bar stays about:blank
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title> </title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: #121212; color: #eee; font-family: system-ui, sans-serif; }
    .wrap { display: flex; flex-direction: column; height: 100%; }
    .bar {
      display: flex; gap: 6px; align-items: center;
      padding: 10px 12px; background: #1e1e1e; border-bottom: 1px solid #333;
    }
    .bar button {
      background: #333; color: #fff; border: 0; border-radius: 6px;
      padding: 8px 12px; cursor: pointer; white-space: nowrap;
    }
    .bar button:hover { background: #444; }
    .bar input {
      flex: 1; background: #121212; color: #fff; border: 1px solid #333;
      border-radius: 6px; padding: 8px 10px; min-width: 0;
    }
    #status { font-size: 12px; color: #9aa; white-space: nowrap; }
    #frame { flex: 1; min-height: 0; background: #fff; }
    #frame iframe { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <button id="back" type="button">←</button>
      <button id="fwd" type="button">→</button>
      <button id="reload" type="button">↻</button>
      <input id="url" type="text" value="${(
        document.getElementById("url")?.value || "https://example.com"
      ).replace(/"/g, "&quot;")}" spellcheck="false" />
      <button id="go" type="button">Go</button>
      <button id="devtools" type="button">DEV</button>
      <span id="status">Loading…</span>
    </div>
    <div id="frame"></div>
  </div>
  <script src="${location.origin}/testprox/baremux/index.js"><\/script>
  <script src="${location.origin}/testprox/scramjet/scramjet.all.js"><\/script>
  <script src="${location.origin}/testprox/app.js"><\/script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

async function init() {
  if (!("serviceWorker" in navigator)) {
    setStatus("Service Workers not supported", true);
    return;
  }

  setStatus("Checking Scramjet DB…");
  try {
    await ensureScramjetDB();
  } catch (err) {
    console.warn("DB check failed", err);
  }

  setStatus("Starting Scramjet…");
  try {
    await scramjet.init();
  } catch (err) {
    // One retry after forced delete
    if (String(err.message || err).includes("object stores") ||
        String(err.message || err).includes("IDBDatabase")) {
      console.warn("IDB error, force-clear and retry");
      try {
        indexedDB.deleteDatabase("$scramjet");
      } catch {}
      await new Promise((r) => setTimeout(r, 400));
      await scramjet.init();
    } else {
      throw err;
    }
  }

  setStatus("Registering service worker…");
  await navigator.serviceWorker.register(SW_URL, { scope: BASE + "/" });
  await navigator.serviceWorker.ready;

  setStatus("Connecting transport…");
  await setTransport();

  const mount = document.getElementById("frame");
  frame = scramjet.createFrame();
  frame.frame.style.cssText = "width:100%;height:100%;border:0;background:#fff";
  frame.frame.setAttribute("title", "Proxied frame");
  mount.appendChild(frame.frame);

  frame.addEventListener?.("urlchange", (e) => {
    if (e?.url && e.url !== "about:blank") {
      const input = document.getElementById("url");
      if (input) input.value = e.url;
      setStatus("Ready");
    }
  });

  document.getElementById("go").onclick = () =>
    navigate(document.getElementById("url").value);
  document.getElementById("url").addEventListener("keydown", (e) => {
    if (e.key === "Enter") navigate(e.target.value);
  });
  document.getElementById("back").onclick = () => frame.back?.();
  document.getElementById("fwd").onclick = () => frame.forward?.();
  document.getElementById("reload").onclick = () => frame.reload?.();
  document.getElementById("devtools")?.addEventListener("click", toggleDevTools);
  document.getElementById("blank")?.addEventListener("click", openAboutBlank);

  setStatus("Ready");
}

init().catch((err) => {
  console.error(err);
  setStatus(err.message || String(err), true);
});