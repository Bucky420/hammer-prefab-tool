const CACHE_PREFIX = "hammer-prefab-tool-";

async function removeScopeFromCache(cacheStorage, name, scope) {
  const cache = await cacheStorage.open(name);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => request.url.startsWith(scope))
      .map((request) => cache.delete(request)),
  );
  if ((await cache.keys()).length === 0) await cacheStorage.delete(name);
}

export async function removeLegacyServiceWorker(environment = globalThis) {
  const baseUrl = environment.document?.baseURI || environment.location?.href;
  const serviceWorker = environment.navigator?.serviceWorker;
  if (baseUrl && serviceWorker?.getRegistrations) {
    const scope = new URL("./", baseUrl).href;
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.scope === scope)
        .map((registration) => registration.unregister()),
    );
  }
  if (environment.caches?.keys) {
    const names = await environment.caches.keys();
    const scope = baseUrl ? new URL("./", baseUrl).href : null;
    if (scope)
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX))
          .map((name) => removeScopeFromCache(environment.caches, name, scope)),
      );
  }
}

if (typeof window !== "undefined") {
  void removeLegacyServiceWorker(window).catch((error) =>
    console.warn("[Hammer Prefab Tool] Legacy cache cleanup failed", error),
  );
}
