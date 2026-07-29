import { canonicalProjectHash } from "./dirty-state.js";

export const AUTOSAVE_SOURCE_VERSION = 1;

export async function fingerprintText(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function createVmfSourceIdentity(file, text, options = {}) {
  const modified = Number(options.lastModified ?? file?.lastModified);
  return {
    version: AUTOSAVE_SOURCE_VERSION,
    kind: "vmf",
    access: options.access || "browser",
    name: String(options.name || file?.name || "prefab.vmf"),
    locator: options.locator || null,
    size: Number(
      options.size ?? file?.size ?? new TextEncoder().encode(text).length,
    ),
    modifiedAt: Number.isFinite(modified)
      ? new Date(modified).toISOString()
      : options.modifiedAt || null,
    fingerprint: await fingerprintText(text),
  };
}

async function sameSource(snapshot, source, currentHandle) {
  if (snapshot.source?.version !== AUTOSAVE_SOURCE_VERSION) return false;
  if (snapshot.source.kind !== "vmf" || source?.kind !== "vmf") return false;
  if (snapshot.fileHandle && currentHandle?.isSameEntry) {
    try {
      if (await currentHandle.isSameEntry(snapshot.fileHandle))
        return snapshot.source.fingerprint === source.fingerprint;
    } catch {
      return false;
    }
  }
  if (snapshot.source.locator || source.locator)
    return (
      snapshot.source.locator === source.locator &&
      snapshot.source.fingerprint === source.fingerprint
    );
  return (
    snapshot.source.name.toLowerCase() === source.name.toLowerCase() &&
    snapshot.source.fingerprint === source.fingerprint
  );
}

export async function findMatchingAutosave(
  snapshots,
  source,
  currentProject,
  currentHandle = null,
) {
  const sourceTime = Date.parse(source?.modifiedAt || "");
  const currentHash = canonicalProjectHash(currentProject);
  for (const snapshot of snapshots) {
    if (!(await sameSource(snapshot, source, currentHandle))) continue;
    if (snapshot.projectHash === currentHash) continue;
    const snapshotTime = Date.parse(snapshot.updatedAt || "");
    if (Number.isFinite(sourceTime) && !(snapshotTime > sourceTime)) continue;
    return snapshot;
  }
  return null;
}
