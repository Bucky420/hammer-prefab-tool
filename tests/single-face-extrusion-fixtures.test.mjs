import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Viewport } from "../public/js/viewport.js";

const fixtureUrl = new URL(
  "./fixtures/extrusion/single-face-finite-cap-edge/fixture.json",
  import.meta.url,
);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const brushesBefore = structuredClone(fixture.editor.brushes);
const viewport = Object.create(Viewport.prototype);
viewport.state = {
  brushes: fixture.editor.brushes,
  grid: fixture.editor.grid,
  faceExtrusionMode: fixture.editor.extrusionMode,
  faceRailMaxAngle: fixture.editor.faceRailMaxAngle,
  faceSourceMaxAngle: fixture.editor.faceSourceMaxAngle,
  hiddenBrushes: new Set(fixture.editor.hiddenBrushes),
};
viewport.drag = {
  selection: new Set(fixture.editor.faceSelection),
  guideSelection: new Set(fixture.editor.faceSelection),
  capEndpointMagnet: new Map(),
};
viewport.kind = fixture.editor.view;
viewport.scale = fixture.viewport.scale;
viewport.offset = fixture.viewport.offset;
viewport.rect = {
  width: fixture.viewport.canvasWidth,
  height: fixture.viewport.canvasHeight,
};
viewport.screen = (vertex) => ({
  x: viewport.rect.width / 2 + vertex.x * viewport.scale,
  y: viewport.rect.height / 2 - vertex.y * viewport.scale,
});
viewport.world = (point) => ({
  x: (point.x - viewport.rect.width / 2) / viewport.scale,
  y: -(point.y - viewport.rect.height / 2) / viewport.scale,
  z: 0,
});

const rawDistance = viewport.faceExtrusionDistance(
  fixture.editor.faceSelection[0],
  fixture.gesture.pointerStart,
  fixture.gesture.pointerEnd,
);
const resolved = viewport.extrusionCandidate?.resolved;
assert.ok(resolved, "fixture acquires a resolved single-face extrusion");
const normalizedConstraints = resolved.constraints.map((constraint) => ({
  movingEdge: constraint.movingEdge,
  direction: constraint.direction,
  origin: constraint.origin,
  targetBrushId: constraint.targetBrushId,
  targetFaceIndex: constraint.targetFaceIndex,
  targetStart: constraint.targetStart,
  targetEnd: constraint.targetEnd,
  targetStartWorld: constraint.targetStartWorld,
  targetEndWorld: constraint.targetEndWorld,
  cornerSnap: constraint.cornerSnap,
}));
const normalizedGeometry = (brushes) =>
  brushes.map((brush) => ({
    sourceBrushId: brush.generator?.sourceBrushId,
    vertices: brush.vertices,
    faces: brush.faces,
  }));

assert.deepEqual(fixture.editor.brushes, brushesBefore, "fixture replay is pure");
assert.equal(rawDistance, fixture.gesture.exactDistance);
assert.equal(resolved.rawDistance, fixture.expected.rawDistance);
assert.equal(resolved.finalDistance, fixture.expected.finalDistance);
assert.deepEqual(
  normalizedConstraints,
  fixture.acquisition.chosenConstraints,
  "cap acquisition preserves the finite target edge and boundary face",
);
assert.deepEqual(resolved.finalCorners, fixture.expected.finalCorners);
assert.deepEqual(resolved.solvedEdges, fixture.expected.solvedEdges);
assert.equal(resolved.blocked, fixture.expected.blocked);
assert.equal(resolved.blockedReason, fixture.expected.blockedReason);
assert.deepEqual(resolved.errors, fixture.expected.errors);
assert.equal(
  resolved.previewBrushes[0],
  resolved.brushes[0],
  "preview and commit retain the exact resolved brush object",
);
assert.deepEqual(
  normalizedGeometry(resolved.previewBrushes),
  fixture.expected.previewGeometry,
  "preview geometry stops at the finite target endpoint",
);
assert.deepEqual(
  normalizedGeometry(resolved.brushes),
  fixture.expected.committedGeometry,
  "committed geometry is the recorded resolved preview",
);
assert.ok(
  existsSync(new URL(fixture.expected.screenshot, fixtureUrl)),
  "fixture includes its browser screenshot",
);

console.log("single-face extrusion browser fixtures passed");
