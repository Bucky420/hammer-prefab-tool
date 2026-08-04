import assert from "node:assert/strict";
import { box } from "../public/js/geometry-model.js";
import {
  acquireNearestPathSource,
  acquirePathSource,
} from "../public/js/path-source-acquisition.js";

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: ${actual}`);
const polar = (radius, degrees) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
};
const floorBox = (id, min, max) => ({ ...box(min, max), id });

function slopedFloor(id, minX, maxX, minY, maxY, zOffset = 0) {
  const topZ = (x) => 10 + x / 4 + zOffset;
  const bottomZ = (x) => topZ(x) - 8;
  return {
    id,
    vertices: [
      { x: minX, y: minY, z: bottomZ(minX) },
      { x: maxX, y: minY, z: bottomZ(maxX) },
      { x: maxX, y: maxY, z: bottomZ(maxX) },
      { x: minX, y: maxY, z: bottomZ(minX) },
      { x: minX, y: minY, z: topZ(minX) },
      { x: maxX, y: minY, z: topZ(maxX) },
      { x: maxX, y: maxY, z: topZ(maxX) },
      { x: minX, y: maxY, z: topZ(minX) },
    ],
    faces: [
      [0, 3, 2, 1],
      [7, 6, 5, 4],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ],
  };
}

function annularFloor(id, startAngle, endAngle) {
  const footprint = [
    polar(100, startAngle),
    polar(100, endAngle),
    polar(60, endAngle),
    polar(60, startAngle),
  ];
  const vertices = footprint.flatMap((point) => [
    { ...point, z: 0 },
    { ...point, z: 8 },
  ]);
  return {
    id,
    vertices,
    faces: [
      [0, 6, 4, 2],
      [1, 3, 5, 7],
      [0, 2, 3, 1],
      [2, 4, 5, 3],
      [4, 6, 7, 5],
      [6, 0, 1, 7],
    ],
  };
}

function importedOuterInnerFloor(id, footprint) {
  const vertices = footprint.flatMap((point) => [
    { ...point, z: -64 },
    { ...point, z: 0 },
  ]);
  return {
    id,
    vertices,
    faces: [
      [0, 6, 4, 2],
      [1, 3, 5, 7],
      [0, 2, 3, 1],
      [2, 4, 5, 3],
      [4, 6, 7, 5],
      [6, 0, 1, 7],
    ],
  };
}

{
  const floor = floorBox("single", { x: 0, y: 0, z: 0 }, { x: 64, y: 32, z: 8 });
  floor.faces[1].reverse();
  const before = structuredClone(floor);
  const result = acquirePathSource([floor], { x: 128, y: 16 }, 4, 0.001);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.sourceBrushIds, ["single"]);
  assert.deepEqual(result.left, { x: 64, y: 32, z: 8 });
  assert.deepEqual(result.right, { x: 64, y: 0, z: 8 });
  assert.deepEqual(result.center, { x: 64, y: 16, z: 8 });
  assert.deepEqual(result.direction, { x: 1, y: 0 });
  assert.deepEqual(result.floorPlane, {
    normal: { x: 0, y: 0, z: 1 },
    distance: 8,
  });
  assert.equal(result.outsideWidth, 32);
  assert.equal(result.interiorWidth, 24);
  assert.equal(result.elevation, 8);
  assert.deepEqual(floor, before, "acquisition must not normalize source winding in place");
}

{
  const south = floorBox("south", { x: 0, y: 0, z: 0 }, { x: 64, y: 32, z: 8 });
  const north = floorBox("north", { x: 0, y: 32, z: 0 }, { x: 64, y: 64, z: 8 });
  const result = acquirePathSource([south, north], { x: 128, y: 32 }, 8, 0.001);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.boundary, [
    { x: 64, y: 64, z: 8 },
    { x: 64, y: 32, z: 8 },
    { x: 64, y: 0, z: 8 },
  ]);
  assert.equal(result.outsideWidth, 64);
  assert.equal(result.interiorWidth, 48);
}

{
  const wedges = [
    annularFloor("wedge-a", -20, 0),
    annularFloor("wedge-b", 0, 20),
  ];
  const result = acquirePathSource(wedges, { x: 180, y: 0 }, 4, 0.001);
  assert.deepEqual(result.errors, []);
  assert.equal(result.boundary.length, 3);
  near(Math.hypot(result.boundary[0].x, result.boundary[0].y), 100, "left outer radius");
  near(Math.hypot(result.boundary[1].x, result.boundary[1].y), 100, "joint outer radius");
  near(Math.hypot(result.boundary[2].x, result.boundary[2].y), 100, "right outer radius");
  assert.ok(result.left.y > 0 && result.right.y < 0);
  near(result.outsideWidth, 2 * 100 * Math.sin((20 * Math.PI) / 180), "outer endpoint chord");
}

{
  // Exact adjacent outer-ring coordinates imported from outer_inner.vmf.
  const wedges = [
    importedOuterInnerFloor("imported-50095", [
      { x: 2048, y: 0 },
      { x: 2030, y: -267 },
      { x: 1523, y: -200 },
      { x: 1536, y: 0 },
    ]),
    importedOuterInnerFloor("imported-50094", [
      { x: 2030, y: -267 },
      { x: 1978, y: -530 },
      { x: 1484, y: -398 },
      { x: 1523, y: -200 },
    ]),
  ];
  const result = acquirePathSource(wedges, { x: 3000, y: -250 }, 16, 0.01);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.sourceBrushIds, ["imported-50095", "imported-50094"]);
  assert.deepEqual(result.boundary, [
    { x: 2048, y: 0, z: 0 },
    { x: 2030, y: -267, z: 0 },
    { x: 1978, y: -530, z: 0 },
  ]);
  near(result.outsideWidth, 534.6026561849463, "outer_inner two-wedge mouth");
  near(result.elevation, 0, "outer_inner floor elevation");
}

{
  const south = slopedFloor("slope-a", 0, 64, 0, 32);
  const north = slopedFloor("slope-b", 0, 64, 32, 64);
  const result = acquirePathSource([south, north], { x: 128, y: 32 }, 8, 0.001);
  assert.deepEqual(result.errors, []);
  near(result.floorPlane.normal.x, -1 / Math.sqrt(17), "slope normal x");
  near(result.floorPlane.normal.z, 4 / Math.sqrt(17), "slope normal z");
  near(result.elevation, 26, "sloped mouth elevation");

  const incompatible = slopedFloor("raised", 0, 64, 32, 64, 1);
  assert.match(
    acquirePathSource([south, incompatible], { x: 128, y: 32 }, 8, 0.001).errors[0],
    /coplanar/,
  );
}

{
  const floor = floorBox("invalid", { x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 8 });
  const remote = floorBox("remote", { x: 128, y: 0, z: 0 }, { x: 192, y: 64, z: 8 });
  assert.ok(acquirePathSource([], { x: 128, y: 32 }, 8).errors.length);
  assert.ok(acquirePathSource([floor, floor, floor], { x: 128, y: 32 }, 8).errors.length);
  assert.match(
    acquirePathSource([floor, remote], { x: 256, y: 32 }, 8).errors[0],
    /share a top-face edge/,
  );
  assert.match(
    acquirePathSource([floor], { x: 96, y: 96 }, 8).errors[0],
    /ambiguous/,
  );
  assert.match(
    acquirePathSource([floor], { x: 32, y: 32 }, 8).errors[0],
    /too close/,
  );
  assert.match(
    acquirePathSource([floor], { x: 64, y: 32 }, 8).errors[0],
    /too close/,
  );
  assert.match(
    acquirePathSource([floor], { x: 48, y: 32 }, 8).errors[0],
    /behind/,
  );
  assert.match(
    acquirePathSource([floor], { x: 128, y: 32 }, 32).errors[0],
    /collapses/,
  );
}

{
  // Exact adjacent outer-ring coordinates imported from outer_inner.vmf.
  const wedges = [
    importedOuterInnerFloor("nearest-50095", [
      { x: 2048, y: 0 },
      { x: 2030, y: -267 },
      { x: 1523, y: -200 },
      { x: 1536, y: 0 },
    ]),
    importedOuterInnerFloor("nearest-50094", [
      { x: 2030, y: -267 },
      { x: 1978, y: -530 },
      { x: 1484, y: -398 },
      { x: 1523, y: -200 },
    ]),
  ];
  const before = structuredClone(wedges);
  const pointer = { x: 3000, y: -250 };
  const result = acquireNearestPathSource(wedges, pointer, 16, 1100, 0.01);
  assert.ok(result);
  assert.deepEqual(result.sourceBrushIds, ["nearest-50095", "nearest-50094"]);
  assert.deepEqual(result.boundary, [
    { x: 2048, y: 0, z: 0 },
    { x: 2030, y: -267, z: 0 },
    { x: 1978, y: -530, z: 0 },
  ]);
  const singles = wedges.map((brush) =>
    acquirePathSource([brush], pointer, 16, 0.01),
  );
  assert.ok(singles.every((single) => single.errors.length === 0));
  assert.ok(singles.every((single) => result.outsideWidth > single.outsideWidth));
  assert.deepEqual(wedges, before, "nearest acquisition must preserve source brushes");
}

{
  // Exact touching outer/inner coordinates from the same outer_inner ring.
  const outer = importedOuterInnerFloor("outer-wedge", [
    { x: 2048, y: 0 },
    { x: 2030, y: -267 },
    { x: 1523, y: -200 },
    { x: 1536, y: 0 },
  ]);
  const inner = importedOuterInnerFloor("inner-wedge", [
    { x: 1536, y: 0 },
    { x: 1523, y: -200 },
    { x: 1015, y: -134 },
    { x: 1024, y: 0 },
  ]);
  const result = acquireNearestPathSource(
    [inner, outer],
    { x: 2100, y: -100 },
    16,
    700,
    0.01,
  );
  assert.ok(result);
  assert.deepEqual(result.sourceBrushIds, ["outer-wedge"]);
}

{
  const floor = floorBox("nearest-box", { x: 0, y: 0, z: 0 }, { x: 64, y: 32, z: 8 });
  const result = acquireNearestPathSource(
    [floor],
    { x: 80, y: 16 },
    4,
    20,
    0.001,
  );
  assert.ok(result);
  assert.deepEqual(result.sourceBrushIds, ["nearest-box"]);
  assert.equal(
    acquireNearestPathSource([floor], { x: 256, y: 16 }, 4, 20, 0.001),
    null,
  );
}

console.log("path source acquisition tests passed");
