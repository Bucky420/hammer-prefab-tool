const state = {
  brushes: [],
  selection: new Set(),
  brushSelection: new Set(),
  hiddenBrushes: new Set(),
  showFuncDetailBrushes: true,
  showRegularBrushes: true,
  faceSelection: new Set(),
  faceSelectionScope: "group",
  faceToolMode: "extrude",
  pathSettings: {
    type: "hallway",
    interiorWidth: 128,
    interiorHeight: 128,
    wallThickness: 16,
    floorThickness: 16,
    ceilingThickness: 16,
    baseElevation: 0,
    materials: {
      floor: "dev/dev_measuregeneric01b",
      wall: "dev/dev_measurewall01a",
      ceiling: "dev/dev_measuregeneric01b",
    },
  },
  selectionScope: "object",
  showTextureAxes: false,
  mode: "selection",
  tool: "box",
  view: "top",
  grid: 16,
  faceExtrusionGridSnap: false,
  textureLock: "world",
  projectName: "Untitled",
  vmfFilename: "prefab.vmf",
  vmfPath: null,
  entities: [],
  groups: [],
  ringMaterialRoles: {},
  ringSettings: {},
  projectSettings: {
    prefab: { ownership: "func_detail", backing: "none" },
  },
  vmf: {},
};

const VALID_MODES = ["straight", "snap", "parallel"];
const getPersistedMode = () => {
  try {
    const v =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("faceExtrudeMode")
        : null;
    if (v === "forward-snap") return "straight";
    return VALID_MODES.includes(v) ? v : null;
  } catch {
    return null;
  }
};
const getPersistedRailAngle = () => {
  try {
    const value = Number(
      typeof localStorage !== "undefined"
        ? localStorage.getItem("faceRailMaxAngle")
        : 89,
    );
    return Number.isFinite(value) ? Math.max(15, Math.min(89, value)) : 89;
  } catch {
    return 89;
  }
};
state.faceRailMaxAngle = getPersistedRailAngle();
const getPersistedSourceAngle = () => {
  try {
    const value = Number(
      typeof localStorage !== "undefined"
        ? localStorage.getItem("faceSourceMaxAngle")
        : 135,
    );
    return Number.isFinite(value) ? Math.max(90, Math.min(179, value)) : 135;
  } catch {
    return 135;
  }
};
state.faceSourceMaxAngle = getPersistedSourceAngle();
const getPersistedExtrusionGridSnap = () => {
  try {
    return localStorage.getItem("faceExtrusionGridSnap") === "true";
  } catch {
    return false;
  }
};
state.faceExtrusionGridSnap = getPersistedExtrusionGridSnap();
let faceExtrusionMode =
  state.faceExtrusionMode || getPersistedMode() || "straight";

Object.defineProperty(state, "faceExtrusionMode", {
  enumerable: true,
  configurable: true,
  get() {
    return faceExtrusionMode;
  },
  set(value) {
    const prev = faceExtrusionMode;
    faceExtrusionMode = VALID_MODES.includes(value) ? value : "straight";
    if (faceExtrusionMode !== prev) {
      try {
        localStorage.setItem("faceExtrudeMode", faceExtrusionMode);
      } catch {}
    }
    if (typeof document === "undefined") return;
    queueMicrotask(() => {
      for (const el of document.querySelectorAll("[data-extrude-mode]")) {
        const active = el.dataset.extrudeMode === faceExtrusionMode;
        el.classList.toggle("active", active);
        el.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });
  },
});

export const HP = {
  state,
  events: new EventTarget(),
};
HP.emit = (name) => HP.events.dispatchEvent(new Event(name));
