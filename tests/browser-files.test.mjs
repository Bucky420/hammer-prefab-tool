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
  canUseFileSystemAccess,
  FileSystemAccessError,
  openVmfFile,
  openVmfWithInput,
  openFileWithPicker,
  saveVmfFile,
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
      self: null,
      top: null,
      isSecureContext: true,
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
const pickerEnvironment = {
  self: null,
  top: null,
  isSecureContext: true,
  showOpenFilePicker: async () => [handle],
};
pickerEnvironment.self = pickerEnvironment;
pickerEnvironment.top = pickerEnvironment;
assert.equal((await openFileWithPicker({}, pickerEnvironment)).handle, handle);
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
let permissionRequests = 0;
const permissionHandle = {
  queryPermission: async ({ mode }) =>
    mode === "readwrite" ? "prompt" : "denied",
  requestPermission: async ({ mode }) => {
    permissionRequests++;
    return mode === "readwrite" ? "granted" : "denied";
  },
  createWritable: writableHandle.createWritable,
};
assert.equal(
  await writeFileHandle(permissionHandle, "permitted"),
  permissionHandle,
);
assert.equal(permissionRequests, 1);
await assert.rejects(
  () =>
    writeFileHandle(
      {
        queryPermission: async () => "prompt",
        requestPermission: async () => "denied",
        createWritable: writableHandle.createWritable,
      },
      "denied",
    ),
  (error) =>
    error instanceof FileSystemAccessError &&
    error.code === "PERMISSION_DENIED",
);
assert.deepEqual(
  await saveFileWithPicker(
    "saved",
    {},
    { showSaveFilePicker: async () => writableHandle },
  ),
  { handle: writableHandle },
);
const accessEnvironment = {
  self: null,
  top: null,
  isSecureContext: true,
  showOpenFilePicker: async () => [handle],
  showSaveFilePicker: async () => writableHandle,
};
accessEnvironment.self = accessEnvironment;
accessEnvironment.top = accessEnvironment;
assert.equal(supportsFileSystemAccess(accessEnvironment), true);
assert.equal(createFileSystemAccessAdapter(accessEnvironment).supported, true);
const topLevelEnvironment = {
  self: null,
  top: null,
  isSecureContext: true,
  showOpenFilePicker: async () => [
    {
      getFile: async () => ({ name: "direct.vmf", text: async () => "direct" }),
    },
  ],
};
topLevelEnvironment.self = topLevelEnvironment;
topLevelEnvironment.top = topLevelEnvironment;
assert.equal(canUseFileSystemAccess(topLevelEnvironment), true);
const directOpen = await openVmfFile(topLevelEnvironment);
assert.deepEqual(
  {
    name: directOpen.name,
    contents: directOpen.contents,
    directSaveSupported: directOpen.directSaveSupported,
  },
  { name: "direct.vmf", contents: "direct", directSaveSupported: true },
);
const inputEvents = {};
const inputEnvironment = {
  self: {},
  top: {},
  isSecureContext: true,
  document: {
    body: { appendChild: (input) => (inputEvents.input = input) },
    createElement: () => ({
      addEventListener: (name, callback) => (inputEvents[name] = callback),
      remove: () => (inputEvents.removed = true),
      click: () => (inputEvents.clicked = true),
      files: [{ name: "fallback.vmf", text: async () => "fallback" }],
    }),
  },
};
const fallbackPromise = openVmfFile(inputEnvironment);
assert.equal(inputEvents.clicked, true);
await inputEvents.change();
assert.deepEqual(await fallbackPromise, {
  name: "fallback.vmf",
  contents: "fallback",
  handle: null,
  directSaveSupported: false,
});
const cancelEvents = {};
const cancelPromise = openVmfWithInput({
  document: {
    body: { appendChild: () => {} },
    createElement: () => ({
      addEventListener: (name, callback) => (cancelEvents[name] = callback),
      remove: () => {},
      click: () => {},
    }),
  },
});
await assert.rejects(
  () => {
    cancelEvents.cancel();
    return cancelPromise;
  },
  (error) => error.name === "AbortError",
);
const saveWrites = [];
const directSave = await saveVmfFile(
  {
    contents: "direct-save",
    handle: {
      createWritable: async () => ({
        write: (value) => saveWrites.push(value),
        close: async () => {},
      }),
    },
    filename: "direct.vmf",
  },
  { Blob, URL: { createObjectURL: () => "unused", revokeObjectURL: () => {} } },
);
assert.deepEqual(directSave, { mode: "direct", filename: "direct.vmf" });
assert.deepEqual(saveWrites, ["direct-save"]);
const downloadEventsForVmf = [];
const downloadSave = await saveVmfFile(
  { contents: "download-save", filename: "fallback.vmf" },
  {
    Blob,
    URL: {
      createObjectURL: () => "blob:fallback",
      revokeObjectURL: (url) => downloadEventsForVmf.push(["revoke", url]),
    },
    document: {
      body: {
        appendChild: (link) =>
          downloadEventsForVmf.push(["append", link.download]),
      },
      createElement: () => ({
        click: () => downloadEventsForVmf.push(["click"]),
        remove: () => downloadEventsForVmf.push(["remove"]),
      }),
    },
    setTimeout: (callback) => callback(),
  },
);
assert.deepEqual(downloadSave, { mode: "download", filename: "fallback.vmf" });
assert.deepEqual(downloadEventsForVmf, [
  ["append", "fallback.vmf"],
  ["click"],
  ["remove"],
  ["revoke", "blob:fallback"],
]);

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
