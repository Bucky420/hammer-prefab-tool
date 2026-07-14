const dot = (left, right) => left.x * right.x + left.y * right.y + left.z * right.z;
const faceCenter = (brush, face) => face.reduce((sum, index) => ({ x: sum.x + brush.vertices[index].x / face.length, y: sum.y + brush.vertices[index].y / face.length, z: sum.z + brush.vertices[index].z / face.length }), { x: 0, y: 0, z: 0 });
const averageZ = (brush, face) => face.reduce((sum, index) => sum + brush.vertices[index].z / face.length, 0);
function normalize(vector) { const length = Math.hypot(vector.x, vector.y, vector.z); return length > .000001 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : null; }
function normal(brush, face) { const a = brush.vertices[face[0]], b = brush.vertices[face[1]], c = brush.vertices[face[2]]; return normalize({ x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }); }
function projectOntoFace(vector, faceNormal) { const projection = dot(vector, faceNormal); return normalize({ x: vector.x - faceNormal.x * projection, y: vector.y - faceNormal.y * projection, z: vector.z - faceNormal.z * projection }); }

// Center-align every face. Curved walls receive tangential U axes; radial end
// caps fall back to a center-facing U axis. Shifts are anchored at shape center.
export function alignAllFacesToCenter(brushes) {
  const vertices = brushes.flatMap(brush => brush.vertices);
  if (!vertices.length) return 0;
  const center = vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / vertices.length, y: sum.y + vertex.y / vertices.length, z: sum.z + vertex.z / vertices.length }), { x: 0, y: 0, z: 0 });
  let aligned = 0;
  for (const brush of brushes) {
    brush.textureAxes ||= [];
    for (const [index, face] of brush.faces.entries()) {
      const faceNormal = normal(brush, face);
      if (!faceNormal) continue;
      const faceOrigin = faceCenter(brush, face);
      const radial = normalize({ x: faceOrigin.x - center.x, y: faceOrigin.y - center.y, z: 0 }) || { x: 1, y: 0, z: 0 };
      const tangent = { x: -radial.y, y: radial.x, z: 0 };
      // Tangent is correct for top/inner/outer ring faces. Radial caps need fallback.
      const u = projectOntoFace(tangent, faceNormal) || projectOntoFace({ x: -radial.x, y: -radial.y, z: 0 }, faceNormal) || projectOntoFace({ x: 1, y: 0, z: 0 }, faceNormal);
      if (!u) continue;
      const v = normalize({ x: faceNormal.y * u.z - faceNormal.z * u.y, y: faceNormal.z * u.x - faceNormal.x * u.z, z: faceNormal.x * u.y - faceNormal.y * u.x });
      if (!v) continue;
      const source = brush.textureAxes[index] || {};
      brush.textureAxes[index] = { u: [u.x, u.y, u.z], v: [v.x, v.y, v.z], uShift: -(center.x * u.x + center.y * u.y + center.z * u.z), vShift: -(center.x * v.x + center.y * v.y + center.z * v.z), uScale: source.uScale || .25, vScale: source.vScale || .25 };
      aligned++;
    }
    brush.topTextureFace = brush.faces.reduce((highest, face, index) => averageZ(brush, face) > averageZ(brush, brush.faces[highest]) ? index : highest, 0);
  }
  return aligned;
}
