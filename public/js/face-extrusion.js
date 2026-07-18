import { validateBrush } from "./brush-validation.js";

let nextId = 30000;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function outward(face, vertices) {
  const center = vertices.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / vertices.length,
      y: sum.y + vertex.y / vertices.length,
      z: sum.z + vertex.z / vertices.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const points = face.map((index) => vertices[index]),
    normal = cross(
      subtract(points[1], points[0]),
      subtract(points[2], points[0]),
    );
  const faceCenter = points.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / points.length,
      y: sum.y + vertex.y / points.length,
      z: sum.z + vertex.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return dot(normal, subtract(faceCenter, center)) < 0
    ? [...face].reverse()
    : face;
}

function faceDirection(brush, face) {
  const points = face.map((index) => brush.vertices[index]),
    center = brush.vertices.reduce(
      (sum, vertex) => ({
        x: sum.x + vertex.x / brush.vertices.length,
        y: sum.y + vertex.y / brush.vertices.length,
        z: sum.z + vertex.z / brush.vertices.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
  const faceCenter = points.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / points.length,
      y: sum.y + vertex.y / points.length,
      z: sum.z + vertex.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  let normal = cross(
    subtract(points[1], points[0]),
    subtract(points[2], points[0]),
  );
  if (dot(normal, subtract(faceCenter, center)) < 0)
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  const length = Math.hypot(normal.x, normal.y, normal.z);
  return length
    ? { x: normal.x / length, y: normal.y / length, z: normal.z / length }
    : null;
}

function planeForFace(brush, face) {
  const normal = faceDirection(brush, face);
  if (!normal) return null;
  return { normal, distance: dot(normal, brush.vertices[face[0]]) };
}

function adjacentFaceForEdge(brush, selectedIndex, a, b) {
  return brush.faces.findIndex(
    (face, index) =>
      index !== selectedIndex && face.includes(a) && face.includes(b),
  );
}

function intersectPlanes(first, second, third) {
  const crossSecondThird = cross(second.normal, third.normal),
    crossThirdFirst = cross(third.normal, first.normal),
    crossFirstSecond = cross(first.normal, second.normal),
    denominator = dot(first.normal, crossSecondThird);
  if (Math.abs(denominator) < 0.000001) return null;
  return {
    x:
      (first.distance * crossSecondThird.x +
        second.distance * crossThirdFirst.x +
        third.distance * crossFirstSecond.x) /
      denominator,
    y:
      (first.distance * crossSecondThird.y +
        second.distance * crossThirdFirst.y +
        third.distance * crossFirstSecond.y) /
      denominator,
    z:
      (first.distance * crossSecondThird.z +
        second.distance * crossThirdFirst.z +
        third.distance * crossFirstSecond.z) /
      denominator,
  };
}

function offsetFacePlaneCap(brush, faceIndex, distance) {
  const face = brush.faces[faceIndex],
    sourcePlane = planeForFace(brush, face);
  if (!sourcePlane) return null;
  const offsetPlane = {
    normal: sourcePlane.normal,
    distance: sourcePlane.distance + distance,
  };
  return face.map((vertexIndex, index) => {
    const previous = face[(index + face.length - 1) % face.length],
      next = face[(index + 1) % face.length],
      previousFaceIndex = adjacentFaceForEdge(
        brush,
        faceIndex,
        previous,
        vertexIndex,
      ),
      nextFaceIndex = adjacentFaceForEdge(brush, faceIndex, vertexIndex, next);
    if (previousFaceIndex < 0 || nextFaceIndex < 0) return null;
    return intersectPlanes(
      offsetPlane,
      planeForFace(brush, brush.faces[previousFaceIndex]),
      planeForFace(brush, brush.faces[nextFaceIndex]),
    );
  });
}

function radialRole(brush, face, enabled) {
  if (!enabled) return null;
  for (const role of ["outer", "inner"]) {
    const vertices = new Set(brush.vertexRoles?.[role] || []);
    if (face.every((index) => vertices.has(index))) return role;
  }
  return null;
}

function extrudedPoint(
  point,
  direction,
  distance,
  radial,
  brush,
  sourceBrushes,
) {
  if (radial) {
    const axes = brush.generator?.extrusionAxes || ["x", "y"],
      group = brush.groupId || brush.id,
      points = sourceBrushes
        .filter((item) => (item.groupId || item.id) === group)
        .flatMap((item) => item.vertices),
      bounds = axes.reduce((result, axis) => {
        const values = points.map((item) => item[axis]);
        if (values.length)
          result[axis] = (Math.min(...values) + Math.max(...values)) / 2;
        return result;
      }, {}),
      source = brush.generator?.sourceBrushId
        ? sourceBrushes.find(
            (item) => item.id === brush.generator.sourceBrushId,
          )
        : null,
      center =
        brush.generator?.extrusionCenter ||
        source?.generator?.extrusionCenter ||
        bounds,
      dx = point[axes[0]] - (center[axes[0]] || 0),
      dy = point[axes[1]] - (center[axes[1]] || 0),
      radius = Math.hypot(dx, dy);
    if (!radius) return null;
    const nextRadius = radius + (radial === "outer" ? distance : -distance);
    if (nextRadius <= 0) return null;
    const result = { ...point };
    result[axes[0]] = (center[axes[0]] || 0) + (dx * nextRadius) / radius;
    result[axes[1]] = (center[axes[1]] || 0) + (dy * nextRadius) / radius;
    return result;
  }
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
    z: point.z + direction.z * distance,
  };
}

function lineIntersection(a, directionA, b, directionB) {
  const denominator = directionA.x * directionB.y - directionA.y * directionB.x;
  if (Math.abs(denominator) < 0.000001) return null;
  const delta = { x: b.x - a.x, y: b.y - a.y },
    t = (delta.x * directionB.y - delta.y * directionB.x) / denominator;
  return { x: a.x + directionA.x * t, y: a.y + directionA.y * t };
}

function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x),
    abC = orient(a, b, c),
    abD = orient(a, b, d),
    cdA = orient(c, d, a),
    cdB = orient(c, d, b);
  // Shared snapped endpoints are normal at miter joins. Only a strict
  // interior crossing makes the offset region self-intersecting.
  return abC * abD < -0.000001 && cdA * cdB < -0.000001;
}

