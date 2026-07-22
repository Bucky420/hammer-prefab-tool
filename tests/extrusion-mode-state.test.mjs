import assert from "node:assert/strict";

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

await new Promise((r) => queueMicrotask(r));
delete globalThis.document;
console.log("extrusion mode state regression passed");
