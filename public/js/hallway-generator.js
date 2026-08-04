import { validateBrush } from "./brush-validation.js";
import { roundToGrid } from "./grid.js";
import { samplePath } from "./path-spline.js";

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
const cloneMetadata = (value) => {
  if (Array.isArray(value)) return value.map(cloneMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneMetadata(item)]),
    );
  }
  return value;
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

function makeTriangleBrush({
  footprint,
  lower,
  upper,
  material,
  owner,
  segment,
  role,
  path,
  settings,
  sourceAttachment,
  endAttachment,
}) {
  let points = footprint;
  let bottom = lower;
  let top = upper;
  if (cross(points[0], points[1], points[2]) < 0) {
    points = [points[0], points[2], points[1]];
    bottom = [bottom[0], bottom[2], bottom[1]];
    top = [top[0], top[2], top[1]];
  }
  const faces = [
    [0, 2, 1],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ];
  const generator = {
    type: "hallway",
    assemblyId: owner,
    segment,
    role,
    path: cloneMetadata(path),
    settings: {
      ...settings,
      materials: { ...settings.materials },
    },
  };
  if (sourceAttachment) generator.sourceAttachment = cloneMetadata(sourceAttachment);
  if (endAttachment) generator.endAttachment = cloneMetadata(endAttachment);
  return {
    id: uniqueId("hallway-brush", nextBrushId++),
    assemblyId: owner,
    groupId: owner,
    material,
    faceMaterials: faces.map(() => material),
    vertices: prismVertices(points, bottom, top),
    faces,
    generator,
  };
}

