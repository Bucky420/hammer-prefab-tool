import assert from "node:assert/strict";
import {
  bindExtrusionModeButtons,
  railWithinAngleLimit,
} from "../public/js/extrusion-policy.js";

globalThis.document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

const { HP } = await import(
  `../public/js/namespace.js?extrusion-mode-test=${Date.now()}`
);

assert.equal(HP.state.faceExtrusionMode, "straight", "default mode is straight");
assert.equal(HP.state.faceRailMaxAngle, 89, "default rail angle preserves behavior");
assert.equal(HP.state.faceSourceMaxAngle, 135, "default signed source angle");
HP.state.faceExtrusionMode = "parallel";
assert.equal(HP.state.faceExtrusionMode, "parallel", "parallel accepted");
HP.state.faceExtrusionMode = "forward-snap";
assert.equal(HP.state.faceExtrusionMode, "straight", "forward-snap is removed");
HP.state.faceExtrusionMode = "unexpected";
assert.equal(HP.state.faceExtrusionMode, "straight", "unknown falls back to straight");
assert.equal(typeof HP.state.faceSnapEnabled, "undefined", "old property removed");
const outward = { x: 1, y: 0 };
const railAt85Degrees = {
  x: Math.cos((85 * Math.PI) / 180),
  y: Math.sin((85 * Math.PI) / 180),
};
assert.equal(
  railWithinAngleLimit(railAt85Degrees, outward, 75),
  false,
  "near-perpendicular rail is rejected by a tighter cap",
);
assert.equal(
  railWithinAngleLimit(railAt85Degrees, outward, 89),
  true,
  "near-perpendicular rail remains available at the compatibility default",
);

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
const controls = [button("parallel"), button("snap")];
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
  control.click();
  assert.equal(HP.state.faceExtrusionMode, "straight");
  assert.equal(control.active, false);
  assert.equal(control.ariaPressed, "false");
}

await new Promise((r) => queueMicrotask(r));
delete globalThis.document;
console.log("extrusion mode state regression passed");
