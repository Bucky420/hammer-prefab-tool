import { box } from "./geometry-model.js";
import { validateBrush } from "./brush-validation.js";
import { VMF_EXPORT_PURPOSE, writeVMFDocument } from "./vmf-writer.js";
import { roundToGrid } from "./grid.js";

const NODRAW = "tools/toolsnodraw";
let nextBackingId = 1;

function groupLookup(groups) {
  const lookup = new Map();
  for (const group of groups || []) {
    const id = group.id ?? group.keys?.id;
    for (const key of [
      group.exportKey,
      group.groupId,
      group.hammerGroupId,
      id,
    ]) {
      if (key !== undefined) lookup.set(String(key), group);
    }
    if (id !== undefined) lookup.set(`vmf-group-${id}`, group);
  }
  return lookup;
}

function firstDescription(brush, group) {
  const candidates = [
    brush.assemblyName,
    brush.assemblyLabel,
    brush.generator?.assemblyName,
    brush.generator?.name,
    brush.generator?.label,
    brush.generator?.description,
    group?.name,
    group?.label,
    group?.exportName,
    group?.keys?.name,
    group?.keys?.targetname,
    group?.editor?.keys?.comments,
  ];
  return candidates.find((value) => value);
}

function assemblyBuckets(brushes, groups) {
  const buckets = new Map();
  const worldBrushes = [];
  const groupsById = groupLookup(groups);
  let legacyRing = 0;
  let previousLegacySegment = -1;
  const add = (key, brush, group) => {
    if (!buckets.has(key))
      buckets.set(key, {
        key,
        brushes: [],
        description: firstDescription(brush, group),
      });
    buckets.get(key).brushes.push(brush);
  };

  for (const brush of brushes) {
    const groupKey = brush.groupId ?? brush.hammerGroupId;
    const preservedGroup = brush.editor?.keys?.hammer_prefab_group;
    const group =
      groupKey === undefined ? undefined : groupsById.get(String(groupKey));
    let key;
    if (brush.assemblyId) key = `assembly:${brush.assemblyId}`;
    else if (
      brush.generator?.type === "ring" ||
      brush.generator?.type === "torus"
    ) {
      if (brush.generator.assemblyId)
        key = `assembly:${brush.generator.assemblyId}`;
      else if (groupKey !== undefined) key = `ring-group:${groupKey}`;
      else {
        const segment = Number(brush.generator.segment);
        if (segment === 0 && previousLegacySegment > 0) legacyRing++;
        key = `legacy-ring:${legacyRing}`;
        previousLegacySegment = Number.isFinite(segment)
          ? segment
          : previousLegacySegment;
      }
    } else if (groupKey !== undefined) key = `group:${groupKey}`;
    else if (preservedGroup) key = `preserved:${preservedGroup}`;
    if (key) add(key, brush, group);
    else worldBrushes.push(brush);
  }
  return {
    buckets: [...buckets.values()].filter((bucket) => bucket.brushes.length),
    worldBrushes,
  };
}

function brushBounds(brushes) {
  const points = brushes.flatMap((brush) => brush.vertices || []);
  if (!points.length) return null;
  return {
    min: {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
      z: Math.min(...points.map((point) => point.z)),
    },
    max: {
      x: Math.max(...points.map((point) => point.x)),
      y: Math.max(...points.map((point) => point.y)),
      z: Math.max(...points.map((point) => point.z)),
    },
  };
}

function backingOptions(options) {
  const backing = options.backing;
  if (!backing && !options.backingBelow && !options.backingAbove)
    return { below: false, above: false, thickness: 16, padding: 0 };
  const object = backing && typeof backing === "object" ? backing : {};
  const placement = typeof backing === "string" ? backing : object.placement;
  return {
    below:
      options.backingBelow ??
      object.below ??
      (backing === true || placement === "below" || placement === "both"),
    above:
      options.backingAbove ??
      object.above ??
      (backing === true || placement === "above" || placement === "both"),
    thickness: Number(options.backingThickness ?? object.thickness ?? 16),
    padding: Number(options.backingPadding ?? object.padding ?? 0),
  };
}

function sanitizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

/**
 * Creates optional worldspawn slabs that touch, but never positively overlap,
 * one assembly's complete bounds.
 *
 * @param {import("./geometry-model.js").Brush[]} brushes
 * @param {object} [options]
 * @returns {import("./geometry-model.js").Brush[]}
 */
