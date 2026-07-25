import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveExtrusion } from "../public/js/face-extrusion.js";

const fixtureUrl = new URL(
  "./fixtures/extrusion/multi-face-selected-source-collision/fixture.json",
  import.meta.url,
);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const brushesBefore = structuredClone(fixture.editor.brushes);
const selection = new Set(fixture.editor.faceSelection);
const resolved = resolveExtrusion({
  sourceBrushes: fixture.editor.brushes,
  selection,
  rawDistance: fixture.gesture.exactDistance,
  grid: fixture.editor.grid,
  guideSelection: selection,
  mode: fixture.editor.extrusionMode,
});

const normalizedGeometry = (brushes) =>
  brushes.map((brush) => ({
    sourceBrushId: brush.generator?.sourceBrushId,
    vertices: brush.vertices,
    faces: brush.faces,
  }));
const epsilon = fixture.expected.distanceTolerance;
const assertGeometryClose = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((brush, brushIndex) => {
    const recorded = expected[brushIndex];
    assert.equal(brush.sourceBrushId, recorded.sourceBrushId, message);
    assert.deepEqual(brush.faces, recorded.faces, message);
    assert.equal(brush.vertices.length, recorded.vertices.length, message);
    brush.vertices.forEach((vertex, vertexIndex) => {
      const recordedVertex = recorded.vertices[vertexIndex];
      for (const axis of ["x", "y", "z"])
        assert.ok(
          Math.abs(vertex[axis] - recordedVertex[axis]) <= epsilon,
          `${message}: brush ${brushIndex} vertex ${vertexIndex} ${axis}`,
        );
    });
  });
};

assert.equal(fixture.schemaVersion, 1, "known extrusion fixture schema");
assert.deepEqual(
  fixture.editor.brushes,
  brushesBefore,
  "fixture replay does not mutate saved editor state",
);
assert.equal(resolved.rawDistance, fixture.expected.rawDistance);
assert.ok(
  Math.abs(resolved.finalDistance - fixture.expected.finalDistance) <= epsilon,
  `selected-source collision should stop near ${fixture.expected.finalDistance}, got ${resolved.finalDistance}`,
);
assert.equal(resolved.blocked, fixture.expected.blocked);
assert.equal(resolved.blockedReason, fixture.expected.blockedReason);
assert.deepEqual(resolved.finalCorners, fixture.expected.finalCorners);
assert.deepEqual(resolved.solvedEdges, fixture.expected.solvedEdges);
assertGeometryClose(
  normalizedGeometry(resolved.previewBrushes),
  fixture.expected.previewGeometry,
  "preview geometry matches the recorded contact result",
);
assertGeometryClose(
  normalizedGeometry(resolved.brushes),
  fixture.expected.committedGeometry,
  "the exact resolved brushes match recorded committed geometry",
);
assert.ok(
  existsSync(new URL(fixture.expected.screenshot, fixtureUrl)),
  "fixture includes its browser screenshot",
);
assert.equal(
  fileURLToPath(fixtureUrl).includes(fixture.name),
  true,
  "fixture directory and recorded name agree",
);

console.log("extrusion browser fixtures passed");
