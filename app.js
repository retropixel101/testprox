/* public/app.js */
const WISP_URL = "wss://wisp-backend-weyl.onrender.com";

const BASE = "/testprox";
const EPOXY_MODULE = BASE + "/epoxy/index.mjs";
const LIBCURL_MODULE = BASE + "/libcurl/indexmjs.mjs";
const BAREMUX_WORKER = BASE + "/baremux/worker.js";
const SW_URL = BASE + "/sw.js";

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
  prefix: BASE + "/scramjet/",
  files: {
    wasm: BASE + "/scramjet/scramjet.wasm.wasm",
    all: BASE + "/scramjet/scramjet.all.js",
    sync: BASE + "/scramjet/scramjet.sync.js",
  },
  flags: {
    captureErrors: true,
    strictRewrites: true,
    rewriterLogs: false,
  },
});

let frame = null;

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "https://example.com";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return "https://" + trimmed;
}

function setStatus(t, bad = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = t;
  el.style.color = bad ? "#ff6b6b" : "#9aa";
}

async function resetScramjetDB() {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("$scramjet");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn("$scramjet delete blocked; close other tabs on this origin");
    };
  });
}

async function setTransport() {
  const connection = new BareMux.BareMuxConnection(BAREMUX_WORKER);
  try {
    await connection.setTransport(EPOXY_MODULE, [{ wisp: WISP_URL }]);
    console.log("[proxy] transport = epoxy", WISP_URL);
  } catch (err) {
    console.warn("[proxy] epoxy failed, falling back to libcurl", err);
    await connection.setTransport(LIBCURL_MODULE, [{ wisp: WISP_URL }]);
    console.log("[proxy] transport = libcurl", WISP_URL);
  }
}

async function init() {
  if (!("serviceWorker" in navigator)) {
    setStatus("No service worker support", true);
    throw new Error("serviceWorker missing");
  }

  // 1. Drop any empty $scramjet DB a previous SW created.
  setStatus("Resetting Scramjet DB…");
  try {
    await resetScramjetDB();
  } catch (err) {
    console.warn("could not delete $scramjet", err);
  }

  // 2. Create stores BEFORE the SW can open the DB.
  setStatus("Starting Scramjet…");
  await scramjet.init();

  // 3. Now it is safe to start the worker.
  setStatus("Registering service worker…");
  await navigator.serviceWorker.register(SW_URL, { scope: BASE + "/" });
  await navigator.serviceWorker.ready;

  setStatus("Connecting transport…");
  await setTransport();

  const mount = document.getElementById("frame");
  frame = scramjet.createFrame();
  frame.frame.style.width = "100%";
  frame.frame.style.height = "100%";
  frame.frame.style.border = "0";
  frame.frame.setAttribute("title", "Proxied frame");
  mount.appendChild(frame.frame);

  const input = document.getElementById("url");
  const go = () => {
    const url = normalizeUrl(input.value);
    input.value = url;
    frame.go(url);
  };

  document.getElementById("go").addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  document.getElementById("back").addEventListener("click", () => frame.back?.());
  document.getElementById("fwd").addEventListener("click", () => frame.forward?.());
  document.getElementById("reload").addEventListener("click", () => frame.reload?.());

  go();
  setStatus("Ready");
}

init().catch((err) => {
  console.error(err);
  setStatus(err.message || String(err), true);
});