export function createRingBackingBrushes(brushes, options = {}) {
  const settings = backingOptions(options);
  if (!settings.below && !settings.above) return [];
  if (!(settings.thickness > 0) || settings.padding < 0)
    throw new RangeError(
      "Ring backing thickness must be positive and padding cannot be negative",
    );
  const bounds = brushBounds(brushes);
  if (!bounds) return [];
  const min = {
    x: bounds.min.x - settings.padding,
    y: bounds.min.y - settings.padding,
    z: bounds.min.z,
  };
  const max = {
    x: bounds.max.x + settings.padding,
    y: bounds.max.y + settings.padding,
    z: bounds.max.z,
  };
  const grid = Number(options.grid);
  if (Number.isFinite(grid) && grid > 0) {
    const supportValues = [
      ...(settings.below ? [min.z] : []),
      ...(settings.above ? [max.z] : []),
    ];
    if (
      supportValues.some(
        (value) => Math.abs(roundToGrid(value, grid) - value) > 1e-6,
      )
    )
      throw new Error(
        "Structural backing requires support planes aligned to the Hammer grid",
      );
    min.x = Math.floor(min.x / grid) * grid;
    min.y = Math.floor(min.y / grid) * grid;
    max.x = Math.ceil(max.x / grid) * grid;
    max.y = Math.ceil(max.y / grid) * grid;
    min.z = roundToGrid(min.z, grid);
    max.z = roundToGrid(max.z, grid);
    settings.thickness = Math.max(
      grid,
      Math.ceil(settings.thickness / grid) * grid,
    );
  }
  if (!(max.x > min.x) || !(max.y > min.y))
    throw new RangeError(
      "Ring backing requires non-zero rectangular X/Y bounds",
    );
  const prefix = options.backingIdPrefix || `prefab-backing-${nextBackingId++}`;
  const backing = [];
  if (settings.below) {
    const brush = box(
      { x: min.x, y: min.y, z: min.z - settings.thickness },
      { x: max.x, y: max.y, z: min.z },
      NODRAW,
    );
    brush.id = `${prefix}-below`;
    brush.faceMaterials = brush.faces.map(() => NODRAW);
    brush.editor = { keys: { hammer_prefab_backing: "1" } };
    backing.push(brush);
  }
  if (settings.above) {
    const brush = box(
      { x: min.x, y: min.y, z: max.z },
      { x: max.x, y: max.y, z: max.z + settings.thickness },
      NODRAW,
    );
    brush.id = `${prefix}-above`;
    brush.faceMaterials = brush.faces.map(() => NODRAW);
    brush.editor = { keys: { hammer_prefab_backing: "1" } };
    backing.push(brush);
  }
  for (const brush of backing) {
    const issues = validateBrush(brush);
    if (issues.length) throw new Error(`Invalid ring backing: ${issues[0]}`);
  }
  return backing;
}

function positiveBoundsOverlap(a, b) {
  return ["x", "y", "z"].every(
    (axis) =>
      Math.min(a.max[axis], b.max[axis]) > Math.max(a.min[axis], b.min[axis]),
  );
}

function sharedBackingBrushes(buckets, options) {
  const settings = backingOptions(options);
  const supports = { below: new Map(), above: new Map() };
  const add = (map, level, brushes) => {
    if (!map.has(level)) map.set(level, []);
    map.get(level).push(...brushes);
  };
  for (const bucket of buckets) {
    const bounds = brushBounds(bucket.brushes);
    if (!bounds) continue;
    if (settings.below) add(supports.below, bounds.min.z, bucket.brushes);
    if (settings.above) add(supports.above, bounds.max.z, bucket.brushes);
  }
  const backing = [];
  let index = 0;
  for (const [direction, levels] of Object.entries(supports)) {
    for (const brushes of levels.values()) {
      backing.push(
        ...createRingBackingBrushes(brushes, {
          ...options,
          backingBelow: direction === "below",
          backingAbove: direction === "above",
          backingIdPrefix: `prefab-backing-${++index}`,
        }),
      );
    }
  }
  const bounds = backing.map((brush) => brushBounds([brush]));
  for (let first = 0; first < bounds.length; first++) {
    for (let second = first + 1; second < bounds.length; second++) {
      if (positiveBoundsOverlap(bounds[first], bounds[second]))
        throw new Error(
          "Structural backing could not be generated without overlapping slabs",
        );
    }
  }
  const sourceBounds = buckets.flatMap((bucket) =>
    bucket.brushes.map((brush) => brushBounds([brush])),
  );
  if (
    bounds.some((backingBounds) =>
      sourceBounds.some((brushBounds) =>
        positiveBoundsOverlap(backingBounds, brushBounds),
      ),
    )
  )
    throw new Error(
      "Structural backing would overlap geometry on another support level",
    );
  return backing;
}