function validateSideRegion(records, endpointUses) {
  const segments = records.map((record) => ({
    record,
    aKey: record.endpoints[0].key,
    bKey: record.endpoints[1].key,
    a: record.shifted.get(record.endpoints[0].key),
    b: record.shifted.get(record.endpoints[1].key),
  }));
  for (let first = 0; first < segments.length; first++)
    for (let second = first + 1; second < segments.length; second++) {
      const a = segments[first],
        b = segments[second];
      if (
        a.aKey === b.aKey ||
        a.aKey === b.bKey ||
        a.bKey === b.aKey ||
        a.bKey === b.bKey
      )
        continue;
      if (segmentsIntersect(a.a, a.b, b.a, b.b))
        return ["offset boundary intersects itself"];
    }
  const visited = new Set();
  for (const start of records) {
    if (visited.has(start.id)) continue;
    const original = [],
      shifted = [];
    let record = start,
      entry = start.endpoints[0].key,
      closed = false;
    while (record && !visited.has(record.id)) {
      visited.add(record.id);
      const endpoint = record.endpoints.find((item) => item.key === entry);
      original.push(endpoint);
      shifted.push(record.shifted.get(entry));
      const exit = record.endpoints.find((item) => item.key !== entry).key;
      if (exit === start.endpoints[0].key) {
        closed = true;
        break;
      }
      const next = (endpointUses.get(exit) || [])
        .map((use) => use.record)
        .find((item) => item !== record && !visited.has(item.id));
      entry = exit;
      record = next;
    }
    if (closed && original.length >= 3) {
      const area = (points) =>
          points.reduce((sum, point, index) => {
            const next = points[(index + 1) % points.length];
            return sum + point.x * next.y - next.x * point.y;
          }, 0) / 2,
        originalArea = area(original),
        shiftedArea = area(shifted);
      if (
        Math.abs(shiftedArea) < 0.001 ||
        Math.sign(originalArea) !== Math.sign(shiftedArea)
      )
        return ["offset boundary collapsed or inverted"];
    }
  }
  return [];
}

