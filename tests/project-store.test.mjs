import assert from "node:assert/strict";
import {
  createProjectStore,
  ProjectStoreError,
} from "../public/js/storage/project-store.js";
import { findMatchingAutosave } from "../public/js/autosave-recovery.js";
import { canonicalProjectHash } from "../public/js/dirty-state.js";

function memoryIndexedDB() {
  const databases = new Map();
  const request = (transaction, action) => {
    const result = {};
    queueMicrotask(() => {
      try {
        result.result = action();
        result.onsuccess?.();
        queueMicrotask(() => transaction.oncomplete?.());
      } catch (error) {
        result.error = error;
        transaction.error = error;
        result.onerror?.();
        transaction.onerror?.();
      }
    });
    return result;
  };
  return {
    open(name) {
      const openRequest = {};
      queueMicrotask(() => {
        let data = databases.get(name);
        const isNew = !data;
        if (!data) {
          data = { stores: new Map() };
          databases.set(name, data);
        }
        const database = {
          objectStoreNames: {
            contains: (storeName) => data.stores.has(storeName),
          },
          createObjectStore(storeName) {
            data.stores.set(storeName, new Map());
          },
          transaction(storeName) {
            const transaction = {
              objectStore() {
                const records = data.stores.get(storeName);
                return {
                  getAll: () =>
                    request(transaction, () => [...records.values()]),
                  get: (id) => request(transaction, () => records.get(id)),
                  put: (record) =>
                    request(transaction, () => {
                      records.set(record.id, structuredClone(record));
                      return record.id;
                    }),
                  delete: (id) =>
                    request(transaction, () => records.delete(id)),
                  clear: () => request(transaction, () => records.clear()),
                };
              },
              abort() {
                this.onabort?.();
              },
            };
            return transaction;
          },
          close() {},
        };
        openRequest.result = database;
        if (isNew) openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    },
  };
}

const project = (name) => ({
  projectName: name,
  brushes: [
    { id: `brush-${name}`, vertices: [], faces: [], metadata: { name } },
  ],
  grid: 16,
});
const times = [
  new Date("2026-01-01T00:00:00.000Z"),
  new Date("2026-01-02T00:00:00.000Z"),
  new Date("2026-01-03T00:00:00.000Z"),
  new Date("2026-01-04T00:00:00.000Z"),
];
let id = 0;
const store = createProjectStore({
  indexedDB: memoryIndexedDB(),
  databaseName: "test-projects",
  retention: 2,
  now: () => times.shift(),
  generateId: () => `stable-${++id}`,
});

const first = await store.saveSnapshot(project("one"), {
  reason: "manual",
  applicationVersion: "1.2.3",
});
const second = await store.saveSnapshot(project("two"));
assert.equal(first.id, "stable-1");
assert.equal(first.projectName, "one");
assert.equal(first.autosaveTime, first.updatedAt);
assert.equal(first.applicationVersion, "1.2.3");
assert.equal(first.projectFormatVersion, first.project.version);
assert.equal(second.id, "stable-2");
assert.deepEqual(
  (await store.listSnapshots()).map((snapshot) => snapshot.id),
  ["stable-2", "stable-1"],
  "snapshots are newest first",
);

const third = await store.saveSnapshot(project("three"));
assert.equal(third.id, "stable-3");
assert.deepEqual(
  (await store.listSnapshots()).map((snapshot) => snapshot.id),
  ["stable-3", "stable-2"],
  "retention removes the oldest snapshot",
);
assert.equal(await store.getSnapshot("stable-1"), null);

const identity = {
  version: 1,
  kind: "vmf",
  access: "browser",
  name: "matching.vmf",
  locator: null,
  modifiedAt: "2025-12-31T00:00:00.000Z",
  fingerprint: "source-fingerprint",
};
const recoveryStore = createProjectStore({
  indexedDB: memoryIndexedDB(),
  databaseName: "test-recovery",
  retention: 20,
  now: () => new Date("2026-01-03T00:00:00.000Z"),
  generateId: () => "matching-snapshot",
});
const recoveredProject = project("recovered");
const matchingRecord = await recoveryStore.saveSnapshot(recoveredProject, {
  source: identity,
  projectHash: canonicalProjectHash(recoveredProject),
  documentKind: "prefab",
  fileHandle: { name: "matching.vmf" },
});
assert.deepEqual(matchingRecord.source, identity);
assert.equal(matchingRecord.documentKind, "prefab");
assert.equal(matchingRecord.fileHandle.name, "matching.vmf");
const sourceProject = project("source");
assert.equal(
  (
    await findMatchingAutosave(
      [
        {
          ...matchingRecord,
          id: "unrelated",
          source: { ...identity, name: "other.vmf" },
        },
        matchingRecord,
      ],
      identity,
      sourceProject,
    )
  ).id,
  "matching-snapshot",
  "only the matching newer VMF snapshot is restored",
);
assert.equal(
  await findMatchingAutosave(
    [matchingRecord],
    { ...identity, fingerprint: "new-source-revision" },
    sourceProject,
  ),
  null,
  "a changed source VMF does not receive an unrelated autosave",
);
assert.equal(
  await findMatchingAutosave(
    [matchingRecord],
    { ...identity, fingerprint: "new-source-revision" },
    sourceProject,
    { isSameEntry: async () => true },
  ),
  null,
  "a matching file handle cannot bypass a changed VMF fingerprint",
);
assert.equal(
  await findMatchingAutosave(
    [{ ...matchingRecord, source: undefined }],
    identity,
    sourceProject,
  ),
  null,
  "legacy metadata-free snapshots are safely ignored for automatic recovery",
);
assert.equal(
  await findMatchingAutosave([matchingRecord], identity, recoveredProject),
  null,
  "an autosave identical to the imported document is ignored",
);
recoveryStore.close();

const restored = await store.restoreSnapshot("stable-2");
assert.equal(restored.name, "two");
restored.brushes[0].metadata.name = "mutated outside store";
assert.equal(
  (await store.restoreSnapshot("stable-2")).brushes[0].metadata.name,
  "two",
  "restores are independent complete clones",
);
await store.restoreSnapshot("stable-2", { discard: true });
assert.equal(await store.getSnapshot("stable-2"), null);

await store.saveSnapshot(project("replacement"), {
  id: "stable-3",
  reason: "updated",
});
const replacement = await store.getSnapshot("stable-3");
assert.equal(replacement.id, "stable-3", "updating retains the stable ID");
assert.equal(
  replacement.createdAt,
  third.createdAt,
  "updating retains original ordering time",
);
assert.equal(replacement.project.name, "replacement");
assert.deepEqual(await store.deleteOldest(0), []);
assert.deepEqual(await store.deleteOldest(), ["stable-3"]);
assert.deepEqual(await store.listSnapshots(), []);

await assert.rejects(
  () => store.restoreSnapshot("missing"),
  (error) => error instanceof ProjectStoreError && error.code === "NOT_FOUND",
);
assert.throws(
  () => createProjectStore({ indexedDB: null }),
  (error) => error instanceof ProjectStoreError && error.code === "UNAVAILABLE",
);
store.close();

console.log("project store checks passed");
