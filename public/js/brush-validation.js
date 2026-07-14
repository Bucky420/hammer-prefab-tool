const EPSILON = 0.001;
function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(v) { return Math.hypot(v.x, v.y, v.z); }
function faceNormal(brush, face) { const a = brush.vertices[face[0]], b = brush.vertices[face[1]], c = brush.vertices[face[2]]; return cross(subtract(b, a), subtract(c, a)); }

export function validateBrush(brush, bounds = 32768) {
  const issues = [];
  if (!brush || !Array.isArray(brush.vertices) || brush.vertices.length < 4) issues.push("needs at least four vertices");
  if (!brush || !Array.isArray(brush.faces) || brush.faces.length < 4) issues.push("needs at least four faces");
  if (!brush?.vertices || !brush?.faces) return issues;
  const unique = new Set();
  for (const [index, vertex] of brush.vertices.entries()) {
    if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) issues.push(`vertex ${index} has an invalid numeric value`);
    if (Math.max(Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)) > bounds) issues.push(`vertex ${index} is outside world bounds`);
    const key = `${vertex.x},${vertex.y},${vertex.z}`;
    if (unique.has(key)) issues.push("contains duplicate vertices");
    unique.add(key);
  }
  const centroid = brush.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / brush.vertices.length, y: sum.y + vertex.y / brush.vertices.length, z: sum.z + vertex.z / brush.vertices.length }), { x: 0, y: 0, z: 0 });
  const edges = new Map();
  for (const [faceIndex, face] of brush.faces.entries()) {
    if (face.length < 3 || new Set(face).size !== face.length) { issues.push(`face ${faceIndex} is degenerate`); continue; }
    if (face.some(index => !brush.vertices[index])) { issues.push(`face ${faceIndex} references a missing vertex`); continue; }
    const normal = faceNormal(brush, face);
    if (length(normal) < EPSILON) { issues.push(`face ${faceIndex} has zero area`); continue; }
    const first = brush.vertices[face[0]];
    if (dot(normal, subtract(centroid, first)) > EPSILON) issues.push(`face ${faceIndex} winding points inward`);
    for (const vertex of brush.vertices) if (dot(normal, subtract(vertex, first)) > EPSILON) { issues.push(`face ${faceIndex} makes the solid non-convex`); break; }
    for (let i = 0; i < face.length; i++) { const a = face[i], b = face[(i + 1) % face.length]; const key = `${Math.min(a, b)}:${Math.max(a, b)}`; edges.set(key, (edges.get(key) || 0) + 1); }
  }
  for (const count of edges.values()) if (count !== 2) { issues.push("solid is not closed"); break; }
  return [...new Set(issues)];
}
export function validateAll(brushes) { return brushes.flatMap(brush => validateBrush(brush).map(issue => `${brush.id}: ${issue}`)); }
