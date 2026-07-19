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

export function planeForFace(brush, face) {
  const normal = faceDirection(brush, face);
  if (!normal) return null;
  return { normal, distance: dot(normal, brush.vertices[face[0]]) };
}

export function adjacentFaceForEdge(brush, selectedIndex, a, b) {
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

export function solveCapFromPlane(
  brush,
  faceIndex,
  targetPlane,
  sidePlaneOverrides,
) {
  const face = brush.faces[faceIndex];
  if (!face || !targetPlane) return null;
  const cap = face.map((vertexIndex, index) => {
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
    const previousEdge = (index + face.length - 1) % face.length,
      previousPlane =
        sidePlaneOverrides?.get(previousEdge) ??
        planeForFace(brush, brush.faces[previousFaceIndex]),
      nextPlane =
        sidePlaneOverrides?.get(index) ??
        planeForFace(brush, brush.faces[nextFaceIndex]);
    const point = intersectPlanes(targetPlane, previousPlane, nextPlane);
    if (!point) return null;
    return Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z)
      ? point
      : null;
  });
  return cap;
}

function line2DIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
  if (Math.abs(denom) < 0.000001) return null;
  const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
  return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
}

function isStrictlyConvex(points, epsilon = 1e-6) {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      c = points[(i + 2) % points.length],
      cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= epsilon) return false;
    const currentSign = Math.sign(cross);
    if (!sign) sign = currentSign;
    else if (currentSign !== sign) return false;
  }
  return true;
}

