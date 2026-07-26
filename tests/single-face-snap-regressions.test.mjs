import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Viewport } from "../public/js/viewport.js";
import { solveSingleFaceExtrusion } from "../public/js/face-extrusion.js";

const fixtureRoot = new URL("./fixtures/extrusion/", import.meta.url);
const loadFixture = (name) => {
  const url = new URL(`${name}/fixture.json`, fixtureRoot);
  return { data: JSON.parse(readFileSync(url, "utf8")), url };
};
const replay = (fixture) => {
  const viewport = Object.create(Viewport.prototype);
  viewport.state = {
    brushes: structuredClone(fixture.editor.brushes),
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
  viewport.rect = { width: fixture.viewport.width, height: fixture.viewport.height };
  viewport.screen = (point) => ({
    x: viewport.rect.width / 2 + point.x * viewport.scale,
    y: viewport.rect.height / 2 - point.y * viewport.scale,
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
  return { viewport, rawDistance, resolved: viewport.extrusionCandidate?.resolved };
};
const assertClose = (actual, expected, message) => {
  if (typeof expected === "number") {
    assert.ok(Math.abs(actual - expected) < 0.000001, message);
    return;
  }
  if (expected === null || typeof expected !== "object") {
    assert.equal(actual, expected, message);
    return;
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, message);
    expected.forEach((item, index) => assertClose(actual[index], item, message));
    return;
  }
  for (const key of Object.keys(expected))
    assertClose(actual[key], expected[key], message);
};
const geometry = (brushes) =>
  brushes.map((brush) => ({
    sourceBrushId: brush.generator?.sourceBrushId,
    vertices: brush.vertices,
    faces: brush.faces,
  }));

{
  const { data: fixture, url } = loadFixture("single-face-dual-brush-squeeze");
  const { viewport, rawDistance, resolved } = replay(fixture);
  assert.ok(Math.abs(rawDistance - fixture.expected.rawDistance) < 0.000001);
  assert.ok(resolved, "dual-brush squeeze resolves an external rail pair");
  const sides = resolved.constraints.filter((item) => item.movingEdge !== "cap");
  assert.deepEqual(sides.map((item) => item.movingEdge), fixture.expected.constraintEdges);
  assert.deepEqual(sides.map((item) => item.targetBrushId), fixture.expected.targetBrushIds);
  assert.deepEqual(sides.map((item) => item.targetFaceIndex), fixture.expected.targetFaceIndices);
  assert.equal(new Set(sides.map((item) => item.canonicalKey)).size, 2);
  assert.equal(viewport.drag.startRailState, "locked");
  assertClose(
    viewport.extrusionAcquisitionDebug,
    fixture.acquisition.candidatePools,
    "recorded dual-rail candidate pools",
  );
  assertClose(sides, fixture.acquisition.chosenConstraints, "chosen dual rails");
  assertClose(resolved.finalCorners, fixture.expected.finalCorners, "dual-rail corners");
  assertClose(resolved.solvedEdges, fixture.expected.solvedEdges, "dual-rail edges");
  assert.equal(resolved.blocked, false);
  assert.equal(resolved.previewBrushes[0], resolved.brushes[0]);
  assertClose(
    geometry(resolved.previewBrushes),
    fixture.expected.previewGeometry,
    "dual-rail preview geometry",
  );
  assertClose(
    geometry(resolved.brushes),
    fixture.expected.committedGeometry,
    "dual-rail commit geometry",
  );
  const reversed = sides.map((constraint) => ({
    ...constraint,
    direction: { x: -constraint.direction.x, y: -constraint.direction.y },
    targetStartWorld: constraint.targetEndWorld,
    targetEndWorld: constraint.targetStartWorld,
  }));
  const reversedResult = solveSingleFaceExtrusion({
    brush: viewport.state.brushes.find((brush) => brush.id === "imported-50000"),
    faceIndex: 5,
    distance: fixture.gesture.rawDistance,
    activeAxes: ["x", "y", "z"],
    constraints: reversed,
    followAdjacentSides: true,
    mirrorSingleSide: true,
    maxSourceAngleDegrees: fixture.editor.faceSourceMaxAngle,
  });
  assert.ok(reversedResult, "reversed target rails remain solvable");
  assertClose(reversedResult.capA, resolved.finalCorners.capA, "reversed sideA");
  assertClose(reversedResult.capB, resolved.finalCorners.capB, "reversed sideB");
  assert.ok(existsSync(new URL(fixture.expected.screenshot, url)));
}

{
  const { data: fixture, url } = loadFixture("single-face-inner-corner-v-rejection");
  const { viewport, rawDistance, resolved } = replay(fixture);
  assert.ok(Math.abs(rawDistance - fixture.expected.rawDistance) < 0.000001);
  assert.ok(resolved, "inner-corner fixture preserves a resolved blocked preview");
  assert.equal(resolved.finalDistance, fixture.expected.finalDistance);
  assert.equal(resolved.blocked, true);
  assert.equal(resolved.blockedReason, fixture.expected.blockedReason);
  assertClose(
    viewport.extrusionAcquisitionDebug,
    fixture.acquisition.candidatePools,
    "recorded inner-corner candidate pools",
  );
  assertClose(resolved.finalCorners, fixture.expected.finalCorners, "blocked corners");
  assertClose(resolved.solvedEdges, fixture.expected.solvedEdges, "blocked edges");
  assert.deepEqual(resolved.brushes, fixture.expected.committedGeometry);
  assert.ok(resolved.previewBrushes.length, "blocked inner-corner result keeps a red preview");
  assertClose(
    geometry(resolved.previewBrushes),
    fixture.expected.previewGeometry,
    "blocked preview geometry",
  );
  assert.ok(existsSync(new URL(fixture.expected.screenshot, url)));
}

console.log("single-face Snap regressions passed");
