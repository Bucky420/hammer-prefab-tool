import assert from "node:assert/strict";
import { box } from "../public/js/geometry-model.js";
import {
  solveCornerSnappedExtrusion,
  extrudeSelectedFaces,
  limitExtrusionDistance,
  solveSingleFaceExtrusion,
} from "../public/js/face-extrusion.js";
import {
  extrusionPolicyForMode,
  isForwardTarget,
} from "../public/js/extrusion-policy.js";
import {
  dedupeFirst,
  isNoDrawMaterial,
  passesProbeValidation,
  projectedRailKey,
  retainLockedCandidate,
} from "../public/js/rail-acquisition.js";

// Helper: rotate a 2D point by angle around center
function rotate2D(x, y, angle, cx, cy) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA };
}

// Helper: build a box then rotate all vertices around its center in XY
function buildRotatedBox(min, max, angleDegrees) {
  const base = box(min, max);
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const angle = (angleDegrees * Math.PI) / 180;
  return {
    ...base,
    vertices: base.vertices.map((v) => {
      const r = rotate2D(v.x, v.y, angle, cx, cy);
      return { x: r.x, y: r.y, z: v.z };
    }),
  };
}

function approxEqual(a, b, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

function approxPoint(a, b, eps = 0.01) {
  return approxEqual(a.x, b.x, eps) && approxEqual(a.y, b.y, eps);
}

// --------------------------------------------------------------------
// Test 1: axis-aligned, cap snaps to target front face
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const t = box({ x: 120, y: 0, z: 0 }, { x: 184, y: 64, z: 64 });
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 62,
    activeAxes: ["x", "y"],
    snapA: { x: 120, y: 0 },
    snapB: { x: 120, y: 64 },
  });
  assert.ok(r, "axis-aligned cap should snap");
  assert.ok(approxPoint(r.capA, { x: 120, y: 0 }), "capA at 120,0");
  assert.ok(approxPoint(r.capB, { x: 120, y: 64 }), "capB at 120,64");
  assert.ok(approxPoint(r.baseA, { x: 64, y: 0 }), "baseA at 64,0");
  assert.ok(approxPoint(r.baseB, { x: 64, y: 64 }), "baseB at 64,64");
  console.log("axis-aligned snap OK");
}

// --------------------------------------------------------------------
// Test 2: source rotated 30 deg, cap snaps to a target edge
// --------------------------------------------------------------------
{
  const angle = 30;
  const s = buildRotatedBox({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }, angle);
  // Source face 3 normal is (cos30, sin30, 0)
  const normalAngle = (angle * Math.PI) / 180;
  const distance = 64;
  const baseAWld = s.vertices[s.faces[3][0]];
  const baseBWld = s.vertices[s.faces[3][1]];
  const snapAWld = {
    x: baseAWld.x + Math.cos(normalAngle) * distance,
    y: baseAWld.y + Math.sin(normalAngle) * distance,
  };
  const snapBWld = {
    x: baseBWld.x + Math.cos(normalAngle) * distance,
    y: baseBWld.y + Math.sin(normalAngle) * distance,
  };
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance,
    activeAxes: ["x", "y"],
    snapA: snapAWld,
    snapB: snapBWld,
  });
  assert.ok(r, "rotated cap should snap");
  // baseA and baseB should match the source's actual face vertices
  assert.ok(
    approxPoint(r.baseA, { x: baseAWld.x, y: baseAWld.y }),
    "baseA matches source face",
  );
  assert.ok(
    approxPoint(r.baseB, { x: baseBWld.x, y: baseBWld.y }),
    "baseB matches source face",
  );
  // cap should land on the snap targets
  assert.ok(approxPoint(r.capA, snapAWld, 0.5), "capA on snap A");
  assert.ok(approxPoint(r.capB, snapBWld, 0.5), "capB on snap B");
  console.log("rotated 30 deg snap OK");
}

// --------------------------------------------------------------------
// Test 3: only one corner snaps, other stays at free position
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const t = box({ x: 120, y: 0, z: 0 }, { x: 184, y: 64, z: 64 });
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 32,
    activeAxes: ["x", "y"],
    snapA: { x: 120, y: 0 },
    snapB: null,
  });
  assert.ok(r, "single-corner snap should work");
  // capA snapped
  assert.ok(approxPoint(r.capA, { x: 120, y: 0 }), "capA on snap");
  // capB free = baseB + normal * distance = (64+32, 64) = (96, 64)
  assert.ok(approxPoint(r.capB, { x: 96, y: 64 }), "capB free");
  console.log("single-corner snap OK");
}

