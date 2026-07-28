import assert from "node:assert/strict";
import {
  BrowserFileError,
  classifyFile,
  classifySingleFile,
  downloadText,
  ensureExtension,
  projectFilename,
  readProjectBrowserFile,
  readSingleBrowserFile,
  sanitizeFilename,
  vmfFilename,
} from "../public/js/files/browser-files.js";
import {
  createFileSystemAccessAdapter,
  FileSystemAccessError,
  openFileWithPicker,
  saveFileWithPicker,
  supportsFileSystemAccess,
  writeFileHandle,
} from "../public/js/files/file-system-access.js";
import {
  createLocalServerFileAdapter,
  LocalServerFileError,
} from "../public/js/files/local-server-files.js";

assert.deepEqual(classifyFile("room.hptproject.json"), {
  kind: "project",
  name: "room.hptproject.json",
  extension: ".hptproject.json",
  legacy: false,
});
assert.equal(classifyFile("legacy.json").legacy, true);
assert.equal(classifyFile("room.VMF").kind, "vmf");
assert.equal(classifyFile("notes.txt").kind, "unknown");
assert.throws(() => classifySingleFile([]), /exactly one/i);
assert.throws(
  () => classifySingleFile([{ name: "a.vmf" }, { name: "b.vmf" }]),
  /exactly one/i,
);
assert.throws(
  () => classifySingleFile([{ name: "readme.txt" }]),
  (error) =>
    error instanceof BrowserFileError && error.code === "UNSUPPORTED_FILE_TYPE",
);

const vmfFile = { name: "simple.vmf", text: async () => "versioninfo {}" };
const readVmf = await readSingleBrowserFile([vmfFile]);
assert.equal(readVmf.kind, "vmf");
assert.equal(readVmf.text, "versioninfo {}");

const projectFile = {
  name: "legacy.json",
  text: async () =>
    JSON.stringify({
      brushes: [{ id: "b", vertices: [], faces: [] }],
      grid: 8,
    }),
};
const readProject = await readProjectBrowserFile([projectFile]);
assert.equal(readProject.project.settings.grid, 8);
assert.equal(readProject.project.name, "legacy.json");

assert.equal(sanitizeFilename("../bad:<name>?.json"), "-bad--name--.json");
assert.equal(sanitizeFilename("CON"), "_CON");
assert.equal(ensureExtension("map.VMF", ".vmf"), "map.VMF");
assert.equal(vmfFilename("map"), "map.vmf");
assert.equal(projectFilename("room.json"), "room.hptproject.json");

const downloadEvents = [];
const fakeUrl = {
  createObjectURL(blob) {
    downloadEvents.push(["create", blob.type]);
    return "blob:test";
  },
  revokeObjectURL(url) {
    downloadEvents.push(["revoke", url]);
  },
};
const fakeLink = {
  style: {},
  click() {
    downloadEvents.push(["click", this.download, this.href]);
  },
  remove() {
    downloadEvents.push(["remove"]);
  },
};
const download = downloadText("{}", "test.hptproject.json", {
  document: {
    createElement: () => fakeLink,
    body: { append: () => downloadEvents.push(["append"]) },
  },
  URL: fakeUrl,
  setTimeout: (callback) => callback(),
});
assert.equal(download.filename, "test.hptproject.json");
assert.deepEqual(
  downloadEvents.map(([event]) => event),
  ["create", "append", "click", "remove", "revoke"],
);

const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
assert.equal(
  await openFileWithPicker(
    {},
    {
      showOpenFilePicker: async () => {
        throw abort;
      },
    },
  ),
  null,
);
await assert.rejects(
  () => openFileWithPicker({}, {}),
  (error) =>
    error instanceof FileSystemAccessError && error.code === "UNAVAILABLE",
);
const handle = { name: "opened.vmf", getFile: async () => vmfFile };
assert.equal(
  (await openFileWithPicker({}, { showOpenFilePicker: async () => [handle] }))
    .handle,
  handle,
);
const writes = [];
const writableHandle = {
  async createWritable() {
    return {
      async write(value) {
        writes.push(value);
      },
      async close() {
        writes.push("closed");
      },
    };
  },
};
assert.equal(await writeFileHandle(writableHandle, "project"), writableHandle);
assert.deepEqual(writes, ["project", "closed"]);
assert.deepEqual(
  await saveFileWithPicker(
    "saved",
    {},
    { showSaveFilePicker: async () => writableHandle },
  ),
  { handle: writableHandle },
);
const accessEnvironment = {
  showOpenFilePicker: async () => [handle],
  showSaveFilePicker: async () => writableHandle,
};
assert.equal(supportsFileSystemAccess(accessEnvironment), true);
assert.equal(createFileSystemAccessAdapter(accessEnvironment).supported, true);

const calls = [];
const server = createLocalServerFileAdapter({
  projects: async () => ({ ok: true, projects: [] }),
  files: async (kind) => (calls.push(["files", kind]), { ok: true }),
  load: async (path, kind) => (
    calls.push(["load", path, kind]),
    { project: {} }
  ),
  save: async (path, project) => (
    calls.push(["save", path, project]),
    { path }
  ),
  autosave: async () => ({ backup: "backup.json" }),
  openVMF: async () => ({ vmf: "" }),
  exportVMF: async () => ({ path: "map.vmf" }),
});
await server.listFiles("export");
await server.loadProject("room.hptproject.json");
await server.saveProject("room.hptproject.json", { version: 1 });
assert.deepEqual(calls[0], ["files", "export"]);
assert.deepEqual(calls[1], ["load", "room.hptproject.json", "project"]);
assert.equal(calls[2][0], "save");
assert.throws(
  () => createLocalServerFileAdapter(),
  (error) =>
    error instanceof LocalServerFileError && error.code === "API_REQUIRED",
);

console.log("browser file checks passed");
