import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) =>
  readFileSync(new URL(`../public/js/${name}`, import.meta.url), "utf8");
const app = source("app.js");

for (const [file, pattern] of [
  ["tool-rail.js", /data-tool-mode="path"/],
  ["selection-controls.js", /selection-scope-toggle/],
  ["grid-controls.js", /GRID_VALUES/],
  ["view-controls.js", /view-selector/],
  ["menu-bar.js", /data-menu/],
  ["context-menu.js", /contextmenu/],
  ["file-browser.js", /browser-list/],
  ["file-drop.js", /dragenter/],
  ["document-chrome.js", /dirty-indicator/],
])
  assert.match(source(file), pattern, `${file} owns its UI behavior`);

for (const pattern of [
  /data-tool-mode="path"/,
  /selection-scope-toggle/,
  /GRID_VALUES/,
  /\$\("view-selector"\)/,
  /querySelectorAll\("\[data-menu\]"\)/,
  /addEventListener\("contextmenu"/,
  /browser-list|file-search/,
  /addEventListener\("dragenter"/,
  /document-title|dirty-indicator|file-access-warning|autosave-status/,
])
  assert.doesNotMatch(app, pattern, `app composition excludes ${pattern}`);

console.log("UI module ownership regression passed");