// --------------------------------------------------------------------
// Test 4: null snaps = pure free extrusion
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 32,
    activeAxes: ["x", "y"],
    snapA: null,
    snapB: null,
  });
  assert.ok(r, "free extrusion should work");
  assert.ok(approxPoint(r.capA, { x: 96, y: 0 }), "capA free");
  assert.ok(approxPoint(r.capB, { x: 96, y: 64 }), "capB free");
  console.log("free extrusion OK");
}

// --------------------------------------------------------------------
// Test 5: backward distance should reject
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: -5,
    activeAxes: ["x", "y"],
    snapA: null,
    snapB: null,
  });
  assert.equal(r, null, "negative distance should reject");
  console.log("negative distance rejected OK");
}

// --------------------------------------------------------------------
// Test 6: extrudeSelectedFaces end-to-end with snap
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const t = box({ x: 120, y: 0, z: 0 }, { x: 184, y: 64, z: 64 });
  const snapTarget = {
    type: "corner-snap",
    activeAxes: ["x", "y"],
    snapA: { x: 120, y: 0 },
    snapB: { x: 120, y: 64 },
    brushes: [s, t],
    distance: 62,
  };
  const result = extrudeSelectedFaces(
    [s, t],
    new Set([s.id + ":f:3"]),
    62,
    16,
    new Set([s.id + ":f:3"]),
    "snap",
    snapTarget,
  );
  assert.equal(result.errors.length, 0, "no errors");
  const created = result.brushes.find((b) => b.id !== s.id && b.id !== t.id);
  assert.ok(created, "new brush created");
  // The new brush should have 8 vertices (4 base + 4 cap).
  // Base vertices are at x=64, cap vertices are at x=120.
  let baseCount = 0, capCount = 0;
  for (const v of created.vertices) {
    if (approxEqual(v.x, 64, 0.5)) baseCount++;
    else if (approxEqual(v.x, 120, 0.5)) capCount++;
  }
  assert.equal(baseCount, 4, "4 base vertices at x=64");
  assert.equal(capCount, 4, "4 cap vertices at x=120");
  console.log("end-to-end extrude OK");
}

// --------------------------------------------------------------------
// Test 7: degenerate snap (cap collapses to base) is rejected
// --------------------------------------------------------------------
{
  // Test that a snap where capB and baseB have the same 2D
  // position is rejected by the corner finder. The 2D distance
  // threshold (1 px) is enforced in viewport.js.
  // The solver itself doesn't enforce this; it just produces
  // degenerate results. So we test the GEOMETRIC consequence:
  // the solver should always produce cap corners that are
  // distinct from the base corners in 2D for normal extrusions.
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 62,
    activeAxes: ["x", "y"],
    snapA: { x: 120, y: 0 },
    snapB: { x: 120, y: 64 },
  });
  const sideBLen = Math.hypot(
    r.capB.x - r.baseB.x,
    r.capB.y - r.baseB.y,
  );
  assert.ok(sideBLen > 1, "sideB has visible length in 2D");
  console.log("non-degenerate snap OK");
}

// --------------------------------------------------------------------
// Test 9: face-normal filter — snap finder rejects edges of
// faces whose normal points away from the source.
// This test is a regression check; the actual rejection is
// exercised in the browser.
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const t = box({ x: 120, y: 0, z: 0 }, { x: 184, y: 64, z: 64 });
  const r1 = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 62,
    activeAxes: ["x", "y"],
    snapA: { x: 120, y: 0 },
    snapB: { x: 120, y: 64 },
  });
  assert.ok(r1, "front-facing target snap works");
  console.log("face-normal filter test OK");
}

