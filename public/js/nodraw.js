const EPSILON = 0.01;

function normal(brush, face) {
  const a = brush.vertices[face[0]],
    b = brush.vertices[face[1]],
    c = brush.vertices[face[2]];
  return {
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  };
}

function projection(vector) {
  const axes = ["x", "y", "z"].sort(
    (a, b) => Math.abs(vector[b]) - Math.abs(vector[a]),
  );
  return axes.slice(1);
}

function pointOnSegment(point, start, end) {
  const cross =
    (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > EPSILON) return false;
  return (
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const a = polygon[previous],
      b = polygon[index];
    if (pointOnSegment(point, a, b)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function faceCoveredBy(brush, face, coveringBrush, coveringFace) {
  const n = normal(brush, face),
    length = Math.hypot(n.x, n.y, n.z);
  if (length < EPSILON) return false;
  const origin = brush.vertices[face[0]];
  const coveringVertices = coveringFace.map(
    (index) => coveringBrush.vertices[index],
  );
  if (
    coveringVertices.some(
      (vertex) =>
        Math.abs(
          n.x * (vertex.x - origin.x) +
            n.y * (vertex.y - origin.y) +
            n.z * (vertex.z - origin.z),
        ) /
          length >
        EPSILON,
    )
  )
    return false;
  const [u, v] = projection(n);
  const polygon = coveringVertices.map((vertex) => ({
    x: vertex[u],
    y: vertex[v],
  }));
  return face.every((index) =>
    pointInPolygon(
      { x: brush.vertices[index][u], y: brush.vertices[index][v] },
      polygon,
    ),
  );
}

export function applyNodrawToHiddenFaces(brushes, brushIds = null) {
  const targets = brushIds?.size
    ? brushes.filter((brush) => brushIds.has(brush.id))
    : brushes;
  let changed = 0;
  for (const brush of targets) {
    brush.faceMaterials ||= brush.faces.map(
      () => brush.material || "tools/toolsnodraw",
    );
    brush.faces.forEach((face, faceIndex) => {
      if (brush.faceMaterials[faceIndex]?.toLowerCase() === "tools/toolsnodraw")
        return;
      const hidden = brushes.some(
        (other) =>
          other !== brush &&
          other.faces.some((otherFace) =>
            faceCoveredBy(brush, face, other, otherFace),
          ),
      );
      if (hidden) {
        brush.faceMaterials[faceIndex] = "tools/toolsnodraw";
        changed++;
      }
    });
  }
  return changed;
}
