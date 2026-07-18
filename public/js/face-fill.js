import { validateBrush } from "./brush-validation.js";

let nextId = 50000;
const key = (point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function pointInTriangle(point, a, b, c) {
  const first = cross(point, a, b),
    second = cross(point, b, c),
    third = cross(point, c, a);
  return (
    (first >= 0 && second >= 0 && third >= 0) ||
    (first <= 0 && second <= 0 && third <= 0)
  );
}

function triangulate(points) {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  const indices = points.map((_, index) => index);
  if (area < 0) indices.reverse();
  const triangles = [];
  while (indices.length > 3) {
    let best = null;
    for (let index = 0; index < indices.length; index++) {
      const previous = indices[(index - 1 + indices.length) % indices.length],
        current = indices[index],
        next = indices[(index + 1) % indices.length];
      if (cross(points[previous], points[current], points[next]) <= 0) continue;
      if (
        indices.some(
          (candidate) =>
            candidate !== previous &&
            candidate !== current &&
            candidate !== next &&
            pointInTriangle(
              points[candidate],
              points[previous],
              points[current],
              points[next],
            ),
        )
      )
        continue;
      const diagonal = Math.hypot(
        points[next].x - points[previous].x,
        points[next].y - points[previous].y,
      );
      if (!best || diagonal < best.diagonal)
        best = { index, previous, current, next, diagonal };
    }
    if (!best) return null;
    triangles.push([best.previous, best.current, best.next]);
    indices.splice(best.index, 1);
  }
  triangles.push(indices);
  return triangles;
}

function convexCenterFan(points) {
  const center = points.reduce(
      (sum, point) => ({
        x: sum.x + point.x / points.length,
        y: sum.y + point.y / points.length,
      }),
      { x: 0, y: 0 },
    ),
    ordered = [...points].sort(
      (a, b) =>
        Math.atan2(a.y - center.y, a.x - center.x) -
        Math.atan2(b.y - center.y, b.x - center.x),
    ),
    signs = [];
  for (let index = 0; index < ordered.length; index++) {
    const value = cross(
      ordered[index],
      ordered[(index + 1) % ordered.length],
      ordered[(index + 2) % ordered.length],
    );
    if (Math.abs(value) > 0.0001) signs.push(Math.sign(value));
  }
  if (!signs.length || signs.some((sign) => sign !== signs[0])) return null;
  return ordered.map((point, index) => [
    point,
    ordered[(index + 1) % ordered.length],
    center,
  ]);
}

function prism(points, zMin, zMax, material) {
  const vertices = points.flatMap((point) => [
    { x: point.x, y: point.y, z: zMin },
    { x: point.x, y: point.y, z: zMax },
  ]);
  const outward = (face) => {
    const center = vertices.reduce(
        (sum, vertex) => ({
          x: sum.x + vertex.x / vertices.length,
          y: sum.y + vertex.y / vertices.length,
          z: sum.z + vertex.z / vertices.length,
        }),
        { x: 0, y: 0, z: 0 },
      ),
      facePoints = face.map((index) => vertices[index]),
      [a, b, c] = facePoints,
      normal = {
        x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
        y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
        z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      },
      faceCenter = facePoints.reduce(
        (sum, vertex) => ({
          x: sum.x + vertex.x / facePoints.length,
          y: sum.y + vertex.y / facePoints.length,
          z: sum.z + vertex.z / facePoints.length,
        }),
        { x: 0, y: 0, z: 0 },
      );
    return normal.x * (faceCenter.x - center.x) +
      normal.y * (faceCenter.y - center.y) +
      normal.z * (faceCenter.z - center.z) <
      0
      ? [...face].reverse()
      : face;
  };
  const faces = [
    [0, 4, 2],
    [1, 3, 5],
    [0, 1, 3, 2],
    [2, 3, 5, 4],
    [4, 5, 1, 0],
  ].map(outward);
  return {
    id: `fill-${nextId++}`,
    material,
    faceMaterials: [
      "dev/dev_measuregeneric01b",
      "dev/dev_measuregeneric01b",
      material,
      material,
      material,
    ],
    vertices,
    faces,
  };
}

export function fillSelectedLoop(brushes, selection) {
  const segments = [],
    errors = [],
    points = new Map();
  let zMin = Infinity,
    zMax = -Infinity,
    material = "dev/dev_measuregeneric01";
  for (const id of selection) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && brushes.find((item) => item.id === match[1]),
      faceIndex = Number(match?.[2]),
      face = brush?.faces[faceIndex];
    if (!brush || !face) {
      errors.push(`${id}: face no longer exists`);
      continue;
    }
    const endpoints = [];
    for (const vertexIndex of face) {
      const vertex = brush.vertices[vertexIndex],
        pointKey = key(vertex);
      zMin = Math.min(zMin, vertex.z);
      zMax = Math.max(zMax, vertex.z);
      if (!points.has(pointKey))
        points.set(pointKey, { x: vertex.x, y: vertex.y });
      if (!endpoints.includes(pointKey)) endpoints.push(pointKey);
    }
    if (endpoints.length !== 2) {
      errors.push(`${id}: fill requires vertical boundary faces`);
      continue;
    }
    material = brush.faceMaterials?.[faceIndex] || brush.material || material;
    segments.push(endpoints);
  }
  if (errors.length || segments.length < 3)
    return {
      brushes: [],
      errors: errors.length
        ? errors
        : ["Select a closed loop of at least three boundary faces"],
    };
  if (zMax - zMin < 0.001)
    return { brushes: [], errors: ["Fill loop has no height"] };
  const links = new Map();
  for (const [a, b] of segments)
    for (const [start, end] of [
      [a, b],
      [b, a],
    ]) {
      const values = links.get(start) || [];
      values.push(end);
      links.set(start, values);
    }
  if ([...links.values()].some((values) => values.length !== 2))
    return {
      brushes: [],
      errors: ["Selected faces do not form one closed boundary loop"],
    };
  const ordered = [],
    start = segments[0][0];
  let previous = null,
    current = start;
  do {
    ordered.push(current);
    const next = links.get(current).find((candidate) => candidate !== previous);
    previous = current;
    current = next;
  } while (current !== start && ordered.length <= segments.length);
  if (current !== start || ordered.length !== segments.length)
    return {
      brushes: [],
      errors: ["Selected faces contain multiple loops or a branch"],
    };
  const polygon = ordered.map((pointKey) => points.get(pointKey)),
    fan = convexCenterFan(polygon),
    triangles =
      fan ||
      triangulate(polygon)?.map((triangle) =>
        triangle.map((index) => polygon[index]),
      );
  if (!triangles)
    return {
      brushes: [],
      errors: ["Fill boundary self-intersects or cannot be triangulated"],
    };
  const created = triangles.map((triangle) =>
    prism(triangle, zMin, zMax, material),
  );
  const issues = created.flatMap((brush) =>
    validateBrush(brush).map((issue) => `${brush.id}: ${issue}`),
  );
  return issues.length
    ? { brushes: [], errors: issues }
    : { brushes: created, errors: [] };
}
