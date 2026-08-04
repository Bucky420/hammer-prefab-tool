import { validateBrush } from "./brush-validation.js";
import { roundToGrid } from "./grid.js";

const EPSILON = 0.000001;
const WORLD_BOUNDS = 32768;
const MITER_LIMIT = 8;
const DEFAULT_MATERIALS = {
  floor: "dev/dev_measuregeneric01b",
  wall: "dev/dev_measurewall01a",
  ceiling: "dev/dev_measuregeneric01b",
};

let nextAssemblyId = 1;
let nextBrushId = 1;

const dot = (a, b) => a.x * b.x + a.y * b.y;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const offsetPoint = (point, miter, distance) => ({
  x: point.x + miter.x * distance,
  y: point.y + miter.y * distance,
});
const normalizeGridValue = (value, grid) => {
  const snapped = roundToGrid(value, grid);
  return Math.abs(value - snapped) <= EPSILON ? snapped : value;
};
const uniqueId = (prefix, fallback) =>
  globalThis.crypto?.randomUUID
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now().toString(36)}-${fallback}`;

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const opposite = (x, y) =>
    (x > EPSILON && y < -EPSILON) || (x < -EPSILON && y > EPSILON);
  if (opposite(abC, abD) && opposite(cdA, cdB)) return true;
  const onSegment = (p, q, r) =>
    Math.abs(cross(p, q, r)) <= EPSILON &&
    r.x >= Math.min(p.x, q.x) - EPSILON &&
    r.x <= Math.max(p.x, q.x) + EPSILON &&
    r.y >= Math.min(p.y, q.y) - EPSILON &&
    r.y <= Math.max(p.y, q.y) + EPSILON;
  return (
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}

function prismVertices(footprint, lower, upper) {
  return [
    ...footprint.map((point, index) => ({ ...point, z: lower[index] })),
    ...footprint.map((point, index) => ({ ...point, z: upper[index] })),
  ];
}

function makeBrush({
  footprint,
  lower,
  upper,
  material,
  owner,
  segment,
  role,
  path,
  settings,
}) {
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return {
    id: uniqueId("hallway-brush", nextBrushId++),
    assemblyId: owner,
    groupId: owner,
    material,
    faceMaterials: faces.map(() => material),
    vertices: prismVertices(footprint, lower, upper),
    faces,
    generator: {
      type: "hallway",
      assemblyId: owner,
      segment,
      role,
      path: path.map((point) => ({ ...point })),
      settings: {
        ...settings,
        materials: { ...settings.materials },
      },
    },
  };
}

/**
 * Generates an open-ended hallway from a 3D centerline.
 *
 * @param {object} [options]
 * @returns {{brushes: object[], errors: string[]}}
 */
export function generateHallway(options = {}) {
  const nestedSettings = options.settings || {};
  const sourcePath = options.path;
  const grid = Number(options.grid ?? nestedSettings.grid ?? 16);
  const errors = [];
  if (!Number.isFinite(grid) || grid <= 0) errors.push("grid must be positive");
  if (!Array.isArray(sourcePath) || sourcePath.length < 2) {
    errors.push("path must contain at least two points");
    return { brushes: [], errors };
  }
  for (const [index, point] of sourcePath.entries()) {
    if (
      !point ||
      ![point.x, point.y, point.z].every(Number.isFinite)
    ) {
      errors.push(`path point ${index} must contain finite x, y, and z values`);
      continue;
    }
    if (
      Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) >
      WORLD_BOUNDS
    ) {
      errors.push(`path point ${index} is outside world bounds`);
    }
  }
  if (errors.length) return { brushes: [], errors };

  const path = sourcePath.map((point) => ({
    x: normalizeGridValue(point.x, grid),
    y: normalizeGridValue(point.y, grid),
    z: normalizeGridValue(point.z, grid),
  }));
  const values = {
    interiorWidth: Number(
      options.interiorWidth ?? nestedSettings.interiorWidth ?? 128,
    ),
    interiorHeight: Number(
      options.interiorHeight ?? nestedSettings.interiorHeight ?? 128,
    ),
    wallThickness: Number(
      options.wallThickness ?? nestedSettings.wallThickness ?? 16,
    ),
    floorThickness: Number(
      options.floorThickness ?? nestedSettings.floorThickness ?? 16,
    ),
    ceilingThickness: Number(
      options.ceilingThickness ?? nestedSettings.ceilingThickness ?? 16,
    ),
  };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value <= 0)
      errors.push(`${name} must be positive`);
    else values[name] = normalizeGridValue(value, grid);
  }
  const suppliedMaterials = options.materials ?? nestedSettings.materials ?? {};
  const materials = { ...DEFAULT_MATERIALS, ...suppliedMaterials };
  for (const role of ["floor", "wall", "ceiling"])
    if (typeof materials[role] !== "string" || !materials[role].trim())
      errors.push(`${role} material must be a non-empty string`);
  if (errors.length) return { brushes: [], errors };

  const pointKeys = new Set();
  for (const [index, point] of path.entries()) {
    const key = `${point.x},${point.y}`;
    if (pointKeys.has(key)) errors.push(`path point ${index} duplicates an XY point`);
    pointKeys.add(key);
  }
  const directions = [];
  const normals = [];
  const lengths = [];
  for (let index = 0; index < path.length - 1; index++) {
    const delta = subtract(path[index + 1], path[index]);
    const length = Math.hypot(delta.x, delta.y);
    if (length <= EPSILON) {
      errors.push(`path segment ${index} has zero XY length`);
      continue;
    }
    const direction = { x: delta.x / length, y: delta.y / length };
    directions.push(direction);
    normals.push({ x: -direction.y, y: direction.x });
    lengths.push(length);
  }
  if (errors.length) return { brushes: [], errors };

  for (let first = 0; first < path.length - 1; first++) {
    for (let second = first + 2; second < path.length - 1; second++) {
      if (
        segmentsIntersect(
          path[first],
          path[first + 1],
          path[second],
          path[second + 1],
        )
      ) {
        errors.push(`path segments ${first} and ${second} intersect`);
      }
    }
  }
  if (errors.length) return { brushes: [], errors };

  const miters = [normals[0]];
  for (let index = 1; index < path.length - 1; index++) {
    const denominator = 1 + dot(directions[index - 1], directions[index]);
    if (denominator <= EPSILON) {
      errors.push(`path join ${index} cannot be mitered`);
      continue;
    }
    const miter = {
      x: (normals[index - 1].x + normals[index].x) / denominator,
      y: (normals[index - 1].y + normals[index].y) / denominator,
    };
    if (!Number.isFinite(miter.x) || Math.hypot(miter.x, miter.y) > MITER_LIMIT)
      errors.push(`path join ${index} has an excessive miter`);
    miters.push(miter);
  }
  miters.push(normals.at(-1));
  if (errors.length) return { brushes: [], errors };

  const gradients = [];
  for (let index = 0; index < directions.length; index++) {
    const slope = (path[index + 1].z - path[index].z) / lengths[index];
    let crossSlope = 0;
    if (index > 0) {
      const previous = gradients[index - 1];
      const miter = miters[index];
      crossSlope =
        previous.x * miter.x +
        previous.y * miter.y -
        slope * dot(directions[index], miter);
    }
    gradients.push({
      x: slope * directions[index].x + crossSlope * normals[index].x,
      y: slope * directions[index].y + crossSlope * normals[index].y,
    });
  }

  const owner =
    options.assemblyId ??
    nestedSettings.assemblyId ??
    uniqueId("hallway-assembly", nextAssemblyId++);
  if (typeof owner !== "string" || !owner) {
    return { brushes: [], errors: ["assemblyId must be a non-empty string"] };
  }
  const canonicalSettings = { ...values, grid, materials };
  const halfWidth = values.interiorWidth / 2;
  const outerWidth = halfWidth + values.wallThickness;
  const brushes = [];
  for (let segment = 0; segment < directions.length; segment++) {
    const start = path[segment];
    const end = path[segment + 1];
    const at = (point, distance, node) =>
      offsetPoint(point, miters[node], distance);
    const elevation = (point) =>
      start.z +
      gradients[segment].x * (point.x - start.x) +
      gradients[segment].y * (point.y - start.y);
    const footprint = (right, left) => [
      at(start, right, segment),
      at(end, right, segment + 1),
      at(end, left, segment + 1),
      at(start, left, segment),
    ];
    const add = (role, points, lowerOffset, upperOffset, material) => {
      const base = points.map(elevation);
      brushes.push(
        makeBrush({
          footprint: points,
          lower: base.map((z) => z + lowerOffset),
          upper: base.map((z) => z + upperOffset),
          material,
          owner,
          segment,
          role,
          path,
          settings: canonicalSettings,
        }),
      );
    };
    add(
      "floor",
      footprint(-outerWidth, outerWidth),
      -values.floorThickness,
      0,
      materials.floor,
    );
    add(
      "ceiling",
      footprint(-outerWidth, outerWidth),
      values.interiorHeight,
      values.interiorHeight + values.ceilingThickness,
      materials.ceiling,
    );
    add(
      "left-wall",
      footprint(halfWidth, outerWidth),
      0,
      values.interiorHeight,
      materials.wall,
    );
    add(
      "right-wall",
      footprint(-outerWidth, -halfWidth),
      0,
      values.interiorHeight,
      materials.wall,
    );
  }

  const validationErrors = brushes.flatMap((brush) =>
    validateBrush(brush).map((issue) => `${brush.id}: ${issue}`),
  );
  return validationErrors.length
    ? { brushes: [], errors: validationErrors }
    : { brushes, errors: [] };
}
