import { snap } from "./math.js";
import { roundToGrid } from "./grid.js";

/**
 * @typedef {"x" | "y" | "z"} Axis
 * @typedef {[Axis, Axis] | [Axis, Axis, Axis]} ActiveAxes
 * @typedef {{x: number, y: number}} Vector2
 * @typedef {{x: number, y: number, z: number}} Vector3
 * @typedef {number[]} Face
 * @typedef {{normal: Vector3, distance: number}} Plane
 * @typedef {string} FaceId
 * @typedef {Set<FaceId>} FaceSelection
 */

/**
 * @typedef {object} TextureAxes
 * @property {number[]} [u]
 * @property {number[]} [v]
 * @property {number} [uShift]
 * @property {number} [vShift]
 * @property {number} [uScale]
 * @property {number} [vScale]
 */

/**
 * Generator metadata remains open because each generator preserves its own
 * additional fields.
 *
 * @typedef {object} BrushGenerator
 * @property {string} [type]
 * @property {string} [sourceBrushId]
 * @property {string} [extrusion]
 * @property {Vector3} [extrusionCenter]
 * @property {Axis[]} [extrusionAxes]
 */

/**
 * @typedef {object} Brush
 * @property {string} id
 * @property {Vector3[]} vertices
 * @property {Face[]} faces
 * @property {string} [material]
 * @property {string[]} [faceMaterials]
 * @property {Array<TextureAxes | undefined>} [textureAxes]
 * @property {string} [groupId]
 * @property {Record<string, number[]>} [vertexRoles]
 * @property {BrushGenerator} [generator]
 */

let nextId = 1;

/**
 * @param {Vector3} [min]
 * @param {Vector3} [max]
 * @param {string} [material]
 * @returns {Brush}
 */
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

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Brush[]} brushes
 * @param {Set<string>} selected
 * @returns {Brush[]}
 */
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

/**
 * @param {Brush[]} brushes
 * @param {Set<string>} selected
 * @param {Vector3} delta
 * @param {number} grid
 * @param {boolean} [snapResult]
 * @returns {void}
 */
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

/**
 * @param {Brush[]} brushes
 * @param {Set<string>} selected
 * @param {Vector3} delta
 * @param {number} grid
 * @param {boolean} [snapResult]
 * @returns {void}
 */
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

/**
 * @param {Brush[]} brushes
 * @param {number} grid
 * @returns {number}
 */
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

/**
 * @param {Brush[]} brushes
 * @param {number} grid
 * @returns {{total: number, offGrid: number}}
 */
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

/**
 * @param {Brush} b
 * @returns {Vector3}
 */
export function center(b) {
  const n = b.vertices.length;
  return b.vertices.reduce(
    (a, v) => ({ x: a.x + v.x / n, y: a.y + v.y / n, z: a.z + v.z / n }),
    { x: 0, y: 0, z: 0 },
  );
}

/**
 * @param {Vector3} point
 * @param {Brush} brush
 * @param {number} [epsilon]
 * @returns {boolean}
 */
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

/**
 * @param {Brush} brush
 * @param {Brush[]} others
 * @param {number} [epsilon]
 * @returns {boolean}
 */
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

/**
 * @param {Brush[]} brushes
 * @param {Set<string>} selection
 * @returns {number}
 */
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
