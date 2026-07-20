import { snap } from "./math.js";
import { roundToGrid } from "./grid.js";
let nextId = 1;
export function box(
  min = { x: -64, y: -64, z: 0 },
  max = { x: 64, y: 64, z: 128 },
  material = "tools/toolsnodraw",
) {
  const v = [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, max.y, min.z],
    [min.x, max.y, min.z],
    [min.x, min.y, max.z],
    [max.x, min.y, max.z],
    [max.x, max.y, max.z],
    [min.x, max.y, max.z],
  ].map(([x, y, z]) => ({ x, y, z }));
  return {
    id: `brush-${nextId++}`,
    material,
    vertices: v,
    faces: [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ],
  };
}
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
export function duplicateBrushes(brushes, selected) {
  const groups = new Map();
  return brushes
    .filter((brush) => selected.has(brush.id))
    .map((brush) => {
      const copy = clone(brush);
      copy.id = `copy-${nextId++}`;
      if (brush.groupId) {
        const group = groups.get(brush.groupId) || `group-copy-${nextId++}`;
        groups.set(brush.groupId, group);
        copy.groupId = group;
      }
      return copy;
    });
}
export function moveVertices(
  brushes,
  selected,
  delta,
  grid,
  snapResult = true,
) {
  brushes.forEach((b) =>
    b.vertices.forEach((v, i) => {
      if (selected.has(`${b.id}:v:${i}`)) {
        v.x = snapResult ? snap(v.x + delta.x, grid) : v.x + delta.x;
        v.y = snapResult ? snap(v.y + delta.y, grid) : v.y + delta.y;
        v.z = snapResult ? snap(v.z + delta.z, grid) : v.z + delta.z;
      }
    }),
  );
}
export function moveBrushes(brushes, selected, delta, grid, snapResult = true) {
  brushes.forEach((b) => {
    if (!selected.has(b.id)) return;
    b.vertices.forEach((v) => {
      v.x = snapResult ? snap(v.x + delta.x, grid) : v.x + delta.x;
      v.y = snapResult ? snap(v.y + delta.y, grid) : v.y + delta.y;
      v.z = snapResult ? snap(v.z + delta.z, grid) : v.z + delta.z;
    });
  });
}
// Matches Hammer's ToolMorph V_rint(position / grid) * grid behavior.
export function snapAllVertices(brushes, grid) {
  let moved = 0;
  for (const brush of brushes)
    for (const vertex of brush.vertices)
      for (const axis of ["x", "y", "z"]) {
        const snapped = roundToGrid(vertex[axis], grid);
        if (vertex[axis] !== snapped) {
          vertex[axis] = snapped;
          moved++;
        }
      }
  return moved;
}
export function countOffGridCoordinates(brushes, grid) {
  let total = 0,
    offGrid = 0;
  for (const brush of brushes)
    for (const vertex of brush.vertices)
      for (const axis of ["x", "y", "z"]) {
        total++;
        if (
          Math.abs(vertex[axis] - Math.round(vertex[axis] / grid) * grid) >
          0.000001
        )
          offGrid++;
      }
  return { total, offGrid };
}
export function center(b) {
  const n = b.vertices.length;
  return b.vertices.reduce(
    (a, v) => ({ x: a.x + v.x / n, y: a.y + v.y / n, z: a.z + v.z / n }),
    { x: 0, y: 0, z: 0 },
  );
}
export function pointInsideBrush(point, brush, epsilon = 0.01) {
  if (!brush?.faces?.length) return false;
  for (const face of brush.faces) {
    if (face.length < 3) continue;
    const p0 = brush.vertices[face[0]];
    const p1 = brush.vertices[face[1]];
    const p2 = brush.vertices[face[2]];
    const ex = p1.x - p0.x,
      ey = p1.y - p0.y,
      ez = p1.z - p0.z;
    const fx = p2.x - p0.x,
      fy = p2.y - p0.y,
      fz = p2.z - p0.z;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    const ux = nx / len,
      uy = ny / len,
      uz = nz / len;
    const dot =
      (point.x - p0.x) * ux + (point.y - p0.y) * uy + (point.z - p0.z) * uz;
    if (dot > epsilon) return false;
  }
  // Check that the point is not on a face surface (which would mean
  // it's exactly on the boundary, not strictly inside).
  for (const face of brush.faces) {
    if (face.length < 3) continue;
    const p0 = brush.vertices[face[0]];
    const p1 = brush.vertices[face[1]];
    const p2 = brush.vertices[face[2]];
    const ex = p1.x - p0.x,
      ey = p1.y - p0.y,
      ez = p1.z - p0.z;
    const fx = p2.x - p0.x,
      fy = p2.y - p0.y,
      fz = p2.z - p0.z;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    const ux = nx / len,
      uy = ny / len,
      uz = nz / len;
    const dot =
      (point.x - p0.x) * ux + (point.y - p0.y) * uy + (point.z - p0.z) * uz;
    if (Math.abs(dot) <= epsilon) return false;
  }
  return true;
}
export function brushEntersOtherBrush(brush, others, epsilon = 0.01) {
  if (!brush?.vertices?.length) return false;
  for (const vertex of brush.vertices) {
    for (const other of others) {
      if (other.id === brush.id) continue;
      if (pointInsideBrush(vertex, other, epsilon)) return true;
    }
  }
  return false;
}
export function selectedVertexCount(brushes, selection) {
  return brushes.reduce(
    (count, brush) =>
      count +
      brush.vertices.reduce(
        (sum, _, index) =>
          sum + (selection.has(`${brush.id}:v:${index}`) ? 1 : 0),
        0,
      ),
    0,
  );
}
