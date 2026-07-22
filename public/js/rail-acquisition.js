export function isNoDrawMaterial(material) {
  return String(material || "")
    .replaceAll("\\", "/")
    .toLowerCase()
    .endsWith("tools/toolsnodraw");
}

export function projectedRailKey(start, end, axisX, axisY) {
  const keyFor = (point) =>
    `${point[axisX].toFixed(5)},${point[axisY].toFixed(5)}`;
  const a = keyFor(start);
  const b = keyFor(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function chooseProjectedBoundaryFace(
  records,
  railDirection,
  reference,
  axisX,
  axisY,
  isNoDraw,
  faceDirection,
) {
  return records
    .filter((record) => !isNoDraw(record.brush.faceMaterials?.[record.faceIndex] || record.brush.material))
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

export function dedupeFirst(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = candidate.key || candidate.canonicalKey;
    if (!map.has(key)) map.set(key, candidate);
  }
  return [...map.values()];
}

export function retainLockedCandidate(candidates, lockedKey, releaseRadius) {
  if (!lockedKey) return candidates;
  const locked = candidates.find(
    (candidate) => candidate.key === lockedKey || candidate.canonicalKey === lockedKey,
  );
  if (locked && locked.distancePx <= releaseRadius) return [locked];
  return candidates;
}

export function passesProbeValidation(safeDistance, probeDistance, threshold = 0.98) {
  return safeDistance / Math.max(probeDistance, 0.000001) >= threshold;
}
