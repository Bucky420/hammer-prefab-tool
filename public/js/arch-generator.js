let nextId = 20000;

// Hammer snaps the creation box to the active grid, but MakeArc rounds the
// generated curve vertices to integer world coordinates, not grid units.
const roundPoint = (value) => Math.round(value);
const polar = (center, radius, degrees) => {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: center.x + Math.cos(angle) * radius.x,
    y: center.y + Math.sin(angle) * radius.y,
  };
};

function outward(face, vertices) {
  const points = face.map((index) => vertices[index]);
  const a = points[0];
  const b = points[1];
  const c = points[2];
  const normal = {
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  };
  const center = vertices.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / vertices.length,
      y: sum.y + vertex.y / vertices.length,
      z: sum.z + vertex.z / vertices.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const faceCenter = points.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / points.length,
      y: sum.y + vertex.y / points.length,
      z: sum.z + vertex.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return normal.x * (faceCenter.x - center.x) +
    normal.y * (faceCenter.y - center.y) +
    normal.z * (faceCenter.z - center.z) <
    0
    ? [...face].reverse()
    : face;
}

// Mirrors Hammer's CreateArch: the staged XY bounds define the outer
// ellipse, and Wall width is an inset of that ellipse's bounding rectangle.
export function generateArch({
  width = 512,
  height = 512,
  depth = 128,
  wallWidth = 64,
  sides = 8,
  startAngle = 0,
  arc = 360,
  addHeight = 0,
  grid = 16,
} = {}) {
  const count = Math.max(3, Math.floor(sides));
  const span = Math.max(1, Math.min(360, Number(arc)));
  const center = { x: 0, y: 0 };
  const outer = { x: width / 2, y: height / 2 };
  const inset = Math.max(0, Number(wallWidth));
  const inner = {
    x: outer.x - inset,
    y: outer.y - inset,
  };
  const solidInner = inset * 2 + 8 >= width || inset * 2 + 8 >= height;
  const outerPoints = [];
  const innerPoints = [];
  const pointCount = span === 360 ? count : count + 1;
  for (let index = 0; index < pointCount; index++) {
    const angle = startAngle + (span * index) / count;
    const outerPoint = polar(center, outer, angle);
    const innerPoint = solidInner ? center : polar(center, inner, angle);
    outerPoints.push({
      x: roundPoint(outerPoint.x),
      y: roundPoint(outerPoint.y),
    });
    innerPoints.push({
      x: roundPoint(innerPoint.x),
      y: roundPoint(innerPoint.y),
    });
  }

  const brushes = [];
  for (let index = 0; index < count; index++) {
    const next = index + 1 < pointCount ? index + 1 : 0;
    const z0 = index * addHeight;
    const z1 = index * addHeight + depth;
    const points = solidInner
      ? [
          [outerPoints[index], z0],
          [outerPoints[next], z0],
          [center, z0],
          [outerPoints[index], z1],
          [outerPoints[next], z1],
          [center, z1],
        ]
      : [
          [outerPoints[index], z0],
          [outerPoints[next], z0],
          [innerPoints[next], z0],
          [innerPoints[index], z0],
          [outerPoints[index], z1],
          [outerPoints[next], z1],
          [innerPoints[next], z1],
          [innerPoints[index], z1],
        ];
    const vertices = points.map(([point, z]) => ({
      x: point.x,
      y: point.y,
      z,
    }));
    const faces = (
      solidInner
        ? [
            [0, 1, 2],
            [5, 4, 3],
            [0, 3, 5, 2],
            [1, 4, 5, 2],
            [0, 1, 4, 3],
          ]
        : [
            [0, 1, 2, 3],
            [4, 7, 6, 5],
            [0, 4, 5, 1],
            [1, 5, 6, 2],
            [2, 6, 7, 3],
            [3, 7, 4, 0],
          ]
    ).map((face) => outward(face, vertices));
    brushes.push({
      id: `arch-${nextId++}`,
      material: "dev/dev_measurewall01a",
      vertices,
      faces,
      generator: {
        type: "arch",
        segment: index,
        sides: count,
        startAngle,
        arc: span,
        wallWidth: inset,
      },
      vertexRoles: {
        outer: solidInner ? [0, 1, 3, 4] : [0, 1, 4, 5],
        inner: solidInner ? [2, 5] : [2, 3, 6, 7],
      },
    });
  }
  return brushes;
}
