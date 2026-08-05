export const COLORS = {
  grid: "#4c4c4c",
  highlightedGrid: "#737373",
  grid1024: "#643205",
  line: "#ffffff",
  axis: "#006464",
  vertex: "#ffffff",
  selected: "#ffff00",
  active: "#66dde3",
  faceHover: "#ffc928",
  invalid: "#ff4055",
};
export const ZOOM_MIN = 0.02125;
export const ZOOM_MAX = 256;

export const INFLUENCE_ACQUIRE_PX = 3;
export const INFLUENCE_RELEASE_PX = 2;

const AXES = {
  top: ["x", "y", "z"],
  front: ["y", "z", "x"],
  side: ["x", "z", "y"],
};

export { AXES };

export const insideRect = (point, box) =>
  point.x >= box.minX &&
  point.x <= box.maxX &&
  point.y >= box.minY &&
  point.y <= box.maxY;

export function segmentsIntersect(a, b, c, d) {
  const ab = { x: b.x - a.x, y: b.y - a.y },
    cd = { x: d.x - c.x, y: d.y - c.y },
    denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) < 0.000001) return false;
  const ac = { x: c.x - a.x, y: c.y - a.y },
    t = (ac.x * cd.y - ac.y * cd.x) / denominator,
    u = (ac.x * ab.y - ac.y * ab.x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
