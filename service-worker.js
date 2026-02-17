
const CACHE_NAME = "e3a-shell-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/awacs.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request, { cache: "no-store" });

    // Always update canonical index.html cache entry
    if (request.mode === "navigate") {
      const canonical = new Request(new URL("./index.html", self.location.href));
      await cache.put(canonical, fresh.clone());
    }

    return fresh;
  } catch (err) {
    // Robust fallback using absolute URL
    if (request.mode === "navigate") {
      const fallback = await cache.match(
        new Request(new URL("./index.html", self.location.href))
      );
      if (fallback) return fallback;
    }

    const cached = await cache.match(request);
    if (cached) return cached;

    throw err;
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;

  // HTML navigation → Network First
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Other assets → Stale While Revalidate
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(networkResp => {
        caches.open(CACHE_NAME).then(cache => {
          cache.put(req, networkResp.clone());
        });
        return networkResp;
      });
      return cached || fetchPromise;
    })
  );
});
