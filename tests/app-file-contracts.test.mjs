import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { History } from "../public/js/history.js";
import { createProject } from "../public/js/project-format.js";

const app = readFileSync(
  new URL("../public/js/app.js", import.meta.url),
  "utf8",
);
const html = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

assert.match(
  app,
  /storageMode === "server" \? createLocalServerFileAdapter\(api\) : null/,
);
const start = app.slice(app.indexOf("async function start()"));
assert.match(start, /if \(serverFiles\)[\s\S]*await api\.config\(\)/);
assert.equal(
  start.includes("await api.config();\n  }"),
  false,
  "hosted startup has no unconditional API call",
);
assert.ok(
  app.indexOf("parseVMFDocument(loaded.text)") <
    app.indexOf("replaceDocument(project, {"),
);
assert.match(app, /function changed\(kind = "document"/);
assert.match(app, /changeType === "selection-commit"\) changed\("session"\)/);
assert.match(app, /window\.addEventListener\("beforeunload"/);
assert.match(app, /if \(!dirtyState\.isDirty\(\)\) return/);
assert.equal(app.includes("updateManager"), false);
assert.equal(html.includes("update-available"), false);
assert.match(app, /hammer-pending-update-snapshot/);
assert.match(
  app,
  /if \(import\.meta\.hot\) \{[\s\S]*document\.createElement\("span"\)/,
);
const restore = app.slice(
  app.indexOf("function restore(data)"),
  app.indexOf("function saveHmrState"),
);
assert.equal(restore.includes("applyNodrawToHiddenFaces"), false);

assert.match(html, /id="vmf-file-input"[^>]*accept="\.vmf"/);
const fileMenu = html.slice(
  html.indexOf('<div id="file-menu"'),
  html.indexOf('<div id="edit-menu"'),
);
assert.deepEqual(
  [...fileMenu.matchAll(/data-command="([^"]+)"/g)].map((match) => match[1]),
  ["open-vmf", "save-vmf", "save-vmf-as"],
  "the File menu contains only Open VMF, Save, and Save As",
);
for (const forbidden of [
  "Open Project",
  "Save Project",
  "Export VMF",
  "Export Hammer Prefab VMF",
  "Restore Autosave",
  "Discard Autosave",
  "project-filename",
  "vmf-filename",
  "prefab-mode",
  "prefab-backing",
])
  assert.equal(
    fileMenu.includes(forbidden),
    false,
    `${forbidden} is not visible`,
  );
assert.equal(
  (fileMenu.match(/data-command="save-vmf"/g) || []).length,
  1,
  "Save appears once in the File menu",
);
assert.match(app, /command === "save-vmf"\) runFileAction\(saveVMF\(\)\)/);
assert.match(app, /run\(event\.shiftKey \? "save-vmf-as" : "save-vmf"\)/);
assert.ok(
  app.indexOf('event.key.toLowerCase() === "s"') <
    app.indexOf('["INPUT", "SELECT", "TEXTAREA"]'),
  "Ctrl+S is intercepted before focused form controls can trigger browser Save Page",
);
assert.match(
  app,
  /documentKind === "complete-map"[\s\S]*!vmfHandle[\s\S]*!state\.vmfPath/,
);
assert.match(
  app,
  /else if \(vmfHandle\)[\s\S]*fileSystem\.write\(vmfHandle, text\)/,
);
assert.match(app, /else if \(saveAs && fileSystem\.supported\)/);
assert.equal(
  app.includes("if (!directSaveAllowed && !vmfHandle && !state.vmfPath) saveAs = true"),
  false,
  "Save without a writable handle downloads to the current filename",
);
assert.match(app, /downloadText\(text, filename,[\s\S]*Downloaded VMF/);
assert.match(app, /event\.key === "F5"[\s\S]*reloadWithAutosave\(\)/);
assert.match(app, /options\.handle \|\| matching\?\.fileHandle \|\| null/);
assert.match(app, /handle: candidate\.fileHandle \|\| null/);
assert.match(app, /navigator\.brave\?\.isBrave/);
assert.match(app, /brave:\/\/flags\/#file-system-access-api/);
assert.match(html, /id="file-access-warning"[\s\S]*id="file-access-help"/);
assert.match(
  app,
  /serverPath: result\.path[\s\S]*directSaveAllowed: true/,
);
assert.match(app, /const reparsed = parseVMFDocument\(text\)/);
assert.match(app, /documentKind === "prefab"[\s\S]*prefabVMFText\(\)/);
assert.match(app, /data-prefab-ownership/);
assert.match(app, /data-prefab-backing/);
assert.match(app, /hammer_prefab_ownership/);
assert.match(app, /hammer_prefab_backing/);
assert.match(app, /filename\.replace\(\/\\\.vmf\$\/i, "-edited\.vmf"\)/);

const project = createProject({
  projectName: "Metadata",
  brushes: [],
  entities: [{ id: "2", classname: "light" }],
  groups: [{ id: "3" }],
  vmf: {
    versionInfo: { editorversion: "400", mapversion: "12" },
    versionProperties: [{ key: "editorversion", value: "400" }],
    world: {
      id: "1",
      keys: { classname: "worldspawn", skyname: "sky_day01_01" },
      properties: [{ key: "skyname", value: "sky_day01_01" }],
    },
  },
});
assert.equal(project.vmf.world.keys.skyname, "sky_day01_01");

const history = new History();
history.push({ brushes: [1] });
history.push({ brushes: [2] });
history.reset({ brushes: [3] });
assert.equal(history.items.length, 1);
assert.equal(
  history.undo(),
  null,
  "replaced document history cannot reach old objects",
);

console.log("app file lifecycle contracts passed");
