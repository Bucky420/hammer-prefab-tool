const dot = (left, right) => left.x * right.x + left.y * right.y + left.z * right.z;
const faceCenter = (brush, face) => face.reduce((sum, index) => ({ x: sum.x + brush.vertices[index].x / face.length, y: sum.y + brush.vertices[index].y / face.length, z: sum.z + brush.vertices[index].z / face.length }), { x: 0, y: 0, z: 0 });
const averageZ = (brush, face) => face.reduce((sum, index) => sum + brush.vertices[index].z / face.length, 0);
function normalize(vector) { const length = Math.hypot(vector.x, vector.y, vector.z); return length > .000001 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : null; }
function normal(brush, face) { const a = brush.vertices[face[0]], b = brush.vertices[face[1]], c = brush.vertices[face[2]], center = faceCenter(brush, face), brushCenter = brush.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / brush.vertices.length, y: sum.y + vertex.y / brush.vertices.length, z: sum.z + vertex.z / brush.vertices.length }), { x: 0, y: 0, z: 0 }); let result = normalize({ x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }); if (result && dot(result, { x: center.x - brushCenter.x, y: center.y - brushCenter.y, z: center.z - brushCenter.z }) < 0) result = { x: -result.x, y: -result.y, z: -result.z }; return result; }
function projectOntoFace(vector, faceNormal) { const projection = dot(vector, faceNormal); return normalize({ x: vector.x - faceNormal.x * projection, y: vector.y - faceNormal.y * projection, z: vector.z - faceNormal.z * projection }); }

// Center-align every face. Curved walls receive tangential U axes; radial end
// caps fall back to a center-facing U axis. Shifts are anchored at shape center.
function alignAllFaces(brushes, direction) {
  const vertices = brushes.flatMap(brush => brush.vertices);
  if (!vertices.length) return 0;
  const center = vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / vertices.length, y: sum.y + vertex.y / vertices.length, z: sum.z + vertex.z / vertices.length }), { x: 0, y: 0, z: 0 });
  const outerRadius = Math.max(...vertices.map(vertex => Math.hypot(vertex.x - center.x, vertex.y - center.y)));
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
      let v = normalize({ x: faceNormal.y * u.z - faceNormal.z * u.y, y: faceNormal.z * u.x - faceNormal.x * u.z, z: faceNormal.x * u.y - faceNormal.y * u.x });
      if (!v) continue;
      const radialDot = v.x * radial.x + v.y * radial.y, desiredRadialSign = direction === "outer" ? 1 : -1;
      if ((Math.abs(radialDot) > .000001 && radialDot * desiredRadialSign < 0) || (Math.abs(radialDot) <= .000001 && v.z < 0)) v = { x: -v.x, y: -v.y, z: -v.z };
      const anchor = direction === "outer" ? { x: center.x + radial.x * outerRadius, y: center.y + radial.y * outerRadius, z: center.z } : center;
      const source = brush.textureAxes[index] || {};
      brush.textureAxes[index] = { u: [u.x, u.y, u.z], v: [v.x, v.y, v.z], uShift: -dot(anchor, u), vShift: -dot(anchor, v), uScale: source.uScale || .25, vScale: source.vScale || .25 };
      aligned++;
    }
    brush.topTextureFace = brush.faces.reduce((highest, face, index) => averageZ(brush, face) > averageZ(brush, brush.faces[highest]) ? index : highest, 0);
  }
  return aligned;
}

export function alignAllFacesToCenter(brushes) { return alignAllFaces(brushes, "center"); }
export function alignAllFacesToOuter(brushes) { return alignAllFaces(brushes, "outer"); }