function backingBuckets(source, sourceGroups, worldBuckets) {
  const buckets = [...worldBuckets];
  for (const entity of source.entities || []) {
    if (entity.keys?.hammer_prefab_generated_group !== "1") continue;
    if (entity.brushes?.length)
      buckets.push({
        key: `entity:${entity.keys.targetname || buckets.length}`,
        brushes: entity.brushes,
      });
  }
  return buckets;
}

export function createSharedPrefabBackingBrushes(input, options = {}) {
  const source = inputDocument(input);
  const sourceGroups = source.world?.groups || source.groups || [];
  const { buckets } = assemblyBuckets(
    source.world?.brushes || [],
    sourceGroups,
  );
  return sharedBackingBrushes(
    backingBuckets(source, sourceGroups, buckets),
    options,
  );
}

function inputDocument(input) {
  if (!Array.isArray(input) && input?.world) return input;
  const brushes = Array.isArray(input) ? input : [];
  return {
    format: "hammer-prefab-tool-vmf-document",
    version: 1,
    versionInfo: { editorversion: "400", editorbuild: "0", mapversion: "1" },
    world: {
      keys: { id: "1", mapversion: "1", classname: "worldspawn" },
      brushes,
      groups: [],
    },
    entities: [],
    groups: [],
    brushes,
  };
}

function removeGroupOwnership(brush) {
  const preservedGroup =
    brush.groupId ||
    brush.hammerGroupId ||
    brush.assemblyId ||
    brush.editor?.keys?.hammer_prefab_group;
  const editor = brush.editor
    ? {
        ...brush.editor,
        keys: Object.fromEntries(
          Object.entries(brush.editor.keys || {}).filter(
            ([key]) => key !== "groupid",
          ),
        ),
        properties: (brush.editor.properties || []).filter(
          ({ key }) => key !== "groupid",
        ),
      }
    : { keys: {}, properties: [] };
  if (preservedGroup) editor.keys.hammer_prefab_group = String(preservedGroup);
  return {
    ...brush,
    groupId: undefined,
    hammerGroupId: undefined,
    editor,
  };
}

/**
 * Converts eligible world brushes into one func_detail per assembly or group.
 * Existing entities and their brushes remain unchanged.
 *
 * @param {import("./geometry-model.js").Brush[] | object} input
 * @param {object} [options]
 * @returns {object}
 */
export function createRingPrefabDocument(input, options = {}) {
  const source = inputDocument(input);
  const sourceGroups = source.world?.groups || source.groups || [];
  const { buckets, worldBrushes } = assemblyBuckets(
    source.world?.brushes || [],
    sourceGroups,
  );
  const backing = sharedBackingBrushes(
    backingBuckets(source, sourceGroups, buckets),
    options,
  );
  const generatedEntities = buckets.map((bucket, index) => {
    const baseName = `ring_${String(index + 1).padStart(2, "0")}`;
    const suffix = sanitizeName(bucket.description);
    const name = suffix ? `${baseName}_${suffix}` : baseName;
    return {
      classname: "func_detail",
      keys: {
        classname: "func_detail",
        targetname: name,
        hammer_prefab_generated_group: "1",
      },
      brushes: bucket.brushes.map(removeGroupOwnership),
    };
  });
  const entities = [...(source.entities || []), ...generatedEntities];
  const world = {
    ...(source.world || {}),
    keys: {
      id: "1",
      mapversion: "1",
      classname: "worldspawn",
      ...(source.world?.keys || {}),
      ...(options.worldKeys || {}),
    },
    brushes: [...worldBrushes, ...backing],
    groups: sourceGroups,
  };
  return {
    ...source,
    format: "hammer-prefab-tool-vmf-document",
    version: 1,
    world,
    entities,
    groups: sourceGroups,
    brushes: [
      ...world.brushes,
      ...entities.flatMap((entity) => entity.brushes || []),
    ],
  };
}

/**
 * @param {import("./geometry-model.js").Brush[] | object} input
 * @param {object} [options]
 * @returns {string}
 */
export function writeRingPrefabVMF(input, options = {}) {
  return writeVMFDocument(createRingPrefabDocument(input, options), {
    purpose: VMF_EXPORT_PURPOSE.PREFAB,
  });
}

export const exportRingPrefab = writeRingPrefabVMF;
