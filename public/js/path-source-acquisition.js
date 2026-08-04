/**
 * @typedef {import("./geometry-model.js").Brush} Brush
 * @typedef {import("./geometry-model.js").Vector2} Vector2
 * @typedef {import("./geometry-model.js").Vector3} Vector3
 */

const DEFAULT_TOLERANCE = 0.001;
const MIN_UPWARD_NORMAL = 0.5;
const CHAIN_SCORE_WINDOW = 0.1;
const CHAIN_NORMAL_DOT = 0.5;

const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cleanZero = (value) => (Math.abs(value) < Number.EPSILON ? 0 : value);
const distance3 = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const average = (points) =>
  points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
      z: sum.z + point.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );

function newellNormal(points) {
  const normal = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    normal.x += (point.y - next.y) * (point.z + next.z);
    normal.y += (point.z - next.z) * (point.x + next.x);
    normal.z += (point.x - next.x) * (point.y + next.y);
  }
  const length = Math.hypot(normal.x, normal.y, normal.z);
  return length > 0
    ? {
        x: cleanZero(normal.x / length),
        y: cleanZero(normal.y / length),
        z: cleanZero(normal.z / length),
      }
    : null;
}

function topFace(brush, tolerance) {
  if (!brush || !Array.isArray(brush.vertices) || !Array.isArray(brush.faces))
    return null;
  const brushCenter = average(brush.vertices);
  return brush.faces
    .map((face, faceIndex) => {
      if (!Array.isArray(face) || face.length < 3) return null;
      const points = face.map((index) => brush.vertices[index]);
      if (points.some((point) => !point || ![point.x, point.y, point.z].every(Number.isFinite)))
        return null;
      let normal = newellNormal(points);
      if (!normal) return null;
      const faceCenter = average(points);
      if (dot3(normal, {
        x: faceCenter.x - brushCenter.x,
        y: faceCenter.y - brushCenter.y,
        z: faceCenter.z - brushCenter.z,
      }) < 0) {
        normal = {
          x: cleanZero(-normal.x),
          y: cleanZero(-normal.y),
          z: cleanZero(-normal.z),
        };
        points.reverse();
      }
      if (normal.z < MIN_UPWARD_NORMAL) return null;
      const distance = dot3(normal, points[0]);
      if (points.some((point) => Math.abs(dot3(normal, point) - distance) > tolerance))
        return null;
      return { brush, faceIndex, points, normal, distance, center: faceCenter };
    })
    .filter(Boolean)
    .sort((a, b) => b.normal.z - a.normal.z || b.center.z - a.center.z)[0] || null;
}

function pointKey(point, tolerance) {
  const scale = 1 / tolerance;
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value * scale))
    .join(",");
}

function edgeKey(a, b, tolerance) {
  const aKey = pointKey(a, tolerance);
  const bKey = pointKey(b, tolerance);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function polygonCentroid(face) {
  let areaTwice = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < face.points.length; index += 1) {
    const point = face.points[index];
    const next = face.points[(index + 1) % face.points.length];
    const cross = point.x * next.y - next.x * point.y;
    areaTwice += cross;
    x += (point.x + next.x) * cross;
    y += (point.y + next.y) * cross;
  }
  const area = Math.abs(areaTwice) / 2;
  if (Math.abs(areaTwice) < Number.EPSILON)
    return { area: 0, point: face.center };
  x /= 3 * areaTwice;
  y /= 3 * areaTwice;
  const z = (face.distance - face.normal.x * x - face.normal.y * y) / face.normal.z;
  return { area, point: { x, y, z } };
}

