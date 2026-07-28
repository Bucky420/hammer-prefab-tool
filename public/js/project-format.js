export const PROJECT_FORMAT = "hammer-prefab-tool-project";
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = ".hptproject.json";

const EXTRUSION_MODES = new Set(["straight", "parallel", "snap"]);

export class ProjectFormatError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ProjectFormatError";
    this.code = options.code || "INVALID_PROJECT";
  }
}

function fail(message, code = "INVALID_PROJECT") {
  throw new ProjectFormatError(message, { code });
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function cloneJsonSafe(value, path = "$", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must contain a finite number`);
    return value;
  }
  if (typeof value !== "object")
    fail(`${path} contains a value that cannot be stored as JSON`);
  if (seen.has(value)) fail(`${path} contains a circular reference`);
  seen.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item, index) =>
        item === undefined
          ? null
          : cloneJsonSafe(item, `${path}[${index}]`, seen),
      );
    if (!isRecord(value))
      fail(`${path} must contain only JSON objects and arrays`);
    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      Object.defineProperty(clone, key, {
        value: cloneJsonSafe(item, `${path}.${key}`, seen),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  } finally {
    seen.delete(value);
  }
}

function sourceName(source, options) {
  const value = options.name ?? source.name ?? source.projectName;
  return typeof value === "string" && value.trim() ? value.trim() : "Untitled";
}

function deriveGroups(brushes) {
  return [
    ...new Set(brushes.map((brush) => brush.groupId).filter(Boolean)),
  ].map((id) => ({ id }));
}

function extrusionSettings(source) {
  const nested = isRecord(source.settings?.extrusion)
    ? source.settings.extrusion
    : isRecord(source.extrusion)
      ? source.extrusion
      : {};
  const mode = nested.mode ?? source.faceExtrusionMode ?? "straight";
  return {
    mode: mode === "forward-snap" ? "straight" : mode,
    gridSnap: Boolean(nested.gridSnap ?? source.faceExtrusionGridSnap ?? false),
    railMaxAngle: nested.railMaxAngle ?? source.faceRailMaxAngle ?? 89,
    sourceMaxAngle: nested.sourceMaxAngle ?? source.faceSourceMaxAngle ?? 135,
  };
}

function ringData(source) {
  const ring = isRecord(source.ring) ? source.ring : {};
  return {
    materialRoles: cloneJsonSafe(
      ring.materialRoles ?? source.ringMaterialRoles ?? {},
      "$.ring.materialRoles",
    ),
    settings: cloneJsonSafe(
      ring.settings ?? source.ringSettings ?? {},
      "$.ring.settings",
    ),
  };
}

function vmfData(source) {
  const vmf = isRecord(source.vmf)
    ? source.vmf
    : isRecord(source.vmfDocument)
      ? source.vmfDocument
      : {};
  const world = isRecord(vmf.world) ? vmf.world : {};
  return {
    versionInfo: cloneJsonSafe(
      vmf.versionInfo ?? source.versionInfo ?? {},
      "$.vmf.versionInfo",
    ),
    versionProperties: cloneJsonSafe(
      vmf.versionProperties ?? source.versionProperties ?? [],
      "$.vmf.versionProperties",
    ),
    versionChildren: cloneJsonSafe(
      vmf.versionChildren ?? source.versionChildren ?? [],
      "$.vmf.versionChildren",
    ),
    children: cloneJsonSafe(vmf.children ?? [], "$.vmf.children"),
    world: cloneJsonSafe(
      {
        id: world.id,
        keys: world.keys ?? {},
        properties: world.properties ?? [],
        children: world.children ?? [],
      },
      "$.vmf.world",
    ),
  };
}

export function createProject(source = {}, options = {}) {
  if (!isRecord(source)) fail("Project source must be an object");
  const brushes = cloneJsonSafe(source.brushes ?? [], "$.brushes");
  const entities = cloneJsonSafe(source.entities ?? [], "$.entities");
  const groups = cloneJsonSafe(
    source.groups ?? deriveGroups(brushes),
    "$.groups",
  );
  const projectSettings = cloneJsonSafe(
    source.settings?.project ?? source.projectSettings ?? {},
    "$.settings.project",
  );
  const project = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: sourceName(source, options),
    brushes,
    entities,
    groups,
    vmf: vmfData(source),
    ring: ringData(source),
    settings: {
      grid: source.settings?.grid ?? source.grid ?? 16,
      extrusion: cloneJsonSafe(
        extrusionSettings(source),
        "$.settings.extrusion",
      ),
      project: projectSettings,
    },
  };
  validateProject(project);
  return project;
}

function validateObjectArray(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  value.forEach((item, index) => {
    if (!isRecord(item)) fail(`${path}[${index}] must be an object`);
  });
}

export function validateProject(project) {
  cloneJsonSafe(project);
  if (!isRecord(project)) fail("Project must be an object");
  if (project.format !== PROJECT_FORMAT)
    fail(
      `Unsupported project format: ${String(project.format)}`,
      "UNSUPPORTED_FORMAT",
    );
  if (!Number.isInteger(project.version) || project.version < 1)
    fail("Project version must be a positive integer");
  if (project.version > PROJECT_VERSION)
    fail(
      `Project version ${project.version} is newer than supported version ${PROJECT_VERSION}`,
      "NEWER_VERSION",
    );
  if (typeof project.name !== "string" || !project.name.trim())
    fail("Project name must be a non-empty string");
  validateObjectArray(project.brushes, "$.brushes");
  validateObjectArray(project.entities, "$.entities");
  validateObjectArray(project.groups, "$.groups");
  if (!isRecord(project.vmf)) fail("$.vmf must be an object");
  if (!isRecord(project.vmf.versionInfo))
    fail("$.vmf.versionInfo must be an object");
  if (!Array.isArray(project.vmf.versionProperties))
    fail("$.vmf.versionProperties must be an array");
  if (!Array.isArray(project.vmf.versionChildren))
    fail("$.vmf.versionChildren must be an array");
  if (!Array.isArray(project.vmf.children))
    fail("$.vmf.children must be an array");
  if (!isRecord(project.vmf.world)) fail("$.vmf.world must be an object");
  if (!isRecord(project.vmf.world.keys))
    fail("$.vmf.world.keys must be an object");
  if (!Array.isArray(project.vmf.world.properties))
    fail("$.vmf.world.properties must be an array");
  if (!Array.isArray(project.vmf.world.children))
    fail("$.vmf.world.children must be an array");
  project.brushes.forEach((brush, index) => {
    if (typeof brush.id !== "string" || !brush.id)
      fail(`$.brushes[${index}].id must be a non-empty string`);
    if (!Array.isArray(brush.vertices) || !Array.isArray(brush.faces))
      fail(`$.brushes[${index}] must include vertices and faces arrays`);
  });
  if (
    new Set(project.brushes.map((brush) => brush.id)).size !==
    project.brushes.length
  )
    fail("$.brushes contains duplicate brush IDs");
  if (!isRecord(project.ring)) fail("$.ring must be an object");
  if (!isRecord(project.ring.materialRoles))
    fail("$.ring.materialRoles must be an object");
  if (!isRecord(project.ring.settings))
    fail("$.ring.settings must be an object");
  if (!isRecord(project.settings)) fail("$.settings must be an object");
  if (!Number.isFinite(project.settings.grid) || project.settings.grid <= 0)
    fail("$.settings.grid must be a positive finite number");
  if (!isRecord(project.settings.extrusion))
    fail("$.settings.extrusion must be an object");
  if (!EXTRUSION_MODES.has(project.settings.extrusion.mode))
    fail("$.settings.extrusion.mode is invalid");
  for (const key of ["railMaxAngle", "sourceMaxAngle"])
    if (!Number.isFinite(project.settings.extrusion[key]))
      fail(`$.settings.extrusion.${key} must be a finite number`);
  if (typeof project.settings.extrusion.gridSnap !== "boolean")
    fail("$.settings.extrusion.gridSnap must be a boolean");
  if (!isRecord(project.settings.project))
    fail("$.settings.project must be an object");
  return true;
}

export function migrateProject(input, options = {}) {
  if (!isRecord(input)) fail("Project must be an object");
  if (input.format === PROJECT_FORMAT) {
    if (input.version > PROJECT_VERSION)
      fail(
        `Project version ${input.version} is newer than supported version ${PROJECT_VERSION}`,
        "NEWER_VERSION",
      );
    if (input.version !== 1 && input.version !== PROJECT_VERSION)
      fail(`No migration is available for project version ${input.version}`);
    if (input.version === 1)
      return createProject(
        {
          ...input,
          version: PROJECT_VERSION,
          vmf: input.vmf || vmfData(input),
        },
        { name: input.name },
      );
    validateProject(input);
    return createProject(input, { name: input.name });
  }
  if (input.format !== undefined)
    fail(
      `Unsupported project format: ${String(input.format)}`,
      "UNSUPPORTED_FORMAT",
    );
  if (isRecord(input.state)) {
    const legacyVersion = input.version ?? 1;
    if (!Number.isInteger(legacyVersion) || legacyVersion < 1)
      fail("Legacy project version must be a positive integer");
    if (legacyVersion > PROJECT_VERSION)
      fail(
        `Project version ${legacyVersion} is newer than supported version ${PROJECT_VERSION}`,
        "NEWER_VERSION",
      );
    return createProject(input.state, {
      name: options.name ?? input.name ?? input.state.projectName,
    });
  }
  return createProject(input, options);
}

export function normalizeProject(input, options = {}) {
  return migrateProject(input, options);
}

export function parseProject(text, options = {}) {
  if (typeof text !== "string") fail("Project file contents must be text");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProjectFormatError(
      `Project JSON could not be parsed: ${error.message}`,
      {
        code: "INVALID_JSON",
        cause: error,
      },
    );
  }
  return migrateProject(parsed, options);
}

export function serializeProject(input, options = {}) {
  const project = normalizeProject(input, options);
  return `${JSON.stringify(project, null, options.space ?? 2)}\n`;
}
