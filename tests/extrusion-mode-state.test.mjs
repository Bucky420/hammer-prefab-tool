import assert from "node:assert/strict";
import { bindExtrusionModeButtons } from "../public/js/extrusion-policy.js";

globalThis.document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

const { HP } = await import(
  `../public/js/namespace.js?extrusion-mode-test=${Date.now()}`
);

assert.equal(HP.state.faceExtrusionMode, "snap", "default mode is snap");
HP.state.faceExtrusionMode = "parallel";
assert.equal(HP.state.faceExtrusionMode, "parallel", "parallel accepted");
HP.state.faceExtrusionMode = "forward-snap";
assert.equal(HP.state.faceExtrusionMode, "forward-snap", "forward-snap accepted");
HP.state.faceExtrusionMode = "unexpected";
assert.equal(HP.state.faceExtrusionMode, "snap", "unknown falls back to snap");
assert.equal(typeof HP.state.faceSnapEnabled, "undefined", "old property removed");

function button(mode) {
  const listeners = new Map();
  return {
    dataset: { extrudeMode: mode },
    active: false,
    ariaPressed: "false",
    classList: {
      toggle(name, value) {
        if (name === "active") this.owner.active = value;
      },
      owner: null,
    },
    setAttribute(name, value) {
      if (name === "aria-pressed") this.ariaPressed = value;
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
}
const controls = [button("parallel"), button("snap"), button("forward-snap")];
controls.forEach((control) => (control.classList.owner = control));
bindExtrusionModeButtons(
  { querySelectorAll: () => controls },
  HP.state,
);
for (const control of controls) {
  control.click();
  assert.equal(HP.state.faceExtrusionMode, control.dataset.extrudeMode);
  assert.equal(control.active, true);
  assert.equal(control.ariaPressed, "true");
}

await new Promise((r) => queueMicrotask(r));
delete globalThis.document;
console.log("extrusion mode state regression passed");
