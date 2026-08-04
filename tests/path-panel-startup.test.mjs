import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(
  new URL("../public/js/app.js", import.meta.url),
  "utf8",
);
const viewport = readFileSync(
  new URL("../public/js/viewport.js", import.meta.url),
  "utf8",
);

assert.match(app, /data-tool-mode="path"/);
assert.match(app, /<strong>PATH TOOLS<\/strong>/);
assert.match(app, /data-path-type><option value="hallway">Hallway<\/option>/);
assert.doesNotMatch(app, /data-path-type[^`]*(?:Road|Tunnel)/);
assert.match(app, /generateHallway\(\{/);
assert.match(app, /function commitHallway\(assemblyId, brushes\)/);
assert.match(app, /event\.key === "Backspace" && state\.mode === "path"/);
assert.match(app, /state\.mode === "path"[\s\S]*view\.commitPath\(\)/);

const faceMarkup = app.slice(
  app.indexOf("facePanel.innerHTML ="),
  app.indexOf("const faceModeSelect"),
);
assert.doesNotMatch(faceMarkup, /Hallway|Path/);
assert.match(viewport, /this\.kind !== "top"/);
assert.match(viewport, /type: "path-node"/);
assert.match(viewport, /point\[vertical\] = roundToGrid/);

console.log("path panel startup regression passed");
