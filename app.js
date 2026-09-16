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
  const raw = document.getElementById("url")?.value || "https://example.com";
  const url = normalizeUrl(raw);
  const encoded = scramjet.encodeUrl
    ? scramjet.encodeUrl(url)
    : location.origin + BASE + "/service/" + encodeURIComponent(url);

  const w = window.open("about:blank", "_blank");
  if (!w) {
    setStatus("Popup blocked — allow popups", true);
    return;
  }

  w.document.open();
  w.document.write(
    `<!DOCTYPE html><html><head><title> </title>
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:#111}</style>
</head><body>
<iframe src="${encoded}" allow="fullscreen"></iframe>
</body></html>`
  );
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