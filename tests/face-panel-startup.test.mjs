import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindExtrusionModeButtons } from "../public/js/extrusion-policy.js";

const appSource = readFileSync(
  new URL("../public/js/app.js", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("../public/js/face-panel.js", import.meta.url),
  "utf8",
);
const markupStart = panelSource.indexOf("panel.innerHTML =");
const bindingStart = panelSource.indexOf("bindExtrusionModeButtons(panel");
const restoreStart = appSource.indexOf("function restore(data)");
const restoreEnd = appSource.indexOf("function saveHmrState", restoreStart);
assert.ok(markupStart >= 0, "face panel markup is initialized in its module");
assert.ok(bindingStart > markupStart, "face panel controls bind after markup");
assert.equal(
  appSource.includes("<strong>FACE TOOLS</strong>"),
  false,
  "app composition does not own face panel markup",
);
assert.ok(
  restoreStart >= 0 && restoreEnd > restoreStart,
  "restore function exists",
);
assert.equal(
  appSource
    .slice(restoreStart, restoreEnd)
    .includes("state.faceExtrusionMode ="),
  false,
  "geometry restore does not change the current extrusion mode",
);
for (const selector of [
  "data-face-mode",
  "data-face-side-material",
  "data-face-top-material",
  "data-face-rail-angle",
  "data-face-source-angle",
  'data-extrude-mode=\"parallel\"',
  'data-extrude-mode=\"snap\"',
])
  assert.ok(panelSource.includes(selector), `face panel contains ${selector}`);

function makeButton(mode) {
  const listeners = new Map();
  const button = {
    dataset: { extrudeMode: mode },
    active: false,
    ariaPressed: "false",
    classList: {
      toggle(name, value) {
        if (name === "active") button.active = value;
      },
    },
    setAttribute(name, value) {
      if (name === "aria-pressed") button.ariaPressed = value;
    },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    click() {
      listeners.get("click")?.({
        preventDefault() {},
        stopPropagation() {},
      });
    },
  };
  return button;
}

const buttons = [makeButton("parallel"), makeButton("snap")];
const state = { faceExtrusionMode: "straight" };
bindExtrusionModeButtons({ querySelectorAll: () => buttons }, state);
for (const button of buttons) {
  button.click();
  assert.equal(state.faceExtrusionMode, button.dataset.extrudeMode);
  assert.equal(button.active, true);
  assert.equal(button.ariaPressed, "true");
  button.click();
  assert.equal(state.faceExtrusionMode, "straight");
  assert.equal(button.active, false);
  assert.equal(button.ariaPressed, "false");
}

console.log("face panel startup regression passed");
