import assert from "node:assert/strict";
import {
  canonicalProjectHash,
  canonicalStringify,
  createDirtyStateService,
} from "../public/js/dirty-state.js";

const brush = {
  id: "brush-1",
  vertices: [{ x: 0, y: 0, z: 0 }],
  faces: [],
  metadata: { z: 2, a: 1 },
};
const base = {
  projectName: "Dirty test",
  brushes: [brush],
  grid: 16,
  selection: new Set(["brush-1"]),
  hiddenBrushes: new Set(),
  camera: { scale: 1 },
  view: "top",
};
const sessionChanged = {
  ...base,
  selection: new Set(),
  hiddenBrushes: new Set(["brush-1"]),
  camera: { scale: 20 },
  view: "side",
  mode: "vertex",
};

assert.equal(canonicalStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
assert.equal(canonicalProjectHash(base), canonicalProjectHash(sessionChanged));
assert.notEqual(
  canonicalProjectHash(base),
  canonicalProjectHash({ ...base, grid: 8 }),
);
assert.notEqual(
  canonicalProjectHash(base),
  canonicalProjectHash({
    ...base,
    brushes: [{ ...brush, material: "brick/wall" }],
  }),
);

const dirty = createDirtyStateService(base);
assert.equal(dirty.isDirty(), false);
assert.equal(
  dirty.update(sessionChanged),
  false,
  "session-only changes stay clean",
);
assert.equal(dirty.update({ ...base, projectName: "Renamed" }), true);
dirty.discard();
assert.equal(dirty.isDirty(), false);
dirty.markClean({ ...base, grid: 8 });
assert.equal(dirty.isDirty({ ...base, grid: 8 }), false);
assert.equal(dirty.isDirty(base), true);
dirty.reset();
assert.equal(dirty.cleanHash, null);
assert.equal(dirty.currentHash, null);

console.log("dirty state checks passed");