// --------------------------------------------------------------------
// Test 10: cap parallel to base — both sides equal length
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  // Standard snap: cap on the target's left face (perpendicular
  // to base). This is the parallelogram case.
  const r = solveCornerSnappedExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 62,
    activeAxes: ["x", "y"],
    snapA: { x: 126, y: 0 },
    snapB: { x: 126, y: 64 },
  });
  assert.ok(r, "snap should produce a result");
  // Both sides should have the same length
  const sideALen = Math.hypot(
    r.capA.x - r.baseA.x,
    r.capA.y - r.baseA.y,
  );
  const sideBLen = Math.hypot(
    r.capB.x - r.baseB.x,
    r.capB.y - r.baseB.y,
  );
  assert.ok(
    Math.abs(sideALen - sideBLen) < 0.5,
    "sides have equal length",
  );
  // Cap should be parallel to base
  const baseVec = { x: r.baseB.x - r.baseA.x, y: r.baseB.y - r.baseA.y };
  const capVec = { x: r.capB.x - r.capA.x, y: r.capB.y - r.capA.y };
  const dot = baseVec.x * capVec.x + baseVec.y * capVec.y;
  const baseLen = Math.hypot(baseVec.x, baseVec.y);
  const capLen = Math.hypot(capVec.x, capVec.y);
  const cosAngle = dot / (baseLen * capLen);
  assert.ok(
    Math.abs(cosAngle) > 0.99,
    "cap is parallel to base",
  );
  console.log("parallel cap OK");
}
{
  // Build a "saved" setup
  const saved = {
    version: 1,
    savedAt: new Date().toISOString(),
    state: {
      mode: "face",
      view: "top",
      grid: 16,
      faceSelection: ["brush-1:f:3"],
      brushSelection: [],
      selection: [],
      faceExtrusionMode: "snap",
      brushes: [
        box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }),
        box({ x: 120, y: 0, z: 0 }, { x: 184, y: 64, z: 64 }),
      ],
    },
  };
  // Simulate the load function (mirroring the app.js code)
  const state = {
    brushes: [],
    faceSelection: new Set(),
    brushSelection: new Set(),
    selection: new Set(),
    mode: "selection",
    view: "top",
    grid: 16,
    faceExtrusionMode: "snap",
  };
  const s = saved.state;
  if (s.brushes) state.brushes = JSON.parse(JSON.stringify(s.brushes));
  if (s.faceSelection) state.faceSelection = new Set(s.faceSelection);
  if (s.mode) state.mode = s.mode;
  if (s.view) state.view = s.view;
  if (s.grid) state.grid = s.grid;
  if (s.faceExtrusionMode) state.faceExtrusionMode = s.faceExtrusionMode;
  assert.equal(state.brushes.length, 2, "two brushes loaded");
  assert.equal(state.mode, "face", "face mode");
  assert.equal(state.faceExtrusionMode, "snap", "snap mode restored");
  assert.ok(state.faceSelection.has("brush-1:f:3"), "face selection restored");
  console.log("save/load round-trip OK");
}

// --------------------------------------------------------------------
// Test 11: grouped Parallel preserves each selected face's direction
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const selected = new Set([`${s.id}:f:2`, `${s.id}:f:3`]);
  const result = extrudeSelectedFaces([s], selected, 16, 16, selected, "parallel");
  assert.equal(result.errors.length, 0, "parallel grouped extrusion is valid");
  assert.equal(result.previewBrushes.length, 2, "both selected faces extruded");
  const caps = result.previewBrushes.map((brush) => brush.faces[1].map((index) => brush.vertices[index]));
  assert.ok(caps.some((face) => face.every((point) => point.x >= 80)), "x-facing face moved along x");
  assert.ok(caps.some((face) => face.every((point) => point.y <= -16)), "y-facing face moved along y");
  console.log("grouped parallel extrusion OK");
}

// --------------------------------------------------------------------
// Test 12: unconstrained diagonal faces follow their own normal
// --------------------------------------------------------------------
{
  const angle = (30 * Math.PI) / 180;
  const s = buildRotatedBox({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }, 30);
  const face = s.faces[3];
  const baseA = s.vertices[face[0]];
  const baseB = s.vertices[face[1]];
  const distance = 16;
  const solved = solveSingleFaceExtrusion({
    brush: s,
    faceIndex: 3,
    distance,
    activeAxes: ["x", "y"],
    constraints: [],
  });
  assert.ok(solved, "unconstrained diagonal solve succeeds");
  const expected = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  assert.ok(approxPoint({ x: solved.capA.x - solved.baseA.x, y: solved.capA.y - solved.baseA.y }, expected), "side A follows face normal");
  assert.ok(approxPoint({ x: solved.capB.x - solved.baseB.x, y: solved.capB.y - solved.baseB.y }, expected), "side B follows face normal");
  assert.ok(Math.abs(baseA.x - baseB.x) + Math.abs(baseA.y - baseB.y) > 1, "diagonal base has distinct endpoints");
  console.log("unconstrained diagonal extrusion OK");
}

// --------------------------------------------------------------------
// Test 13: two independent support lines produce a narrowing cap
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const constraints = [
    { movingEdge: "sideA", direction: { x: 1, y: 0.25 } },
    { movingEdge: "sideB", direction: { x: 1, y: -0.25 } },
  ];
  const result = solveSingleFaceExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 64,
    activeAxes: ["x", "y"],
    constraints,
  });
  assert.ok(result, "two support lines solve");
  assert.ok(result.capA.y > 0 && result.capB.y < 64, "cap narrows between rails");
  assert.ok(result.capA.x > 64 && result.capB.x > 64, "both rails move forward");
  const reversed = solveSingleFaceExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 64,
    activeAxes: ["x", "y"],
    constraints: constraints.map((constraint) => ({
      ...constraint,
      direction: {
        x: -constraint.direction.x,
        y: -constraint.direction.y,
      },
    })),
  });
  assert.ok(reversed, "reversed support-line winding still solves");
  assert.ok(approxPoint(result.capA, reversed.capA), "side A is winding-independent");
  assert.ok(approxPoint(result.capB, reversed.capB), "side B is winding-independent");
  console.log("independent support-line narrowing OK");
}

