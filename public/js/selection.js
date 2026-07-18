import { pointInPolygon, distanceToSegment, distanceSquared } from "./math.js";
export function selectByShape(points, shape, mode) {
  if (mode === "box") {
    const minX = Math.min(shape.x, shape.x + shape.w),
      maxX = Math.max(shape.x, shape.x + shape.w),
      minY = Math.min(shape.y, shape.y + shape.h),
      maxY = Math.max(shape.y, shape.y + shape.h);
    return points.filter(
      (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
    );
  }
  if (mode === "circle")
    return points.filter((p) => distanceSquared(p, shape) <= shape.r * shape.r);
  return points.filter((p) => pointInPolygon(p, shape));
}
export function applySelection(current, ids, operation = "replace") {
  const next = new Set(operation === "replace" ? [] : current);
  ids.forEach((id) => {
    if (operation === "remove") next.delete(id);
    else if (operation === "toggle")
      next.has(id) ? next.delete(id) : next.add(id);
    else next.add(id);
  });
  return next;
}
export function ringVertexIds(brushes, role) {
  return brushes.flatMap((brush) =>
    (brush.vertexRoles?.[role] || []).map((index) => `${brush.id}:v:${index}`),
  );
}
export function faceRole(brush, faceIndex) {
  const face = brush.faces[faceIndex];
  if (!face) return null;
  for (const role of ["outer", "inner"]) {
    const vertices = new Set(brush.vertexRoles?.[role] || []);
    if (vertices.size && face.every((index) => vertices.has(index)))
      return role;
  }
  const a = brush.vertices[face[0]],
    b = brush.vertices[face[1]],
    c = brush.vertices[face[2]];
  const normal = {
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  };
  const center = brush.vertices.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / brush.vertices.length,
      y: sum.y + vertex.y / brush.vertices.length,
      z: sum.z + vertex.z / brush.vertices.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const faceCenter = face.reduce(
    (sum, index) => ({
      x: sum.x + brush.vertices[index].x / face.length,
      y: sum.y + brush.vertices[index].y / face.length,
      z: sum.z + brush.vertices[index].z / face.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  if (
    normal.x * (faceCenter.x - center.x) +
      normal.y * (faceCenter.y - center.y) +
      normal.z * (faceCenter.z - center.z) <
    0
  )
    normal.z *= -1;
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (!length || Math.abs(normal.z) / length < 0.98) return null;
  return normal.z > 0 ? "top" : "bottom";
}
export function semanticFaceIds(brushes, id) {
  const match = id.match(/^(.*):f:(\d+)$/),
    source = match && brushes.find((brush) => brush.id === match[1]),
    role = source && faceRole(source, Number(match[2]));
  if (!source || !role) return [id];
  const group = source.groupId || source.id;
  return brushes
    .filter((brush) => (brush.groupId || brush.id) === group)
    .flatMap((brush) =>
      brush.faces
        .map((_, faceIndex) =>
          faceRole(brush, faceIndex) === role
            ? `${brush.id}:f:${faceIndex}`
            : null,
        )
        .filter(Boolean),
    );
}
function faceNormal(brush, faceIndex) {
  const face = brush.faces[faceIndex],
    a = brush.vertices[face[0]],
    b = brush.vertices[face[1]],
    c = brush.vertices[face[2]];
  let normal = {
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  };
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  normal = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  return normal;
}
export function connectedFaceIds(brushes, id) {
  const match = id.match(/^(.*):f:(\d+)$/),
    source = match && brushes.find((brush) => brush.id === match[1]),
    sourceIndex = Number(match?.[2]);
  if (!source || !source.faces[sourceIndex]) return [id];
  const group = source.groupId || source.id,
    sourceRole = faceRole(source, sourceIndex),
    sourceNormal = faceNormal(source, sourceIndex),
    pointKey = (point) =>
      `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`,
    groupedBrushes = brushes.filter(
      (item) => (item.groupId || item.id) === group,
    ),
    faceKey = (brush, face) =>
      face
        .map((index) => pointKey(brush.vertices[index]))
        .sort()
        .join("|"),
    faceCounts = new Map(),
    nodes = new Map(),
    edges = new Map();
  for (const brush of groupedBrushes)
    for (const face of brush.faces) {
      const key = faceKey(brush, face);
      faceCounts.set(key, (faceCounts.get(key) || 0) + 1);
    }
  for (const brush of groupedBrushes)
    for (const [faceIndex, face] of brush.faces.entries()) {
      const role = faceRole(brush, faceIndex),
        normal = faceNormal(brush, faceIndex),
        compatible = sourceRole
          ? role === sourceRole
          : Math.abs(Math.abs(normal.z) - Math.abs(sourceNormal.z)) < 0.02 &&
            (Math.abs(sourceNormal.z) < 0.02 ||
              Math.sign(normal.z) === Math.sign(sourceNormal.z));
      if (!compatible || faceCounts.get(faceKey(brush, face)) > 1) continue;
      const faceId = `${brush.id}:f:${faceIndex}`,
        edgeKeys = [];
      for (let index = 0; index < face.length; index++) {
        const a = pointKey(brush.vertices[face[index]]),
          b = pointKey(brush.vertices[face[(index + 1) % face.length]]),
          key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edgeKeys.push(key);
        const list = edges.get(key) || [];
        list.push(faceId);
        edges.set(key, list);
      }
      nodes.set(faceId, edgeKeys);
    }
  const visited = new Set(),
    queue = [id];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current) || !nodes.has(current)) continue;
    visited.add(current);
    for (const edge of nodes.get(current))
      for (const neighbor of edges.get(edge) || [])
        if (!visited.has(neighbor)) queue.push(neighbor);
  }
  return visited.size ? [...visited] : [id];
}
export function nearest(points, p, max = 12) {
  let result = null,
    best = max;
  points.forEach((x) => {
    const d = Math.hypot(x.x - p.x, x.y - p.y);
    if (d < best) {
      best = d;
      result = x;
    }
  });
  return result;
}
export { distanceToSegment };
