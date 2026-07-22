import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindExtrusionModeButtons } from "../public/js/extrusion-policy.js";

const appSource = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const markupStart = appSource.indexOf("facePanel.innerHTML =");
const bindingStart = appSource.indexOf("bindExtrusionModeButtons(facePanel");
assert.ok(markupStart >= 0, "face panel markup is initialized");
assert.ok(bindingStart > markupStart, "face panel controls bind after markup");
for (const selector of [
  "data-face-mode",
  "data-face-side-material",
  "data-face-top-material",
  'data-extrude-mode=\"parallel\"',
  'data-extrude-mode=\"snap\"',
  'data-extrude-mode=\"forward-snap\"',
])
  assert.ok(appSource.includes(selector), `face panel contains ${selector}`);

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

const buttons = [
  makeButton("parallel"),
  makeButton("snap"),
  makeButton("forward-snap"),
];
const state = { faceExtrusionMode: "snap" };
bindExtrusionModeButtons({ querySelectorAll: () => buttons }, state);
for (const button of buttons) {
  button.click();
  assert.equal(state.faceExtrusionMode, button.dataset.extrudeMode);
  assert.equal(button.active, true);
  assert.equal(button.ariaPressed, "true");
}

console.log("face panel startup regression passed");
