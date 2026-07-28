import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

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
if (expectedBase === "./")
  assert.match(
    index,
    /(?:src|href)="\.\/assets\//,
    "default build base is relative",
  );
else
  assert.ok(
    index.includes(`="${expectedBase}assets/`),
    `build uses configured base ${expectedBase}`,
  );
assert.equal(
  index.includes("data-local-server"),
  false,
  "local import map is removed",
);
assert.equal(
  textOutput.includes("/_deps"),
  false,
  "hosted output has no dependency shim request",
);
assert.equal(
  textOutput.includes("/api"),
  false,
  "hosted output has no server API request",
);

assert.equal(typeof version.id, "string");
assert.ok(version.id.length > 0);
assert.ok(version.files.includes("index.html"));
assert.ok(
  version.files.some((file) => /^assets\/.*-[A-Za-z0-9_-]{6,}\.js$/.test(file)),
);
assert.ok(
  version.files.some((file) =>
    /^assets\/.*-[A-Za-z0-9_-]{6,}\.css$/.test(file),
  ),
);
for (const file of version.files)
  assert.ok(
    fs.existsSync(path.join(dist, file)),
    `manifest file exists: ${file}`,
  );

assert.ok(
  worker.includes(JSON.stringify(version.id)),
  "worker matches version metadata",
);
assert.equal(worker.includes("__HAMMER_BUILD_ID__"), false);
assert.match(worker, /version\?\.id !== BUILD_ID/);
assert.match(
  worker,
  /await Promise\.all\(/,
  "worker stages the complete manifest",
);
assert.match(worker, /request\.mode === "navigate"/);
assert.match(worker, /matchRetainedCaches\(INDEX_URL\)/);
assert.match(worker, /cached \|\| fetch\(request\)/);
const runtimeFetchSource = worker.slice(
  worker.indexOf("async function networkFirst"),
);
assert.equal(
  runtimeFetchSource.includes("cache.put"),
  false,
  "staged generation caches remain immutable",
);
assert.match(worker, /isHashedAsset\(url\)/);
assert.match(worker, /const RETAINED_GENERATIONS = 3/);
assert.match(worker, /protectedCaches = new Set/);
assert.match(worker, /GET_CLIENT_VERSION/);
assert.match(worker, /matchRetainedCaches\(fallbackUrl\)/);
assert.match(
  worker,
  /names\.reverse\(\)\.filter/,
  "hashed fallback searches retained caches",
);
const installSource = worker.slice(
  worker.indexOf('self.addEventListener("install"'),
  worker.indexOf('self.addEventListener("message"'),
);
assert.match(
  installSource,
  /await stageBuild\(\);\s*await self\.skipWaiting\(\)/,
  "complete staging activates immediately",
);
const activateSource = worker.slice(
  worker.indexOf('self.addEventListener("activate"'),
  worker.indexOf("function isHashedAsset"),
);
assert.match(activateSource, /await pruneBuildCaches\(clients\)/);
assert.match(activateSource, /await self\.clients\.claim\(\)/);
assert.equal(activateSource.includes("location.reload"), false);

const sourceWorker = fs.readFileSync(
  path.join(root, "public", "sw.js"),
  "utf8",
);
const workerListeners = new Map();
const deletedCaches = [];
let installPromise = null;
let skipWaitingCalls = 0;
let missingAsset = true;
const workerSelf = {
  registration: { scope: "https://example.test/tool/" },
  location: { origin: "https://example.test" },
  clients: { claim: async () => {} },
  skipWaiting: async () => skipWaitingCalls++,
  addEventListener(type, listener) {
    workerListeners.set(type, listener);
  },
};
vm.runInNewContext(sourceWorker, {
  self: workerSelf,
  URL,
  Request,
  console,
  caches: {
    open: async () => ({ put: async () => {} }),
    delete: async (name) => deletedCaches.push(name),
    keys: async () => [],
  },
  fetch: async (request) => {
    const url = typeof request === "string" ? request : request.url;
    if (url.endsWith("version.json"))
      return new Response(
        JSON.stringify({ id: "__HAMMER_BUILD_ID__", files: ["index.html"] }),
      );
    return missingAsset
      ? new Response("missing", { status: 404 })
      : new Response("complete", { status: 200 });
  },
});
workerListeners.get("install")({
  waitUntil: (promise) => (installPromise = promise),
});
await assert.rejects(installPromise, /index\.html request failed \(404\)/);
assert.deepEqual(deletedCaches, ["hammer-prefab-tool-__HAMMER_BUILD_ID__"]);
assert.equal(skipWaitingCalls, 0, "incomplete deploy does not activate");
missingAsset = false;
workerListeners.get("install")({
  waitUntil: (promise) => (installPromise = promise),
});
await installPromise;
assert.equal(skipWaitingCalls, 1, "fully staged deploy activates immediately");

const viteConfig = fs.readFileSync(path.join(root, "vite.config.mjs"), "utf8");
assert.ok(viteConfig.includes('process.env.HAMMER_BASE_PATH || "./"'));
console.log("static hosted build contracts passed");