export function solveCrossSectionCap(brush, faceIndex, distance, snapTarget) {
  const face = brush.faces[faceIndex],
    sourcePlane = planeForFace(brush, face);
  if (!sourcePlane) return null;
  const faceLength = face.length;

  const axes = snapTarget?.activeAxes || ["x", "y"],
    [axisX, axisY] = axes,
    depthAxis = axes.length > 2 ? axes[2] : "z";

  const sourceNormal = faceDirection(brush, face);
  if (!sourceNormal) return null;

  const pointKey = (index) =>
    `${brush.vertices[index][axisX].toFixed(8)},${brush.vertices[index][axisY].toFixed(8)}`;
  const xyGroups = new Map();
  for (const index of face) {
    const key = pointKey(index);
    if (!xyGroups.has(key)) xyGroups.set(key, []);
    xyGroups.get(key).push(index);
  }
  const xyEntries = [...xyGroups.entries()];
  if (xyEntries.length !== 2 || (!snapTarget?.railA && !snapTarget?.railB)) {
    return solveCapFromPlane(brush, faceIndex, {
      normal: sourcePlane.normal,
      distance: sourcePlane.distance + distance,
    });
  }

  const [groupA, groupB] = xyEntries.map(([, indices]) => indices);
  const baseA = {
      x: brush.vertices[groupA[0]][axisX],
      y: brush.vertices[groupA[0]][axisY],
    },
    baseB = {
      x: brush.vertices[groupB[0]][axisX],
      y: brush.vertices[groupB[0]][axisY],
    };

  const allZ = face.map((index) => brush.vertices[index][depthAxis]);
  const zMin = Math.min(...allZ),
    zMax = Math.max(...allZ);

  const srcDir = { x: baseB.x - baseA.x, y: baseB.y - baseA.y },
    srcLen = Math.hypot(srcDir.x, srcDir.y);
  if (srcLen < 0.000001)
    return solveCapFromPlane(brush, faceIndex, {
      normal: sourcePlane.normal,
      distance: sourcePlane.distance + distance,
    });

  const srcNormal = { x: -srcDir.y / srcLen, y: srcDir.x / srcLen };
  let outwardSign =
    srcNormal.x * sourceNormal[axisX] + srcNormal.y * sourceNormal[axisY];
  if (outwardSign < 0) {
    srcNormal.x *= -1;
    srcNormal.y *= -1;
  }

  const capLine = {
    origin: {
      x: baseA.x + srcNormal.x * distance,
      y: baseA.y + srcNormal.y * distance,
    },
    direction: srcDir,
  };

  const railForEndpoint = (endpoint, indices, snapKey) => {
    if (snapTarget?.[snapKey]) {
      const s = snapTarget[snapKey];
      return {
        origin: { x: endpoint.x, y: endpoint.y },
        direction: s.direction,
      };
    }
    let bestIndex = -1;
    for (const vi of indices) {
      const prev = face[(face.indexOf(vi) + faceLength - 1) % faceLength];
      const adj = adjacentFaceForEdge(brush, faceIndex, prev, vi);
      if (adj >= 0) {
        bestIndex = adj;
        break;
      }
    }
    if (bestIndex < 0)
      return { origin: { x: endpoint.x, y: endpoint.y }, direction: srcDir };
    const adjNormal = faceDirection(brush, brush.faces[bestIndex]);
    if (!adjNormal)
      return { origin: { x: endpoint.x, y: endpoint.y }, direction: srcDir };
    const adjDir = {
      x: -adjNormal[axisY] || srcDir.x,
      y: adjNormal[axisX] || srcDir.y,
    };
    const adjLen = Math.hypot(adjDir.x, adjDir.y);
    return adjLen > 0.000001
      ? {
          origin: { x: endpoint.x, y: endpoint.y },
          direction: { x: adjDir.x / adjLen, y: adjDir.y / adjLen },
        }
      : { origin: { x: endpoint.x, y: endpoint.y }, direction: srcDir };
  };

  const railA = railForEndpoint(baseA, groupA, "railA");
  const railB = railForEndpoint(baseB, groupB, "railB");

  const railALen = Math.hypot(railA.direction.x, railA.direction.y);
  const railBLen = Math.hypot(railB.direction.x, railB.direction.y);
  if (railALen < 0.000001 || railBLen < 0.000001)
    return solveCapFromPlane(brush, faceIndex, {
      normal: sourcePlane.normal,
      distance: sourcePlane.distance + distance,
    });

  const capA = line2DIntersection(
    capLine.origin.x,
    capLine.origin.y,
    capLine.origin.x + capLine.direction.x,
    capLine.origin.y + capLine.direction.y,
    railA.origin.x,
    railA.origin.y,
    railA.origin.x + railA.direction.x,
    railA.origin.y + railA.direction.y,
  );
  const capB = line2DIntersection(
    capLine.origin.x,
    capLine.origin.y,
    capLine.origin.x + capLine.direction.x,
    capLine.origin.y + capLine.direction.y,
    railB.origin.x,
    railB.origin.y,
    railB.origin.x + railB.direction.x,
    railB.origin.y + railB.direction.y,
  );

  if (!capA || !capB) return null;
  if (
    !Number.isFinite(capA.x) ||
    !Number.isFinite(capA.y) ||
    !Number.isFinite(capB.x) ||
    !Number.isFinite(capB.y)
  )
    return null;

  const pushedA = dot({ x: capA.x - baseA.x, y: capA.y - baseA.y }, srcNormal);
  const pushedB = dot({ x: capB.x - baseB.x, y: capB.y - baseB.y }, srcNormal);
  if (pushedA <= 0.0001 || pushedB <= 0.0001) return null;

  if (
    !isStrictlyConvex([baseA, baseB, capB, capA]) &&
    !isStrictlyConvex([baseA, capA, capB, baseB])
  ) {
    if (!snapTarget?.railA || !snapTarget?.railB) return null;
    const swappedA = line2DIntersection(
      capLine.origin.x,
      capLine.origin.y,
      capLine.origin.x + capLine.direction.x,
      capLine.origin.y + capLine.direction.y,
      snapTarget.railB.origin.x,
      snapTarget.railB.origin.y,
      snapTarget.railB.origin.x + snapTarget.railB.direction.x,
      snapTarget.railB.origin.y + snapTarget.railB.direction.y,
    );
    const swappedB = line2DIntersection(
      capLine.origin.x,
      capLine.origin.y,
      capLine.origin.x + capLine.direction.x,
      capLine.origin.y + capLine.direction.y,
      snapTarget.railA.origin.x,
      snapTarget.railA.origin.y,
      snapTarget.railA.origin.x + snapTarget.railA.direction.x,
      snapTarget.railA.origin.y + snapTarget.railA.direction.y,
    );
    if (
      !swappedA ||
      !swappedB ||
      !isStrictlyConvex([baseA, baseB, swappedB, swappedA])
    )
      return null;
    capA.x = swappedA.x;
    capA.y = swappedA.y;
    capB.x = swappedB.x;
    capB.y = swappedB.y;
  }

  const cap = [];
  for (let i = 0; i < faceLength; i++) {
    const vertexIndex = face[i],
      z = brush.vertices[vertexIndex][depthAxis];
    const isA = groupA.includes(vertexIndex),
      pt = isA ? capA : capB;
    cap[i] = { x: 0, y: 0, z: z };
    cap[i][axisX] = pt.x;
    cap[i][axisY] = pt.y;
    cap[i][depthAxis] = z;
  }

  const aZ = [...new Set(groupA.map((i) => brush.vertices[i][depthAxis]))];
  const bZ = [...new Set(groupB.map((i) => brush.vertices[i][depthAxis]))];
  if (
    !aZ.every((z) => Number.isFinite(z)) ||
    !bZ.every((z) => Number.isFinite(z))
  )
    return null;
  if (aZ.length > 2 || bZ.length > 2) return null;

  return cap;
}

