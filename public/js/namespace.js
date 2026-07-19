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

let faceExtrusionMode = "normal";

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
      const control = document.querySelector("[data-extrusion-parallel]");
      if (control) control.checked = faceExtrusionMode === "parallel";
    });
  },
});

export const HP = {
  state,
  events: new EventTarget(),
};
HP.emit = (name) => HP.events.dispatchEvent(new Event(name));
