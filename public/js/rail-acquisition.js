/**
 * @typedef {import("./geometry-model.js").Axis} Axis
 * @typedef {import("./geometry-model.js").Brush} Brush
 * @typedef {import("./geometry-model.js").Face} Face
 * @typedef {import("./geometry-model.js").Vector2} Vector2
 * @typedef {import("./geometry-model.js").Vector3} Vector3
 */

/**
 * @typedef {object} ProjectedFaceRecord
 * @property {Brush} brush
 * @property {number} faceIndex
 * @property {Face} face
 * @property {Vector2} edgePoint
 */

/**
 * @typedef {ProjectedFaceRecord & {
 *   normal: Vector3,
 *   projectedLength: number,
 *   corridorSide: number
 * }} ProjectedBoundaryFace
 */

/**
 * Candidate shared by the active attached and magnetic side-rail paths.
 *
 * @typedef {object} RailCandidate
 * @property {"sideA" | "sideB"} movingEdge
 * @property {string} targetBrushId
 * @property {number | undefined} targetFaceIndex
 * @property {number[]} adjacentFaceIndices
 * @property {Vector2} railDirection
 * @property {Vector2} lineOrigin
 * @property {Vector3} targetStartWorld
 * @property {Vector3} targetEndWorld
 * @property {number} distancePx
 * @property {number} lineDistancePx
 * @property {number} finiteSegmentDistancePx
 * @property {number} infiniteLineDistancePx
 * @property {number} corridorSideScore
 * @property {number} signedForwardDirection
 * @property {number | null} sourceAngleDifferenceDegrees
 * @property {number | null} railAngleDifferenceDegrees
 * @property {number | null} solvedEdgeToRailDistance
 * @property {string} canonicalKey
 * @property {"attached" | "magnetic"} source
 * @property {"direct" | "source-chain"} [attachmentKind]
 * @property {number} [targetEdgeIndex]
 * @property {Vector3} [targetFaceNormal]
 * @property {string} [projectedRailKey]
 */

/**
 * @param {unknown} material
 * @returns {boolean}
 */
export function isNoDrawMaterial(material) {
  return String(material || "")
    .replaceAll("\\", "/")
    .toLowerCase()
    .endsWith("tools/toolsnodraw");
}

/**
 * @param {Vector3} start
 * @param {Vector3} end
 * @param {Axis} axisX
 * @param {Axis} axisY
 * @returns {string}
 */
export function projectedRailKey(start, end, axisX, axisY) {
  const keyFor = (point) =>
    `${point[axisX].toFixed(5)},${point[axisY].toFixed(5)}`;
  const a = keyFor(start);
  const b = keyFor(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * @param {ProjectedFaceRecord[]} records
 * @param {Vector2} railDirection
 * @param {Vector2} reference
 * @param {Axis} axisX
 * @param {Axis} axisY
 * @param {(material: unknown) => boolean} isNoDraw
 * @param {(brush: Brush, face: Face) => Vector3 | null} faceDirection
 * @param {boolean} [allowNoDraw]
 * @returns {ProjectedBoundaryFace | null}
 */
export function chooseProjectedBoundaryFace(
  records,
  railDirection,
  reference,
  axisX,
  axisY,
  isNoDraw,
  faceDirection,
  allowNoDraw = false,
) {
  return records
    .filter((record) => allowNoDraw || !isNoDraw(record.brush.faceMaterials?.[record.faceIndex] || record.brush.material))
    .map((record) => {
      const normal = faceDirection(record.brush, record.face);
      const projected = { x: normal?.[axisX] || 0, y: normal?.[axisY] || 0 };
      const projectedLength = Math.hypot(projected.x, projected.y);
      if (projectedLength < 0.25) return null;
      const nx = projected.x / projectedLength;
      const ny = projected.y / projectedLength;
      if (Math.abs(nx * railDirection.x + ny * railDirection.y) > 0.1)
        return null;
      return {
        ...record,
        normal,
        projectedLength,
        corridorSide: nx * (reference.x - record.edgePoint.x) +
          ny * (reference.y - record.edgePoint.y),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.corridorSide - a.corridorSide)
    .find((record) => record.corridorSide >= -0.01) || null;
}

/**
 * @template {{key?: string, canonicalKey?: string}} T
 * @param {T[]} candidates
 * @returns {T[]}
 */
export function dedupeFirst(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = candidate.key || candidate.canonicalKey;
    if (!map.has(key)) map.set(key, candidate);
  }
  return [...map.values()];
}

/**
 * @template {{key?: string, canonicalKey?: string, distancePx: number}} T
 * @param {T[]} candidates
 * @param {string | null | undefined} lockedKey
 * @param {number} releaseRadius
 * @returns {T[]}
 */
export function retainLockedCandidate(candidates, lockedKey, releaseRadius) {
  if (!lockedKey) return candidates;
  const locked = candidates.find(
    (candidate) => candidate.key === lockedKey || candidate.canonicalKey === lockedKey,
  );
  if (locked && locked.distancePx <= releaseRadius) return [locked];
  return candidates;
}

/**
 * @param {number} safeDistance
 * @param {number} probeDistance
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function passesProbeValidation(safeDistance, probeDistance, threshold = 0.98) {
  return safeDistance / Math.max(probeDistance, 0.000001) >= threshold;
}

/**
 * @param {[Vector2, Vector2]} solvedEdge
 * @param {Vector2} targetStart
 * @param {Vector2} targetEnd
 * @param {number} tolerance
 * @returns {boolean}
 */
export function solvedEdgeMatchesRail(
  solvedEdge,
  targetStart,
  targetEnd,
  tolerance,
) {
  const dx = targetEnd.x - targetStart.x;
  const dy = targetEnd.y - targetStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.000001) return false;
  return solvedEdge.every(
    (point) =>
      Math.abs(
        dy * point.x -
          dx * point.y +
          targetEnd.x * targetStart.y -
          targetEnd.y * targetStart.x,
      ) /
        length <=
      tolerance,
  );
}

/**
 * @param {Vector2} baseCorner
 * @param {Vector2} freeCorner
 * @param {Vector2} targetStart
 * @param {Vector2} targetEnd
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function movingCornerTouchesRail(
  baseCorner,
  freeCorner,
  targetStart,
  targetEnd,
  tolerance = 0.01,
) {
  const orient = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const within = (value, first, second) =>
    value >= Math.min(first, second) - tolerance &&
    value <= Math.max(first, second) + tolerance;
  const onSegment = (point, start, end) =>
    Math.abs(orient(start, end, point)) <= tolerance &&
    within(point.x, start.x, end.x) &&
    within(point.y, start.y, end.y);
  const first = orient(baseCorner, freeCorner, targetStart);
  const second = orient(baseCorner, freeCorner, targetEnd);
  const third = orient(targetStart, targetEnd, baseCorner);
  const fourth = orient(targetStart, targetEnd, freeCorner);
  return (
    (first * second < 0 && third * fourth < 0) ||
    onSegment(targetStart, baseCorner, freeCorner) ||
    onSegment(targetEnd, baseCorner, freeCorner) ||
    onSegment(baseCorner, targetStart, targetEnd) ||
    onSegment(freeCorner, targetStart, targetEnd)
  );
}
