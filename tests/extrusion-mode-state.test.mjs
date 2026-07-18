import assert from "node:assert/strict";

const control = { value: "parallel" };
globalThis.document = {
  querySelector(selector) {
    assert.equal(selector, "[data-extrusion-mode]");
    return control;
  },
};

const { HP } = await import(
  `../public/js/namespace.js?extrusion-mode-test=${Date.now()}`
);

HP.state.faceExtrusionMode = "normal";
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  control.value,
  "normal",
  "restoring Face normal must update a dropdown that previously displayed Parallel",
);

HP.state.faceExtrusionMode = "parallel";
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  control.value,
  "parallel",
  "restoring Parallel must update a dropdown that previously displayed Face normal",
);

HP.state.faceExtrusionMode = "unexpected-value";
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(
  control.value,
  "normal",
  "unknown extrusion modes must safely fall back to Face normal",
);

delete globalThis.document;
console.log("extrusion mode state regression passed");
