import assert from "node:assert/strict";
import {
  assertBrushGeometry,
  assertBrushesGeometry,
  assertFinitePoint,
} from "../public/js/geometry-runtime.js";

const validBrush = {
  id: "test-brush",
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
  ],
  faces: [[0, 1, 2], [0, 2, 3]],
};

assert.doesNotThrow(() => assertFinitePoint({ x: 1, y: 2, z: 3 }, "valid"));
assert.doesNotThrow(() => assertBrushGeometry(validBrush, "valid"));
assert.doesNotThrow(() => assertBrushesGeometry([validBrush], "valid"));
assert.throws(
  () => assertFinitePoint({ x: undefined, y: 2, z: 3 }, "preview"),
  /Invalid geometry point at preview/,
);
assert.throws(
  () =>
    assertBrushGeometry(
      { ...validBrush, faces: [[0, 1, 99]] },
      "generated brush",
    ),
  /generated brush face 0 references missing vertex 99/,
);

console.log("geometry runtime checks passed");
