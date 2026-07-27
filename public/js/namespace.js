const state = {
  brushes: [],
  selection: new Set(),
  brushSelection: new Set(),
  hiddenBrushes: new Set(),
  faceSelection: new Set(),
  faceSelectionScope: "group",
  faceToolMode: "extrude",
  selectionScope: "group",
  showTextureAxes: false,
  mode: "selection",
  tool: "box",
  view: "top",
  grid: 16,
  textureLock: "world",
  projectName: "untitled.json",
  vmfPath: null,
};

const VALID_MODES = ["straight", "snap", "parallel"];
const getPersistedMode = () => {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem("faceExtrudeMode") : null;
    if (v === "forward-snap") return "straight";
    return VALID_MODES.includes(v) ? v : null;
  } catch { return null; }
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
let faceExtrusionMode = state.faceExtrusionMode || getPersistedMode() || "straight";

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
      try { localStorage.setItem("faceExtrudeMode", faceExtrusionMode); } catch {}
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
