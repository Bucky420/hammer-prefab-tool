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
