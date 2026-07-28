import assert from "node:assert/strict";
import { box, clone } from "../public/js/geometry-model.js";
import { validateAll } from "../public/js/brush-validation.js";
import { extrudeSelectedFaces } from "../public/js/face-extrusion.js";
import { generateRing } from "../public/js/ring-generator.js";
import {
  createRingPrefabDocument,
  writeRingPrefabVMF,
} from "../public/js/ring-export.js";
import { parseVMFDocument } from "../public/js/vmf-parser.js";
import { PREFAB_VERSION_KEY } from "../public/js/vmf-writer.js";

const first = generateRing({
  radius: 512,
  width: 64,
  height: 128,
  segments: 48,
  grid: 1,
});
const second = generateRing({
  radius: 384,
  width: 48,
  height: 96,
  segments: 48,
  grid: 1,
});
second.forEach((brush) => {
  brush.vertices.forEach((vertex) => {
    vertex.x += 1400;
  });
});
first[0].faceMaterials = first[0].faces.map((_, index) =>
  index === 2 ? "brick/brickwall001a" : first[0].material,
);
first[0].sideData = first[0].faces.map((_, index) => ({
  rotation: index === 2 ? 17.5 : 0,
  lightmapScale: index === 2 ? 8 : 16,
  smoothingGroups: index === 2 ? 5 : 0,
}));

assert.notEqual(first[0].assemblyId, second[0].assemblyId);
assert.ok(first.every((brush) => brush.assemblyId === first[0].assemblyId));
assert.deepEqual(first[0].faceRoles.outer, [2]);
assert.equal(first[0].materialRoles.outer, "prefab/ring_outer");
assert.equal(second[0].faceMaterials[1], "prefab/ring_top");
assert.equal(second[0].faceMaterials[4], "prefab/ring_inner");

const extrusionSource = generateRing({
  radius: 128,
  width: 32,
  height: 32,
  segments: 8,
  grid: 1,
})[0];
const extrusion = extrudeSelectedFaces(
  [extrusionSource],
  new Set([`${extrusionSource.id}:f:1`]),
  16,
  1,
);
assert.equal(extrusion.errors.length, 0);
assert.equal(extrusion.brushes[0].assemblyId, extrusionSource.assemblyId);
assert.deepEqual(extrusion.brushes[0].faceRoles.top, [1]);
assert.deepEqual(extrusion.brushes[0].faceRoles.base, [0]);
assert.equal(extrusion.brushes[0].materialRoles.base, "tools/toolsnodraw");

const source = [...first, ...second];
const sourceSnapshot = JSON.stringify(source);
const vmf = writeRingPrefabVMF(source);
assert.equal(
  JSON.stringify(source),
  sourceSnapshot,
  "prefab export must not mutate source brushes",
);
const document = parseVMFDocument(vmf);
assert.equal(document.world.keys[PREFAB_VERSION_KEY], "1");
assert.equal(document.versionInfo.prefab, "1");
assert.equal(document.versionInfo.formatversion, "100");
assert.equal(document.world.brushes.length, 0);
assert.equal(
  document.entities.length,
  2,
  "two rings must become two func_detail entities",
);
assert.deepEqual(
  document.entities.map((entity) => entity.keys.targetname),
  ["ring_01", "ring_02"],
);
assert.ok(
  document.entities.every((entity) => entity.classname === "func_detail"),
);
assert.deepEqual(
  document.entities.map((entity) => entity.brushes.length),
  [48, 48],
  "rings must not flatten or export one entity per brush",
);
assert.equal(validateAll(document.brushes).length, 0);
assert.equal(
  document.entities[0].brushes[0].faceMaterials[2],
  "brick/brickwall001a",
);
assert.equal(document.entities[0].brushes[0].sideData[2].rotation, 17.5);
assert.equal(document.entities[0].brushes[0].sideData[2].lightmapScale, 8);
assert.equal(document.entities[0].brushes[0].sideData[2].smoothingGroups, 5);
assert.deepEqual(
  document.entities[0].brushes[0].textureAxes[1].u,
  first[0].textureAxes[1].u,
  "generated U axes must survive prefab export",
);
assert.deepEqual(
  document.entities[0].brushes[0].textureAxes[1].v,
  first[0].textureAxes[1].v,
  "generated V axes must survive prefab export",
);

