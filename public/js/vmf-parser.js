let nextId = 50000;

function blocks(text, name) {
  const output = [];
  const expression = new RegExp(`\\b${name}\\s*\\{`, "g");
  let match;
  while ((match = expression.exec(text))) {
    let depth = 1;
    let index = expression.lastIndex;
    for (; index < text.length && depth; index++) {
      if (text[index] === "{") depth++;
      if (text[index] === "}") depth--;
    }
    if (!depth) output.push(text.slice(expression.lastIndex, index - 1));
    expression.lastIndex = index;
  }
  return output;
}

function parsePlane(value) {
  const numbers = [...value.matchAll(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map(match => +match[0]);
  return numbers.length === 9 ? [[numbers[0], numbers[1], numbers[2]], [numbers[3], numbers[4], numbers[5]], [numbers[6], numbers[7], numbers[8]]] : null;
}

function parseAxis(value) {
  const numbers = [...value.matchAll(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map(match => +match[0]);
  return numbers.length === 5 ? { vector: numbers.slice(0, 3), shift: numbers[3], scale: numbers[4] } : null;
}

function normal(a, b, c) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
}

function faceVertices(plane, vertices) {
  const [a, b, c] = plane.map(([x, y, z]) => ({ x, y, z }));
  const n = normal(a, b, c);
  const length = Math.hypot(n.x, n.y, n.z) || 1;
  const points = vertices.map((vertex, index) => ({ vertex, index })).filter(({ vertex }) => Math.abs(n.x * (vertex.x - a.x) + n.y * (vertex.y - a.y) + n.z * (vertex.z - a.z)) / length < 0.02);
  if (points.length < 3) return [];
  const center = points.reduce((sum, point) => ({ x: sum.x + point.vertex.x / points.length, y: sum.y + point.vertex.y / points.length, z: sum.z + point.vertex.z / points.length }), { x: 0, y: 0, z: 0 });
  const reference = Math.abs(n.z) < .9 * length ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const uLength = Math.hypot(n.y * reference.z - n.z * reference.y, n.z * reference.x - n.x * reference.z, n.x * reference.y - n.y * reference.x) || 1;
  const u = { x: (n.y * reference.z - n.z * reference.y) / uLength, y: (n.z * reference.x - n.x * reference.z) / uLength, z: (n.x * reference.y - n.y * reference.x) / uLength };
  const v = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
  return points.sort((left, right) => Math.atan2((left.vertex.x - center.x) * v.x + (left.vertex.y - center.y) * v.y + (left.vertex.z - center.z) * v.z, (left.vertex.x - center.x) * u.x + (left.vertex.y - center.y) * u.y + (left.vertex.z - center.z) * u.z) - Math.atan2((right.vertex.x - center.x) * v.x + (right.vertex.y - center.y) * v.y + (right.vertex.z - center.z) * v.z, (right.vertex.x - center.x) * u.x + (right.vertex.y - center.y) * u.y + (right.vertex.z - center.z) * u.z)).map(point => point.index);
}

export function parseVMF(text) {
  return blocks(text, "solid").map(solid => {
    const sides = blocks(solid, "side");
    const sideData = sides.map(side => ({ plane: parsePlane((side.match(/"plane"\s+"([^"]+)"/) || [])[1] || ""), u: parseAxis((side.match(/"uaxis"\s+"([^"]+)"/) || [])[1] || ""), v: parseAxis((side.match(/"vaxis"\s+"([^"]+)"/) || [])[1] || "") })).filter(side => side.plane);
    const planes = sideData.map(side => side.plane);
    const unique = new Map();
    for (const plane of planes) for (const [x, y, z] of plane) unique.set(`${x},${y},${z}`, { x, y, z });
    const vertices = [...unique.values()];
    const parsedFaces = sideData.map(side => ({ face: faceVertices(side.plane, vertices), axes: side.u && side.v ? { u: side.u.vector, v: side.v.vector, uShift: side.u.shift, vShift: side.v.shift, uScale: side.u.scale, vScale: side.v.scale } : undefined })).filter(item => item.face.length >= 3);
    const faces = parsedFaces.map(item => item.face);
    const material = (solid.match(/"material"\s+"([^"]+)"/) || [])[1] || "tools/toolsnodraw";
    return { id: `imported-${nextId++}`, material, vertices, faces, textureAxes: parsedFaces.map(item => item.axes) };
  }).filter(brush => brush.vertices.length >= 4 && brush.faces.length >= 4);
}
