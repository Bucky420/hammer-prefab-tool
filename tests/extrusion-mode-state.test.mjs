import assert from "node:assert/strict";

const parallelControl = { classList: { toggle: () => {} }, setAttribute: () => {} };
const snapControl = { classList: { toggle: () => {} }, setAttribute: () => {} };
globalThis.document = {
  querySelector(selector) {
    if (selector === "[data-extrusion-parallel]") return parallelControl;
    if (selector === "[data-extrusion-snap]") return snapControl;
    return null;
  },
};

const { HP } = await import(
  `../public/js/namespace.js?extrusion-mode-test=${Date.now()}`
);

let parallelActive = null;
parallelControl.classList.toggle = (cls, val) => {
  if (cls === "active") parallelActive = val;
};
parallelControl.setAttribute = (k, v) => {
  if (k === "aria-pressed") parallelActive = v === "true";
};

let snapActive = null;
snapControl.classList.toggle = (cls, val) => {
  if (cls === "active") snapActive = val;
};
snapControl.setAttribute = (k, v) => {
  if (k === "aria-pressed") snapActive = v === "true";
};

HP.state.faceExtrusionMode = "normal";
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  parallelActive,
  false,
  "setting Face normal must deactivate the Parallel label",
);

HP.state.faceExtrusionMode = "parallel";
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  parallelActive,
  true,
  "setting Parallel must activate the Parallel label",
);

HP.state.faceExtrusionMode = "unexpected-value";
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  parallelActive,
  false,
  "unknown extrusion modes must safely fall back to Face normal",
);

HP.state.faceSnapEnabled = true;
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  snapActive,
  true,
  "toggling faceSnapEnabled true must activate the Snap label",
);

HP.state.faceSnapEnabled = false;
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  snapActive,
  false,
  "toggling faceSnapEnabled false must deactivate the Snap label",
);

delete globalThis.document;
console.log("extrusion mode state regression passed");