const backed = createRingPrefabDocument(source, {
  backing: "both",
  backingThickness: 32,
});
assert.equal(backed.world.brushes.length, 4);
assert.equal(validateAll(backed.world.brushes).length, 0);
assert.ok(
  backed.world.brushes.every((brush) => brush.material === "tools/toolsnodraw"),
);
assert.equal(new Set(backed.world.brushes.map((brush) => brush.id)).size, 4);
const bounds = (brushes) => ({
  minX: Math.min(
    ...brushes.flatMap((brush) => brush.vertices.map((vertex) => vertex.x)),
  ),
  maxX: Math.max(
    ...brushes.flatMap((brush) => brush.vertices.map((vertex) => vertex.x)),
  ),
  minZ: Math.min(
    ...brushes.flatMap((brush) => brush.vertices.map((vertex) => vertex.z)),
  ),
  maxZ: Math.max(
    ...brushes.flatMap((brush) => brush.vertices.map((vertex) => vertex.z)),
  ),
});
const firstBounds = bounds(first);
const secondBounds = bounds(second);
const backingBounds = backed.world.brushes.map((brush) => bounds([brush]));
assert.deepEqual(backingBounds, [
  { ...firstBounds, minZ: firstBounds.minZ - 32, maxZ: firstBounds.minZ },
  { ...firstBounds, minZ: firstBounds.maxZ, maxZ: firstBounds.maxZ + 32 },
  { ...secondBounds, minZ: secondBounds.minZ - 32, maxZ: secondBounds.minZ },
  { ...secondBounds, minZ: secondBounds.maxZ, maxZ: secondBounds.maxZ + 32 },
]);
assert.ok(
  backingBounds[0].maxX < backingBounds[2].minX,
  "per-ring backing must not bridge separate assemblies",
);

const imported = [
  box({ x: 0, y: 0, z: 0 }, { x: 32, y: 32, z: 32 }),
  box({ x: 32, y: 0, z: 0 }, { x: 64, y: 32, z: 32 }),
  box({ x: 96, y: 0, z: 0 }, { x: 128, y: 32, z: 32 }),
  box({ x: 128, y: 0, z: 0 }, { x: 160, y: 32, z: 32 }),
  box({ x: 192, y: 0, z: 0 }, { x: 224, y: 32, z: 32 }),
];
for (const brush of imported.slice(0, 2)) {
  brush.hammerGroupId = "10";
  brush.groupId = "vmf-group-10";
}
for (const brush of imported.slice(2, 4)) {
  brush.groupId = "ordinary-group";
}
const fallback = createRingPrefabDocument(imported);
assert.deepEqual(
  fallback.entities.map((entity) => entity.brushes.length),
  [2, 2],
);
assert.equal(
  fallback.world.brushes.length,
  1,
  "ungrouped imports must remain world geometry",
);