function sideLoopCaps(sourceBrushes, selection, distance, grid) {
  const records = [],
    endpointUses = new Map(),
    key = (point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
  for (const id of selection) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && sourceBrushes.find((item) => item.id === match[1]),
      face = brush?.faces[Number(match?.[2])],
      direction = brush && face && faceDirection(brush, face);
    if (!brush || !face || !direction || Math.abs(direction.z) > 0.01) continue;
    const endpoints = [];
    for (const index of face) {
      const point = brush.vertices[index],
        pointKey = key(point);
      if (!endpoints.some((item) => item.key === pointKey))
        endpoints.push({ key: pointKey, x: point.x, y: point.y });
    }
    if (endpoints.length !== 2) continue;
    const line = {
        x: endpoints[1].x - endpoints[0].x,
        y: endpoints[1].y - endpoints[0].y,
      },
      record = {
        id,
        brush,
        face,
        endpoints,
        line,
        direction,
        shifted: new Map(),
      };
    records.push(record);
    for (const endpoint of endpoints) {
      const uses = endpointUses.get(endpoint.key) || [];
      uses.push({ record, endpoint });
      endpointUses.set(endpoint.key, uses);
    }
  }
  for (const uses of endpointUses.values()) {
    let shared = null;
    if (uses.length >= 2) {
      const first = uses[0],
        second = uses[1],
        a = {
          x: first.endpoint.x + first.record.direction.x * distance,
          y: first.endpoint.y + first.record.direction.y * distance,
        },
        b = {
          x: second.endpoint.x + second.record.direction.x * distance,
          y: second.endpoint.y + second.record.direction.y * distance,
        };
      shared = lineIntersection(a, first.record.line, b, second.record.line);
      const average = {
        x:
          uses.reduce(
            (sum, use) =>
              sum + use.endpoint.x + use.record.direction.x * distance,
            0,
          ) / uses.length,
        y:
          uses.reduce(
            (sum, use) =>
              sum + use.endpoint.y + use.record.direction.y * distance,
            0,
          ) / uses.length,
      };
      if (
        !shared ||
        Math.hypot(shared.x - first.endpoint.x, shared.y - first.endpoint.y) >
          Math.max(distance * 4, 0.01)
      )
        shared = average;
    }
    for (const use of uses) {
      const point = shared || {
        x: use.endpoint.x + use.record.direction.x * distance,
        y: use.endpoint.y + use.record.direction.y * distance,
      };
      use.record.shifted.set(use.endpoint.key, {
        x: point.x,
        y: point.y,
      });
    }
  }
  return {
    caps: new Map(
      records.map((record) => [
        record.id,
        record.face.map((index) => {
          const source = record.brush.vertices[index],
            shifted = record.shifted.get(key(source));
          return { x: shifted.x, y: shifted.y, z: source.z };
        }),
      ]),
    ),
    errors: validateSideRegion(records, endpointUses),
  };
}

export function extrudeSelectedFaces(
  sourceBrushes,
  selection,
  distance,
  grid,
  guideSelection = selection,
  mode = "normal",
) {
  const created = [],
    preview = [],
    errors = [],
    touched = [],
    firstId = [...selection][0],
    firstMatch = firstId?.match(/^(.*):f:(\d+)$/),
    firstBrush =
      firstMatch && sourceBrushes.find((item) => item.id === firstMatch[1]),
    firstFace = firstBrush?.faces[Number(firstMatch?.[2])],
    sharedDirection =
      firstBrush && firstFace ? faceDirection(firstBrush, firstFace) : null,
    region =
      selection.size > 1
        ? sideLoopCaps(sourceBrushes, selection, distance, grid)
        : { caps: new Map(), errors: [] };
  errors.push(...region.errors);
  for (const id of selection) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && sourceBrushes.find((item) => item.id === match[1]),
      faceIndex = Number(match?.[2]),
      face = brush?.faces[faceIndex];
    if (!brush || !face || face.length < 3) {
      errors.push(`${id}: face no longer exists`);
      continue;
    }
    const direction =
      mode === "parallel" ? sharedDirection : faceDirection(brush, face);
    if (!direction) {
      errors.push(`${id}: face has no usable normal`);
      continue;
    }
    const base = face.map((index) => ({ ...brush.vertices[index] }));
    const cap =
      region.caps.get(id) ||
      (mode === "parallel" && selection.size === 1
        ? offsetFacePlaneCap(brush, faceIndex, distance)
        : base.map((point) => extrudedPoint(point, direction, distance)));
    if (cap.some((point) => !point)) {
      errors.push(`${id}: extrusion crossed the ring center`);
      continue;
    }
    const vertices = [...base, ...cap],
      count = base.length;
    const faces = [
      [...Array(count).keys()],
      [...Array(count).keys()].map((index) => count + index),
      ...Array.from({ length: count }, (_, index) => [
        index,
        (index + 1) % count,
        count + ((index + 1) % count),
        count + index,
      ]),
    ].map((candidate) => outward(candidate, vertices));
    const material =
      brush.faceMaterials?.[faceIndex] || brush.material || "tools/toolsnodraw";
    const result = {
      id: `extrude-${nextId++}`,
      material,
      faceMaterials: [
        "tools/toolsnodraw",
        material,
        ...Array(count).fill(material),
      ],
      vertices,
      faces,
      generator: {
        ...brush.generator,
        type: brush.generator?.type || "face-extrude",
        sourceBrushId: brush.id,
        extrusion: region.caps.has(id) ? "region" : mode,
      },
    };
    if (brush.vertexRoles) {
      result.vertexRoles = Object.fromEntries(
        Object.entries(brush.vertexRoles).map(([role, indices]) => [
          role,
          face.flatMap((sourceIndex, index) =>
            indices.includes(sourceIndex) ? [index, count + index] : [],
          ),
        ]),
      );
    }
    preview.push(result);
    const issues = validateBrush(result);
    if (issues.length) {
      errors.push(`${id}: ${issues[0]}`);
      continue;
    }
    touched.push({ brush, faceIndex });
    created.push(result);
  }
  if (errors.length) return { brushes: [], previewBrushes: preview, errors };
  for (const { brush, faceIndex } of touched) {
    brush.faceMaterials ||= brush.faces.map(
      () => brush.material || "tools/toolsnodraw",
    );
    brush.faceMaterials[faceIndex] = "tools/toolsnodraw";
  }
  return { brushes: created, previewBrushes: preview, errors };
}

