/**
 * @typedef {{x: number, y: number, z: number}} Vector3
 * @typedef {{id?: string, vertices: Vector3[], faces: number[][]}} Brush
 */

/**
 * Fail at the geometry boundary instead of later inside a formatting or
 * drawing call. The message includes the exact brush and vertex involved.
 *
 * @param {unknown} point
 * @param {string} context
 * @returns {asserts point is Vector3}
 */
export function assertFinitePoint(point, context) {
  if (!point || typeof point !== "object")
    throw new TypeError(`Invalid geometry point at ${context}`);
  /** @type {Partial<Vector3>} */
  const vector = point;
  if (
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    !Number.isFinite(vector.z)
  )
    throw new TypeError(`Invalid geometry point at ${context}`);
}

/**
 * Check the structural invariants required by viewport geometry consumers.
 * Convexity is intentionally left to brush-validation.js.
 *
 * @param {unknown} brush
 * @param {string} context
 * @returns {asserts brush is Brush}
 */
export function assertBrushGeometry(brush, context) {
  if (!brush || typeof brush !== "object")
    throw new TypeError(`Invalid brush at ${context}`);
  /** @type {Partial<Brush>} */
  const candidate = brush;
  if (!Array.isArray(candidate.vertices))
    throw new TypeError(`Brush has no vertex array at ${context}`);
  if (!Array.isArray(candidate.faces))
    throw new TypeError(`Brush has no face array at ${context}`);

  /** @type {Brush} */
  const validBrush = {
    id: typeof candidate.id === "string" ? candidate.id : undefined,
    /** @type {Vector3[]} */
    vertices: candidate.vertices,
    /** @type {number[][]} */
    faces: candidate.faces,
  };

  validBrush.vertices.forEach((point, index) =>
    assertFinitePoint(point, `${context} vertex ${index}`),
  );
  validBrush.faces.forEach((face, faceIndex) => {
    if (!Array.isArray(face) || face.length < 3)
      throw new TypeError(`${context} face ${faceIndex} is incomplete`);
    face.forEach((vertexIndex) => {
      if (!Number.isInteger(vertexIndex) || !validBrush.vertices[vertexIndex])
        throw new TypeError(
          `${context} face ${faceIndex} references missing vertex ${vertexIndex}`,
        );
    });
  });
}

/**
 * @param {unknown[]} brushes
 * @param {string} context
 * @returns {asserts brushes is Brush[]}
 */
export function assertBrushesGeometry(brushes, context) {
  if (!Array.isArray(brushes))
    throw new TypeError(`Invalid brush collection at ${context}`);
  brushes.forEach((brush, index) =>
    assertBrushGeometry(brush, `${context} brush ${index}`),
  );
}
