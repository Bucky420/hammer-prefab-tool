import assert from "node:assert/strict";
import { box, clone } from "../public/js/geometry-model.js";
import { parseVMF, parseVMFDocument } from "../public/js/vmf-parser.js";
import { tokenizeVMF } from "../public/js/vmf-document.js";
import { writeVMF, writeVMFDocument } from "../public/js/vmf-writer.js";

const worldBrush = box(
  { x: 0, y: 0, z: 0 },
  { x: 64, y: 64, z: 64 },
  "brick/brickwall001a",
);
worldBrush.vmfId = "101";
worldBrush.groupId = "vmf-group-50";
worldBrush.hammerGroupId = "50";
worldBrush.textureAxes = worldBrush.faces.map(() => ({
  u: [0, 1, 0],
  v: [0, 0, -1],
  uShift: 12.5,
  vShift: -4,
  uScale: 0.5,
  vScale: 0.125,
}));
worldBrush.sideData = worldBrush.faces.map((_, index) => ({
  id: String(201 + index),
  rotation: index === 0 ? 22.5 : 0,
  lightmapScale: index === 0 ? 8 : 16,
  smoothingGroups: index === 0 ? 3 : 0,
  children:
    index === 0
      ? [
          {
            name: "dispinfo",
            properties: [
              { key: "power", value: "2" },
              { key: "startposition", value: "[0 0 64]" },
              { key: "elevation", value: "0" },
              { key: "subdiv", value: "0" },
            ],
            children: [
              {
                name: "distances",
                properties: [
                  { key: "row0", value: "0 0 0 0 0" },
                  { key: "row1", value: "0 0 0 0 0" },
                ],
                children: [],
              },
              {
                name: "allowed_verts",
                properties: [
                  { key: "10", value: "-1 -1 -1 -1 -1 -1 -1 -1 -1 -1" },
                ],
                children: [],
              },
            ],
          },
        ]
      : [],
}));
worldBrush.editor = {
  keys: { color: "0 128 255", groupid: "50" },
  children: [
    {
      name: "editor_extension",
      properties: [{ key: "locked_reason", value: "fixture" }],
      children: [],
    },
  ],
};

const entityBrush = clone(worldBrush);
entityBrush.id = "entity-brush";
entityBrush.vmfId = "102";
entityBrush.groupId = undefined;
entityBrush.hammerGroupId = undefined;
entityBrush.sideData = entityBrush.sideData.map((side, index) => ({
  ...side,
  id: String(301 + index),
}));
entityBrush.vertices.forEach((vertex) => {
  vertex.x += 128;
});

const sourceDocument = {
  versionInfo: {
    editorversion: "400",
    editorbuild: "10000",
    mapversion: "7",
  },
  world: {
    id: "1",
    keys: {
      id: "1",
      mapversion: "7",
      classname: "worldspawn",
      skyname: "sky_day01_01",
      message: 'quoted { brace } and a \\"quote\\"',
    },
    brushes: [worldBrush],
    groups: [
      {
        id: "50",
        keys: { id: "50" },
        children: [
          {
            name: "group_extension",
            properties: [{ key: "label", value: "primary" }],
            children: [],
          },
        ],
        editor: {
          keys: { color: "12 34 56" },
          children: [
            {
              name: "editor_extension",
              properties: [{ key: "group_note", value: "kept" }],
              children: [],
            },
          ],
        },
      },
      {
        id: "51",
        keys: { id: "51" },
        groupId: "vmf-group-50",
        hammerGroupId: "50",
        editor: { keys: { color: "56 34 12", groupid: "50" } },
      },
    ],
  },
  entities: [
    {
      id: "75",
      classname: "func_detail",
      keys: {
        id: "75",
        classname: "func_detail",
        targetname: "detail_shell",
      },
      properties: [
        { key: "id", value: "75" },
        { key: "classname", value: "func_detail" },
        { key: "targetname", value: "detail_shell" },
        { key: "OnUser1", value: "first,Trigger,,0,-1" },
        { key: "OnUser1", value: "second,Trigger,,0,-1" },
      ],
      brushes: [entityBrush],
      children: [
        {
          name: "connections",
          properties: [
            { key: "OnUser1", value: "door_a,Open,,0,-1" },
            { key: "OnUser1", value: "door_b,Close,,1.5,1" },
          ],
          children: [],
        },
        {
          name: "entity_extension",
          properties: [{ key: "opaque", value: "yes" }],
          children: [],
        },
      ],
      editor: {
        keys: { color: "220 30 220" },
        children: [
          {
            name: "editor_extension",
            properties: [{ key: "entity_note", value: "kept" }],
            children: [],
          },
        ],
      },
    },
    {
      classname: "info_target",
      keys: { classname: "info_target", targetname: "generated_id_fixture" },
      brushes: [],
    },
  ],
  children: [
    {
      name: "custom_top_level",
      properties: [
        { key: "id", value: "2" },
        { key: "payload", value: "opaque top-level data" },
      ],
      children: [
        {
          name: "nested_data",
          properties: [{ key: "value", value: "preserved" }],
          children: [],
        },
      ],
    },
  ],
};
sourceDocument.world.children = [
  {
    name: "world_extension",
    properties: [{ key: "setting", value: "retained" }],
    children: [],
  },
];