function axisProjection(brush, axis) {
  const values = brush.vertices.map(
    (point) => point.x * axis.x + point.y * axis.y + point.z * axis.z,
  );
  return [Math.min(...values), Math.max(...values)];
}

function separatingAxes(brush) {
  const axes = [];
  for (const face of brush.faces) {
    const a = brush.vertices[face[0]],
      b = brush.vertices[face[1]],
      c = brush.vertices[face[2]],
      normal = cross(subtract(b, a), subtract(c, a)),
      length = Math.hypot(normal.x, normal.y, normal.z);
    if (length > 0.000001)
      axes.push({
        x: normal.x / length,
        y: normal.y / length,
        z: normal.z / length,
      });
  }
  for (const face of brush.faces)
    for (let index = 0; index < face.length; index++) {
      const a = brush.vertices[face[index]],
        b = brush.vertices[face[(index + 1) % face.length]],
        edge = subtract(b, a);
      for (const other of brush.faces) {
        const c = brush.vertices[other[0]],
          d = brush.vertices[other[1]],
          otherEdge = subtract(d, c),
          axis = cross(edge, otherEdge),
          length = Math.hypot(axis.x, axis.y, axis.z);
        if (length > 0.000001)
          axes.push({
            x: axis.x / length,
            y: axis.y / length,
            z: axis.z / length,
          });
      }
    }
  return axes;
}

export function convexBrushesOverlap(first, second, epsilon = 0.0001) {
  for (const axis of [...separatingAxes(first), ...separatingAxes(second)]) {
    const a = axisProjection(first, axis),
      b = axisProjection(second, axis);
    if (a[1] <= b[0] + epsilon || b[1] <= a[0] + epsilon) return false;
  }
  return true;
}

export function limitExtrusionDistance(
  sourceBrushes,
  selection,
  distance,
  grid,
  guideSelection = selection,
  mode = "normal",
) {
  const selectedBrushIds = new Set(
    [...selection].map((id) => id.match(/^(.*):f:/)?.[1]).filter(Boolean),
  );
  const collides = (amount) => {
    const result = extrudeSelectedFaces(
      sourceBrushes,
      selection,
      amount,
      grid,
      guideSelection,
      mode,
    );
    if (!result.previewBrushes.length || result.errors.length) return false;
    const obstacles = sourceBrushes.filter(
      (brush) => !selectedBrushIds.has(brush.id),
    );
    return result.previewBrushes.some((candidate) =>
      obstacles.some((obstacle) => convexBrushesOverlap(candidate, obstacle)),
    );
  };
  if (distance <= 0 || !collides(distance)) return distance;
  let low = 0;
  let high = distance;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (collides(middle)) high = middle;
    else low = middle;
  }
  return low;
}