export function solveVertexSnappedExtrusion(
  brush,
  faceIndex,
  distance,
  snapA,
  snapB,
  activeAxes,
) {
  const face = brush.faces[faceIndex];
  if (!face) return null;

  const axes = activeAxes || ["x", "y"],
    [axisX, axisY] = axes,
    depthAxis = axes.length > 2 ? axes[2] : "z";

  const pointKey = (index) =>
    `${brush.vertices[index][axisX].toFixed(8)},${brush.vertices[index][axisY].toFixed(8)}`;
  const xyGroups = new Map();
  for (const index of face) {
    const key = pointKey(index);
    if (!xyGroups.has(key)) xyGroups.set(key, []);
    xyGroups.get(key).push(index);
  }
  const xyEntries = [...xyGroups.entries()];
  if (xyEntries.length !== 2) return null;

  const [groupA, groupB] = xyEntries.map(([, indices]) => indices);
  const baseA = {
      x: brush.vertices[groupA[0]][axisX],
      y: brush.vertices[groupA[0]][axisY],
    },
    baseB = {
      x: brush.vertices[groupB[0]][axisX],
      y: brush.vertices[groupB[0]][axisY],
    };

  const srcDir = { x: baseB.x - baseA.x, y: baseB.y - baseA.y },
    srcLen = Math.hypot(srcDir.x, srcDir.y);
  if (srcLen < 0.000001) return null;

  const sourceNormal = faceDirection(brush, face);
  if (!sourceNormal) return null;

  const srcNormal = { x: -srcDir.y / srcLen, y: srcDir.x / srcLen };
  let outwardSign =
    srcNormal.x * sourceNormal[axisX] + srcNormal.y * sourceNormal[axisY];
  if (outwardSign < 0) {
    srcNormal.x *= -1;
    srcNormal.y *= -1;
  }

  const freeA = {
    x: baseA.x + srcNormal.x * distance,
    y: baseA.y + srcNormal.y * distance,
  };
  const freeB = {
    x: baseB.x + srcNormal.x * distance,
    y: baseB.y + srcNormal.y * distance,
  };

  let capA, capB;
  if (snapA && snapB) {
    capA = snapA.point;
    capB = snapB.point;
  } else if (snapA) {
    const delta = {
      x: snapA.point.x - baseA.x,
      y: snapA.point.y - baseA.y,
    };
    capA = snapA.point;
    capB = { x: baseB.x + delta.x, y: baseB.y + delta.y };
  } else if (snapB) {
    const delta = {
      x: snapB.point.x - baseB.x,
      y: snapB.point.y - baseB.y,
    };
    capA = { x: baseA.x + delta.x, y: baseA.y + delta.y };
    capB = snapB.point;
  } else {
    capA = freeA;
    capB = freeB;
  }

  if (!capA || !capB) return null;
  if (!Number.isFinite(capA.x) || !Number.isFinite(capB.x)) return null;

  const pushedA =
    (capA.x - baseA.x) * srcNormal.x + (capA.y - baseA.y) * srcNormal.y;
  const pushedB =
    (capB.x - baseB.x) * srcNormal.x + (capB.y - baseB.y) * srcNormal.y;
  if (pushedA <= 0.0001 || pushedB <= 0.0001) return null;

  if (
    !isStrictlyConvex([baseA, baseB, capB, capA]) &&
    !isStrictlyConvex([baseA, capA, capB, baseB])
  )
    return null;

  const cap = [];
  for (let i = 0; i < face.length; i++) {
    const vertexIndex = face[i],
      z = brush.vertices[vertexIndex][depthAxis];
    const isA = groupA.includes(vertexIndex),
      pt = isA ? capA : capB;
    cap[i] = { x: 0, y: 0, z };
    cap[i][axisX] = pt.x;
    cap[i][axisY] = pt.y;
    cap[i][depthAxis] = z;
  }
  return cap;
}

