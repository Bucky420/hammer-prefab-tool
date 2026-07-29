import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { removeLegacyServiceWorker } from "../public/js/service-worker-cleanup.js";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

assert.ok(fs.existsSync(dist), "npm run build emits root dist");
const index = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const version = JSON.parse(
  fs.readFileSync(path.join(dist, "version.json"), "utf8"),
);
const worker = fs.readFileSync(path.join(dist, "sw.js"), "utf8");
const textOutput = filesIn(dist)
  .filter((file) => /\.(?:html|js|css|json)$/.test(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

assert.match(index, /<meta name="hammer-build-id" content="[^"]+"/);
const expectedBase = process.env.HAMMER_BASE_PATH || "./";
if (expectedBase === "./") assert.match(index, /(?:src|href)="\.\/assets\//);
else assert.ok(index.includes(`="${expectedBase}assets/`));
assert.equal(index.includes("data-local-server"), false);
assert.equal(textOutput.includes("/_deps"), false);
assert.equal(textOutput.includes("/api"), false);
assert.equal(textOutput.includes("update-available"), false);
assert.equal(version.id, "updates-retired-v1");
assert.equal(version.retired, true);
assert.equal("files" in version, false, "retirement metadata has no manifest");
assert.equal(worker.includes('addEventListener("fetch"'), false);
assert.match(worker, /registration\.unregister\(\)/);
assert.match(worker, /name\.startsWith\(CACHE_PREFIX\)/);

function memoryCaches(events) {
  const entries = new Map([
    [
      "hammer-prefab-tool-mixed",
      [
        { url: "https://example.test/tool/index.html" },
        { url: "https://example.test/other/index.html" },
      ],
    ],
    [
      "hammer-prefab-tool-owned",
      [{ url: "https://example.test/tool/assets/app.js" }],
    ],
    [
      "hammer-prefab-tool-other-scope",
      [{ url: "https://example.test/other/index.html" }],
    ],
    ["unrelated-cache", [{ url: "https://example.test/tool/data" }]],
  ]);
  return {
    keys: async () => [...entries.keys()],
    open: async (name) => ({
      keys: async () => [...(entries.get(name) || [])],
      delete: async (request) => {
        entries.set(
          name,
          (entries.get(name) || []).filter((item) => item.url !== request.url),
        );
        events.push(`entry:${name}:${request.url}`);
      },
    }),
    delete: async (name) => {
      entries.delete(name);
      events.push(`cache:${name}`);
    },
  };
}

const listeners = new Map();
const cacheEvents = [];
const messages = [];
let unregistered = 0;
let claimed = 0;
let skipped = 0;
vm.runInNewContext(worker, {
  self: {
    registration: {
      scope: "https://example.test/tool/",
      unregister: async () => unregistered++,
    },
    clients: {
      claim: async () => claimed++,
      matchAll: async () => [
        { postMessage: (message) => messages.push(message) },
      ],
    },
    skipWaiting: async () => skipped++,
    addEventListener: (type, listener) => listeners.set(type, listener),
  },
  caches: memoryCaches(cacheEvents),
});
let pending;
listeners.get("install")({ waitUntil: (promise) => (pending = promise) });
await pending;
assert.equal(skipped, 1);
listeners.get("activate")({ waitUntil: (promise) => (pending = promise) });
await pending;
assert.ok(
  cacheEvents.includes(
    "entry:hammer-prefab-tool-mixed:https://example.test/tool/index.html",
  ),
);
assert.ok(cacheEvents.includes("cache:hammer-prefab-tool-owned"));
assert.equal(cacheEvents.includes("cache:hammer-prefab-tool-mixed"), false);
assert.equal(claimed, 1);
assert.equal(unregistered, 1);
assert.equal(messages[0].type, "UPDATE_ACTIVATED");

const cleanupEvents = [];
await removeLegacyServiceWorker({
  document: { baseURI: "https://example.test/tool/" },
  navigator: {
    serviceWorker: {
      getRegistrations: async () => [
        {
          scope: "https://example.test/tool/",
          unregister: async () => cleanupEvents.push("unregister-owned"),
        },
        {
          scope: "https://example.test/other/",
          unregister: async () => cleanupEvents.push("unregister-other"),
        },
      ],
    },
  },
  caches: memoryCaches(cleanupEvents),
});
assert.ok(cleanupEvents.includes("unregister-owned"));
assert.ok(cleanupEvents.includes("cache:hammer-prefab-tool-owned"));
assert.equal(cleanupEvents.includes("unregister-other"), false);
assert.equal(cleanupEvents.includes("cache:hammer-prefab-tool-mixed"), false);

const viteConfig = fs.readFileSync(path.join(root, "vite.config.mjs"), "utf8");
assert.ok(viteConfig.includes('process.env.HAMMER_BASE_PATH || "./"'));
console.log("static hosted build contracts passed");