const documentFirst = clone(first);
const documentSecond = clone(second);
documentFirst[0].assemblyName = "Upper Ring / East";
const ordinaryGroup = [
  box({ x: 2200, y: 0, z: 0 }, { x: 2240, y: 40, z: 40 }),
  box({ x: 2240, y: 0, z: 0 }, { x: 2280, y: 40, z: 40 }),
];
ordinaryGroup.forEach((brush) => {
  brush.groupId = "ordinary-group";
});
const unrelatedWorld = box({ x: 2600, y: 0, z: 0 }, { x: 2640, y: 40, z: 40 });
const funcBrushSolid = box({ x: 2800, y: 0, z: 0 }, { x: 2840, y: 40, z: 40 });
funcBrushSolid.vmfId = "904";
funcBrushSolid.sideData = funcBrushSolid.faces.map((_, index) => ({
  id: String(910 + index),
}));
const existingDetailSolid = box(
  { x: 3000, y: 0, z: 0 },
  { x: 3040, y: 40, z: 40 },
);
existingDetailSolid.vmfId = "920";
existingDetailSolid.sideData = existingDetailSolid.faces.map((_, index) => ({
  id: String(921 + index),
}));
const fullInput = {
  format: "hammer-prefab-tool-vmf-document",
  version: 1,
  versionInfo: { editorversion: "400", formatversion: "100", prefab: "0" },
  world: {
    id: "1",
    keys: {
      id: "1",
      mapversion: "9",
      classname: "worldspawn",
      skyname: "sky_day01_01",
    },
    brushes: [
      ...documentFirst,
      ...documentSecond,
      ...ordinaryGroup,
      unrelatedWorld,
    ],
    groups: [
      {
        id: "850",
        exportKey: "ordinary-group",
        keys: { id: "850", name: "Door Frame" },
        editor: { keys: { color: "12 34 56" } },
      },
    ],
    children: [
      {
        name: "world_extension",
        properties: [{ key: "preserve", value: "yes" }],
        children: [],
      },
    ],
  },
  entities: [
    {
      id: "900",
      classname: "logic_relay",
      keys: { id: "900", classname: "logic_relay", targetname: "keep_relay" },
      brushes: [],
      children: [
        {
          name: "connections",
          properties: [{ key: "OnTrigger", value: "keep_target,Enable,,0,-1" }],
          children: [],
        },
      ],
    },
    {
      id: "901",
      classname: "func_brush",
      keys: { id: "901", classname: "func_brush", targetname: "keep_brush" },
      brushes: [funcBrushSolid],
    },
    {
      id: "903",
      classname: "func_detail",
      keys: {
        id: "903",
        classname: "func_detail",
        targetname: "existing_detail",
      },
      brushes: [existingDetailSolid],
    },
  ],
  groups: [],
  children: [
    {
      name: "custom_top_level",
      properties: [{ key: "payload", value: "keep" }],
      children: [],
    },
  ],
};
fullInput.groups = fullInput.world.groups;
fullInput.brushes = [
  ...fullInput.world.brushes,
  funcBrushSolid,
  existingDetailSolid,
];
const fullSnapshot = JSON.stringify(fullInput);
const fullPrefab = createRingPrefabDocument(fullInput, {
  backingBelow: true,
  backingThickness: 16,
});
assert.equal(
  JSON.stringify(fullInput),
  fullSnapshot,
  "document conversion must not mutate its input",
);
assert.equal(fullPrefab.entities.length, 6);
assert.deepEqual(fullPrefab.entities.slice(0, 3), fullInput.entities);
assert.deepEqual(
  fullPrefab.entities.slice(3).map((entity) => entity.keys.targetname),
  ["ring_01_upper_ring_east", "ring_02", "ring_03_door_frame"],
);
assert.deepEqual(
  fullPrefab.entities.slice(3).map((entity) => entity.brushes.length),
  [48, 48, 2],
);
assert.equal(fullPrefab.world.groups[0].keys.name, "Door Frame");
assert.equal(
  fullPrefab.world.brushes.length,
  4,
  "one unrelated world brush plus three backings",
);
assert.equal(
  new Set(fullPrefab.world.brushes.map((brush) => brush.id)).size,
  fullPrefab.world.brushes.length,
  "backing and retained world brushes require unique model IDs",
);
const convertedIds = fullPrefab.entities
  .slice(3)
  .flatMap((entity) => entity.brushes.map((brush) => brush.id));
assert.equal(
  new Set(convertedIds).size,
  98,
  "each converted brush must have one owner",
);

const fullVMF = writeRingPrefabVMF(fullInput, {
  backingBelow: true,
  backingThickness: 16,
});
assert.equal(
  JSON.stringify(fullInput),
  fullSnapshot,
  "document writing must not mutate its input",
);
const fullRoundTrip = parseVMFDocument(fullVMF);
assert.equal(fullRoundTrip.versionInfo.prefab, "1");
assert.equal(fullRoundTrip.versionInfo.formatversion, "100");
assert.equal(fullRoundTrip.world.keys.skyname, "sky_day01_01");
assert.equal(fullRoundTrip.groups[0].id, "850");
assert.equal(fullRoundTrip.groups[0].keys.name, "Door Frame");
assert.equal(
  fullRoundTrip.entities.find((entity) => entity.id === "900").classname,
  "logic_relay",
);
assert.equal(
  fullRoundTrip.entities
    .find((entity) => entity.id === "900")
    .children.find((child) => child.name === "connections").properties[0].value,
  "keep_target,Enable,,0,-1",
);
assert.equal(
  fullRoundTrip.entities.find((entity) => entity.id === "901").brushes[0].vmfId,
  "904",
);
assert.equal(
  fullRoundTrip.entities.find((entity) => entity.id === "903").keys.targetname,
  "existing_detail",
);
assert.equal(fullRoundTrip.children[0].name, "custom_top_level");
assert.equal(fullRoundTrip.world.children[0].name, "world_extension");
const roundTripIds = [
  fullRoundTrip.world.id,
  ...fullRoundTrip.groups.map((group) => group.id),
  ...fullRoundTrip.entities.map((entity) => entity.id),
  ...fullRoundTrip.brushes.flatMap((brush) => [
    brush.vmfId,
    ...brush.sideData.map((side) => side.id),
  ]),
].filter(Boolean);
assert.equal(
  new Set(roundTripIds).size,
  roundTripIds.length,
  "all emitted VMF IDs must be unique",
);

console.log("ring prefab export tests passed");
