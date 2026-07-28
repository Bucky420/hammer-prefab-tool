"use strict";

const BUILD_ID = "__HAMMER_BUILD_ID__";
const CACHE_PREFIX = "hammer-prefab-tool-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const RETAINED_GENERATIONS = 3;
const CLIENT_VERSION_TIMEOUT = 500;
const VERSION_URL = new URL("version.json", self.registration.scope).href;
const INDEX_URL = new URL("index.html", self.registration.scope).href;

function validManifestFile(file) {
  if (
    typeof file !== "string" ||
    !file ||
    file.startsWith("/") ||
    file.includes("..")
  )
    return false;
  return new URL(file, self.registration.scope).origin === self.location.origin;
}

async function stageBuild() {
  const versionResponse = await fetch(VERSION_URL, { cache: "reload" });
  if (!versionResponse.ok)
    throw new Error(
      `Version metadata request failed (${versionResponse.status})`,
    );
  const version = await versionResponse.clone().json();
  if (version?.id !== BUILD_ID)
    throw new Error("Service worker and version metadata do not match");
  if (!Array.isArray(version.files) || !version.files.includes("index.html"))
    throw new Error("Build manifest is incomplete");
  if (!version.files.every(validManifestFile))
    throw new Error("Build manifest contains an unsafe path");

  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all(
      version.files.map(async (file) => {
        const request = new Request(new URL(file, self.registration.scope), {
          cache: "reload",
        });
        const response = await fetch(request);
        if (!response.ok)
          throw new Error(`${file} request failed (${response.status})`);
        await cache.put(request, response);
      }),
    );
    await cache.put(VERSION_URL, versionResponse);
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await stageBuild();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") void self.skipWaiting();
  if (event.data?.type === "GET_VERSION")
    event.ports?.[0]?.postMessage({ type: "VERSION", version: BUILD_ID });
});

async function requestClientVersion(client) {
  if (typeof MessageChannel === "undefined") return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (version) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.close();
      resolve(version);
    };
    const timeout = setTimeout(() => finish(null), CLIENT_VERSION_TIMEOUT);
    channel.port1.onmessage = (event) => finish(event.data?.version || null);
    client.postMessage({ type: "GET_CLIENT_VERSION" }, [channel.port2]);
  });
}

async function pruneBuildCaches(clients) {
  const names = (await caches.keys()).filter((name) =>
    name.startsWith(CACHE_PREFIX),
  );
  const clientVersions = await Promise.all(clients.map(requestClientVersion));
  const protectedCaches = new Set([
    CACHE_NAME,
    ...clientVersions
      .filter(Boolean)
      .map((version) => `${CACHE_PREFIX}${version}`)
      .filter((name) => names.includes(name)),
  ]);
  for (const name of [...names].reverse()) {
    if (protectedCaches.size >= RETAINED_GENERATIONS) break;
    protectedCaches.add(name);
  }
  await Promise.all(
    names
      .filter((name) => !protectedCaches.has(name))
      .map((name) => caches.delete(name)),
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      await pruneBuildCaches(clients);
      await self.clients.claim();
      const controlledClients = await self.clients.matchAll({ type: "window" });
      for (const client of controlledClients)
        client.postMessage({ type: "UPDATE_ACTIVATED", version: BUILD_ID });
    })(),
  );
});

function isHashedAsset(url) {
  return /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[^/]+$/.test(url.pathname);
}

async function matchRetainedCaches(request) {
  const names = (await caches.keys()).filter((name) =>
    name.startsWith(CACHE_PREFIX),
  );
  const orderedNames = [
    CACHE_NAME,
    ...names.reverse().filter((name) => name !== CACHE_NAME),
  ];
  for (const name of orderedNames) {
    const cached = await (await caches.open(name)).match(request);
    if (cached) return cached;
  }
  return null;
}

async function networkFirst(request, fallbackUrl = request.url) {
  try {
    const response = await fetch(request);
    if (!response.ok)
      throw new Error(`Network request failed (${response.status})`);
    return response;
  } catch (error) {
    const cached = await matchRetainedCaches(fallbackUrl);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      matchRetainedCaches(INDEX_URL).then((cached) => cached || fetch(request)),
    );
    return;
  }
  if (url.href === VERSION_URL || isHashedAsset(url))
    event.respondWith(networkFirst(request));
});
