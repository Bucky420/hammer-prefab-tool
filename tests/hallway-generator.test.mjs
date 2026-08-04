import assert from "node:assert/strict";
import { validateBrush } from "../public/js/brush-validation.js";
import { generateHallway } from "../public/js/hallway-generator.js";
import {
  createProject,
  normalizeProject,
} from "../public/js/project-format.js";

const settings = {
  interiorWidth: 64,
  interiorHeight: 96,
  wallThickness: 8,
  floorThickness: 8,
  ceilingThickness: 8,
  grid: 8,
  assemblyId: "hallway-test",
};
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: ${actual}`);
const verticesAtXY = (brushes, x, y) =>
  brushes.flatMap((brush) =>
    brush.vertices.filter(
      (vertex) =>
        Math.abs(vertex.x - x) < 0.000001 && Math.abs(vertex.y - y) < 0.000001,
    ),
  );
const assertValidResult = (result, message) => {
  assert.deepEqual(result.errors, [], message);
  assert.ok(result.brushes.length > 0, `${message}: expected brushes`);
  assert.ok(
    result.brushes.every((brush) => validateBrush(brush).length === 0),
    `${message}: every brush must be valid`,
  );
};

{
  const result = generateHallway({
    ...settings,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 128, y: 0, z: 0 },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.brushes.length, 4);
  assert.equal(new Set(result.brushes.map((brush) => brush.id)).size, 4);
  assert.ok(result.brushes.every((brush) => brush.vertices.length === 8));
  assert.ok(result.brushes.every((brush) => brush.faces.length === 6));
  assert.ok(result.brushes.every((brush) => validateBrush(brush).length === 0));
  assert.ok(
    result.brushes.every((brush) => brush.assemblyId === "hallway-test"),
  );
  assert.ok(result.brushes.every((brush) => brush.groupId === "hallway-test"));
  assert.deepEqual(
    new Set(result.brushes.map((brush) => brush.generator.role)),
    new Set(["floor", "ceiling", "left-wall", "right-wall"]),
  );
  assert.ok(
    result.brushes.every(
      (brush) =>
        brush.generator.type === "hallway" &&
        brush.generator.path.length === 2 &&
        brush.generator.settings.interiorWidth === 64,
    ),
  );
  const interiorPoint = { x: 64, y: 0, z: 48 };
  assert.ok(
    result.brushes.every((brush) =>
      brush.faces.some((face) => {
        const vertices = face.map((index) => brush.vertices[index]);
        const [a, b, c] = vertices;
        const normal = {
          x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
          y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
          z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
        };
        return (
          normal.x * (interiorPoint.x - a.x) +
            normal.y * (interiorPoint.y - a.y) +
            normal.z * (interiorPoint.z - a.z) >
          0.000001
        );
      }),
    ),
    "the center of the hallway must remain outside every solid brush",
  );
  const restored = normalizeProject(
    JSON.parse(JSON.stringify(createProject({ brushes: result.brushes }))),
  );
  assert.deepEqual(
    restored.brushes[0].generator.path,
    result.brushes[0].generator.path,
    "portable projects preserve the editable hallway centerline",
  );
  assert.deepEqual(
    restored.brushes[0].generator.settings,
    result.brushes[0].generator.settings,
    "portable projects preserve hallway generator settings",
  );
}

{
  const result = generateHallway({
    ...settings,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 128, y: 0, z: 0 },
      { x: 128, y: 128, z: 0 },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.brushes.length, 8);
  assert.ok(verticesAtXY(result.brushes, 88, 40).length > 0);
  assert.ok(verticesAtXY(result.brushes, 168, -40).length > 0);
  assert.ok(verticesAtXY(result.brushes, 96, 32).length > 0);
  assert.ok(verticesAtXY(result.brushes, 160, -32).length > 0);
  for (const [x, y] of [
    [88, 40],
    [168, -40],
    [96, 32],
    [160, -32],
  ]) {
    const firstSegment = verticesAtXY(
      result.brushes.filter((brush) => brush.generator.segment === 0),
      x,
      y,
    );
    const secondSegment = verticesAtXY(
      result.brushes.filter((brush) => brush.generator.segment === 1),
      x,
      y,
    );
    assert.ok(firstSegment.length > 0 && secondSegment.length > 0);
  }
}

{
  const result = generateHallway({
    ...settings,
    path: [
      { x: 0, y: 0, z: 16 },
      { x: 128, y: 0, z: 80 },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.brushes.every((brush) => validateBrush(brush).length === 0));
  const floor = result.brushes.find(
    (brush) => brush.generator.role === "floor",
  );
  const leftWall = result.brushes.find(
    (brush) => brush.generator.role === "left-wall",
  );
  assert.deepEqual(
    [
      ...new Set(
        floor.vertices.filter((vertex) => vertex.x === 0).map((v) => v.z),
      ),
    ].sort((a, b) => a - b),
    [8, 16],
  );
  assert.deepEqual(
    [
      ...new Set(
        floor.vertices.filter((vertex) => vertex.x === 128).map((v) => v.z),
      ),
    ].sort((a, b) => a - b),
    [72, 80],
  );
  const wallStart = leftWall.vertices.filter((vertex) => vertex.x === 0);
  near(Math.min(...wallStart.map((vertex) => vertex.z)), 16, "wall floor");
  near(Math.max(...wallStart.map((vertex) => vertex.z)), 112, "wall ceiling");
}

for (const options of [
  { ...settings, path: [{ x: 0, y: 0, z: 0 }] },
  {
    ...settings,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 16 },
    ],
  },
  {
    ...settings,
    interiorWidth: 0,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 128, y: 0, z: 0 },
    ],
  },
  {
    ...settings,
    wallThickness: -8,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 128, y: 0, z: 0 },
    ],
  },
  {
    ...settings,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: Number.NaN, y: 0, z: 0 },
    ],
  },
  {
    ...settings,
    path: [
      { x: 32760, y: 0, z: 0 },
      { x: 32769, y: 0, z: 0 },
    ],
  },
]) {
  const result = generateHallway(options);
  assert.equal(result.brushes.length, 0);
  assert.ok(result.errors.length > 0);
}

{
  const result = generateHallway({
    ...settings,
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 128, y: 128, z: 0 },
      { x: 0, y: 128, z: 0 },
      { x: 128, y: 0, z: 0 },
    ],
  });
  assert.equal(result.brushes.length, 0);
  assert.ok(result.errors.some((error) => error.includes("intersect")));
}

{
  const nodes = [
    { x: 0, y: 0, z: 0 },
    { x: 128, y: 0, z: 0 },
    { x: 192, y: 96, z: 0 },
  ];
  const legacy = generateHallway({ ...settings, path: nodes });
  const spline = generateHallway({ ...settings, path: { nodes } });
  assertValidResult(spline, "default spline");
  assert.ok(spline.stations.length > nodes.length);
  assert.ok(spline.brushes.length > legacy.brushes.length);
  assert.equal(spline.path.segmentModes[0], "spline");
  assert.ok(spline.brushes.every((brush) => brush.vertices.length === 6));
  assert.ok(spline.brushes.every((brush) => brush.faces.length === 5));
}

{
  const result = generateHallway({
    ...settings,
    path: {
      nodes: [
        { x: 0, y: 0, z: 0, width: 48 },
        { x: 128, y: 0, z: 0, width: 48 },
        { x: 256, y: 64, z: 0, width: 48 },
      ],
      segmentModes: ["straight", "spline"],
      detail: { maxAngleDegrees: 8, maxSegmentLength: 256, chordError: 0.5 },
    },
  });
  assertValidResult(result, "mixed segment modes");
  assert.deepEqual(result.path.segmentModes, ["straight", "spline"]);
  assert.equal(
    result.stations.filter((station) => station.sourceSegment === 0).length,
    2,
    "the long-detail straight segment remains one sampled span",
  );
  assert.ok(
    result.stations.filter((station) => station.sourceSegment === 1).length > 1,
  );
}

{
  const nodes = [
    { x: -160, y: -160, z: 0, tangentMode: "corner" },
    { x: 160, y: -160, z: 32, tangentMode: "corner" },
    { x: 160, y: 160, z: 64, tangentMode: "corner" },
    { x: -160, y: 160, z: 32, tangentMode: "corner" },
  ];
  const generateClosed = (orderedNodes) =>
    generateHallway({
      ...settings,
      wallThickness: 6,
      path: {
        closed: true,
        nodes: orderedNodes,
        segmentModes: ["straight", "straight", "straight", "straight"],
        detail: { maxAngleDegrees: 10, maxSegmentLength: 512, chordError: 1 },
      },
    });
  const result = generateClosed(nodes);
  assertValidResult(result, "closed hallway");
  assert.equal(result.path.closed, true);
  const seamSegment = result.stations.length - 1;
  assert.ok(
    result.brushes.some((brush) => brush.generator.segment === seamSegment),
    "closed hallway includes the final-to-first seam",
  );
  const reversed = generateClosed(nodes.toReversed());
  assertValidResult(reversed, "reversed closed hallway");
  assert.equal(
    reversed.brushes.length,
    result.brushes.length,
    "clockwise and counter-clockwise paths produce equivalent brush counts",
  );
}

{
  const result = generateHallway({
    ...settings,
    path: {
      nodes: [
        { x: 0, y: 0, z: 0, width: 80, height: 72 },
        { x: 128, y: 16, z: 24, width: 112, height: 104 },
        { x: 224, y: 96, z: 64, width: 144, height: 136 },
      ],
      detail: { maxAngleDegrees: 8, maxSegmentLength: 48, chordError: 0.5 },
    },
  });
  assertValidResult(result, "variable sloped spline");
  near(result.stations[0].width, 80, "first outside width");
  near(result.stations.at(-1).width, 144, "last outside width");
  near(result.stations[0].height, 72, "first clear height");
  near(result.stations.at(-1).height, 136, "last clear height");
  assert.ok(
    result.brushes.every(
      (brush) => brush.generator.path.nodes[0].width === 80,
    ),
  );
}

{
  const sourceAttachment = {
    boundary: [
      { x: 0, y: -40, z: 0 },
      { x: -8, y: -20, z: 0 },
      { x: -12, y: 0, z: 0 },
      { x: -8, y: 20, z: 0 },
      { x: 0, y: 40, z: 0 },
    ],
    left: { id: "left-edge" },
    right: { id: "right-edge" },
    center: { x: -12, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    floorPlane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
    outsideWidth: 80,
    sourceBrushIds: ["source-a", "source-b"],
    blendLength: 64,
    flare: 0.25,
  };
  const original = structuredClone(sourceAttachment);
  const result = generateHallway({
    ...settings,
    sourceAttachment,
    path: {
      nodes: [
        { x: 0, y: 0, z: 0, width: 80, height: 96 },
        { x: 96, y: 0, z: 0, width: 80, height: 96 },
      ],
      segmentModes: ["straight"],
      detail: { maxAngleDegrees: 10, maxSegmentLength: 128, chordError: 1 },
    },
  });
  assertValidResult(result, "curved source boundary");
  assert.equal(result.brushes[0].generator.settings.avoidShapes, true);
  assert.equal(result.brushes[0].generator.settings.routeMargin, 32);
  assert.deepEqual(sourceAttachment, original, "source attachment remains immutable");
  assert.deepEqual(
    result.brushes[0].generator.sourceAttachment,
    sourceAttachment,
    "source attachment is retained as generator metadata",
  );
  const restored = normalizeProject(
    JSON.parse(JSON.stringify(createProject({ brushes: result.brushes }))),
  );
  assert.equal(restored.brushes[0].generator.path.version, 1);
  assert.deepEqual(
    restored.brushes[0].generator.sourceAttachment,
    sourceAttachment,
    "portable projects preserve editable source attachments",
  );
  const firstFloor = result.brushes.filter(
    (brush) =>
      brush.generator.segment === 0 && brush.generator.role === "floor",
  );
  assert.equal(firstFloor.length, 8, "four curved-boundary cells replace the chord span");
  assert.ok(
    firstFloor.every(
      (brush) =>
        !(
          brush.vertices.some((vertex) => vertex.x === 0 && vertex.y === -40) &&
          brush.vertices.some((vertex) => vertex.x === 0 && vertex.y === 40)
        ),
    ),
    "no floor brush bridges the curved source boundary with one chord",
  );
}

{
  const endAttachment = {
    boundary: [
      { x: 256, y: 40, z: 16 },
      { x: 264, y: 20, z: 16 },
      { x: 268, y: 0, z: 16 },
      { x: 264, y: -20, z: 16 },
      { x: 256, y: -40, z: 16 },
    ],
    outsideWidth: 80,
    blendLength: 64,
    flare: 0,
  };
  const original = structuredClone(endAttachment);
  const result = generateHallway({
    ...settings,
    path: {
      nodes: [
        { x: 0, y: 0, z: 16, width: 80, height: 96 },
        { x: 128, y: 0, z: 16, width: 80, height: 96 },
        { x: 256, y: 0, z: 16, width: 80, height: 96 },
      ],
      segmentModes: ["straight", "straight"],
      detail: { maxAngleDegrees: 10, maxSegmentLength: 128, chordError: 1 },
      endAttachment,
    },
  });
  assertValidResult(result, "curved end boundary");
  assert.deepEqual(endAttachment, original, "end attachment remains immutable");
  const finalSegment = result.stations.length - 2;
  const finalFloor = result.brushes.filter(
    (brush) =>
      brush.generator.segment === finalSegment && brush.generator.role === "floor",
  );
  assert.equal(finalFloor.length, 8, "four end-boundary cells replace the final span");
  assert.ok(
    finalFloor.some((brush) =>
      brush.vertices.some((vertex) => vertex.x === 268 && vertex.y === 0),
    ),
    "the reverse adapter reaches the curved target boundary",
  );
  assert.ok(
    finalFloor.every(
      (brush) =>
        !(
          brush.vertices.some((vertex) => vertex.x === 256 && vertex.y === -40) &&
          brush.vertices.some((vertex) => vertex.x === 256 && vertex.y === 40)
        ),
    ),
    "no final floor brush bridges the target boundary with one chord",
  );
}

{
  const boundary = [
    { x: 0, y: -40, z: 0 },
    { x: -8, y: 0, z: 0 },
    { x: 0, y: 40, z: 0 },
  ];
  const generate = (flare) =>
    generateHallway({
      ...settings,
      sourceAttachment: { boundary, outsideWidth: 80, blendLength: 96, flare },
      path: {
        nodes: [
          { x: 0, y: 0, z: 0, width: 80, height: 96 },
          { x: 192, y: 0, z: 0, width: 80, height: 96 },
        ],
        segmentModes: ["straight"],
        detail: { maxAngleDegrees: 10, maxSegmentLength: 256, chordError: 1 },
      },
    });
  const fitted = generate(0);
  const flared = generate(16);
  assertValidResult(fitted, "zero-flare source fit");
  assertValidResult(flared, "flared source approach");
  near(fitted.stations[0].width, 80, "zero flare fits the boundary width");
  near(flared.stations[0].width, 112, "flare expands both boundary sides");
  assert.ok(
    flared.stations[1].width > fitted.stations[1].width,
    "flare widens the deterministic blend transition",
  );
  assert.deepEqual(
    flared.brushes[0].generator.sourceAttachment.boundary,
    boundary,
    "flare does not move the fixed source boundary",
  );
}

{
  const sourceAttachment = {
    boundary: [
      { x: 0, y: 40, z: 0 },
      { x: -6, y: 0, z: 0 },
      { x: 0, y: -40, z: 0 },
    ],
    blendLength: 48,
    flare: 0,
    sourceBrushIds: ["source"],
  };
  const endAttachment = {
    boundary: [
      { x: 320, y: 40, z: 0 },
      { x: 326, y: 0, z: 0 },
      { x: 320, y: -40, z: 0 },
    ],
    blendLength: 48,
    flare: 8,
    sourceBrushIds: ["target"],
  };
  const sourceOriginal = structuredClone(sourceAttachment);
  const endOriginal = structuredClone(endAttachment);
  const result = generateHallway({
    ...settings,
    settings: { ...settings, sourceAttachment },
    path: {
      nodes: [
        { x: 0, y: 0, z: 0, width: 80, height: 96 },
        { x: 160, y: 0, z: 0, width: 80, height: 96 },
        { x: 320, y: 0, z: 0, width: 80, height: 96 },
      ],
      segmentModes: ["straight", "straight"],
      detail: { maxAngleDegrees: 10, maxSegmentLength: 160, chordError: 1 },
      metadata: { endAttachment },
    },
  });
  assertValidResult(result, "source and end metadata");
  assert.deepEqual(sourceAttachment, sourceOriginal);
  assert.deepEqual(endAttachment, endOriginal);
  for (const brush of result.brushes) {
    assert.deepEqual(brush.generator.sourceAttachment, sourceAttachment);
    assert.deepEqual(brush.generator.endAttachment, endAttachment);
  }
}

for (const path of [
  {
    nodes: [
      { x: 0, y: 0, z: 0, width: 16 },
      { x: 128, y: 0, z: 0, width: 16 },
    ],
    segmentModes: ["straight"],
  },
  {
    closed: true,
    nodes: [
      { x: 0, y: 0, z: 0 },
      { x: 128, y: 128, z: 0 },
      { x: 0, y: 128, z: 0 },
      { x: 128, y: 0, z: 0 },
    ],
    segmentModes: ["straight", "straight", "straight", "straight"],
  },
]) {
  const result = generateHallway({ ...settings, path });
  assert.equal(result.brushes.length, 0);
  assert.ok(result.errors.length > 0);
  assert.ok(result.path, "invalid object paths still return their normalized path");
  assert.ok(result.stations.length > 0);
}

console.log("hallway generator checks passed");
