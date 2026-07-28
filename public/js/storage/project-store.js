import { cloneJsonSafe, normalizeProject } from "../project-format.js";

export const DEFAULT_PROJECT_STORE_NAME = "hammer-prefab-tool";
export const PROJECT_SNAPSHOT_STORE = "project-snapshots";

export class ProjectStoreError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ProjectStoreError";
    this.code = options.code || "PROJECT_STORE_ERROR";
    this.operation = options.operation;
  }
}

function requestResult(request, operation) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new ProjectStoreError(`${operation} failed`, {
          operation,
          cause: request.error,
        }),
      );
  });
}

function transactionComplete(transaction, operation) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        new ProjectStoreError(`${operation} transaction failed`, {
          operation,
          cause: transaction.error,
        }),
      );
    transaction.onabort = () =>
      reject(
        new ProjectStoreError(`${operation} transaction was aborted`, {
          operation,
          code: "TRANSACTION_ABORTED",
          cause: transaction.error,
        }),
      );
  });
}

function isoTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new ProjectStoreError("Snapshot time is invalid", {
      code: "INVALID_TIME",
    });
  return date.toISOString();
}

export function compareSnapshotsNewestFirst(a, b) {
  return (
    String(b.createdAt).localeCompare(String(a.createdAt)) ||
    String(b.id).localeCompare(String(a.id))
  );
}

export function createProjectStore(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName || DEFAULT_PROJECT_STORE_NAME;
  const retention = options.retention ?? 20;
  const now = options.now || (() => new Date());
  let fallbackSequence = 0;
  const makeId =
    options.generateId ||
    (() => {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      fallbackSequence += 1;
      return `snapshot-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
    });
  let databasePromise;

  if (!indexedDB || typeof indexedDB.open !== "function")
    throw new ProjectStoreError("IndexedDB is unavailable", {
      code: "UNAVAILABLE",
    });
  if (!Number.isInteger(retention) || retention < 1)
    throw new ProjectStoreError(
      "Snapshot retention must be a positive integer",
      {
        code: "INVALID_RETENTION",
      },
    );

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(databaseName, 1);
      } catch (error) {
        reject(
          new ProjectStoreError(`Opening ${databaseName} failed`, {
            operation: "open",
            cause: error,
          }),
        );
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PROJECT_SNAPSHOT_STORE))
          database.createObjectStore(PROJECT_SNAPSHOT_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = undefined;
        reject(
          new ProjectStoreError(`Opening ${databaseName} failed`, {
            operation: "open",
            cause: request.error,
          }),
        );
      };
      request.onblocked = () => {
        databasePromise = undefined;
        reject(
          new ProjectStoreError(`Opening ${databaseName} was blocked`, {
            operation: "open",
            code: "OPEN_BLOCKED",
          }),
        );
      };
    });
    return databasePromise;
  }

  async function run(operation, mode, action) {
    const database = await open();
    let transaction;
    let complete;
    try {
      transaction = database.transaction(PROJECT_SNAPSHOT_STORE, mode);
      complete = transactionComplete(transaction, operation);
      const result = await action(
        transaction.objectStore(PROJECT_SNAPSHOT_STORE),
      );
      await complete;
      return result;
    } catch (error) {
      complete?.catch(() => {});
      if (error instanceof ProjectStoreError) throw error;
      try {
        transaction?.abort();
      } catch {
        // A completed or already aborted transaction cannot be aborted again.
      }
      throw new ProjectStoreError(
        `${operation} failed: ${error?.message || error}`,
        {
          operation,
          cause: error,
        },
      );
    }
  }

  async function records() {
    const result = await run("list snapshots", "readonly", (store) =>
      requestResult(store.getAll(), "list snapshots"),
    );
    return result
      .sort(compareSnapshotsNewestFirst)
      .map((record) => cloneJsonSafe(record));
  }

  async function getSnapshot(id) {
    if (typeof id !== "string" || !id)
      throw new ProjectStoreError("Snapshot ID is required", {
        code: "INVALID_ID",
      });
    const record = await run("get snapshot", "readonly", (store) =>
      requestResult(store.get(id), "get snapshot"),
    );
    return record ? cloneJsonSafe(record) : null;
  }

  async function discardSnapshot(id) {
    if (typeof id !== "string" || !id)
      throw new ProjectStoreError("Snapshot ID is required", {
        code: "INVALID_ID",
      });
    await run("discard snapshot", "readwrite", (store) =>
      requestResult(store.delete(id), "discard snapshot"),
    );
    return true;
  }

  async function deleteOldest(count = 1) {
    if (!Number.isInteger(count) || count < 0)
      throw new ProjectStoreError(
        "Delete count must be a non-negative integer",
        {
          code: "INVALID_COUNT",
        },
      );
    if (count === 0) return [];
    const oldest = (await records()).slice(-count).reverse();
    for (const record of oldest) await discardSnapshot(record.id);
    return oldest.map((record) => record.id);
  }

  async function enforceRetention() {
    const all = await records();
    if (all.length > retention) await deleteOldest(all.length - retention);
  }

  async function saveSnapshot(project, snapshotOptions = {}) {
    const id = snapshotOptions.id || makeId();
    if (typeof id !== "string" || !id)
      throw new ProjectStoreError(
        "Snapshot ID generator returned an invalid ID",
        {
          code: "INVALID_ID",
        },
      );
    const existing = snapshotOptions.id ? await getSnapshot(id) : null;
    const timestamp = isoTime(snapshotOptions.createdAt ?? now());
    const normalizedProject = normalizeProject(project);
    const record = {
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      projectName: String(
        snapshotOptions.projectName || normalizedProject.name || "Untitled",
      ),
      lastModifiedAt: isoTime(snapshotOptions.lastModifiedAt ?? timestamp),
      autosaveTime: timestamp,
      applicationVersion: String(
        snapshotOptions.applicationVersion || "unknown",
      ),
      projectFormatVersion: normalizedProject.version,
      reason: String(snapshotOptions.reason || existing?.reason || "autosave"),
      project: normalizedProject,
    };
    await run("save snapshot", "readwrite", (store) =>
      requestResult(store.put(record), "save snapshot"),
    );
    await enforceRetention();
    return cloneJsonSafe(record);
  }

  async function restoreSnapshot(id, restoreOptions = {}) {
    const record = await getSnapshot(id);
    if (!record)
      throw new ProjectStoreError(`Snapshot ${id} was not found`, {
        operation: "restore snapshot",
        code: "NOT_FOUND",
      });
    const project = normalizeProject(record.project);
    if (restoreOptions.discard) await discardSnapshot(id);
    return project;
  }

  async function clear() {
    await run("clear snapshots", "readwrite", (store) =>
      requestResult(store.clear(), "clear snapshots"),
    );
  }

  function close() {
    if (!databasePromise) return;
    databasePromise.then((database) => database.close()).catch(() => {});
    databasePromise = undefined;
  }

  return Object.freeze({
    open,
    saveSnapshot,
    listSnapshots: records,
    getSnapshot,
    restoreSnapshot,
    discardSnapshot,
    deleteOldest,
    clear,
    close,
  });
}
