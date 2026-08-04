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

console.log("hallway generator checks passed");
