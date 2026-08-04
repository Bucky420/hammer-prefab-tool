const EPSILON = 1e-9;

export const PATH_VERSION = 1;
export const DEFAULT_PATH_NODE = Object.freeze({
  width: 128,
  height: 128,
  tangentMode: "auto",
});
export const DEFAULT_PATH_DETAIL = Object.freeze({
  maxAngleDegrees: 10,
  maxSegmentLength: 64,
  chordError: 1,
});

const TANGENT_MODES = new Set(["auto", "smooth", "corner"]);
const SEGMENT_MODES = new Set(["spline", "straight"]);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new RangeError(`${label} must be positive`);
  return number;
}

function normalizeTangent(value, label) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must be a vector`);
  }
  return {
    x: finiteNumber(value.x, `${label}.x`),
    y: finiteNumber(value.y, `${label}.y`),
    z: finiteNumber(value.z, `${label}.z`),
  };
}

function normalizeNode(node, index, defaults) {
  if (!node || typeof node !== "object") {
    throw new TypeError(`path node ${index} must be an object`);
  }
  const tangentMode = node.tangentMode ?? DEFAULT_PATH_NODE.tangentMode;
  if (!TANGENT_MODES.has(tangentMode)) {
    throw new RangeError(`path node ${index} has an invalid tangentMode`);
  }
  const normalized = {
    x: finiteNumber(node.x, `path node ${index}.x`),
    y: finiteNumber(node.y, `path node ${index}.y`),
    z: finiteNumber(node.z, `path node ${index}.z`),
    width: positiveNumber(
      node.width ?? defaults.width,
      `path node ${index}.width`,
    ),
    height: positiveNumber(
      node.height ?? defaults.height,
      `path node ${index}.height`,
    ),
    tangentMode,
  };
  const tangentIn = normalizeTangent(node.tangentIn, `path node ${index}.tangentIn`);
  const tangentOut = normalizeTangent(
    node.tangentOut,
    `path node ${index}.tangentOut`,
  );
  if (tangentIn) normalized.tangentIn = tangentIn;
  if (tangentOut) normalized.tangentOut = tangentOut;
  return normalized;
}

/**
 * Converts supported path input into the current, portable path representation.
 * Point arrays and unversioned `points` objects are legacy straight paths.
 *
 * @param {object|object[]} input
 * @param {object} [options]
 * @returns {object}
 */
export function normalizePath(input, options = {}) {
  const arrayInput = Array.isArray(input);
  if (!arrayInput && (!input || typeof input !== "object")) {
    throw new TypeError("path must be an object or point array");
  }
  const source = arrayInput ? { points: input } : input;
  if (source.version != null && source.version !== PATH_VERSION) {
    throw new RangeError(`unsupported path version ${source.version}`);
  }
  const usesLegacyPoints = Array.isArray(source.points) && !Array.isArray(source.nodes);
  const nodesSource = source.nodes ?? source.points;
  if (!Array.isArray(nodesSource)) throw new TypeError("path nodes must be an array");

  const defaultsSource = options.defaults ?? {};
  const defaults = {
    width: positiveNumber(
      defaultsSource.width ?? options.width ?? DEFAULT_PATH_NODE.width,
      "default width",
    ),
    height: positiveNumber(
      defaultsSource.height ?? options.height ?? DEFAULT_PATH_NODE.height,
      "default height",
    ),
  };
  const nodes = nodesSource.map((node, index) =>
    normalizeNode(node, index, defaults),
  );
  const closed = Boolean(source.closed);
  const minimum = closed ? 3 : 2;
  if (nodes.length < minimum) {
    throw new RangeError(
      `${closed ? "closed" : "open"} path requires at least ${minimum} nodes`,
    );
  }
  const segmentCount = closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < segmentCount; index++) {
    const next = (index + 1) % nodes.length;
    if (
      Math.abs(nodes[index].x - nodes[next].x) <= EPSILON &&
      Math.abs(nodes[index].y - nodes[next].y) <= EPSILON
    ) {
      throw new RangeError(`path segment ${index} has duplicate consecutive XY nodes`);
    }
  }

  const legacy = options.legacy === true || options.migrateLegacy === true || usesLegacyPoints;
  const defaultSegmentMode = legacy ? "straight" : "spline";
  const suppliedModes = source.segmentModes ?? [];
  if (!Array.isArray(suppliedModes)) {
    throw new TypeError("path segmentModes must be an array");
  }
  if (suppliedModes.length > segmentCount) {
    throw new RangeError("path has too many segment modes");
  }
  const segmentModes = Array.from({ length: segmentCount }, (_, index) => {
    const mode = suppliedModes[index] ?? defaultSegmentMode;
    if (!SEGMENT_MODES.has(mode)) {
      throw new RangeError(`path segment ${index} has an invalid mode`);
    }
    return mode;
  });

  const detailSource = source.detail ?? {};
  if (!detailSource || typeof detailSource !== "object") {
    throw new TypeError("path detail must be an object");
  }
  const detail = {
    maxAngleDegrees: positiveNumber(
      detailSource.maxAngleDegrees ?? DEFAULT_PATH_DETAIL.maxAngleDegrees,
      "detail.maxAngleDegrees",
    ),
    maxSegmentLength: positiveNumber(
      detailSource.maxSegmentLength ?? DEFAULT_PATH_DETAIL.maxSegmentLength,
      "detail.maxSegmentLength",
    ),
    chordError: positiveNumber(
      detailSource.chordError ?? DEFAULT_PATH_DETAIL.chordError,
      "detail.chordError",
    ),
  };
  if (detail.maxAngleDegrees >= 180) {
    throw new RangeError("detail.maxAngleDegrees must be less than 180");
  }

  return { version: PATH_VERSION, nodes, segmentModes, closed, detail };
}

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (value, amount) => ({
  x: value.x * amount,
  y: value.y * amount,
  z: value.z * amount,
});
const length = (value) => Math.hypot(value.x, value.y, value.z);

function automaticTangent(nodes, index, closed) {
  if (closed) {
    const previous = nodes[(index - 1 + nodes.length) % nodes.length];
    const next = nodes[(index + 1) % nodes.length];
    return scale(subtract(next, previous), 0.5);
  }
  if (index === 0) return subtract(nodes[1], nodes[0]);
  if (index === nodes.length - 1) return subtract(nodes[index], nodes[index - 1]);
  return scale(subtract(nodes[index + 1], nodes[index - 1]), 0.5);
}

function segmentTangents(path, index) {
  const nextIndex = (index + 1) % path.nodes.length;
  const start = path.nodes[index];
  const end = path.nodes[nextIndex];
  const delta = subtract(end, start);
  if (path.segmentModes[index] === "straight") return [delta, delta];

  const tangentFor = (node, nodeIndex, side) => {
    const supplied = side === "out" ? node.tangentOut : node.tangentIn;
    if (supplied) return supplied;
    if (node.tangentMode === "corner") return delta;
    return automaticTangent(path.nodes, nodeIndex, path.closed);
  };
  return [tangentFor(start, index, "out"), tangentFor(end, nextIndex, "in")];
}

function evaluateSegment(path, index, t, tangents) {
  const nextIndex = (index + 1) % path.nodes.length;
  const start = path.nodes[index];
  const end = path.nodes[nextIndex];
  if (t === 0) return { position: { x: start.x, y: start.y, z: start.z }, width: start.width, height: start.height, tangent: tangents[0] };
  if (t === 1) return { position: { x: end.x, y: end.y, z: end.z }, width: end.width, height: end.height, tangent: tangents[1] };
  if (path.segmentModes[index] === "straight") {
    return {
      position: add(start, scale(subtract(end, start), t)),
      width: start.width + (end.width - start.width) * t,
      height: start.height + (end.height - start.height) * t,
      tangent: tangents[0],
    };
  }

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const position = {
    x: h00 * start.x + h10 * tangents[0].x + h01 * end.x + h11 * tangents[1].x,
    y: h00 * start.y + h10 * tangents[0].y + h01 * end.y + h11 * tangents[1].y,
    z: h00 * start.z + h10 * tangents[0].z + h01 * end.z + h11 * tangents[1].z,
  };
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -d00;
  const d11 = 3 * t2 - 2 * t;
  return {
    position,
    width: start.width + (end.width - start.width) * t,
    height: start.height + (end.height - start.height) * t,
    tangent: {
      x: d00 * start.x + d10 * tangents[0].x + d01 * end.x + d11 * tangents[1].x,
      y: d00 * start.y + d10 * tangents[0].y + d01 * end.y + d11 * tangents[1].y,
      z: d00 * start.z + d10 * tangents[0].z + d01 * end.z + d11 * tangents[1].z,
    },
  };
}

function pointToChordDistance(point, start, end) {
  const chord = subtract(end, start);
  const denominator = chord.x ** 2 + chord.y ** 2 + chord.z ** 2;
  if (denominator <= EPSILON) return length(subtract(point, start));
  const offset = subtract(point, start);
  const t = Math.max(
    0,
    Math.min(1, (offset.x * chord.x + offset.y * chord.y + offset.z * chord.z) / denominator),
  );
  return length(subtract(point, add(start, scale(chord, t))));
}

function tangentAngle(a, b) {
  const aLength = length(a);
  const bLength = length(b);
  if (aLength <= EPSILON || bLength <= EPSILON) return 180;
  const cosine = Math.max(
    -1,
    Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (aLength * bLength)),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function station(sample, sourceSegment, t, fallbackTangent) {
  const tangent = length(sample.tangent) > EPSILON ? sample.tangent : fallbackTangent;
  const tangentLength = length(tangent);
  return {
    x: sample.position.x,
    y: sample.position.y,
    z: sample.position.z,
    width: sample.width,
    height: sample.height,
    tangent: tangentLength > EPSILON ? scale(tangent, 1 / tangentLength) : { x: 0, y: 0, z: 0 },
    sourceSegment,
    t,
  };
}

/**
 * Adaptively samples a normalized or supported legacy path.
 *
 * @param {object|object[]} input
 * @param {object} [options]
 * @returns {{stations: object[], closed: boolean, path: object}}
 */
export function samplePath(input, options = {}) {
  const path = normalizePath(input, options);
  const recursionCap = Math.trunc(options.recursionCap ?? 24);
  const sampleCap = Math.trunc(options.sampleCap ?? 100000);
  if (!Number.isInteger(recursionCap) || recursionCap < 1) {
    throw new RangeError("recursionCap must be a positive integer");
  }
  if (!Number.isInteger(sampleCap) || sampleCap < 2) {
    throw new RangeError("sampleCap must be an integer of at least 2");
  }

  const stations = [];
  const append = (sample, segmentIndex, t, fallback) => {
    if (stations.length >= sampleCap) throw new RangeError("path sample overflow");
    stations.push(station(sample, segmentIndex, t, fallback));
  };
  for (let index = 0; index < path.segmentModes.length; index++) {
    const tangents = segmentTangents(path, index);
    const start = evaluateSegment(path, index, 0, tangents);
    const end = evaluateSegment(path, index, 1, tangents);
    if (index === 0) append(start, index, 0, subtract(end.position, start.position));

    const subdivide = (t0, sample0, t1, sample1, depth) => {
      const midpointT = (t0 + t1) / 2;
      const midpoint = evaluateSegment(path, index, midpointT, tangents);
      const tooLong = length(subtract(sample1.position, sample0.position)) > path.detail.maxSegmentLength + EPSILON;
      const tooCurved =
        Math.max(
          tangentAngle(sample0.tangent, sample1.tangent),
          tangentAngle(sample0.tangent, midpoint.tangent),
          tangentAngle(midpoint.tangent, sample1.tangent),
        ) > path.detail.maxAngleDegrees + EPSILON;
      const tooFar =
        pointToChordDistance(midpoint.position, sample0.position, sample1.position) >
        path.detail.chordError + EPSILON;
      if (tooLong || tooCurved || tooFar) {
        if (depth >= recursionCap) {
          throw new RangeError(`path segment ${index} exceeded the adaptive recursion cap`);
        }
        subdivide(t0, sample0, midpointT, midpoint, depth + 1);
        subdivide(midpointT, midpoint, t1, sample1, depth + 1);
        return;
      }
      const finalClosedSeam = path.closed && index === path.segmentModes.length - 1 && t1 === 1;
      if (!finalClosedSeam) {
        append(sample1, index, t1, subtract(sample1.position, sample0.position));
      }
    };
    subdivide(0, start, 1, end, 0);
  }
  return { stations, closed: path.closed, path };
}

export function setSegmentMode(input, segmentIndex, mode, options = {}) {
  const path = normalizePath(input, options);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= path.segmentModes.length) {
    throw new RangeError("segment index is out of range");
  }
  if (!SEGMENT_MODES.has(mode)) throw new RangeError("invalid segment mode");
  path.segmentModes[segmentIndex] = mode;
  return path;
}

export function setPathClosed(input, closed, options = {}) {
  const path = normalizePath(input, options);
  return normalizePath({ ...path, closed: Boolean(closed) }, options);
}