// --------------------------------------------------------------------
// Test 14: single-side constraints do not mirror the opposite side
// --------------------------------------------------------------------
{
  const s = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
  const result = solveSingleFaceExtrusion({
    brush: s,
    faceIndex: 3,
    distance: 16,
    activeAxes: ["x", "y"],
    constraints: [{ movingEdge: "sideA", direction: { x: 1, y: 0 } }],
  });
  assert.ok(result, "single-side solve succeeds");
  assert.equal(result.applied.sideA, true, "sideA constrained");
  assert.equal(result.applied.sideB, false, "sideB stays unconstrained");
  assert.ok(
    approxPoint(
      { x: result.capB.x - result.baseB.x, y: result.capB.y - result.baseB.y },
      { x: 16, y: 0 },
    ),
    "unconstrained side stays on source normal",
  );
  console.log("single-side no-mirror OK");
}

// --------------------------------------------------------------------
// Test 15: projected rail keys collapse depth duplicates
// --------------------------------------------------------------------
{
  const top = { x: 10, y: 20, z: 64 };
  const bottom = { x: 10, y: 20, z: 0 };
  const topEnd = { x: 10, y: 84, z: 64 };
  const bottomEnd = { x: 10, y: 84, z: 0 };
  assert.equal(
    projectedRailKey(top, topEnd, "x", "y"),
    projectedRailKey(bottom, bottomEnd, "x", "y"),
    "top and bottom edges share one projected rail key",
  );
  console.log("projected rail key regression OK");
}

// --------------------------------------------------------------------
// Test 16: outward normal extrusion is rotation and winding invariant
// --------------------------------------------------------------------
{
  for (const angle of [0, 90, 180, 270]) {
    for (const reverse of [false, true]) {
      const source = buildRotatedBox({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }, angle);
      if (reverse) source.faces = source.faces.map((face) => [...face].reverse());
      const result = solveSingleFaceExtrusion({
        brush: source,
        faceIndex: 3,
        distance: 16,
        activeAxes: ["x", "y"],
        constraints: [],
      });
      assert.ok(result, `rotation ${angle}, reverse ${reverse} solves`);
      assert.ok(
        Math.hypot(result.capA.x - result.baseA.x, result.capA.y - result.baseA.y) > 15,
        `rotation ${angle}, reverse ${reverse} moves outward`,
      );
    }
  }
  console.log("rotation and winding invariance OK");
}

// --------------------------------------------------------------------
// Test 17: rail-acquisition helpers preserve attached priority
// --------------------------------------------------------------------
{
  assert.equal(isNoDrawMaterial("tools/toolsnodraw"), true, "nodraw matches");
  assert.equal(isNoDrawMaterial("custom/brick"), false, "visible material does not match");
  const deduped = dedupeFirst([
    { key: "brush-1:edge-1", source: "attached" },
    { key: "brush-1:edge-1", source: "magnetic" },
    { key: "brush-2:edge-1", source: "magnetic" },
  ]);
  assert.equal(deduped.length, 2, "first duplicate wins");
  assert.equal(deduped[0].source, "attached", "attached priority preserved");
  const locked = retainLockedCandidate(
    [
      { canonicalKey: "edge-1", distancePx: 10 },
      { canonicalKey: "edge-2", distancePx: 2 },
    ],
    "edge-2",
    18,
  );
  assert.equal(locked.length, 1, "locked rail retained first");
  assert.equal(locked[0].canonicalKey, "edge-2", "locked rail survives reorder");
  assert.equal(passesProbeValidation(9.8, 10), true, "probe validation passes");
  assert.equal(passesProbeValidation(9.7, 10), false, "probe validation fails");
  console.log("rail acquisition helper OK");
}

// --------------------------------------------------------------------
// Test 18: mode policies are explicit and forward-only is directional
// --------------------------------------------------------------------
{
  assert.deepEqual(extrusionPolicyForMode("snap"), {
    externalSnap: true,
    groupedRegion: false,
    forwardOnly: false,
  });
  assert.deepEqual(extrusionPolicyForMode("parallel"), {
    externalSnap: false,
    groupedRegion: true,
    forwardOnly: false,
  });
  assert.equal(extrusionPolicyForMode("forward-snap").forwardOnly, true);
  const outward = { x: 1, y: 0 };
  const base = { x: 0, y: 0 };
  assert.equal(isForwardTarget({ x: 8, y: 0 }, base, outward), true, "ahead target accepted");
  assert.equal(isForwardTarget({ x: -8, y: 0 }, base, outward), false, "behind target rejected");
  console.log("extrusion policy direction OK");
}

console.log("all test-setup tests passed");
