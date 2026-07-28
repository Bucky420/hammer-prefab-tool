import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const managerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../public/js/update-manager.js"),
  "utf8",
);
const { createUpdateManager } = await import(
  `data:text/javascript;base64,${Buffer.from(managerSource).toString("base64")}`
);

class EventSource {
  listeners = new Map();

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || new Set();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
}

class TestMessageChannel {
  constructor() {
    this.port1 = { onmessage: null, close() {} };
    this.port2 = {
      postMessage: (data) =>
        queueMicrotask(() => this.port1.onmessage?.({ data })),
    };
  }
}

const events = [];
const waiting = {
  state: "installed",
  scriptURL: "https://example.test/tool/sw.js",
  postMessage(message) {
    events.push(`post:${message.type}`);
    queueMicrotask(() => serviceWorker.emit("controllerchange"));
  },
};
const registration = new EventSource();
registration.waiting = waiting;
registration.installing = null;
registration.update = async () => events.push("update");

const serviceWorker = new EventSource();
serviceWorker.controller = {};
serviceWorker.register = async (url, options) => {
  events.push(
    `register:${url.href}:${options.scope}:${options.updateViaCache}`,
  );
  return registration;
};

let reloads = 0;
let intervalCallback = null;
const manager = createUpdateManager({
  currentVersion: "build-old",
  baseUrl: "https://example.test/tool/",
  serviceWorker,
  fetch: async (url, options) => {
    events.push(`fetch:${url.href}:${options.cache}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "build-new", files: ["index.html"] }),
    };
  },
  location: { reload: () => reloads++ },
  setInterval(callback) {
    intervalCallback = callback;
    return 1;
  },
  clearInterval() {
    intervalCallback = null;
  },
  setTimeout,
  clearTimeout,
  MessageChannel: TestMessageChannel,
});

let notification = null;
const unsubscribe = manager.onUpdateAvailable((detail) => {
  notification = detail;
});
assert.equal(await manager.start(), true);
assert.match(events[0], /^register:https:\/\/example\.test\/tool\/sw\.js:/);
assert.equal(notification.currentVersion, "build-old");
assert.equal(notification.version, "build-new");
assert.equal(typeof notification.applyUpdate, "function");
assert.ok(
  events.includes("update"),
  "different version asks registration to update",
);
assert.equal(typeof intervalCallback, "function");
let lateNotification = null;
const unsubscribeLate = manager.onUpdateAvailable((detail) => {
  lateNotification = detail;
});
assert.equal(
  lateNotification,
  notification,
  "late integration receives pending update",
);

await notification.applyUpdate(async () => events.push("save"));
assert.ok(events.indexOf("save") < events.indexOf("post:ACTIVATE_UPDATE"));
assert.equal(reloads, 1, "activation reloads after the controller changes");

unsubscribe();
unsubscribeLate();
manager.stop();
assert.equal(intervalCallback, null);

let activeVersion = "build-old";
let activeReloads = 0;
const activeController = {
  scriptURL: "https://example.test/tool/sw.js",
  postMessage(message, ports) {
    if (message.type === "GET_VERSION")
      ports[0].postMessage({ type: "VERSION", version: activeVersion });
  },
};
const activeServiceWorker = new EventSource();
activeServiceWorker.controller = activeController;
const activeRegistration = new EventSource();
activeRegistration.waiting = null;
activeRegistration.installing = null;
activeRegistration.update = async () => {};
activeServiceWorker.register = async () => activeRegistration;
const activeManager = createUpdateManager({
  currentVersion: "build-old",
  baseUrl: "https://example.test/tool/",
  serviceWorker: activeServiceWorker,
  MessageChannel: TestMessageChannel,
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: activeVersion, files: ["index.html"] }),
  }),
  location: { reload: () => activeReloads++ },
  setInterval: () => 3,
  setTimeout,
  clearTimeout,
});
let activeNotification = null;
activeManager.onUpdateAvailable((detail) => {
  activeNotification = detail;
});
assert.equal(await activeManager.start(), true);
assert.equal(
  activeNotification,
  null,
  "matching active controller does not notify",
);
activeVersion = "build-new";
activeServiceWorker.emit("controllerchange");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(activeNotification.version, "build-new");
assert.equal(
  activeReloads,
  0,
  "controller change does not reload the running page",
);
const activeApplyEvents = [];
await activeNotification.applyUpdate(async () =>
  activeApplyEvents.push("save"),
);
assert.deepEqual(activeApplyEvents, ["save"]);
assert.equal(
  activeReloads,
  1,
  "active update reloads only after supplied save",
);

let clientVersionReply = null;
activeServiceWorker.emit("message", {
  data: { type: "GET_CLIENT_VERSION" },
  ports: [{ postMessage: (data) => (clientVersionReply = data) }],
});
assert.deepEqual(clientVersionReply, {
  type: "CLIENT_VERSION",
  version: "build-old",
});

let noBuildRegistrations = 0;
const noBuildManager = createUpdateManager({
  currentVersion: "",
  baseUrl: "https://example.test/tool/",
  serviceWorker: { register: async () => noBuildRegistrations++ },
});
assert.equal(
  await noBuildManager.start(),
  false,
  "build-free local mode does not register",
);
assert.equal(noBuildRegistrations, 0);

let offlineTimer = null;
const offlineRegistration = new EventSource();
offlineRegistration.waiting = null;
offlineRegistration.installing = null;
offlineRegistration.update = async () => {};
const offlineManager = createUpdateManager({
  currentVersion: "build",
  baseUrl: "https://example.test/tool/",
  serviceWorker: {
    controller: {},
    register: async () => offlineRegistration,
  },
  fetch: async () => {
    throw new Error("offline");
  },
  global: { console: { warn() {} } },
  setInterval(callback) {
    offlineTimer = callback;
    return 2;
  },
});
assert.equal(
  await offlineManager.start(),
  true,
  "offline checks do not disable registration",
);
assert.equal(
  typeof offlineTimer,
  "function",
  "offline manager keeps checking later",
);

let rejectedReloads = 0;
const rejectedSaveManager = createUpdateManager({
  currentVersion: "build",
  location: { reload: () => rejectedReloads++ },
});
await assert.rejects(
  rejectedSaveManager.applyUpdate(async () => {
    throw new Error("save failed");
  }),
  /save failed/,
);
assert.equal(rejectedReloads, 0, "failed save blocks reload");

console.log("update manager contracts passed");
