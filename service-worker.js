// E-3A Quick Planner Service Worker
// Strategy:
// - Precache core shell on install (offline-first boot).
// - Network-first for HTML navigations (always try to get the newest index.html).
// - Stale-while-revalidate for static assets (fast, but updates itself in background).
// - Auto-activate new SW (skipWaiting + clients.claim).

const CACHE_NAME = "e3a-quick-planner-cache";
const CORE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/awacs.png"
];

// Install: cache the core app shell so it works offline even after reboot.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_URLS))
  );
});

// Activate: clean up old caches (in case CACHE_NAME ever changes) and take control.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html")
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".ico")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // "no-store" forces an actual network check while online (important for HTML updates)
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && (fresh.status === 200 || fresh.type === "opaque")) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;

    // Last resort: for navigations, fall back to cached app shell
    if (isNavigationRequest(request)) {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false });

  const fetchPromise = fetch(request)
    .then(async (resp) => {
      if (resp && (resp.status === 200 || resp.type === "opaque")) {
        await cache.put(request, resp.clone());
      }
      return resp;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || cached;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests (GitHub Pages origin)
  if (url.origin !== self.location.origin) return;

  // HTML / app shell: always try network first
  if (isNavigationRequest(req) || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Static assets: fast cache, refresh in background
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: network-first with cache fallback
  event.respondWith(networkFirst(req));
});
