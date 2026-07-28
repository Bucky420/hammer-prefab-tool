import { normalizeProject } from "./project-format.js";

export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(",")}}`;
}

function fnv1a32(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalProjectHash(project) {
  const canonical = canonicalStringify(normalizeProject(project));
  return `${fnv1a32(canonical, 0x811c9dc5)}${fnv1a32(canonical, 0x9e3779b9)}`;
}

export function createDirtyStateService(initialProject) {
  let cleanHash =
    initialProject === undefined ? null : canonicalProjectHash(initialProject);
  let currentHash = cleanHash;
  return {
    hash: canonicalProjectHash,
    markClean(project) {
      currentHash = canonicalProjectHash(project);
      cleanHash = currentHash;
      return cleanHash;
    },
    update(project) {
      currentHash = canonicalProjectHash(project);
      return currentHash !== cleanHash;
    },
    isDirty(project) {
      if (project !== undefined) currentHash = canonicalProjectHash(project);
      return cleanHash === null
        ? currentHash !== null
        : currentHash !== cleanHash;
    },
    discard() {
      currentHash = cleanHash;
      return currentHash;
    },
    reset() {
      cleanHash = null;
      currentHash = null;
    },
    get cleanHash() {
      return cleanHash;
    },
    get currentHash() {
      return currentHash;
    },
  };
}
