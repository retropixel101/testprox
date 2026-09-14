/* public/app.js */
const WISP_URL = "wss://wisp-backend-weyl.onrender.com";

const EPOXY_MODULE = "/testprox/epoxy/index.mjs";
const LIBCURL_MODULE = "/testprox/libcurl/index.mjs";
const BAREMUX_WORKER = "/testprox/baremux/worker.js";

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
  prefix: "/testprox/scramjet/",
  files: {
    wasm: "/testprox/scramjet/scramjet.wasm.wasm",
    all: "/testprox/scramjet/scramjet.all.js",
    sync: "/testprox/scramjet/scramjet.sync.js",
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

async function setTransport(connection) {
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
  const status = document.getElementById("status");
  const setStatus = (t, bad = false) => {
    status.textContent = t;
    status.style.color = bad ? "#ff6b6b" : "#9aa";
  };

  if (!("serviceWorker" in navigator)) {
    setStatus("No service worker support", true);
    throw new Error("serviceWorker missing");
  }

  setStatus("Registering service worker…");
  await navigator.serviceWorker.register("/testprox/sw.js")
  await navigator.serviceWorker.ready;

  setStatus("Connecting transport…");
  const connection = new BareMux.BareMuxConnection(BAREMUX_WORKER);
  await setTransport(connection);

  setStatus("Starting Scramjet…");
  await scramjet.init();

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
  const status = document.getElementById("status");
  if (status) {
    status.textContent = err.message || String(err);
    status.style.color = "#ff6b6b";
  }
});