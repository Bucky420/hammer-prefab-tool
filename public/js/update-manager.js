const CHECK_INTERVAL = 60 * 60 * 1000;
const ACTIVATION_TIMEOUT = 5000;
const VERSION_RESPONSE_TIMEOUT = 1000;

function readBuildId(documentRef) {
  return (
    documentRef
      ?.querySelector('meta[name="hammer-build-id"]')
      ?.getAttribute("content") || ""
  );
}

/**
 * Creates an update manager. Environment overrides keep the update lifecycle
 * testable without a browser or network.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
export function createUpdateManager(overrides = {}) {
  const globalRef = overrides.global || globalThis;
  const documentRef = overrides.document ?? globalRef.document;
  const navigatorRef = overrides.navigator ?? globalRef.navigator;
  const serviceWorker = overrides.serviceWorker ?? navigatorRef?.serviceWorker;
  const fetchRef = overrides.fetch ?? globalRef.fetch?.bind(globalRef);
  const locationRef = overrides.location ?? globalRef.location;
  const setIntervalRef =
    overrides.setInterval ?? globalRef.setInterval?.bind(globalRef);
  const clearIntervalRef =
    overrides.clearInterval ?? globalRef.clearInterval?.bind(globalRef);
  const setTimeoutRef =
    overrides.setTimeout ?? globalRef.setTimeout?.bind(globalRef);
  const clearTimeoutRef =
    overrides.clearTimeout ?? globalRef.clearTimeout?.bind(globalRef);
  const MessageChannelRef =
    overrides.MessageChannel === undefined
      ? globalRef.MessageChannel
      : overrides.MessageChannel;
  const currentVersion = overrides.currentVersion ?? readBuildId(documentRef);
  const baseUrl =
    overrides.baseUrl || documentRef?.baseURI || locationRef?.href;
  const listeners = new Set();

  let registration = null;
  let checkTimer = null;
  let started = false;
  let lastNotification = null;
  let availableUpdate = null;

  async function fetchVersion() {
    if (!fetchRef || !baseUrl) return null;
    const response = await fetchRef(new URL("version.json", baseUrl), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Update check failed (${response.status})`);
    const version = await response.json();
    if (!version || typeof version.id !== "string" || !version.id)
      throw new Error("Update metadata is invalid");
    return version;
  }

  function emitUpdate(worker, version) {
    if (!worker || version?.id === currentVersion) return;
    const key = `${worker.scriptURL || "waiting"}:${version?.id || "unknown"}`;
    if (lastNotification === key) return;
    lastNotification = key;
    availableUpdate = Object.freeze({
      currentVersion,
      version: version?.id || null,
      applyUpdate,
    });
    for (const listener of listeners) {
      try {
        listener(availableUpdate);
      } catch (error) {
        globalRef.console?.error(
          "[Hammer Prefab Tool] Update callback failed",
          error,
        );
      }
    }
  }

  async function notifyWaiting(worker = registration?.waiting, version = null) {
    if (!worker || !serviceWorker?.controller) return;
    const metadata = version || (await fetchVersion().catch(() => null));
    emitUpdate(worker, metadata);
  }

  function observeInstalling(worker) {
    if (!worker?.addEventListener) return;
    const installed = () => {
      if (worker.state === "installed" && registration?.waiting)
        void notifyWaiting(registration.waiting);
    };
    worker.addEventListener("statechange", installed);
    installed();
  }

  async function readControllerVersion(controller = serviceWorker?.controller) {
    if (controller?.postMessage && MessageChannelRef) {
      const version = await new Promise((resolve) => {
        const channel = new MessageChannelRef();
        let timeout = null;
        const finish = (value) => {
          if (timeout !== null && clearTimeoutRef) clearTimeoutRef(timeout);
          channel.port1.close?.();
          resolve(value);
        };
        channel.port1.onmessage = (event) =>
          finish(event.data?.version || null);
        if (setTimeoutRef)
          timeout = setTimeoutRef(() => finish(null), VERSION_RESPONSE_TIMEOUT);
        controller.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      });
      if (version) return { id: version };
    }
    return fetchVersion().catch(() => null);
  }

  async function inspectController(controller = serviceWorker?.controller) {
    if (!controller) return;
    const version = await readControllerVersion(controller);
    if (version?.id && version.id !== currentVersion)
      emitUpdate(controller, version);
  }

  function handleServiceWorkerMessage(event) {
    if (event.data?.type === "GET_CLIENT_VERSION") {
      event.ports?.[0]?.postMessage({
        type: "CLIENT_VERSION",
        version: currentVersion,
      });
      return;
    }
    if (event.data?.type === "UPDATE_ACTIVATED")
      emitUpdate(event.source || serviceWorker?.controller, {
        id: event.data.version,
      });
  }

  function handleControllerChange() {
    void inspectController();
  }

  async function checkForUpdate() {
    if (!registration) return null;
    const version = await fetchVersion();
    if (version.id !== currentVersion) await registration.update();
    if (registration.waiting)
      await notifyWaiting(registration.waiting, version);
    return version;
  }

  async function start() {
    if (started) return Boolean(registration);
    started = true;
    if (!currentVersion || !serviceWorker || !baseUrl) return false;

    serviceWorker.addEventListener?.("message", handleServiceWorkerMessage);
    serviceWorker.addEventListener?.(
      "controllerchange",
      handleControllerChange,
    );
    const scopeUrl = new URL("./", baseUrl);
    registration = await serviceWorker.register(new URL("sw.js", scopeUrl), {
      scope: scopeUrl.pathname,
      updateViaCache: "none",
    });
    registration.addEventListener?.("updatefound", () =>
      observeInstalling(registration.installing),
    );
    observeInstalling(registration.installing);
    if (registration.waiting) await notifyWaiting(registration.waiting);
    await inspectController();
    await checkForUpdate().catch((error) =>
      globalRef.console?.warn(
        "[Hammer Prefab Tool] Update check failed",
        error,
      ),
    );
    if (setIntervalRef)
      checkTimer = setIntervalRef(() => {
        void checkForUpdate().catch((error) =>
          globalRef.console?.warn(
            "[Hammer Prefab Tool] Update check failed",
            error,
          ),
        );
      }, CHECK_INTERVAL);
    return true;
  }

  function onUpdateAvailable(callback) {
    if (typeof callback !== "function")
      throw new TypeError("Update callback must be a function");
    listeners.add(callback);
    if (availableUpdate) callback(availableUpdate);
    return () => listeners.delete(callback);
  }

  async function applyUpdate(save) {
    const saveCallback = typeof save === "function" ? save : save?.save;
    if (saveCallback) await saveCallback();

    const waiting = registration?.waiting;
    if (waiting && serviceWorker?.addEventListener) {
      await new Promise((resolve) => {
        let timeout = null;
        const changed = () => {
          if (timeout !== null && clearTimeoutRef) clearTimeoutRef(timeout);
          serviceWorker.removeEventListener?.("controllerchange", changed);
          resolve();
        };
        serviceWorker.addEventListener("controllerchange", changed);
        if (setTimeoutRef) timeout = setTimeoutRef(changed, ACTIVATION_TIMEOUT);
        waiting.postMessage({ type: "ACTIVATE_UPDATE" });
      });
    }
    locationRef?.reload?.();
  }

  function stop() {
    if (checkTimer !== null && clearIntervalRef) clearIntervalRef(checkTimer);
    checkTimer = null;
    serviceWorker?.removeEventListener?.("message", handleServiceWorkerMessage);
    serviceWorker?.removeEventListener?.(
      "controllerchange",
      handleControllerChange,
    );
  }

  return Object.freeze({
    start,
    stop,
    checkForUpdate,
    onUpdateAvailable,
    applyUpdate,
    get currentVersion() {
      return currentVersion;
    },
  });
}

export const updateManager = createUpdateManager();

if (typeof window !== "undefined") {
  window.HammerPrefabUpdates = updateManager;
  void updateManager
    .start()
    .catch((error) =>
      console.warn("[Hammer Prefab Tool] Update manager unavailable", error),
    );
}
