import { generateRing } from "./ring-generator.js";

const snap = (value, grid) => Math.round(value / grid) * grid;
const polar = (radius, degrees) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
};
function outward(face, vertices) {
  const center = vertices.reduce(
    (sum, point) => ({
      x: sum.x + point.x / vertices.length,
      y: sum.y + point.y / vertices.length,
      z: sum.z + point.z / vertices.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const points = face.map((index) => vertices[index]),
    [a, b, c] = points;
  const normal = {
      x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    },
    faceCenter = points.reduce(
      (sum, point) => ({
        x: sum.x + point.x / points.length,
        y: sum.y + point.y / points.length,
        z: sum.z + point.z / points.length,
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
let nextId = 60000;
export function generateCylinder({
  radius = 128,
  height = 128,
  segments = 16,
  addHeight = 0,
  grid = 16,
} = {}) {
  const brushes = [],
    count = Math.max(3, Math.floor(segments)),
    z0 = snap(addHeight, grid),
    z1 = snap(addHeight + height, grid);
  for (let index = 0; index < count; index++) {
    const start = polar(radius, (index * 360) / count),
      end = polar(radius, ((index + 1) * 360) / count);
    const vertices = [
      { x: 0, y: 0, z: z0 },
      { x: snap(start.x, grid), y: snap(start.y, grid), z: z0 },
      { x: snap(end.x, grid), y: snap(end.y, grid), z: z0 },
      { x: 0, y: 0, z: z1 },
      { x: snap(start.x, grid), y: snap(start.y, grid), z: z1 },
      { x: snap(end.x, grid), y: snap(end.y, grid), z: z1 },
    ];
    const faces = [
      [0, 2, 1],
      [3, 4, 5],
      [1, 2, 5, 4],
      [0, 1, 4, 3],
      [2, 0, 3, 5],
    ].map((face) => outward(face, vertices));
    brushes.push({
      id: `cylinder-${nextId++}`,
      material: "dev/dev_measurewall01a",
      vertices,
      faces,
      generator: {
        type: "cylinder",
        segment: index,
        segments: count,
        radius,
        height,
      },
    });
  }
  return brushes;
}
export function generateSphere({
  radius = 128,
  segments = 24,
  rings = 12,
  grid = 16,
} = {}) {
  const brushes = [],
    count = Math.max(3, Math.floor(segments)),
    layers = Math.max(2, Math.floor(rings));
  for (let layer = 0; layer < layers; layer++) {
    const low = -90 + (180 * layer) / layers,
      high = -90 + (180 * (layer + 1)) / layers,
      z0 = snap(radius * Math.sin((low * Math.PI) / 180), grid),
      z1 = snap(radius * Math.sin((high * Math.PI) / 180), grid),
      r0 = Math.max(grid, snap(radius * Math.cos((low * Math.PI) / 180), grid)),
      r1 = Math.max(
        grid,
        snap(radius * Math.cos((high * Math.PI) / 180), grid),
      );
    for (let index = 0; index < count; index++) {
      const a = polar(r0, (index * 360) / count),
        b = polar(r0, ((index + 1) * 360) / count),
        c = polar(r1, ((index + 1) * 360) / count),
        d = polar(r1, (index * 360) / count);
      const vertices = [
        { x: 0, y: 0, z: z0 },
        { x: a.x, y: a.y, z: z0 },
        { x: b.x, y: b.y, z: z0 },
        { x: 0, y: 0, z: z1 },
        { x: d.x, y: d.y, z: z1 },
        { x: c.x, y: c.y, z: z1 },
      ];
      const faces = [
        [0, 2, 1],
        [3, 4, 5],
        [1, 2, 5, 4],
        [0, 1, 4, 3],
        [2, 0, 3, 5],
      ].map((face) => outward(face, vertices));
      brushes.push({
        id: `sphere-${nextId++}`,
        material: "dev/dev_measurewall01a",
        vertices,
        faces,
        generator: {
          type: "sphere",
          layer,
          segment: index,
          segments: count,
          rings: layers,
          radius,
        },
      });
    }
  }
  return brushes;
}
export function generateTorus({
  radius = 256,
  width = 64,
  height = 64,
  segments = 24,
  grid = 16,
} = {}) {
  return generateRing({
    radius,
    width,
    height,
    segments,
    startAngle: 0,
    endAngle: 360,
    grid,
  }).map((brush) => ({
    ...brush,
    generator: { ...brush.generator, type: "torus" },
  }));
}
