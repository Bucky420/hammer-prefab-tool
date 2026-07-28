export const VMF_EXPORT_PURPOSE = Object.freeze({
  STANDARD: "standard",
  DOCUMENT: "document",
  PREFAB: "prefab",
});

export const PREFAB_VERSION_KEY = "hammer_prefab_tool_version";
export const PREFAB_VERSION = "1";

const SIDE_KEYS = new Set([
  "id",
  "plane",
  "material",
  "uaxis",
  "vaxis",
  "rotation",
  "lightmapscale",
  "smoothing_groups",
]);

function escapeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function property(key, value, indent = 1) {
  return `${"\t".repeat(indent)}"${escapeValue(key)}" "${escapeValue(value)}"\n`;
}

function writeOpaqueChunk(chunk, indent = 0) {
  let output = `${"\t".repeat(indent)}${chunk.name}\n${"\t".repeat(indent)}{\n`;
  for (const item of chunk.properties || [])
    output += property(item.key, item.value, indent + 1);
  for (const child of chunk.children || [])
    output += writeOpaqueChunk(child, indent + 1);
  return `${output}${"\t".repeat(indent)}}\n`;
}

function writeOpaqueChildren(children, knownNames, indent) {
  const known = new Set(knownNames);
  return (children || [])
    .filter((child) => !known.has(child.name.toLowerCase()))
    .map((child) => writeOpaqueChunk(child, indent))
    .join("");
}

function plane(a, b, c) {
  return `(${a.x} ${a.y} ${a.z}) (${b.x} ${b.y} ${b.z}) (${c.x} ${c.y} ${c.z})`;
}

function sourcePlane(brush, face, center) {
  const a = brush.vertices[face[0]],
    b = brush.vertices[face[1]],
    c = brush.vertices[face[2]],
    ux = b.x - a.x,
    uy = b.y - a.y,
    uz = b.z - a.z,
    vx = c.x - a.x,
    vy = c.y - a.y,
    vz = c.z - a.z,
    towardCenter =
      (uy * vz - uz * vy) * (center.x - a.x) +
      (uz * vx - ux * vz) * (center.y - a.y) +
      (ux * vy - uy * vx) * (center.z - a.z);
  return towardCenter < 0 ? plane(a, c, b) : plane(a, b, c);
}

function vmfAxis(vector, shift, scale, fallback) {
  const axis = vector || fallback;
  return `[${axis[0]} ${axis[1]} ${axis[2]} ${shift ?? 0}] ${scale ?? 0.25}`;
}

function mergedProperties(model, defaults = {}, omitted = new Set()) {
  const keys = { ...defaults, ...(model?.keys || {}) };
  const result = [];
  const seen = new Set();
  const source = Array.isArray(model?.properties)
    ? model.properties
    : model?.properties && typeof model.properties === "object"
      ? Object.entries(model.properties).map(([key, value]) => ({ key, value }))
      : [];
  const lastValues = Object.fromEntries(
    source.map(({ key, value }) => [key, value]),
  );
  const lastIndices = Object.fromEntries(
    source.map(({ key }, index) => [key, index]),
  );
  for (const [index, item] of source.entries()) {
    if (omitted.has(item.key)) continue;
    const changed =
      Object.hasOwn(keys, item.key) && keys[item.key] !== lastValues[item.key];
    result.push({
      key: item.key,
      value:
        changed && lastIndices[item.key] === index
          ? keys[item.key]
          : item.value,
    });
    seen.add(item.key);
  }
  for (const [key, value] of Object.entries(keys))
    if (!seen.has(key) && !omitted.has(key) && value !== undefined)
      result.push({ key, value });
  return result;
}

function storedProperty(properties, key) {
  const source = Array.isArray(properties)
    ? properties
    : properties && typeof properties === "object"
      ? Object.entries(properties).map(([propertyKey, value]) => ({
          key: propertyKey,
          value,
        }))
      : [];
  return [...source].reverse().find((item) => item.key === key)?.value;
}

class IdAllocator {
  constructor() {
    this.used = new Set();
    this.next = 1;
  }

