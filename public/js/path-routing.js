const EPSILON = 1e-8;
const MAX_OBSTACLES = 256;
const MAX_NODES = 2048;
const MAX_COORDINATE = 1e9;

const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const samePoint = (a, b, tolerance = EPSILON) =>
  distance(a, b) <= tolerance;

function finitePoint(value, label) {
  if (
    !value ||
    !Number.isFinite(Number(value.x)) ||
    !Number.isFinite(Number(value.y))
  ) {
    throw new TypeError(`${label} must have finite x and y coordinates`);
  }
  return { x: Number(value.x), y: Number(value.y) };
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function convexHull(points) {
  const sorted = points
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, all) => index === 0 || !samePoint(point, all[index - 1]));
  if (sorted.length < 3) return [];

  const half = [];
  for (const point of sorted) {
    while (
      half.length >= 2 &&
      cross(half[half.length - 2], half[half.length - 1], point) <= EPSILON
    ) {
      half.pop();
    }
    half.push(point);
  }
  const lower = half.slice();
  half.length = 0;
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (
      half.length >= 2 &&
      cross(half[half.length - 2], half[half.length - 1], point) <= EPSILON
    ) {
      half.pop();
    }
    half.push(point);
  }
  lower.pop();
  half.pop();
  return lower.concat(half);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - points[index].y * next.x;
  }
  return area / 2;
}

function lineIntersection(a, directionA, b, directionB) {
  const denominator = directionA.x * directionB.y - directionA.y * directionB.x;
  if (Math.abs(denominator) <= EPSILON) return null;
  const offset = { x: b.x - a.x, y: b.y - a.y };
  const t = (offset.x * directionB.y - offset.y * directionB.x) / denominator;
  return { x: a.x + directionA.x * t, y: a.y + directionA.y * t };
}

function inflatePolygon(points, clearance) {
  const lines = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const direction = { x: next.x - point.x, y: next.y - point.y };
    const edgeLength = Math.hypot(direction.x, direction.y);
    if (edgeLength <= EPSILON) return null;
    const normal = { x: direction.y / edgeLength, y: -direction.x / edgeLength };
    return {
      point: {
        x: point.x + normal.x * clearance,
        y: point.y + normal.y * clearance,
      },
      direction,
    };
  });
  if (lines.some((line) => !line)) return null;

  const inflated = lines.map((line, index) => {
    const previous = lines[(index - 1 + lines.length) % lines.length];
    return lineIntersection(previous.point, previous.direction, line.point, line.direction);
  });
  if (
    inflated.some(
      (point) =>
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > MAX_COORDINATE ||
        Math.abs(point.y) > MAX_COORDINATE,
    ) ||
    polygonArea(inflated) <= EPSILON
  ) {
    return null;
  }
  return inflated;
}

function pointLocation(point, polygon, tolerance = EPSILON) {
  let boundary = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const edgeLength = distance(a, b);
    const side = cross(a, b, point) / edgeLength;
    if (side < -tolerance) return -1;
    if (Math.abs(side) <= tolerance) boundary = true;
  }
  return boundary ? 0 : 1;
}

function segmentIntersectionParameters(start, end, a, b, tolerance) {
  const route = { x: end.x - start.x, y: end.y - start.y };
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const denominator = route.x * edge.y - route.y * edge.x;
  const offset = { x: a.x - start.x, y: a.y - start.y };
  if (Math.abs(denominator) <= tolerance) return [];
  const t = (offset.x * edge.y - offset.y * edge.x) / denominator;
  const u = (offset.x * route.y - offset.y * route.x) / denominator;
  if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) {
    return [];
  }
  return [Math.max(0, Math.min(1, t))];
}

function segmentClearsPolygon(start, end, polygon, tolerance) {
  if (
    pointLocation(start, polygon, tolerance) === 1 ||
    pointLocation(end, polygon, tolerance) === 1
  ) {
    return false;
  }
  const parameters = [0, 1];
  for (let index = 0; index < polygon.length; index++) {
    parameters.push(
      ...segmentIntersectionParameters(
        start,
        end,
        polygon[index],
        polygon[(index + 1) % polygon.length],
        tolerance,
      ),
    );
  }
  parameters.sort((a, b) => a - b);
  for (let index = 1; index < parameters.length; index++) {
    if (parameters[index] - parameters[index - 1] <= tolerance) continue;
    const t = (parameters[index] + parameters[index - 1]) / 2;
    const point = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };
    if (pointLocation(point, polygon, tolerance) === 1) return false;
  }
  return true;
}

