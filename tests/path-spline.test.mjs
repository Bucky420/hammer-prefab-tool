import assert from "node:assert/strict";
import {
  normalizePath,
  PATH_VERSION,
  samplePath,
  setPathClosed,
  setSegmentMode,
} from "../public/js/path-spline.js";

const near = (actual, expected, message = "values differ") =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const node = (x, y, z = 0, extra = {}) => ({ x, y, z, ...extra });

{
  const input = {
    nodes: [node(0, 0), node(64, 64), node(128, 0)],
    detail: { maxAngleDegrees: 8, maxSegmentLength: 24, chordError: 0.25 },
  };
  const result = samplePath(input);
  assert.equal(result.path.version, PATH_VERSION);
  assert.equal(result.closed, false);
  assert.deepEqual(result.path.segmentModes, ["spline", "spline"]);
  for (const control of input.nodes) {
    assert.ok(result.stations.some(({ x, y, z }) => x === control.x && y === control.y && z === control.z));
  }
}

{
  const path = {
    nodes: [
      node(0, 0, 0, { tangentOut: { x: 0, y: 100, z: 0 } }),
      node(100, 0),
      node(200, 100),
    ],
    segmentModes: ["spline", "straight"],
    detail: { maxAngleDegrees: 12, maxSegmentLength: 25, chordError: 0.5 },
  };
  const result = samplePath(path);
  assert.ok(result.stations.some((entry) => entry.sourceSegment === 0 && entry.y > 0));
  for (const entry of result.stations.filter((entry) => entry.sourceSegment === 1)) {
    near(entry.y, entry.x - 100, "straight segment ignored handles");
  }
  assert.deepEqual(setSegmentMode(path, 0, "straight").segmentModes, ["straight", "straight"]);
}

{
  const result = samplePath({
    nodes: [node(0, 0), node(100, 0), node(100, 100), node(0, 100)],
    closed: true,
    detail: { maxAngleDegrees: 15, maxSegmentLength: 30, chordError: 0.5 },
  });
  assert.equal(result.closed, true);
  assert.equal(result.stations.filter(({ x, y }) => x === 0 && y === 0).length, 1);
  const seam = result.stations[0];
  near(seam.tangent.x, Math.SQRT1_2, "periodic seam tangent x");
  near(seam.tangent.y, -Math.SQRT1_2, "periodic seam tangent y");
  assert.equal(setPathClosed({ nodes: [node(0, 0), node(10, 0), node(10, 10)] }, true).closed, true);
}

{
  const result = samplePath({
    nodes: [node(0, 0, 0, { width: 64, height: 96 }), node(100, 0, 40, { width: 128, height: 160 })],
    segmentModes: ["straight"],
    detail: { maxAngleDegrees: 10, maxSegmentLength: 60, chordError: 1 },
  });
  const midpoint = result.stations.find(({ t }) => t === 0.5);
  assert.ok(midpoint);
  near(midpoint.z, 20);
  near(midpoint.width, 96);
  near(midpoint.height, 128);
}

{
  const normalized = normalizePath([node(0, 0), node(100, 0)]);
  assert.deepEqual(normalized.segmentModes, ["straight"]);
  assert.equal(normalized.nodes[0].width, 128);
  assert.equal(normalized.nodes[0].height, 128);
  assert.deepEqual(
    normalizePath({ nodes: [node(0, 0), node(100, 0)] }, { legacy: true }).segmentModes,
    ["straight"],
  );
}

{
  const coarse = samplePath({
    nodes: [node(0, 0, 0, { tangentOut: { x: 0, y: 200, z: 0 } }), node(100, 0)],
    detail: { maxAngleDegrees: 45, maxSegmentLength: 1000, chordError: 20 },
  });
  const fine = samplePath({
    nodes: [node(0, 0, 0, { tangentOut: { x: 0, y: 200, z: 0 } }), node(100, 0)],
    detail: { maxAngleDegrees: 5, maxSegmentLength: 12, chordError: 0.1 },
  });
  assert.ok(fine.stations.length > coarse.stations.length * 2);
  for (let index = 1; index < fine.stations.length; index++) {
    const a = fine.stations[index - 1];
    const b = fine.stations[index];
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) <= 12 + 1e-7);
  }
  assert.throws(() => samplePath(fine.path, { sampleCap: 3 }), /sample overflow/);
}

for (const [input, pattern] of [
  [{ nodes: [node(0, 0)] }, /at least 2 nodes/],
  [{ nodes: [node(0, 0), node(10, 0)], closed: true }, /at least 3 nodes/],
  [{ nodes: [node(0, 0), node(Number.NaN, 1)] }, /must be finite/],
  [{ nodes: [node(0, 0), node(0, 0)] }, /duplicate consecutive XY/],
  [{ nodes: [node(0, 0, 0, { width: 0 }), node(1, 0)] }, /width must be positive/],
  [{ nodes: [node(0, 0), node(1, 0, 0, { height: -1 })] }, /height must be positive/],
  [{ nodes: [node(0, 0), node(1, 0)], segmentModes: ["arc"] }, /invalid mode/],
  [{ version: PATH_VERSION + 1, nodes: [node(0, 0), node(1, 0)] }, /unsupported path version/],
]) {
  assert.throws(() => normalizePath(input), pattern);
}

console.log("path spline checks passed");