  reserve(preferred) {
    const numeric = Number(preferred);
    if (Number.isInteger(numeric) && numeric > 0 && !this.used.has(numeric)) {
      this.used.add(numeric);
      this.next = Math.max(this.next, numeric + 1);
      return numeric;
    }
    return undefined;
  }

  allocate() {
    while (this.used.has(this.next)) this.next++;
    const id = this.next++;
    this.used.add(id);
    return id;
  }
}

function brushCenter(brush) {
  return brush.vertices.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / brush.vertices.length,
      y: sum.y + vertex.y / brush.vertices.length,
      z: sum.z + vertex.z / brush.vertices.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

function writeEditor(editor, groupId, indent) {
  const omitted = new Set(["color", "groupid"]);
  let output = `${"\t".repeat(indent)}editor\n${"\t".repeat(indent)}{\n`;
  output += property("color", editor?.keys?.color || "0 128 255", indent + 1);
  if (groupId !== undefined) output += property("groupid", groupId, indent + 1);
  for (const item of mergedProperties(editor, {}, omitted))
    output += property(item.key, item.value, indent + 1);
  output += writeOpaqueChildren(editor?.children, [], indent + 1);
  return `${output}${"\t".repeat(indent)}}\n`;
}

function writeSolid(brush, allocator, groupId, indent = 1, idPlan) {
  const solidId = idPlan?.solidIds.get(brush) ?? allocator.allocate();
  const center = brushCenter(brush);
  let output = `${"\t".repeat(indent)}solid\n${"\t".repeat(indent)}{\n`;
  output += property("id", solidId, indent + 1);
  for (const item of mergedProperties(
    { properties: brush.vmfProperties, keys: brush.vmfKeys },
    {},
    new Set(["id"]),
  ))
    output += property(item.key, item.value, indent + 1);
  for (const [index, face] of brush.faces.entries()) {
    const axes = brush.textureAxes?.[index];
    const side = brush.sideData?.[index] || {};
    output += `${"\t".repeat(indent + 1)}side\n${"\t".repeat(indent + 1)}{\n`;
    output += property(
      "id",
      idPlan?.sideIds.get(brush)?.[index] ?? allocator.allocate(),
      indent + 2,
    );
    output += property("plane", sourcePlane(brush, face, center), indent + 2);
    output += property(
      "material",
      brush.faceMaterials?.[index] || brush.material || "tools/toolsnodraw",
      indent + 2,
    );
    output += property(
      "uaxis",
      vmfAxis(axes?.u, axes?.uShift, axes?.uScale, [1, 0, 0]),
      indent + 2,
    );
    output += property(
      "vaxis",
      vmfAxis(axes?.v, axes?.vShift, axes?.vScale, [0, -1, 0]),
      indent + 2,
    );
    output += property("rotation", side.rotation ?? 0, indent + 2);
    output += property("lightmapscale", side.lightmapScale ?? 16, indent + 2);
    output += property(
      "smoothing_groups",
      side.smoothingGroups ?? 0,
      indent + 2,
    );
    for (const item of side.properties || [])
      if (!SIDE_KEYS.has(item.key))
        output += property(item.key, item.value, indent + 2);
    output += writeOpaqueChildren(side.children, [], indent + 2);
    output += `${"\t".repeat(indent + 1)}}\n`;
  }
  if (
    brush.editor ||
    (brush.vmfId ??
      brush.vmfKeys?.id ??
      storedProperty(brush.vmfProperties, "id")) === undefined ||
    groupId !== undefined
  )
    output += writeEditor(brush.editor, groupId, indent + 1);
  output += writeOpaqueChildren(brush.children, ["side", "editor"], indent + 1);
  return `${output}${"\t".repeat(indent)}}\n`;
}

function writeGroup(group, allocator, assignedId, groupId, indent = 1) {
  let output = `${"\t".repeat(indent)}group\n${"\t".repeat(indent)}{\n`;
  output += property("id", assignedId ?? allocator.allocate(), indent + 1);
  for (const item of mergedProperties(group, {}, new Set(["id"])))
    output += property(item.key, item.value, indent + 1);
  if (
    group?.editor ||
    (group?.id ??
      group?.keys?.id ??
      storedProperty(group?.properties, "id")) === undefined
  )
    output += writeEditor(group?.editor, groupId, indent + 1);
  output += writeOpaqueChildren(group?.children, ["editor"], indent + 1);
  return `${output}${"\t".repeat(indent)}}\n`;
}

function writeEntity(entity, allocator, groupIds, idPlan) {
  const entityId = idPlan?.entityIds.get(entity) ?? allocator.allocate();
  let output = "entity\n{\n";
  output += property("id", entityId);
  const defaults = entity.keys || {};
  const properties = mergedProperties(entity, defaults, new Set(["id"]));
  if (!properties.some(({ key }) => key === "classname"))
    properties.unshift({
      key: "classname",
      value: entity.classname || "func_detail",
    });
  for (const item of properties) output += property(item.key, item.value);
  for (const brush of entity.brushes || [])
    output += writeSolid(
      brush,
      allocator,
      resolveGroupId(brush, groupIds),
      1,
      idPlan,
    );
  if (
    entity.editor ||
    (entity.id ??
      entity.keys?.id ??
      storedProperty(entity.properties, "id")) === undefined
  )
    output += writeEditor(entity.editor, resolveGroupId(entity, groupIds), 1);
  output += writeOpaqueChildren(entity.children, ["solid", "editor"], 1);
  return `${output}}\n`;
}

function reserveOpaqueIds(allocator, chunks) {
  for (const chunk of chunks || []) {
    for (const item of chunk.properties || [])
      if (item.key.toLowerCase() === "id") allocator.reserve(item.value);
    reserveOpaqueIds(allocator, chunk.children);
  }
}

function resolveGroupId(value, groupIds) {
  if (!value) return undefined;
  for (const key of [
    value.groupId,
    value.hammerGroupId,
    value.editor?.keys?.groupid,
  ])
    if (key !== undefined && groupIds.has(String(key)))
      return groupIds.get(String(key));
  return undefined;
}

function groupLookupKeys(group) {
  const id =
    group.id ?? group.keys?.id ?? storedProperty(group.properties, "id");
  return [id, id === undefined ? undefined : `vmf-group-${id}`]
    .filter((value) => value !== undefined)
    .map(String);
}

function standardDocument(brushes) {
  const groupNames = [
    ...new Set(brushes.map((brush) => brush.groupId).filter(Boolean)),
  ];
  const groups = groupNames.map((id) => ({ id: undefined, exportKey: id }));
  return {
    versionInfo: { editorversion: "400" },
    world: {
      keys: { id: "1", mapversion: "1", classname: "worldspawn" },
      brushes,
      groups,
    },
    entities: [],
  };
}

/**
 * Serializes a JSON-safe VMF document. The purpose is explicit so prefab
 * callers can receive a version marker without changing normal map exports.
 *
 * @param {object} document
 * @param {{purpose?: string}} [options]
 * @returns {string}
 */
export function writeVMFDocument(
  document,
  { purpose = VMF_EXPORT_PURPOSE.DOCUMENT } = {},
) {
  const allocator = new IdAllocator();
  const world = document.world || {};
  const worldDefaults = { id: "1", mapversion: "1", classname: "worldspawn" };
  const worldKeys = { ...worldDefaults, ...(world.keys || {}) };
  if (purpose === VMF_EXPORT_PURPOSE.PREFAB)
    worldKeys[PREFAB_VERSION_KEY] = PREFAB_VERSION;
  const groups = document.world?.groups || document.groups || [];
  const assignedGroupIds = new Map();
  const idPlan = {
    entityIds: new Map(),
    solidIds: new Map(),
    sideIds: new Map(),
  };
  let worldId = allocator.reserve(
    world.id ?? worldKeys.id ?? storedProperty(world.properties, "id"),
  );
  for (const group of groups) {
    const assigned = allocator.reserve(
      group.id ?? group.keys?.id ?? storedProperty(group.properties, "id"),
    );
    if (assigned !== undefined) assignedGroupIds.set(group, assigned);
  }
  for (const entity of document.entities || []) {
    const assigned = allocator.reserve(
      entity.id ?? entity.keys?.id ?? storedProperty(entity.properties, "id"),
    );
    if (assigned !== undefined) idPlan.entityIds.set(entity, assigned);
  }
  const allBrushes = [
    ...(world.brushes || []),
    ...(document.entities || []).flatMap((entity) => entity.brushes || []),
  ];
  for (const brush of allBrushes) {
    const solidId = allocator.reserve(
      brush.vmfId ??
        brush.vmfKeys?.id ??
        storedProperty(brush.vmfProperties, "id"),
    );
    if (solidId !== undefined) idPlan.solidIds.set(brush, solidId);
    idPlan.sideIds.set(
      brush,
      brush.faces.map((_, index) => {
        const side = brush.sideData?.[index];
        return allocator.reserve(
          side?.id ?? storedProperty(side?.properties, "id"),
        );
      }),
    );
  }

  reserveOpaqueIds(allocator, document.children);
  reserveOpaqueIds(allocator, document.versionChildren);
  reserveOpaqueIds(allocator, world.children);
  for (const group of groups) {
    reserveOpaqueIds(allocator, group.children);
    reserveOpaqueIds(allocator, group.editor?.children);
  }
  for (const entity of document.entities || []) {
    reserveOpaqueIds(allocator, entity.children);
    reserveOpaqueIds(allocator, entity.editor?.children);
  }
  for (const brush of allBrushes) {
    reserveOpaqueIds(allocator, brush.children);
    reserveOpaqueIds(allocator, brush.editor?.children);
    for (const side of brush.sideData || [])
      reserveOpaqueIds(allocator, side.children);
  }

  worldId ??= allocator.allocate();
  for (const group of groups)
    if (!assignedGroupIds.has(group))
      assignedGroupIds.set(group, allocator.allocate());
  for (const entity of document.entities || [])
    if (!idPlan.entityIds.has(entity))
      idPlan.entityIds.set(entity, allocator.allocate());
  for (const brush of allBrushes) {
    if (!idPlan.solidIds.has(brush))
      idPlan.solidIds.set(brush, allocator.allocate());
    idPlan.sideIds.set(
      brush,
      idPlan.sideIds.get(brush).map((sideId) => sideId ?? allocator.allocate()),
    );
  }

  const groupIds = new Map();
  for (const group of groups) {
    const assigned = assignedGroupIds.get(group);
    for (const key of groupLookupKeys(group)) groupIds.set(key, assigned);
    if (group.exportKey !== undefined)
      groupIds.set(String(group.exportKey), assigned);
  }

  const versionDefaults = { editorversion: "400" };
  const versionInfo = { ...(document.versionInfo || {}) };
  if (purpose === VMF_EXPORT_PURPOSE.PREFAB) {
    versionInfo.formatversion = "100";
    versionInfo.prefab = "1";
  }
  let output = "versioninfo\n{\n";
  for (const item of mergedProperties(
    { properties: document.versionProperties, keys: versionInfo },
    versionDefaults,
  ))
    output += property(item.key, item.value);
  output += writeOpaqueChildren(document.versionChildren, [], 1);
  output += "}\n";

  output += "world\n{\n";
  output += property("id", worldId);
  for (const item of mergedProperties(world, worldKeys, new Set(["id"])))
    output += property(item.key, item.value);
  for (const brush of world.brushes || [])
    output += writeSolid(
      brush,
      allocator,
      resolveGroupId(brush, groupIds),
      1,
      idPlan,
    );
  for (const group of groups)
    output += writeGroup(
      group,
      allocator,
      assignedGroupIds.get(group),
      resolveGroupId(group, groupIds),
      1,
    );
  output += writeOpaqueChildren(world.children, ["solid", "group"], 1);
  output += "}\n";
  for (const entity of document.entities || [])
    output += writeEntity(entity, allocator, groupIds, idPlan);
  output += writeOpaqueChildren(
    document.children,
    ["versioninfo", "world", "entity"],
    0,
  );
  return output;
}

/**
 * Existing brush-only export API.
 *
 * @param {import("./geometry-model.js").Brush[]} brushes
 * @param {{purpose?: string}} [options]
 * @returns {string}
 */
export function writeVMF(
  brushes,
  { purpose = VMF_EXPORT_PURPOSE.STANDARD } = {},
) {
  return writeVMFDocument(standardDocument(brushes), { purpose });
}