function generateSampledHallway(options, nestedSettings) {
  const sourcePath = options.path;
  const errors = [];
  const grid = Number(options.grid ?? nestedSettings.grid ?? 16);
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
  if (!Number.isFinite(grid) || grid <= 0) errors.push("grid must be positive");
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value <= 0) errors.push(`${name} must be positive`);
    else values[name] = normalizeGridValue(value, grid);
  }
  const materials = {
    ...DEFAULT_MATERIALS,
    ...(options.materials ?? nestedSettings.materials ?? {}),
  };
  for (const role of ["floor", "wall", "ceiling"]) {
    if (typeof materials[role] !== "string" || !materials[role].trim()) {
      errors.push(`${role} material must be a non-empty string`);
    }
  }
  if (errors.length) return { brushes: [], errors, path: null, stations: [] };

  let sampled;
  try {
    sampled = samplePath(sourcePath, {
      defaults: {
        width: values.interiorWidth + 2 * values.wallThickness,
        height: values.interiorHeight,
      },
    });
  } catch (error) {
    return {
      brushes: [],
      errors: [error instanceof Error ? error.message : String(error)],
      path: null,
      stations: [],
    };
  }
  const { path, stations, closed } = sampled;
  const attachmentValue = (name) =>
    options[name] ??
    sourcePath?.[name] ??
    sourcePath?.metadata?.[name] ??
    nestedSettings[name];
  const normalizeAttachment = (name) => {
    const attachment = attachmentValue(name);
    if (!attachment) return null;
    const boundary = attachment.boundary;
    if (boundary != null && !Array.isArray(boundary)) {
      errors.push(`${name}.boundary must be an array`);
      return { metadata: attachment, boundary: null };
    }
    if (
      boundary?.some(
        (point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )
    ) {
      errors.push(`${name} boundary points must contain finite x and y values`);
      return { metadata: attachment, boundary: null };
    }
    const flare = Number(attachment.flare ?? 0);
    const blendLength = Number(attachment.blendLength ?? 0);
    if (!Number.isFinite(flare) || flare < 0) {
      errors.push(`${name}.flare must be a non-negative finite number`);
    }
    if (!Number.isFinite(blendLength) || blendLength < 0) {
      errors.push(`${name}.blendLength must be a non-negative finite number`);
    }
    const safeFlare = Number.isFinite(flare) && flare >= 0 ? flare : 0;
    const safeBlendLength =
      Number.isFinite(blendLength) && blendLength >= 0 ? blendLength : 0;
    const points = boundary?.map((point) => ({
      x: point.x,
      y: point.y,
      z: Number.isFinite(point.z) ? point.z : undefined,
    }));
    const boundaryWidth = points?.length >= 2
      ? Math.hypot(
          points.at(-1).x - points[0].x,
          points.at(-1).y - points[0].y,
        )
      : null;
    return {
      metadata: attachment,
      boundary: points?.length >= 2 ? points : null,
      boundaryWidth,
      targetWidth: boundaryWidth == null ? null : boundaryWidth + 2 * safeFlare,
      flare: safeFlare,
      blendLength: safeBlendLength,
    };
  };
  const sourceInfo = normalizeAttachment("sourceAttachment");
  const endInfo = normalizeAttachment("endAttachment");

  const insertBlendStation = (info, atStart) => {
    if (closed || !info?.boundary || info.blendLength <= EPSILON) return;
    const total = stations.slice(1).reduce(
      (sum, station, index) =>
        sum + Math.hypot(station.x - stations[index].x, station.y - stations[index].y),
      0,
    );
    const targetDistance = Math.min(info.blendLength / 2, total / 2);
    if (targetDistance <= EPSILON) return;
    let traversed = 0;
    const first = atStart ? 0 : stations.length - 1;
    const step = atStart ? 1 : -1;
    for (let offset = 0; offset < stations.length - 1; offset++) {
      const fromIndex = first + offset * step;
      const toIndex = fromIndex + step;
      const from = stations[fromIndex];
      const to = stations[toIndex];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (traversed + length < targetDistance - EPSILON) {
        traversed += length;
        continue;
      }
      const amount = (targetDistance - traversed) / length;
      if (amount <= EPSILON || amount >= 1 - EPSILON) return;
      const interpolate = (key) => from[key] + (to[key] - from[key]) * amount;
      const tangent = {
        x: from.tangent.x + (to.tangent.x - from.tangent.x) * amount,
        y: from.tangent.y + (to.tangent.y - from.tangent.y) * amount,
        z: from.tangent.z + (to.tangent.z - from.tangent.z) * amount,
      };
      const tangentLength = Math.hypot(tangent.x, tangent.y, tangent.z);
      const station = {
        x: interpolate("x"),
        y: interpolate("y"),
        z: interpolate("z"),
        width: interpolate("width"),
        height: interpolate("height"),
        tangent:
          tangentLength > EPSILON
            ? {
                x: tangent.x / tangentLength,
                y: tangent.y / tangentLength,
                z: tangent.z / tangentLength,
              }
            : { ...from.tangent },
        sourceSegment: atStart ? from.sourceSegment : to.sourceSegment,
        t: from.t + (to.t - from.t) * amount,
      };
      stations.splice(Math.max(fromIndex, toIndex), 0, station);
      return;
    }
  };
  insertBlendStation(sourceInfo, true);
  insertBlendStation(endInfo, false);

  if (!closed && (sourceInfo?.targetWidth != null || endInfo?.targetWidth != null)) {
    const distances = [0];
    for (let index = 1; index < stations.length; index++) {
      distances.push(
        distances[index - 1] +
          Math.hypot(
            stations[index].x - stations[index - 1].x,
            stations[index].y - stations[index - 1].y,
          ),
      );
    }
    const total = distances.at(-1);
    stations.forEach((station, index) => {
      const originalWidth = station.width;
      const influence = (info, distance) => {
        if (info?.targetWidth == null) return 0;
        if (info.blendLength <= EPSILON) return distance <= EPSILON ? 1 : 0;
        return Math.max(0, 1 - distance / info.blendLength);
      };
      const sourceInfluence = influence(sourceInfo, distances[index]);
      const endInfluence = influence(endInfo, total - distances[index]);
      const originalInfluence = Math.max(0, 1 - sourceInfluence - endInfluence);
      const denominator = originalInfluence + sourceInfluence + endInfluence;
      station.width =
        (originalWidth * originalInfluence +
          (sourceInfo?.targetWidth ?? 0) * sourceInfluence +
          (endInfo?.targetWidth ?? 0) * endInfluence) /
        denominator;
    });
  }

  const segmentCount = closed ? stations.length : stations.length - 1;
  for (const [index, station] of stations.entries()) {
    if (station.width <= 2 * values.wallThickness + EPSILON) {
      errors.push(`path station ${index} outside width must exceed both walls`);
    }
    if (station.height <= EPSILON) errors.push(`path station ${index} height must be positive`);
    if (
      Math.max(Math.abs(station.x), Math.abs(station.y), Math.abs(station.z)) >
      WORLD_BOUNDS
    ) {
      errors.push(`path station ${index} is outside world bounds`);
    }
  }

  const directions = [];
  const normals = [];
  for (let index = 0; index < segmentCount; index++) {
    const next = (index + 1) % stations.length;
    const delta = subtract(stations[next], stations[index]);
    const length = Math.hypot(delta.x, delta.y);
    if (length <= EPSILON) {
      errors.push(`sampled path segment ${index} has zero XY length`);
      directions.push({ x: 0, y: 0 });
      normals.push({ x: 0, y: 0 });
      continue;
    }
    const direction = { x: delta.x / length, y: delta.y / length };
    directions.push(direction);
    normals.push({ x: -direction.y, y: direction.x });
  }

  for (let first = 0; first < segmentCount; first++) {
    for (let second = first + 1; second < segmentCount; second++) {
      const adjacent =
        second === first + 1 || (closed && first === 0 && second === segmentCount - 1);
      if (adjacent) continue;
      if (
        segmentsIntersect(
          stations[first],
          stations[(first + 1) % stations.length],
          stations[second],
          stations[(second + 1) % stations.length],
        )
      ) {
        errors.push(`sampled path segments ${first} and ${second} intersect`);
      }
    }
  }
  if (errors.length) return { brushes: [], errors, path, stations };

  const miters = stations.map((_, index) => {
    if (!closed && index === 0) return normals[0];
    if (!closed && index === stations.length - 1) return normals.at(-1);
    const incoming = directions[(index - 1 + segmentCount) % segmentCount];
    const outgoing = directions[index % segmentCount];
    const denominator = 1 + dot(incoming, outgoing);
    if (denominator <= EPSILON) {
      errors.push(`path join ${index} cannot be mitered`);
      return { x: 0, y: 0 };
    }
    const miter = {
      x:
        (normals[(index - 1 + segmentCount) % segmentCount].x +
          normals[index % segmentCount].x) /
        denominator,
      y:
        (normals[(index - 1 + segmentCount) % segmentCount].y +
          normals[index % segmentCount].y) /
        denominator,
    };
    if (!Number.isFinite(miter.x) || Math.hypot(miter.x, miter.y) > MITER_LIMIT) {
      errors.push(`path join ${index} has an excessive miter`);
    }
    return miter;
  });
  if (errors.length) return { brushes: [], errors, path, stations };

  const crossSection = stations.map((station, index) => {
    const halfOutside = station.width / 2;
    const halfInside = halfOutside - values.wallThickness;
    return {
      outerRight: offsetPoint(station, miters[index], -halfOutside),
      innerRight: offsetPoint(station, miters[index], -halfInside),
      innerLeft: offsetPoint(station, miters[index], halfInside),
      outerLeft: offsetPoint(station, miters[index], halfOutside),
    };
  });
  for (let segment = 0; segment < segmentCount; segment++) {
    const next = (segment + 1) % stations.length;
    const outer = [
      crossSection[segment].outerRight,
      crossSection[next].outerRight,
      crossSection[next].outerLeft,
      crossSection[segment].outerLeft,
    ];
    const firstWinding = cross(outer[0], outer[1], outer[2]);
    const secondWinding = cross(outer[0], outer[2], outer[3]);
    if (
      Math.abs(firstWinding) <= EPSILON ||
      Math.abs(secondWinding) <= EPSILON ||
      firstWinding * secondWinding < 0
    ) {
      errors.push(`path span ${segment} offset collapses or crosses`);
    }
    for (const point of outer) {
      if (Math.max(Math.abs(point.x), Math.abs(point.y)) > WORLD_BOUNDS) {
        errors.push(`path span ${segment} offset is outside world bounds`);
        break;
      }
    }
  }
  if (errors.length) return { brushes: [], errors, path, stations };

  const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const orientBoundary = (info, stationIndex) => {
    if (closed || !info?.boundary) return null;
    const boundary = info.boundary.map((point) => ({
      ...point,
      z: point.z ?? stations[stationIndex].z,
    }));
    const right = crossSection[stationIndex].outerRight;
    if (distanceSquared(boundary.at(-1), right) < distanceSquared(boundary[0], right)) {
      boundary.reverse();
    }
    return boundary;
  };
  const sourceBoundary = orientBoundary(sourceInfo, 0);
  const endBoundary = orientBoundary(endInfo, stations.length - 1);

  const owner =
    options.assemblyId ??
    nestedSettings.assemblyId ??
    uniqueId("hallway-assembly", nextAssemblyId++);
  if (typeof owner !== "string" || !owner) {
    return { brushes: [], errors: ["assemblyId must be a non-empty string"], path, stations };
  }
  const canonicalSettings = { ...values, grid, materials };
  const brushes = [];
  const addTriangle = (role, points, base, lowerOffsets, upperOffsets, material, segment) => {
    brushes.push(
      makeTriangleBrush({
        footprint: points,
        lower: base.map((z, index) => z + lowerOffsets[index]),
        upper: base.map((z, index) => z + upperOffsets[index]),
        material,
        owner,
        segment,
        role,
        path,
        settings: canonicalSettings,
        sourceAttachment: sourceInfo?.metadata,
        endAttachment: endInfo?.metadata,
      }),
    );
  };
  const addQuad = (role, points, base, lowerOffsets, upperOffsets, material, segment) => {
    for (const indices of [[0, 1, 2], [0, 2, 3]]) {
      addTriangle(
        role,
        indices.map((index) => points[index]),
        indices.map((index) => base[index]),
        indices.map((index) => lowerOffsets[index]),
        indices.map((index) => upperOffsets[index]),
        material,
        segment,
      );
    }
  };
  const addAdapter = ({ segment, boundary, atStart, start, end, startCross, endCross, name }) => {
    const transition = atStart ? end : start;
    const attached = atStart ? start : end;
    const transitionCross = atStart ? endCross : startCross;
    const last = boundary.length - 1;
    const transitionAcross = boundary.map((_, index) => {
      const amount = index / last;
      return {
        x:
          transitionCross.outerRight.x +
          (transitionCross.outerLeft.x - transitionCross.outerRight.x) * amount,
        y:
          transitionCross.outerRight.y +
          (transitionCross.outerLeft.y - transitionCross.outerRight.y) * amount,
      };
    });
    for (let cell = 0; cell < last; cell++) {
      const points = atStart
        ? [boundary[cell], transitionAcross[cell], transitionAcross[cell + 1], boundary[cell + 1]]
        : [transitionAcross[cell], boundary[cell], boundary[cell + 1], transitionAcross[cell + 1]];
      const base = atStart
        ? [boundary[cell].z, transition.z, transition.z, boundary[cell + 1].z]
        : [transition.z, boundary[cell].z, boundary[cell + 1].z, transition.z];
      const heights = atStart
        ? [attached.height, transition.height, transition.height, attached.height]
        : [transition.height, attached.height, attached.height, transition.height];
      addQuad(
        "floor",
        points,
        base,
        Array(4).fill(-values.floorThickness),
        [0, 0, 0, 0],
        materials.floor,
        segment,
      );
      addQuad(
        "ceiling",
        points,
        base,
        heights,
        heights.map((height) => height + values.ceilingThickness),
        materials.ceiling,
        segment,
      );
    }
    const boundaryWidth = Math.hypot(
      boundary.at(-1).x - boundary[0].x,
      boundary.at(-1).y - boundary[0].y,
    );
    if (boundaryWidth <= 2 * values.wallThickness + EPSILON) {
      errors.push(`${name} boundary is too narrow for both walls`);
      return;
    }
    const inset = values.wallThickness / boundaryWidth;
    const rightInner = {
      x: boundary[0].x + (boundary.at(-1).x - boundary[0].x) * inset,
      y: boundary[0].y + (boundary.at(-1).y - boundary[0].y) * inset,
    };
    const leftInner = {
      x: boundary.at(-1).x + (boundary[0].x - boundary.at(-1).x) * inset,
      y: boundary.at(-1).y + (boundary[0].y - boundary.at(-1).y) * inset,
    };
    const rightPoints = atStart
      ? [boundary[0], transitionCross.outerRight, transitionCross.innerRight, rightInner]
      : [transitionCross.outerRight, boundary[0], rightInner, transitionCross.innerRight];
    const leftPoints = atStart
      ? [leftInner, transitionCross.innerLeft, transitionCross.outerLeft, boundary.at(-1)]
      : [transitionCross.innerLeft, leftInner, boundary.at(-1), transitionCross.outerLeft];
    const rightBase = atStart
      ? [boundary[0].z, transition.z, transition.z, boundary[0].z]
      : [transition.z, boundary[0].z, boundary[0].z, transition.z];
    const leftBase = atStart
      ? [boundary.at(-1).z, transition.z, transition.z, boundary.at(-1).z]
      : [transition.z, boundary.at(-1).z, boundary.at(-1).z, transition.z];
    const wallHeights = atStart
      ? [attached.height, transition.height, transition.height, attached.height]
      : [transition.height, attached.height, attached.height, transition.height];
    addQuad("right-wall", rightPoints, rightBase, [0, 0, 0, 0], wallHeights, materials.wall, segment);
    addQuad("left-wall", leftPoints, leftBase, [0, 0, 0, 0], wallHeights, materials.wall, segment);
  };

  if (sourceBoundary && endBoundary && segmentCount === 1) {
    return {
      brushes: [],
      errors: ["sourceAttachment and endAttachment require separate adapter spans"],
      path,
      stations,
    };
  }

  for (let segment = 0; segment < segmentCount; segment++) {
    const next = (segment + 1) % stations.length;
    const start = stations[segment];
    const end = stations[next];
    const startCross = crossSection[segment];
    const endCross = crossSection[next];
    const addOrdinary = (role, points, lowerOffsets, upperOffsets, material) => {
      addQuad(
        role,
        points,
        [start.z, end.z, end.z, start.z],
        lowerOffsets,
        upperOffsets,
        material,
        segment,
      );
    };
    if (segment === 0 && sourceBoundary) {
      addAdapter({
        segment,
        boundary: sourceBoundary,
        atStart: true,
        start,
        end,
        startCross,
        endCross,
        name: "sourceAttachment",
      });
      continue;
    }
    if (segment === segmentCount - 1 && endBoundary) {
      addAdapter({
        segment,
        boundary: endBoundary,
        atStart: false,
        start,
        end,
        startCross,
        endCross,
        name: "endAttachment",
      });
      continue;
    }
    const outer = [startCross.outerRight, endCross.outerRight, endCross.outerLeft, startCross.outerLeft];
    addOrdinary("floor", outer, [-values.floorThickness, -values.floorThickness, -values.floorThickness, -values.floorThickness], [0, 0, 0, 0], materials.floor);
    addOrdinary("ceiling", outer, [start.height, end.height, end.height, start.height], [start.height + values.ceilingThickness, end.height + values.ceilingThickness, end.height + values.ceilingThickness, start.height + values.ceilingThickness], materials.ceiling);
    addOrdinary("right-wall", [startCross.outerRight, endCross.outerRight, endCross.innerRight, startCross.innerRight], [0, 0, 0, 0], [start.height, end.height, end.height, start.height], materials.wall);
    addOrdinary("left-wall", [startCross.innerLeft, endCross.innerLeft, endCross.outerLeft, startCross.outerLeft], [0, 0, 0, 0], [start.height, end.height, end.height, start.height], materials.wall);
  }

  const validationErrors = brushes.flatMap((brush) =>
    validateBrush(brush).map((issue) => `${brush.id}: ${issue}`),
  );
  return errors.length || validationErrors.length
    ? { brushes: [], errors: [...errors, ...validationErrors], path, stations }
    : { brushes, errors: [], path, stations };
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
  if (!Array.isArray(sourcePath)) {
    return generateSampledHallway(options, nestedSettings);
  }
  const grid = Number(options.grid ?? nestedSettings.grid ?? 16);
  const errors = [];
  if (!Number.isFinite(grid) || grid <= 0) errors.push("grid must be positive");
  if (!Array.isArray(sourcePath) || sourcePath.length < 2) {
    errors.push("path must contain at least two points");
    return {
      brushes: [],
      errors,
      path: Array.isArray(sourcePath) ? cloneMetadata(sourcePath) : null,
      stations: Array.isArray(sourcePath) ? cloneMetadata(sourcePath) : [],
    };
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
  if (errors.length) {
    return {
      brushes: [],
      errors,
      path: cloneMetadata(sourcePath),
      stations: cloneMetadata(sourcePath),
    };
  }

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
  if (errors.length) return { brushes: [], errors, path, stations: cloneMetadata(path) };

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
  if (errors.length) return { brushes: [], errors, path, stations: cloneMetadata(path) };

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
  if (errors.length) return { brushes: [], errors, path, stations: cloneMetadata(path) };

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
  if (errors.length) return { brushes: [], errors, path, stations: cloneMetadata(path) };

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
    return {
      brushes: [],
      errors: ["assemblyId must be a non-empty string"],
      path,
      stations: cloneMetadata(path),
    };
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
    ? { brushes: [], errors: validationErrors, path, stations: cloneMetadata(path) }
    : { brushes, errors: [], path, stations: cloneMetadata(path) };
}
