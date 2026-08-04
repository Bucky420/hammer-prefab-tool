import assert from "node:assert/strict";
import { box } from "../public/js/geometry-model.js";
import {
  pathClearsObstacles,
  routePathAroundBrushes,
} from "../public/js/path-routing.js";

const point = (x, y) => ({ x, y });
const obstacle = (id, min, max) => {
  const brush = box(min, max);
  brush.id = id;
  return brush;
};
const route = (overrides = {}) =>
  routePathAroundBrushes({
    start: point(0, 0),
    end: point(100, 0),
    brushes: [],
    outsideWidth: 0,
    margin: 0,
    floorZ: 0,
    height: 64,
    excludeBrushIds: [],
    ...overrides,
  });

{
  const result = route();
  assert.deepEqual(result, {
    points: [point(0, 0), point(100, 0)],
    obstacles: [],
    errors: [],
  });
}

{
  const result = route({
    brushes: [
      obstacle("middle", { x: 40, y: -10, z: -8 }, { x: 60, y: 10, z: 80 }),
    ],
    outsideWidth: 8,
    margin: 1,
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.obstacles, [
    {
      brushId: "middle",
      points: [point(35, -15), point(65, -15), point(65, 15), point(35, 15)],
    },
  ]);
  assert.deepEqual(result.points, [
    point(0, 0),
    point(35, -15),
    point(65, -15),
    point(100, 0),
  ]);
  assert.equal(pathClearsObstacles(result.points, result.obstacles), true);
}

{
  const result = route({
    end: point(140, 0),
    brushes: [
      obstacle("first", { x: 35, y: -25, z: -8 }, { x: 55, y: 10, z: 80 }),
      obstacle("second", { x: 80, y: -10, z: -8 }, { x: 100, y: 55, z: 80 }),
    ],
    outsideWidth: 8,
    margin: 1,
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.points.some(({ y }) => y === -30), "shortest route uses the lower side");
  assert.ok(result.points.every(({ y }) => y <= 0));
  assert.equal(pathClearsObstacles(result.points, result.obstacles), true);
}

{
  const brush = obstacle(
    "width-test",
    { x: 40, y: -10, z: -8 },
    { x: 60, y: 10, z: 80 },
  );
  const narrow = route({ brushes: [brush], outsideWidth: 8, margin: 1 });
  const wide = route({ brushes: [brush], outsideWidth: 40, margin: 1 });
  const detour = (result) => Math.max(...result.points.map(({ y }) => Math.abs(y)));
  assert.ok(detour(wide) > detour(narrow));
  assert.equal(detour(narrow), 15);
  assert.equal(detour(wide), 31);
}

{
  const below = obstacle(
    "below",
    { x: 40, y: -10, z: -64 },
    { x: 60, y: 10, z: 0 },
  );
  const above = obstacle(
    "above",
    { x: 40, y: -10, z: 64 },
    { x: 60, y: 10, z: 128 },
  );
  const result = route({ brushes: [below, above] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.obstacles, []);
  assert.deepEqual(result.points, [point(0, 0), point(100, 0)]);
}

{
  const ignored = obstacle(
    "source",
    { x: -10, y: -10, z: -8 },
    { x: 20, y: 10, z: 80 },
  );
  const result = route({ brushes: [ignored], excludeBrushIds: new Set(["source"]) });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.obstacles, []);
  assert.deepEqual(result.points, [point(0, 0), point(100, 0)]);
}

{
  const result = route({
    brushes: [
      obstacle("occupied", { x: -10, y: -10, z: -8 }, { x: 10, y: 10, z: 80 }),
    ],
  });
  assert.deepEqual(result.points, []);
  assert.match(result.errors[0], /start is inside obstacle occupied/);
}

{
  const frame = [
    obstacle("top", { x: -21, y: 10, z: -8 }, { x: 21, y: 22, z: 80 }),
    obstacle("bottom", { x: -21, y: -22, z: -8 }, { x: 21, y: -10, z: 80 }),
    obstacle("left", { x: -22, y: -11, z: -8 }, { x: -10, y: 11, z: 80 }),
    obstacle("right", { x: 10, y: -11, z: -8 }, { x: 22, y: 11, z: 80 }),
  ];
  const result = route({ start: point(0, 0), end: point(100, 0), brushes: frame });
  assert.deepEqual(result.points, []);
  assert.match(result.errors[0], /no clear route exists/);
}

{
  const brushes = [
    obstacle("b", { x: 70, y: -12, z: -8 }, { x: 90, y: 12, z: 80 }),
    obstacle("a", { x: 30, y: -12, z: -8 }, { x: 50, y: 12, z: 80 }),
  ];
  const first = route({ brushes, outsideWidth: 8, margin: 2 });
  const second = route({ brushes: brushes.slice().reverse(), outsideWidth: 8, margin: 2 });
  assert.deepEqual(second, first);
}

{
  const brushes = [
    obstacle("immutable", { x: 40, y: -10, z: -8 }, { x: 60, y: 10, z: 80 }),
  ];
  const input = {
    start: point(0, 0),
    end: point(100, 0),
    brushes,
    outsideWidth: 8,
    margin: 1,
    floorZ: 0,
    height: 64,
    excludeBrushIds: [],
  };
  const before = structuredClone(input);
  routePathAroundBrushes(input);
  assert.deepEqual(input, before);
}

console.log("path routing checks passed");
