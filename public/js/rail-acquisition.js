export function isNoDrawMaterial(material) {
  return String(material || "")
    .replaceAll("\\", "/")
    .toLowerCase()
    .endsWith("tools/toolsnodraw");
}

export function dedupeFirst(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    if (!map.has(candidate.key)) map.set(candidate.key, candidate);
  }
  return [...map.values()];
}
