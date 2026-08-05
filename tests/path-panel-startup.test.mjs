import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(
  new URL("../public/js/app.js", import.meta.url),
  "utf8",
);
const vpInteraction = readFileSync(
  new URL("../public/js/viewport-interaction.js", import.meta.url),
  "utf8",
);
const vpPath = readFileSync(
  new URL("../public/js/viewport-path.js", import.meta.url),
  "utf8",
);
const viewport = vpInteraction + vpPath;
const panel = readFileSync(
  new URL("../public/js/path-panel.js", import.meta.url),
  "utf8",
);
const rail = readFileSync(
  new URL("../public/js/tool-rail.js", import.meta.url),
  "utf8",
);

assert.match(rail, /data-tool-mode="path"/);
assert.match(panel, /<strong>PATH TOOLS<\/strong>/);
assert.match(panel, /data-path-type><option value="hallway">Hallway<\/option>/);
assert.doesNotMatch(panel, /data-path-type[^`]*(?:Road|Tunnel)/);
assert.match(app, /generateHallway\(\{/);
assert.match(app, /acquirePathSource\(/);
assert.match(app, /function commitHallway\(assemblyId, brushes\)/);
assert.match(app, /event\.key === "Backspace" && state\.mode === "path"/);
assert.match(app, /state\.mode === "path"[\s\S]*view\.commitPath\(\)/);

assert.doesNotMatch(app, /<strong>PATH TOOLS<\/strong>|data-path-setting/);
assert.match(viewport, /this\.kind !== "top"/);
assert.match(viewport, /type: "path-node"/);
assert.match(viewport, /\[vertical\]: roundToGrid\(current\[vertical\]/);
assert.match(panel, /data-path-segment-mode/);
assert.match(panel, /data-path-node-mode/);
assert.match(panel, /data-path-close/);
assert.match(panel, /data-path-detach/);
assert.match(panel, /data-path-snap/);
assert.match(panel, /data-path-avoid/);
assert.match(panel, /data-path-setting="routeMargin"/);
assert.match(app, /routePathAroundBrushes\(/);
assert.match(viewport, /type: "path-width"/);
assert.match(viewport, /type: "path-height"/);
assert.match(viewport, /type: "path-tangent"/);
assert.match(viewport, /type: "path-move"/);

console.log("path panel startup regression passed");
