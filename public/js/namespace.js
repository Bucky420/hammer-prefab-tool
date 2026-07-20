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

let faceExtrusionMode = state.faceExtrusionMode || "normal";
let faceSnapEnabled = state.faceSnapEnabled ?? false;

Object.defineProperty(state, "faceExtrusionMode", {
  enumerable: true,
  configurable: true,
  get() {
    return faceExtrusionMode;
  },
  set(value) {
    faceExtrusionMode = value === "parallel" ? "parallel" : "normal";

    if (typeof document === "undefined") return;
    queueMicrotask(() => {
      const parallelLabel = document.querySelector("[data-extrusion-parallel]");
      if (parallelLabel) {
        parallelLabel.classList.toggle(
          "active",
          faceExtrusionMode === "parallel",
        );
        parallelLabel.setAttribute(
          "aria-pressed",
          faceExtrusionMode === "parallel" ? "true" : "false",
        );
      }
    });
  },
});

Object.defineProperty(state, "faceSnapEnabled", {
  enumerable: true,
  configurable: true,
  get() {
    return faceSnapEnabled;
  },
  set(value) {
    faceSnapEnabled = Boolean(value);

    if (typeof document === "undefined") return;
    queueMicrotask(() => {
      const snapLabel = document.querySelector("[data-extrusion-snap]");
      if (snapLabel) {
        snapLabel.classList.toggle("active", faceSnapEnabled);
        snapLabel.setAttribute(
          "aria-pressed",
          faceSnapEnabled ? "true" : "false",
        );
      }
    });
  },
});

export const HP = {
  state,
  events: new EventTarget(),
};
HP.emit = (name) => HP.events.dispatchEvent(new Event(name));