function obstaclePoints(obstacle) {
  return Array.isArray(obstacle) ? obstacle : obstacle?.points;
}

/**
 * Tests a routed polyline against inflated convex obstacles. Boundary contact
 * is permitted, but no segment may enter an obstacle interior.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {Array<{points: Array<{x: number, y: number}>}|Array<{x: number, y: number}>>} obstacles
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function pathClearsObstacles(points, obstacles, tolerance = EPSILON) {
  if (!Array.isArray(points) || !Array.isArray(obstacles)) return false;
  const amount = Number(tolerance);
  if (!Number.isFinite(amount) || amount < 0) return false;
  for (let index = 1; index < points.length; index++) {
    for (const obstacle of obstacles) {
      const polygon = obstaclePoints(obstacle);
      if (
        !Array.isArray(polygon) ||
        polygon.length < 3 ||
        !segmentClearsPolygon(points[index - 1], points[index], polygon, amount)
      ) {
        return false;
      }
    }
  }
  return true;
}

function visible(a, b, obstacles) {
  if (samePoint(a, b)) return false;
  return obstacles.every(({ points }) =>
    segmentClearsPolygon(a, b, points, EPSILON),
  );
}

function shortestPath(nodes, obstacles) {
  const adjacency = Array.from({ length: nodes.length }, () => []);
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      if (!visible(nodes[a], nodes[b], obstacles)) continue;
      const weight = distance(nodes[a], nodes[b]);
      adjacency[a].push({ node: b, weight });
      adjacency[b].push({ node: a, weight });
    }
  }

  const distances = Array(nodes.length).fill(Infinity);
  const previous = Array(nodes.length).fill(-1);
  const visited = Array(nodes.length).fill(false);
  distances[0] = 0;
  for (let count = 0; count < nodes.length; count++) {
    let current = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (
        !visited[index] &&
        (current < 0 ||
          distances[index] < distances[current] - EPSILON ||
          (Math.abs(distances[index] - distances[current]) <= EPSILON && index < current))
      ) {
        current = index;
      }
    }
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) break;
    visited[current] = true;
    for (const edge of adjacency[current]) {
      const candidate = distances[current] + edge.weight;
      if (
        candidate < distances[edge.node] - EPSILON ||
        (Math.abs(candidate - distances[edge.node]) <= EPSILON &&
          (previous[edge.node] < 0 || current < previous[edge.node]))
      ) {
        distances[edge.node] = candidate;
        previous[edge.node] = current;
      }
    }
  }
  if (!Number.isFinite(distances[1])) return [];
  const path = [];
  for (let index = 1; index >= 0; index = previous[index]) {
    path.push(nodes[index]);
    if (index === 0) break;
  }
  return path.reverse().map((point) => ({ x: point.x, y: point.y }));
}

function simplifyPath(points, obstacles) {
  const result = points.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < result.length - 1; index++) {
      if (
        Math.abs(cross(result[index - 1], result[index], result[index + 1])) <= EPSILON &&
        visible(result[index - 1], result[index + 1], obstacles)
      ) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

/**
 * Finds a deterministic shortest Top-view route around vertically overlapping
 * convex brush projections.
 *
 * @param {object} input
 * @returns {{points: Array<{x: number, y: number}>, obstacles: Array<{brushId: string, points: Array<{x: number, y: number}>}>, errors: string[]}}
 */
