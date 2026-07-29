"use strict";

const RETIREMENT_VERSION = "updates-retired-v1";
const CACHE_PREFIX = "hammer-prefab-tool-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const scope = self.registration.scope;
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX))
          .map(async (name) => {
            const cache = await caches.open(name);
            const requests = await cache.keys();
            await Promise.all(
              requests
                .filter((request) => request.url.startsWith(scope))
                .map((request) => cache.delete(request)),
            );
            if ((await cache.keys()).length === 0) await caches.delete(name);
          }),
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients)
        client.postMessage({
          type: "UPDATE_ACTIVATED",
          version: RETIREMENT_VERSION,
        });
      await self.registration.unregister();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION")
    event.ports?.[0]?.postMessage({
      type: "VERSION",
      version: RETIREMENT_VERSION,
    });
  if (event.data?.type === "ACTIVATE_UPDATE") void self.skipWaiting();
});