function offsetFacePlaneCap(brush, faceIndex, distance, snapTarget = null) {
  const face = brush.faces[faceIndex];

  if (snapTarget?.snapA || snapTarget?.snapB) {
    const result = solveVertexSnappedExtrusion(
      brush,
      faceIndex,
      distance,
      snapTarget.snapA,
      snapTarget.snapB,
      snapTarget.activeAxes,
    );
    if (result) return result;
  }

  // Fall back to cross-section rails or plane offset
  if (snapTarget?.railA || snapTarget?.railB) {
    const result = solveCrossSectionCap(brush, faceIndex, distance, snapTarget);
    if (result) return result;
  }
  const sourcePlane = planeForFace(brush, face);
  if (!sourcePlane) return null;
  const targetPlane = snapTarget?.plane
    ? {
        normal: snapTarget.plane.normal,
        distance:
          snapTarget.plane.distance +
          (distance - snapTarget.distance) *
            dot(snapTarget.plane.normal, sourcePlane.normal),
      }
    : {
        normal: sourcePlane.normal,
        distance: sourcePlane.distance + distance,
      };
  return solveCapFromPlane(brush, faceIndex, targetPlane);
}

function extrudedPoint(point, direction, distance) {
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
  snapTarget = null,
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
      (selection.size === 1 && snapTarget
        ? offsetFacePlaneCap(brush, faceIndex, distance, snapTarget)
        : mode === "parallel" && selection.size === 1
          ? offsetFacePlaneCap(brush, faceIndex, distance)
          : base.map((point) => extrudedPoint(point, direction, distance)));
    if (!cap || cap.some((point) => !point)) {
      errors.push(`${id}: cap plane intersection failed or exceeded bounds`);
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
  snapTarget = null,
) {
  const CONTACT_EPSILON = 0.01;
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
      snapTarget,
    );
    if (!result.previewBrushes.length || result.errors.length) return false;
    const targetBrushIds = snapTarget?.targetBrushIds?.length
      ? snapTarget.targetBrushIds
      : snapTarget?.targetBrushId
        ? [snapTarget.targetBrushId]
        : [];
    const targetEpsilon = targetBrushIds.length ? 0.05 : CONTACT_EPSILON;
    return result.previewBrushes.some((candidate) =>
      sourceBrushes.some(
        (obstacle) =>
          !selectedBrushIds.has(obstacle.id) &&
          convexBrushesOverlap(
            candidate,
            obstacle,
            targetBrushIds.includes(obstacle.id)
              ? targetEpsilon
              : CONTACT_EPSILON,
          ),
      ),
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
