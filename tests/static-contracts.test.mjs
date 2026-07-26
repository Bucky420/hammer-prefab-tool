import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const publicJs = path.join(root, "public", "js");

function sourceFile(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function typedExports(files) {
  const exportsByFile = new Map();
  for (const [fileName, file] of files) {
    const exported = new Map();
    for (const statement of file.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
      if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
        continue;
      const tags = statement.parameters.map(
        (parameter) => ts.getJSDocParameterTags(parameter)[0],
      );
      if (tags.some((tag) => !tag)) continue;
      const optional = new Set(
        tags.filter((tag) => tag?.isBracketed).map((tag) => tag.name.getText(file)),
      );
      let required = statement.parameters.length;
      while (required > 0) {
        const parameter = statement.parameters[required - 1];
        const name = parameter.name.getText(file);
        if (!parameter.initializer && !parameter.dotDotDotToken && !optional.has(name)) break;
        required -= 1;
      }
      exported.set(statement.name.text, required);
    }
    exportsByFile.set(path.normalize(fileName), exported);
  }
  return exportsByFile;
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(importer), specifier);
  return path.normalize(path.extname(resolved) ? resolved : `${resolved}.js`);
}

function findContractErrors(files) {
  const contracts = typedExports(files);
  const errors = [];
  for (const [fileName, file] of files) {
    const imported = new Map();
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
      if (!ts.isNamedImports(statement.importClause.namedBindings)) continue;
      const target = resolveImport(fileName, statement.moduleSpecifier.text);
      const targetContracts = target && contracts.get(target);
      if (!targetContracts) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        const exportedName = element.propertyName?.text || element.name.text;
        const required = targetContracts.get(exportedName);
        if (required !== undefined) imported.set(element.name.text, { exportedName, required });
      }
    }
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const contract = imported.get(node.expression.text);
        if (contract && node.arguments.length < contract.required) {
          const position = file.getLineAndCharacterOfPosition(node.getStart(file));
          errors.push(
            `${path.relative(root, fileName).split(path.sep).join("/")}:${position.line + 1}:${position.character + 1} ` +
            `${contract.exportedName} requires ${contract.required} arguments, got ${node.arguments.length}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return errors;
}

function projectFiles(directory) {
  const files = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const item of projectFiles(fullPath)) files.set(...item);
    } else if (entry.name.endsWith(".js")) {
      files.set(path.normalize(fullPath), sourceFile(fullPath, fs.readFileSync(fullPath, "utf8")));
    }
  }
  return files;
}

const fixtureRoot = path.join(root, "contract-fixture");
const fixtureFiles = new Map([
  [
    path.join(fixtureRoot, "helper.js"),
    sourceFile(
      path.join(fixtureRoot, "helper.js"),
      "/**\n * @param {object} a\n * @param {object} b\n * @param {string} x\n * @param {string} y\n */\n" +
        "export function projectedRailKey(a, b, x, y) {}",
    ),
  ],
  [
    path.join(fixtureRoot, "caller.js"),
    sourceFile(
      path.join(fixtureRoot, "caller.js"),
      'import { projectedRailKey } from "./helper.js";\nprojectedRailKey({}, {});',
    ),
  ],
]);
assert.deepEqual(findContractErrors(fixtureFiles), [
  "contract-fixture/caller.js:2:1 projectedRailKey requires 4 arguments, got 2",
]);

const errors = findContractErrors(projectFiles(publicJs));
assert.deepEqual(errors, [], `Static contract errors:\n${errors.join("\n")}`);

const appSource = fs.readFileSync(path.join(publicJs, "app.js"), "utf8");
const snapshotStart = appSource.indexOf("function snapshot()");
const snapshotEnd = appSource.indexOf("function redraw", snapshotStart);
const snapshotSource = appSource.slice(snapshotStart, snapshotEnd);
assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, "editor snapshot exists");
for (const transientName of [
  "previewBrushes",
  "resolvedExtrusion",
  "extrusionCandidate",
  "extrusionAcquisitionDebug",
  "extrusionMatchDebug",
  "extrusionSolvedDebug",
])
  assert.equal(
    snapshotSource.includes(transientName),
    false,
    `editor snapshots exclude transient ${transientName}`,
  );
assert.equal(
  (appSource.match(/history\.push\(snapshot\(\)\)/g) || []).length,
  3,
  "all history writes consume the persistent editor snapshot",
);
const hmrSaveStart = appSource.indexOf("function saveHmrState");
const hmrSaveEnd = appSource.indexOf("function restoreHmrState", hmrSaveStart);
assert.ok(
  appSource.slice(hmrSaveStart, hmrSaveEnd).includes("...snapshot()"),
  "reload persistence consumes the persistent editor snapshot",
);
const exportStart = appSource.indexOf("async function exportVMF");
const exportEnd = appSource.indexOf("const escapeHtml", exportStart);
assert.ok(
  appSource.slice(exportStart, exportEnd).includes("writeVMF(state.brushes)"),
  "VMF export consumes committed state brushes only",
);
const commitStart = appSource.indexOf("function commitFaceExtrusion");
const commitEnd = appSource.indexOf("function run", commitStart);
const commitSource = appSource.slice(commitStart, commitEnd);
assert.ok(commitStart >= 0 && commitEnd > commitStart, "extrusion commit exists");
assert.equal(
  /\b(?:limitExtrusionDistance|extrudeSelectedFaces)\s*\(/.test(commitSource),
  false,
  "extrusion commit consumes resolved geometry without rebuilding it",
);
assert.ok(
  commitSource.includes("assignExtrusionBrushIds(resolved.brushes, state.brushes)"),
  "extrusion commit assigns permanent IDs to the resolved brushes",
);
assert.ok(
  commitSource.indexOf("assignExtrusionBrushIds(resolved.brushes, state.brushes)") <
    commitSource.indexOf("state.faceSelection = new Set(resolved.selection)"),
  "permanent IDs are assigned before committed selection state changes",
);
assert.ok(
  commitSource.indexOf("assignExtrusionBrushIds(resolved.brushes, state.brushes)") <
    commitSource.indexOf('add(resolved.brushes, "Faces extruded")'),
  "permanent IDs are assigned before brushes enter persistent editor state",
);

const viewportSource = fs.readFileSync(path.join(publicJs, "viewport.js"), "utf8");
const previewStart = viewportSource.indexOf(
  'if (this.drag.type === "face-extrude") {',
  viewportSource.indexOf('addEventListener("pointermove"'),
);
const previewEnd = viewportSource.indexOf(
  'if (this.drag.type === "pan")',
  previewStart,
);
const previewSource = viewportSource.slice(previewStart, previewEnd);
assert.ok(previewStart >= 0 && previewEnd > previewStart, "extrusion preview exists");
assert.equal(
  /\b(?:limitExtrusionDistance|extrudeSelectedFaces)\s*\(/.test(previewSource),
  false,
  "pointer preview consumes one resolved extrusion",
);
const releaseStart = viewportSource.indexOf(
  'if (this.drag.type === "face-extrude") {',
  viewportSource.indexOf('addEventListener("pointerup"'),
);
const releaseEnd = viewportSource.indexOf(
  'if (this.drag.type === "object-transform")',
  releaseStart,
);
const releaseSource = viewportSource.slice(releaseStart, releaseEnd);
assert.ok(releaseStart >= 0 && releaseEnd > releaseStart, "extrusion release exists");
for (const cleanup of [
  "this.previewBrushes = []",
  "this.drag = null",
  "this.extrusionCandidate = null",
  "this.extrusionAcquisitionDebug = null",
  "this.extrusionMatchDebug = []",
  "this.extrusionSolvedDebug = null",
])
  assert.ok(
    releaseSource.includes(cleanup),
    `extrusion release clears transient cache: ${cleanup}`,
  );
console.log("static frontend contracts passed");
