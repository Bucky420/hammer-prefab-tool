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
};

const VALID_MODES = ["snap", "parallel", "forward-snap"];
const getPersistedMode = () => {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem("faceExtrudeMode") : null;
    return VALID_MODES.includes(v) ? v : null;
  } catch { return null; }
};
let faceExtrusionMode = state.faceExtrusionMode || getPersistedMode() || "snap";

Object.defineProperty(state, "faceExtrusionMode", {
  enumerable: true,
  configurable: true,
  get() {
    return faceExtrusionMode;
  },
  set(value) {
    const prev = faceExtrusionMode;
    faceExtrusionMode = VALID_MODES.includes(value) ? value : "snap";
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