const vmf = writeVMFDocument(sourceDocument);
const document = parseVMFDocument(vmf);
assert.equal(document.world.keys.skyname, "sky_day01_01");
assert.equal(document.world.keys.message, 'quoted { brace } and a \\"quote\\"');
assert.equal(document.world.id, "1");
assert.equal(document.groups.length, 2);
assert.equal(document.groups[0].id, "50");
assert.equal(document.groups[0].editor.keys.color, "12 34 56");
assert.equal(document.groups[1].hammerGroupId, "50");
assert.equal(document.groups[0].children[0].name, "group_extension");
assert.equal(document.groups[0].editor.children[0].name, "editor_extension");
assert.equal(document.entities.length, 2);
assert.equal(document.entities[0].id, "75");
assert.equal(document.entities[0].classname, "func_detail");
assert.equal(document.entities[0].keys.targetname, "detail_shell");
assert.deepEqual(
  document.entities[0].properties
    .filter(({ key }) => key === "OnUser1")
    .map(({ value }) => value),
  ["first,Trigger,,0,-1", "second,Trigger,,0,-1"],
);
assert.equal(document.entities[0].brushes.length, 1);
const connections = document.entities[0].children.find(
  (child) => child.name === "connections",
);
assert.deepEqual(connections.properties, [
  { key: "OnUser1", value: "door_a,Open,,0,-1" },
  { key: "OnUser1", value: "door_b,Close,,1.5,1" },
]);
assert.equal(document.entities[0].editor.children[0].name, "editor_extension");
assert.equal(document.world.children[0].name, "world_extension");
assert.equal(document.children[0].name, "custom_top_level");
assert.notEqual(
  document.entities[1].id,
  "2",
  "opaque preferred IDs must be reserved",
);
assert.equal(document.brushes.length, 2);
assert.equal(document.world.brushes[0].vmfId, "101");
assert.equal(document.world.brushes[0].hammerGroupId, "50");
assert.equal(document.world.brushes[0].sideData[0].id, "201");
assert.equal(document.world.brushes[0].sideData[0].rotation, 22.5);
assert.equal(document.world.brushes[0].sideData[0].lightmapScale, 8);
assert.equal(document.world.brushes[0].sideData[0].smoothingGroups, 3);
assert.deepEqual(document.world.brushes[0].textureAxes[0], {
  u: [0, 1, 0],
  v: [0, 0, -1],
  uShift: 12.5,
  vShift: -4,
  uScale: 0.5,
  vScale: 0.125,
});
assert.equal(document.entities[0].brushes[0].hammerEntityId, "75");
assert.equal(document.entities[0].brushes[0].entityClassname, "func_detail");
assert.equal(
  document.world.brushes[0].sideData[0].children[0].name,
  "dispinfo",
);
assert.equal(
  document.world.brushes[0].sideData[0].children[0].children[0].properties[1]
    .value,
  "0 0 0 0 0",
);
assert.equal(
  document.world.brushes[0].editor.children[0].name,
  "editor_extension",
);
assert.doesNotThrow(() => JSON.stringify(document));

const rewritten = writeVMFDocument(JSON.parse(JSON.stringify(document)));
const rewrittenDocument = parseVMFDocument(rewritten);
assert.equal(rewrittenDocument.world.keys.skyname, "sky_day01_01");
assert.equal(rewrittenDocument.entities[0].brushes[0].vmfId, "102");
assert.equal(rewrittenDocument.world.brushes[0].sideData[0].rotation, 22.5);
assert.equal(
  rewrittenDocument.entities[0].children.filter(
    (child) => child.name === "connections",
  ).length,
  1,
  "known entity children must not be duplicated",
);
assert.equal(
  rewrittenDocument.world.brushes[0].sideData[0].children.filter(
    (child) => child.name === "dispinfo",
  ).length,
  1,
  "side children must remain under their original side exactly once",
);
assert.equal(rewrittenDocument.children[0].children[0].name, "nested_data");
assert.equal(
  parseVMF(rewritten).length,
  2,
  "compatibility parser must include entity solids",
);

const grouped = [
  box(),
  box({ x: 128, y: -64, z: 0 }, { x: 256, y: 64, z: 128 }),
];
grouped.forEach((brush) => {
  brush.groupId = "standard-group";
});
const standard = writeVMF(grouped);
const standardDocument = parseVMFDocument(standard);
assert.equal(standardDocument.entities.length, 0);
assert.equal(standardDocument.world.groups.length, 1);
assert.equal(standardDocument.world.brushes.length, 2);
assert.equal(
  standardDocument.world.brushes[0].groupId,
  standardDocument.world.brushes[1].groupId,
  "standard brush export must remain one directly-openable Hammer group",
);

assert.ok(
  tokenizeVMF('world { "message" "literal { }" }').some(
    (token) => token.value === "literal { }",
  ),
  "quoted braces must remain value text",
);
assert.throws(
  () => parseVMFDocument('world { "id" "1"'),
  /VMF parse error at 1:1: unclosed "world" block/,
);
assert.throws(
  () => parseVMFDocument('world { "id" "unterminated }'),
  /VMF parse error at 1:14: unterminated quoted string/,
);
assert.throws(
  () => parseVMFDocument('world { "id" }'),
  /missing value for "id"/,
);

const legacyPropertyVMF = writeVMFDocument({
  world: {
    keys: { id: "1", classname: "worldspawn" },
    brushes: [],
    groups: [],
  },
  entities: [
    {
      properties: {
        classname: "light",
        targetname: "legacy_light",
        _light: "255 200 160 400",
      },
      brushes: [],
    },
  ],
});
const legacyPropertyDocument = parseVMFDocument(legacyPropertyVMF);
assert.equal(legacyPropertyDocument.entities[0].classname, "light");
assert.equal(
  legacyPropertyDocument.entities[0].keys.targetname,
  "legacy_light",
);

console.log("VMF document tests passed");
