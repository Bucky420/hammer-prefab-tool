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
    x: viewport.rect.width / 2 + point.x * viewport.scale + viewport.offset.x,
    y: viewport.rect.height / 2 - point.y * viewport.scale + viewport.offset.y,
  });
  viewport.world = (point) => ({
    x: (point.x - viewport.rect.width / 2 - viewport.offset.x) / viewport.scale,
    y: -(point.y - viewport.rect.height / 2 - viewport.offset.y) / viewport.scale,
    z: 0,
  });
  const rawDistance = viewport.faceExtrusionDistance(
    fixture.editor.faceSelection[0],
    fixture.gesture.pointerStart,
    fixture.gesture.pointerEnd,
  );
  return { viewport, rawDistance, resolved: viewport.extrusionCandidate?.resolved };
};
const replaySequence = (fixture, scenario) => {
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
    selection: new Set(scenario.faceSelection),
    guideSelection: new Set(scenario.faceSelection),
    capEndpointMagnet: new Map(),
  };
  viewport.kind = fixture.editor.view;
  viewport.scale = fixture.viewport.scale;
  viewport.offset = fixture.viewport.offset;
  viewport.rect = { width: fixture.viewport.width, height: fixture.viewport.height };
  viewport.screen = (point) => ({
    x: viewport.rect.width / 2 + point.x * viewport.scale + viewport.offset.x,
    y: viewport.rect.height / 2 - point.y * viewport.scale + viewport.offset.y,
  });
  viewport.world = (point) => ({
    x: (point.x - viewport.rect.width / 2 - viewport.offset.x) / viewport.scale,
    y: -(point.y - viewport.rect.height / 2 - viewport.offset.y) / viewport.scale,
    z: 0,
  });
  const id = scenario.faceSelection[0];
  const match = id.match(/^(.*):f:(\d+)$/);
  const brush = viewport.state.brushes.find((item) => item.id === match[1]);
  const face = brush.faces[Number(match[2])];
  const center = face.reduce(
    (sum, index) => ({
      x: sum.x + brush.vertices[index].x / face.length,
      y: sum.y + brush.vertices[index].y / face.length,
      z: sum.z + brush.vertices[index].z / face.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const normal = viewport.faceNormal(brush, face);
  const length = Math.hypot(normal.x, normal.y);
  const direction = { x: normal.x / length, y: normal.y / length };
  const start = viewport.screen(center);
  const snapshots = fixture.distances.map((distance) => {
    const current = viewport.screen({
      x: center.x + direction.x * distance,
      y: center.y + direction.y * distance,
      z: center.z,
    });
    const rawDistance = viewport.faceExtrusionDistance(id, start, current);
    return {
      distance,
      rawDistance,
      resolved: viewport.extrusionCandidate?.resolved || null,
      debug: structuredClone(viewport.extrusionAcquisitionDebug),
      lockState: viewport.drag.startRailState,
      pair: viewport.drag.startRailPair,
      solvedOverlay: structuredClone(viewport.extrusionSolvedDebug),
    };
  });
  return { viewport, brush, faceIndex: Number(match[2]), snapshots };
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
  const { viewport, rawDistance } = replay(fixture);
  assert.ok(Math.abs(rawDistance - fixture.expected.rawDistance) < 0.000001);
  assert.equal(viewport.extrusionCandidate, null);
  assert.equal(viewport.drag.startRailState, "pending");
  assert.ok(
    viewport.extrusionAcquisitionDebug.rejected.some(
      (candidate) => candidate.rejectionReason === "segment-behind-source",
    ),
    "outward finite rails are rejected instead of continued infinitely",
  );
  assert.ok(existsSync(new URL(fixture.expected.screenshot, url)));
}

{
  const { data: fixture, url } = loadFixture("single-face-nodraw-junction-sides");
  for (const scenario of fixture.scenarios) {
    const replayFixture = structuredClone(fixture);
    replayFixture.editor.faceSelection = scenario.faceSelection;
    replayFixture.gesture = {
      pointerStart: scenario.pointerStart,
      pointerEnd: scenario.pointerEnd,
    };
    const { rawDistance, resolved, viewport } = replay(replayFixture);
    assert.ok(
      Math.abs(rawDistance - scenario.rawDistance) < 0.000001,
      `${scenario.name}: raw distance`,
    );
    if (!resolved) {
      assert.equal(viewport.drag.startRailState, "pending", `${scenario.name}: finite rail remains pending`);
      assert.ok(
        viewport.extrusionAcquisitionDebug.rejected.some(
          (candidate) => candidate.rejectionReason === "segment-behind-source",
        ),
        `${scenario.name}: records finite segment rejection`,
      );
      continue;
    }
    const side = resolved.constraints.find(
      (constraint) => constraint.movingEdge === scenario.expected.movingEdge,
    );
    assert.ok(side, `${scenario.name}: expected attached side rail`);
    assert.equal(side.targetBrushId, scenario.expected.targetBrushId);
    assert.equal(side.targetFaceIndex, scenario.expected.targetFaceIndex);
    assertClose(
      viewport.extrusionAcquisitionDebug,
      scenario.expected.candidatePools,
      `${scenario.name}: recorded candidate pools`,
    );
    assert.ok(
      Math.abs(resolved.finalDistance - scenario.expected.finalDistance) < 0.000001,
      `${scenario.name}: full requested distance`,
    );
    assert.equal(resolved.blocked, false);
    assert.ok(
      resolved.finalCorners && resolved.solvedEdges,
      `${scenario.name}: finite solved geometry`,
    );
    if (scenario.expected.commitUsesPreviewResult)
      assert.equal(resolved.previewBrushes[0], resolved.brushes[0]);
    if (scenario.expected.rejectedBackwardTargetBrushId) {
      const selectedCandidate = viewport.extrusionAcquisitionDebug[
        scenario.expected.movingEdge
      ].find((candidate) => candidate.targetBrushId === scenario.expected.targetBrushId);
      const backwardCandidate = viewport.extrusionAcquisitionDebug.rejected.find(
        (candidate) =>
          candidate.targetBrushId === scenario.expected.rejectedBackwardTargetBrushId,
      );
      assert.ok(selectedCandidate.signedForwardDirection > 0);
      assert.ok(backwardCandidate);
      assert.ok(backwardCandidate.rejectionReason);
    }
  }
  assert.ok(existsSync(new URL(fixture.screenshot, url)));
}

{
  const { data: fixture, url } = loadFixture("single-face-near-seam-contact");
  const { rawDistance, resolved, viewport } = replay(fixture);
  assert.ok(Math.abs(rawDistance - fixture.expected.rawDistance) < 0.000001);
  assert.ok(resolved, "near-seam attached rails resolve");
  const sides = resolved.constraints.filter((item) => item.movingEdge !== "cap");
  assert.deepEqual(sides.map((item) => item.movingEdge), fixture.expected.constraintEdges);
  assert.deepEqual(sides.map((item) => item.targetBrushId), fixture.expected.targetBrushIds);
  assert.deepEqual(sides.map((item) => item.targetFaceIndex), fixture.expected.targetFaceIndices);
  assertClose(
    {
      sideA: viewport.extrusionAcquisitionDebug.sideA.filter(
        (candidate) => candidate.source === "attached",
      ),
      sideB: viewport.extrusionAcquisitionDebug.sideB.filter(
        (candidate) => candidate.source === "attached",
      ),
    },
    fixture.expected.attachedCandidatePools,
    "recorded near-seam candidate pools",
  );
  assert.ok(Math.abs(resolved.finalDistance - fixture.expected.finalDistance) < 0.000001);
  assert.equal(resolved.blocked, false);
  assertClose(resolved.finalCorners, fixture.expected.finalCorners, "near-seam corners");
  assertClose(resolved.solvedEdges, fixture.expected.solvedEdges, "near-seam edges");
  assertClose(
    {
      vertices: resolved.previewBrushes[0].vertices,
      faces: resolved.previewBrushes[0].faces,
    },
    fixture.expected.previewGeometry,
    "near-seam preview geometry",
  );
  if (fixture.expected.commitUsesPreviewResult)
    assert.equal(resolved.previewBrushes[0], resolved.brushes[0]);
  assert.ok(existsSync(new URL(fixture.expected.screenshot, url)));
}

{
  const { data: fixture, url } = loadFixture("single-face-attached-forward-segments");
  for (const scenario of fixture.scenarios) {
    const { viewport, brush, faceIndex, snapshots } = replaySequence(fixture, scenario);
    let lockedKeys = null;
    for (const snapshot of snapshots) {
      const expectedState = scenario.states[fixture.distances.indexOf(snapshot.distance)];
      assert.equal(snapshot.lockState, expectedState, `${scenario.name} L${snapshot.distance}: lock state`);
      assert.ok(
        Math.abs(snapshot.rawDistance - snapshot.distance) < 0.000001,
        `${scenario.name} L${snapshot.distance}: raw distance`,
      );
      assert.ok(
        Math.abs(snapshot.debug.probeDistance - Math.max(snapshot.distance, 0.0001)) < 0.000001,
        `${scenario.name} L${snapshot.distance}: current-distance probe`,
      );
      if (snapshot.distance === 0) {
        assert.equal(snapshot.resolved, null, `${scenario.name} L0: no preview result`);
        continue;
      }
      assert.ok(snapshot.resolved, `${scenario.name} L${snapshot.distance}: preview result`);
      assert.equal(snapshot.resolved.blocked, false, `${scenario.name} L${snapshot.distance}: not blocked`);
      assert.equal(snapshot.resolved.previewBrushes.length, 1, `${scenario.name} L${snapshot.distance}: one preview wedge`);
      assert.equal(
        snapshot.resolved.previewBrushes[0],
        snapshot.resolved.brushes[0],
        `${scenario.name} L${snapshot.distance}: preview/commit identity`,
      );
      const sides = snapshot.resolved.constraints.filter(
        (constraint) => constraint.movingEdge !== "cap",
      );
      if (expectedState === "paired") {
        assert.equal(sides.length, 2, `${scenario.name} L${snapshot.distance}: paired sides`);
        assert.deepEqual(
          sides.map((side) => side.targetBrushId),
          scenario.pair,
          `${scenario.name} L${snapshot.distance}: paired brush IDs`,
        );
        assert.deepEqual(
          sides.map((side) => side.targetFaceIndex),
          scenario.pairFaces,
          `${scenario.name} L${snapshot.distance}: paired face IDs`,
        );
        const keys = sides.map((side) => side.canonicalKey);
        if (!lockedKeys) lockedKeys = keys;
        if (lockedKeys.length === 1)
          assert.ok(
            keys.includes(lockedKeys[0]),
            `${scenario.name} L${snapshot.distance}: single rail retained during upgrade`,
          );
        else assert.deepEqual(keys, lockedKeys, `${scenario.name} L${snapshot.distance}: paired keys remain locked`);
        lockedKeys = keys;
      } else if (expectedState.startsWith("single-")) {
        assert.equal(sides.length, 1, `${scenario.name} L${snapshot.distance}: single side`);
        assert.equal(sides[0].movingEdge, scenario.singleEdge);
        assert.equal(sides[0].targetBrushId, scenario.singleTarget);
        if (!lockedKeys) lockedKeys = [sides[0].canonicalKey];
        assert.deepEqual(
          [sides[0].canonicalKey],
          lockedKeys,
          `${scenario.name} L${snapshot.distance}: single key remains locked`,
        );
      }
      for (const side of sides) {
        if (side.source === "attached") {
          assert.ok(
            (side.availableForwardSegmentLength || 0) > 0,
            `${scenario.name} L${snapshot.distance}: finite forward rail length`,
          );
          assert.ok(
            side.capProjectedT >= -0.01 && side.capProjectedT <= 1.01,
            `${scenario.name} L${snapshot.distance}: cap remains on finite rail`,
          );
        }
      }
      const points = [
        snapshot.resolved.finalCorners.baseA,
        snapshot.resolved.finalCorners.baseB,
        snapshot.resolved.finalCorners.capB,
        snapshot.resolved.finalCorners.capA,
      ];
      const signs = points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        const after = points[(index + 2) % points.length];
        return Math.sign(
          (next.x - point.x) * (after.y - next.y) -
            (next.y - point.y) * (after.x - next.x),
        );
      });
      assert.ok(signs.every((sign) => sign && sign === signs[0]), `${scenario.name} L${snapshot.distance}: strict convexity`);
      assertClose(
        snapshot.solvedOverlay,
        viewport.toScreenEdges(snapshot.resolved.solvedEdges),
        `${scenario.name} L${snapshot.distance}: solved overlay matches geometry`,
      );
      assert.ok(
        snapshot.debug.rejected.some(
          (candidate) => candidate.rejectionReason === "segment-behind-source",
        ),
        `${scenario.name} L${snapshot.distance}: records rejected backward rails`,
      );
    }
    const final = snapshots[snapshots.length - 1];
    const finalSides = final.resolved.constraints.filter(
      (constraint) => constraint.movingEdge !== "cap",
    );
    const reversed = finalSides.map((constraint) => ({
      ...constraint,
      direction: { x: -constraint.direction.x, y: -constraint.direction.y },
      targetStartWorld: constraint.targetEndWorld,
      targetEndWorld: constraint.targetStartWorld,
    }));
    const reversedResult = solveSingleFaceExtrusion({
      brush,
      faceIndex,
      distance: fixture.distances.at(-1),
      activeAxes: ["x", "y", "z"],
      constraints: reversed,
      followAdjacentSides: true,
      mirrorSingleSide: false,
      maxSourceAngleDegrees: fixture.editor.faceSourceMaxAngle,
    });
    assert.ok(reversedResult, `${scenario.name}: reversed endpoint order solves`);
    assertClose(reversedResult.capA, final.resolved.finalCorners.capA, `${scenario.name}: reversed capA`);
    assertClose(reversedResult.capB, final.resolved.finalCorners.capB, `${scenario.name}: reversed capB`);
  }
  assert.ok(existsSync(new URL(fixture.screenshot, url)));
}

{
  const { data: fixture, url } = loadFixture("single-face-inward-angled-squeeze");
  const { viewport, rawDistance } = replay(fixture);
  assert.ok(Math.abs(rawDistance - fixture.expected.rawDistance) < 0.000001);
  assert.equal(viewport.extrusionCandidate, null);
  assert.equal(viewport.drag.startRailState, "pending");
  assert.ok(
    viewport.extrusionAcquisitionDebug.rejected.some(
      (candidate) => candidate.rejectionReason === "segment-behind-source",
    ),
    "infinite inward continuation is rejected without finite segment support",
  );
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
