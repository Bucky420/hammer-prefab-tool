let nextId = 10000;
const polar = (radius, degrees) => { const radians = degrees * Math.PI / 180; return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }; };
const axis = value => Math.abs(value) < 0.000001 ? 0 : Number(value.toFixed(6));
// Equivalent to Hammer's V_rint(value / grid) * grid snapping.
const hammerSnap = (value, grid) => Math.round(value / grid) * grid;
function outward(face, vertices) {
  const center = vertices.reduce((sum, v) => ({ x: sum.x + v.x / vertices.length, y: sum.y + v.y / vertices.length, z: sum.z + v.z / vertices.length }), { x: 0, y: 0, z: 0 });
  const points = face.map(index => vertices[index]);
  const a = points[0], b = points[1], c = points[2];
  const normal = { x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) };
  const faceCenter = points.reduce((sum, v) => ({ x: sum.x + v.x / points.length, y: sum.y + v.y / points.length, z: sum.z + v.z / points.length }), { x: 0, y: 0, z: 0 });
  return normal.x * (faceCenter.x - center.x) + normal.y * (faceCenter.y - center.y) + normal.z * (faceCenter.z - center.z) < 0 ? [...face].reverse() : face;
}

// Matches Hammer's CreateSegment topology: every side is a convex annular wedge brush.
export function generateRing({ radius = 256, width = 64, height = 128, segments = 12, startAngle = 0, endAngle = 360, addHeight = 0, textureMode = "radial", grid = 16 } = {}) {
  const innerRadius = Math.max(0, radius - width / 2);
  const outerRadius = Math.max(innerRadius + 1, radius + width / 2);
  const count = Math.max(3, Math.floor(segments));
  const span = endAngle - startAngle;
  const brushes = [];
  for (let i = 0; i < count; i++) {
    const start = startAngle + span * i / count;
    const end = startAngle + span * (i + 1) / count;
    const outerStart = polar(outerRadius, start), outerEnd = polar(outerRadius, end);
    const innerEnd = polar(innerRadius, end), innerStart = polar(innerRadius, start);
    const z0 = hammerSnap(i * addHeight, grid), z1 = hammerSnap(i * addHeight + height, grid);
    const vertices = [outerStart, outerEnd, innerEnd, innerStart].flatMap(p => [{ x: hammerSnap(p.x, grid), y: hammerSnap(p.y, grid), z: z0 }, { x: hammerSnap(p.x, grid), y: hammerSnap(p.y, grid), z: z1 }]);
    // Bottom, top, outer curve chord, end cap, inner curve chord, start cap.
    const faces = [[0, 2, 4, 6], [1, 7, 5, 3], [0, 1, 3, 2], [2, 3, 5, 4], [4, 5, 7, 6], [6, 7, 1, 0]].map(face => outward(face, vertices));
    const midpoint = (start + end) * Math.PI / 360;
    const tangent = [axis(-Math.sin(midpoint)), axis(Math.cos(midpoint)), 0];
    const radial = [axis(Math.cos(midpoint)), axis(Math.sin(midpoint)), 0];
    // The top and inner wall share U along the curve, keeping texture flow continuous.
    const textureAxes = textureMode === "radial" ? [
      { u: tangent, v: radial },
      { u: tangent, v: radial },
      { u: tangent, v: [0, 0, 1] },
      { u: radial, v: [0, 0, 1] },
      { u: tangent, v: [0, 0, 1] },
      { u: radial, v: [0, 0, 1] }
    ] : undefined;
    brushes.push({ id: `brush-${nextId++}`, material: "dev/dev_measurewall01a", vertices, faces, textureAxes, generator: { type: "ring", segment: i, segments: count, startAngle: start, endAngle: end, innerRadius, outerRadius }, vertexRoles: { inner: [4, 5, 6, 7], outer: [0, 1, 2, 3], topInner: [5, 7], topOuter: [1, 3], bottomInner: [4, 6], bottomOuter: [0, 2] } });
  }
  return brushes;
}
