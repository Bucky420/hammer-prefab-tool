import assert from "node:assert/strict";
import {
  cloneJsonSafe,
  createProject,
  migrateProject,
  parseProject,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectFormatError,
  serializeProject,
  validateProject,
} from "../public/js/project-format.js";

const brush = {
  id: "ring-1",
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 16, y: 0, z: 0 },
    { x: 0, y: 16, z: 0 },
  ],
  faces: [[0, 1, 2]],
  material: "dev/dev_measurewall01a",
  faceMaterials: ["brick/wall"],
  textureAxes: [{ u: [1, 0, 0], v: [0, 1, 0], uScale: 0.25 }],
  groupId: "ring-group",
  vertexRoles: { inner: [0], outer: [1, 2] },
  generator: { type: "ring", segment: 0, customMetadata: { kept: true } },
};
const state = {
  projectName: "Courtyard",
  brushes: [brush],
  entities: [
    {
      id: "light-1",
      classname: "light",
      properties: { _light: "255 200 160" },
    },
  ],
  groups: [{ id: "ring-group", name: "Outer wall", color: "orange" }],
  ringMaterialRoles: { inner: "brick/inside", outer: "brick/outside" },
  ringSettings: { radius: 256, width: 32, segments: 16 },
  grid: 8,
  faceExtrusionMode: "snap",
  faceExtrusionGridSnap: true,
  faceRailMaxAngle: 75,
  faceSourceMaxAngle: 120,
  projectSettings: { units: "hammer", exportHint: "prefab.vmf" },
  vmf: {
    versionChildren: [
      {
        name: "version_extension",
        properties: [{ key: "keep", value: "yes" }],
        children: [],
      },
    ],
    children: [
      {
        name: "cameras",
        properties: [],
        children: [],
      },
    ],
    world: {
      keys: { classname: "worldspawn" },
      properties: [],
      children: [
        {
          name: "world_extension",
          properties: [{ key: "keep", value: "yes" }],
          children: [],
        },
      ],
    },
  },
  selection: new Set(["ring-1"]),
  camera: { scale: 4 },
};

const before = JSON.stringify({ ...state, selection: [...state.selection] });
const project = createProject(state);
assert.equal(project.format, PROJECT_FORMAT);
assert.equal(project.version, PROJECT_VERSION);
assert.equal(project.name, "Courtyard");
assert.deepEqual(project.brushes[0], brush, "all brush metadata is preserved");
assert.deepEqual(project.entities, state.entities);
assert.deepEqual(project.groups, state.groups);
assert.deepEqual(project.ring.materialRoles, state.ringMaterialRoles);
assert.deepEqual(project.ring.settings, state.ringSettings);
assert.deepEqual(project.vmf.children, state.vmf.children);
assert.deepEqual(project.vmf.versionChildren, state.vmf.versionChildren);
assert.deepEqual(project.vmf.world.children, state.vmf.world.children);
assert.deepEqual(project.settings, {
  grid: 8,
  extrusion: {
    mode: "snap",
    gridSnap: true,
    railMaxAngle: 75,
    sourceMaxAngle: 120,
  },
  project: state.projectSettings,
});
assert.equal(
  "selection" in project,
  false,
  "session selection is not portable",
);
assert.equal("camera" in project, false, "session camera is not portable");
assert.equal(
  JSON.stringify({ ...state, selection: [...state.selection] }),
  before,
);
assert.equal(validateProject(project), true);

const serialized = serializeProject(project);
assert.ok(serialized.endsWith("\n"));
assert.deepEqual(parseProject(serialized), project);

const versionOne = structuredClone(project);
versionOne.version = 1;
delete versionOne.vmf;
const migratedVersionOne = migrateProject(versionOne);
assert.equal(migratedVersionOne.version, PROJECT_VERSION);
assert.deepEqual(migratedVersionOne.vmf.versionInfo, {});

const sparseVersionOne = migrateProject({
  format: PROJECT_FORMAT,
  version: 1,
  name: "Sparse v1",
  brushes: [brush],
});
assert.equal(sparseVersionOne.version, PROJECT_VERSION);
assert.deepEqual(sparseVersionOne.entities, []);
assert.equal(sparseVersionOne.settings.grid, 16);

const rawLegacy = migrateProject({
  projectName: "Legacy raw",
  brushes: [brush],
  grid: 32,
  faceExtrusionMode: "forward-snap",
});
assert.equal(rawLegacy.name, "Legacy raw");
assert.equal(rawLegacy.settings.grid, 32);
assert.equal(rawLegacy.settings.extrusion.mode, "straight");
assert.deepEqual(rawLegacy.groups, [{ id: "ring-group" }]);

const wrappedLegacy = migrateProject({
  version: 1,
  name: "Wrapped legacy",
  state: { brushes: [brush], grid: 4, entities: [{ id: "legacy-entity" }] },
});
assert.equal(wrappedLegacy.name, "Wrapped legacy");
assert.equal(wrappedLegacy.settings.grid, 4);
assert.equal(wrappedLegacy.entities[0].id, "legacy-entity");

assert.throws(
  () =>
    migrateProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1 }),
  (error) =>
    error instanceof ProjectFormatError && error.code === "NEWER_VERSION",
);
assert.throws(
  () => migrateProject({ version: PROJECT_VERSION + 1, state: {} }),
  (error) =>
    error instanceof ProjectFormatError && error.code === "NEWER_VERSION",
);
assert.throws(() => parseProject("{"), /could not be parsed/);
assert.throws(() => cloneJsonSafe({ invalid: Number.NaN }), /finite number/);
assert.deepEqual(
  cloneJsonSafe({ kept: true, omitted: undefined, array: [undefined] }),
  { kept: true, array: [null] },
);
const cycle = {};
cycle.self = cycle;
assert.throws(() => cloneJsonSafe(cycle), /circular reference/);
assert.throws(
  () => createProject({ brushes: [brush, structuredClone(brush)] }),
  /duplicate brush IDs/,
);

console.log("project format checks passed");