export function routePathAroundBrushes(input) {
  const errors = [];
  let start;
  let end;
  let brushes;
  let clearance;
  let floorZ;
  let ceilingZ;
  let excluded;
  try {
    if (!input || typeof input !== "object") throw new TypeError("routing input is required");
    start = finitePoint(input.start, "start");
    end = finitePoint(input.end, "end");
    brushes = input.brushes;
    if (!Array.isArray(brushes)) throw new TypeError("brushes must be an array");
    const outsideWidth = finiteNumber(input.outsideWidth, "outsideWidth");
    const margin = finiteNumber(input.margin, "margin");
    floorZ = finiteNumber(input.floorZ, "floorZ");
    const height = finiteNumber(input.height, "height");
    if (outsideWidth < 0) throw new RangeError("outsideWidth must not be negative");
    if (margin < 0) throw new RangeError("margin must not be negative");
    if (height <= 0) throw new RangeError("height must be positive");
    clearance = outsideWidth / 2 + margin;
    ceilingZ = floorZ + height;
    if (!Number.isFinite(clearance) || !Number.isFinite(ceilingZ)) {
      throw new RangeError("routing dimensions are excessive");
    }
    const ids = input.excludeBrushIds ?? [];
    if (!(Array.isArray(ids) || ids instanceof Set)) {
      throw new TypeError("excludeBrushIds must be an array or Set");
    }
    excluded = new Set(ids);
  } catch (error) {
    return { points: [], obstacles: [], errors: [error.message] };
  }

  const obstacles = [];
  for (let brushIndex = 0; brushIndex < brushes.length; brushIndex++) {
    const brush = brushes[brushIndex];
    if (!brush || excluded.has(brush.id)) continue;
    if (!Array.isArray(brush.vertices) || brush.vertices.length < 4) continue;
    const vertices = [];
    let minZ = Infinity;
    let maxZ = -Infinity;
    let invalid = false;
    for (const vertex of brush.vertices) {
      if (
        !vertex ||
        !Number.isFinite(Number(vertex.x)) ||
        !Number.isFinite(Number(vertex.y)) ||
        !Number.isFinite(Number(vertex.z))
      ) {
        invalid = true;
        break;
      }
      vertices.push({ x: Number(vertex.x), y: Number(vertex.y) });
      minZ = Math.min(minZ, Number(vertex.z));
      maxZ = Math.max(maxZ, Number(vertex.z));
    }
    if (invalid) {
      errors.push(`brush ${brush.id ?? brushIndex} has nonfinite vertices`);
      continue;
    }
    if (maxZ <= floorZ || minZ >= ceilingZ) continue;
    const hull = convexHull(vertices);
    if (hull.length < 3 || polygonArea(hull) <= EPSILON) {
      errors.push(`brush ${brush.id ?? brushIndex} has a collapsed XY projection`);
      continue;
    }
    const points = inflatePolygon(hull, clearance);
    if (!points) {
      errors.push(`brush ${brush.id ?? brushIndex} has an invalid or excessive offset`);
      continue;
    }
    obstacles.push({ brushId: String(brush.id ?? brushIndex), points });
    if (obstacles.length > MAX_OBSTACLES) {
      return {
        points: [],
        obstacles,
        errors: [`routing supports at most ${MAX_OBSTACLES} obstacles`],
      };
    }
  }
  obstacles.sort((a, b) => {
    if (a.brushId !== b.brushId) return a.brushId < b.brushId ? -1 : 1;
    return a.points[0].x - b.points[0].x || a.points[0].y - b.points[0].y;
  });
  if (errors.length) return { points: [], obstacles, errors };
  const nodeCount = 2 + obstacles.reduce((sum, obstacle) => sum + obstacle.points.length, 0);
  if (nodeCount > MAX_NODES) {
    return {
      points: [],
      obstacles,
      errors: [`routing supports at most ${MAX_NODES} visibility nodes`],
    };
  }
  for (const [label, point] of [["start", start], ["end", end]]) {
    const obstacle = obstacles.find(({ points }) => pointLocation(point, points) === 1);
    if (obstacle) {
      return {
        points: [],
        obstacles,
        errors: [`${label} is inside obstacle ${obstacle.brushId}`],
      };
    }
  }

  const nodes = [start, end, ...obstacles.flatMap(({ points }) => points)];
  const points = shortestPath(nodes, obstacles);
  if (!points.length) {
    return { points: [], obstacles, errors: ["no clear route exists"] };
  }
  return { points: simplifyPath(points, obstacles), obstacles, errors: [] };
}