function connectedComponents(edges, tolerance) {
  const remaining = new Set(edges);
  const components = [];
  while (remaining.size) {
    const component = [remaining.values().next().value];
    remaining.delete(component[0]);
    for (let index = 0; index < component.length; index += 1) {
      const edge = component[index];
      for (const candidate of [...remaining]) {
        const touches =
          pointKey(edge.a, tolerance) === pointKey(candidate.a, tolerance) ||
          pointKey(edge.a, tolerance) === pointKey(candidate.b, tolerance) ||
          pointKey(edge.b, tolerance) === pointKey(candidate.a, tolerance) ||
          pointKey(edge.b, tolerance) === pointKey(candidate.b, tolerance);
        if (touches && edge.outward.x * candidate.outward.x + edge.outward.y * candidate.outward.y >= CHAIN_NORMAL_DOT) {
          component.push(candidate);
          remaining.delete(candidate);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function orderChain(edges, tolerance) {
  if (edges.length === 1) return [edges[0].a, edges[0].b];
  const counts = new Map();
  for (const edge of edges) {
    for (const point of [edge.a, edge.b]) {
      const key = pointKey(point, tolerance);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const endpoint = [...counts].find(([, count]) => count === 1)?.[0];
  if (!endpoint) return null;
  const remaining = new Set(edges);
  const points = [];
  let currentKey = endpoint;
  while (remaining.size) {
    const edge = [...remaining].find(
      (candidate) =>
        pointKey(candidate.a, tolerance) === currentKey ||
        pointKey(candidate.b, tolerance) === currentKey,
    );
    if (!edge) return null;
    const aKey = pointKey(edge.a, tolerance);
    const start = aKey === currentKey ? edge.a : edge.b;
    const end = aKey === currentKey ? edge.b : edge.a;
    if (!points.length) points.push({ ...start });
    points.push({ ...end });
    currentKey = pointKey(end, tolerance);
    remaining.delete(edge);
  }
  return points;
}

function failure(sourceBrushIds, errors) {
  return {
    sourceBrushIds,
    boundary: [],
    left: null,
    right: null,
    center: null,
    direction: null,
    floorPlane: null,
    outsideWidth: 0,
    interiorWidth: 0,
    elevation: null,
    errors,
  };
}

/**
 * Infers a hallway mouth from one or two selected floor brushes.
 *
 * @param {Brush[]} selectedBrushes
 * @param {Vector2} pointer
 * @param {number} wallThickness
 * @param {number} [tolerance]
 */
export function acquirePathSource(
  selectedBrushes,
  pointer,
  wallThickness,
  tolerance = DEFAULT_TOLERANCE,
) {
  const brushes = Array.isArray(selectedBrushes) ? selectedBrushes : [];
  const sourceBrushIds = brushes.map((brush) => brush?.id).filter((id) => typeof id === "string");
  if (brushes.length < 1 || brushes.length > 2)
    return failure(sourceBrushIds, ["Select one or two floor brushes"]);
  if (!pointer || ![pointer.x, pointer.y].every(Number.isFinite))
    return failure(sourceBrushIds, ["Pointer must contain finite x and y values"]);
  if (!Number.isFinite(wallThickness) || wallThickness < 0)
    return failure(sourceBrushIds, ["Wall thickness must be non-negative"]);
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    return failure(sourceBrushIds, ["Tolerance must be positive"]);

  const topFaces = brushes.map((brush) => topFace(brush, tolerance));
  if (topFaces.some((face) => !face))
    return failure(sourceBrushIds, ["Every selected brush must have a usable upward face"]);
  const floorPlane = {
    normal: { ...topFaces[0].normal },
    distance: topFaces[0].distance,
  };
  if (topFaces.slice(1).some((face) =>
    1 - dot3(face.normal, floorPlane.normal) > tolerance ||
    Math.abs(face.distance - floorPlane.distance) > tolerance)) {
    return failure(sourceBrushIds, ["Selected floor faces must be compatible and coplanar"]);
  }

  const edgeGroups = new Map();
  for (const face of topFaces) {
    for (let index = 0; index < face.points.length; index += 1) {
      const a = face.points[index];
      const b = face.points[(index + 1) % face.points.length];
      const key = edgeKey(a, b, tolerance);
      if (!edgeGroups.has(key)) edgeGroups.set(key, []);
      edgeGroups.get(key).push({ a, b, face });
    }
  }
  const sharedEdges = [...edgeGroups.values()].filter((group) => group.length === 2);
  if (brushes.length === 2 && sharedEdges.length === 0)
    return failure(sourceBrushIds, ["Selected floor brushes must share a top-face edge"]);
  if ([...edgeGroups.values()].some((group) => group.length > 2))
    return failure(sourceBrushIds, ["Selected floor perimeter is ambiguous"]);
  const perimeter = [...edgeGroups.values()]
    .filter((group) => group.length === 1)
    .map(([edge]) => edge);

  const weighted = topFaces.map(polygonCentroid);
  const totalArea = weighted.reduce((sum, entry) => sum + entry.area, 0);
  if (totalArea <= tolerance * tolerance)
    return failure(sourceBrushIds, ["Selected floor area is too small"]);
  const centroid = weighted.reduce(
    (sum, entry) => ({
      x: sum.x + (entry.point.x * entry.area) / totalArea,
      y: sum.y + (entry.point.y * entry.area) / totalArea,
      z: sum.z + (entry.point.z * entry.area) / totalArea,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const pointerOffset = { x: pointer.x - centroid.x, y: pointer.y - centroid.y };
  const pointerDistance = Math.hypot(pointerOffset.x, pointerOffset.y);
  if (pointerDistance <= tolerance)
    return failure(sourceBrushIds, ["Pointer is too close to the selected floor center"]);
  const direction = {
    x: pointerOffset.x / pointerDistance,
    y: pointerOffset.y / pointerDistance,
  };

  for (const edge of perimeter) {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const outward = {
      x: dy * edge.face.normal.z,
      y: -dx * edge.face.normal.z,
    };
    const length = Math.hypot(outward.x, outward.y);
    edge.outward = { x: outward.x / length, y: outward.y / length };
    edge.score = edge.outward.x * direction.x + edge.outward.y * direction.y;
  }
  const maxScore = Math.max(...perimeter.map((edge) => edge.score));
  if (!Number.isFinite(maxScore) || maxScore <= tolerance)
    return failure(sourceBrushIds, ["Pointer is behind the selected floor boundary"]);
  const candidates = perimeter.filter(
    (edge) => edge.score >= maxScore - CHAIN_SCORE_WINDOW && edge.score > 0,
  );
  const components = connectedComponents(candidates, tolerance)
    .map((edges) => ({ edges, score: Math.max(...edges.map((edge) => edge.score)) }))
    .sort((a, b) => b.score - a.score);
  if (components.length > 1 && components[0].score - components[1].score <= tolerance)
    return failure(sourceBrushIds, ["Pointer direction is ambiguous"]);
  let boundary = orderChain(components[0].edges, tolerance);
  if (!boundary)
    return failure(sourceBrushIds, ["Selected floor boundary is ambiguous"]);

  const componentOutside = components[0].edges.reduce((best, edge) => {
    const midpoint = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    return Math.max(best,
      edge.outward.x * (pointer.x - midpoint.x) +
      edge.outward.y * (pointer.y - midpoint.y));
  }, -Infinity);
  if (componentOutside < -tolerance)
    return failure(sourceBrushIds, ["Pointer is behind the selected floor boundary"]);
  if (componentOutside <= tolerance)
    return failure(sourceBrushIds, ["Pointer is too close to the selected floor boundary"]);

  const lateral = { x: -direction.y, y: direction.x };
  if ((boundary[0].x - centroid.x) * lateral.x + (boundary[0].y - centroid.y) * lateral.y <
      (boundary.at(-1).x - centroid.x) * lateral.x + (boundary.at(-1).y - centroid.y) * lateral.y) {
    boundary = boundary.reverse();
  }
  const left = { ...boundary[0] };
  const right = { ...boundary.at(-1) };
  const center = {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    z: (left.z + right.z) / 2,
  };
  const outsideWidth = distance3(left, right);
  const interiorWidth = outsideWidth - 2 * wallThickness;
  if (interiorWidth <= tolerance)
    return failure(sourceBrushIds, ["Wall thickness collapses the hallway interior"]);

  return {
    sourceBrushIds,
    boundary,
    left,
    right,
    center,
    direction,
    floorPlane,
    outsideWidth,
    interiorWidth,
    elevation: center.z,
    errors: [],
  };
}

function distanceToBoundary(pointer, boundary) {
  let nearest = Infinity;
  for (let index = 0; index + 1 < boundary.length; index += 1) {
    const a = boundary[index];
    const b = boundary[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = Math.max(
      0,
      Math.min(
        1,
        ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) /
          (lengthSquared || 1),
      ),
    );
    nearest = Math.min(
      nearest,
      Math.hypot(pointer.x - a.x - amount * dx, pointer.y - a.y - amount * dy),
    );
  }
  return nearest;
}

function brushBoundsDistance(brush, pointer) {
  if (!brush || !Array.isArray(brush.vertices) || brush.vertices.length === 0)
    return Infinity;
  const xs = brush.vertices.map((vertex) => vertex?.x).filter(Number.isFinite);
  const ys = brush.vertices.map((vertex) => vertex?.y).filter(Number.isFinite);
  if (xs.length !== brush.vertices.length || ys.length !== brush.vertices.length)
    return Infinity;
  const dx = Math.max(Math.min(...xs) - pointer.x, 0, pointer.x - Math.max(...xs));
  const dy = Math.max(Math.min(...ys) - pointer.y, 0, pointer.y - Math.max(...ys));
  return Math.hypot(dx, dy);
}

function bothBrushesContribute(boundary, faces, tolerance) {
  const boundaryEdges = new Set();
  for (let index = 0; index + 1 < boundary.length; index += 1)
    boundaryEdges.add(edgeKey(boundary[index], boundary[index + 1], tolerance));
  return faces.every((face) =>
    face.points.some((point, index) =>
      boundaryEdges.has(
        edgeKey(point, face.points[(index + 1) % face.points.length], tolerance),
      ),
    ),
  );
}

/**
 * Finds the nearest usable one- or two-brush hallway mouth.
 *
 * @param {Brush[]} brushes
 * @param {Vector2} pointer
 * @param {number} wallThickness
 * @param {number} maxDistance
 * @param {number} [tolerance]
 */
export function acquireNearestPathSource(
  brushes,
  pointer,
  wallThickness,
  maxDistance,
  tolerance = DEFAULT_TOLERANCE,
) {
  if (
    !Array.isArray(brushes) ||
    !pointer ||
    ![pointer.x, pointer.y].every(Number.isFinite) ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  ) {
    return null;
  }

  const nearby = brushes
    .map((brush, index) => ({ brush, index }))
    .filter(({ brush }) => brushBoundsDistance(brush, pointer) <= maxDistance + tolerance)
    .map((entry) => ({ ...entry, face: topFace(entry.brush, tolerance) }))
    .filter((entry) => entry.face);
  const scored = [];
  const retain = (result) => {
    if (result.errors.length) return;
    const boundaryDistance = distanceToBoundary(pointer, result.boundary);
    if (boundaryDistance <= maxDistance + tolerance)
      scored.push({ result, boundaryDistance });
  };

  for (const { brush } of nearby)
    retain(acquirePathSource([brush], pointer, wallThickness, tolerance));

  const edgeOwners = new Map();
  for (const entry of nearby) {
    for (let index = 0; index < entry.face.points.length; index += 1) {
      const key = edgeKey(
        entry.face.points[index],
        entry.face.points[(index + 1) % entry.face.points.length],
        tolerance,
      );
      if (!edgeOwners.has(key)) edgeOwners.set(key, []);
      edgeOwners.get(key).push(entry);
    }
  }
  const testedPairs = new Set();
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2 || owners[0].index === owners[1].index) continue;
    const pairKey = [owners[0].index, owners[1].index].sort((a, b) => a - b).join(":");
    if (testedPairs.has(pairKey)) continue;
    testedPairs.add(pairKey);
    const result = acquirePathSource(
      [owners[0].brush, owners[1].brush],
      pointer,
      wallThickness,
      tolerance,
    );
    if (
      !result.errors.length &&
      bothBrushesContribute(result.boundary, owners.map((owner) => owner.face), tolerance)
    ) {
      retain(result);
    }
  }

  scored.sort((a, b) => {
    const distanceDifference = a.boundaryDistance - b.boundaryDistance;
    if (Math.abs(distanceDifference) > tolerance) return distanceDifference;
    const aPair = a.result.sourceBrushIds.length === 2;
    const bPair = b.result.sourceBrushIds.length === 2;
    if (aPair !== bPair) {
      const pair = aPair ? a : b;
      const single = aPair ? b : a;
      if (pair.result.outsideWidth > single.result.outsideWidth + tolerance)
        return aPair ? -1 : 1;
    }
    return b.result.outsideWidth - a.result.outsideWidth;
  });
  return scored[0]?.result || null;
}
