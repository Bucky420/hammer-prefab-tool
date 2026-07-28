import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { History } from "../public/js/history.js";
import {
  createProject,
  parseProject,
  serializeProject,
} from "../public/js/project-format.js";

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
assert.ok(
  app.indexOf("parseProject(loaded.text") <
    app.indexOf("replaceDocument(project, {"),
);
assert.match(app, /function changed\(kind = "document"/);
assert.match(app, /changeType === "selection-commit"\) changed\("session"\)/);
assert.match(app, /window\.addEventListener\("beforeunload"/);
assert.match(
  app,
  /if \(updateReloadPending \|\| !dirtyState\.isDirty\(\)\) return/,
);
assert.match(
  app,
  /if \(import\.meta\.hot\) \{[\s\S]*document\.createElement\("span"\)/,
);
const restore = app.slice(
  app.indexOf("function restore(data)"),
  app.indexOf("function saveHmrState"),
);
assert.equal(restore.includes("applyNodrawToHiddenFaces"), false);

assert.match(
  html,
  /Your VMF and project files are processed locally in your browser\s+and\s+are not\s+uploaded\./,
);
assert.match(html, /id="vmf-file-input"[^>]*accept="\.vmf"/);
assert.match(
  html,
  /id="project-file-input"[^>]*accept="\.json,\.hptproject\.json"/,
);
assert.equal(
  (html.match(/data-command="save-direct"/g) || []).length,
  1,
  "direct save appears only in the File menu",
);

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
assert.deepEqual(parseProject(serializeProject(project)).vmf, project.vmf);

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
