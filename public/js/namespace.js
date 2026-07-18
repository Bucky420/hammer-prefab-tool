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

    // app.js restores editor snapshots after constructing the Face pane. Keep
    // the visible dropdown synchronized so it can never say Parallel while the
    // extrusion code is actually receiving Face normal (or vice versa).
    if (typeof document === "undefined") return;
    queueMicrotask(() => {
      const control = document.querySelector("[data-extrusion-mode]");
      if (control && control.value !== faceExtrusionMode)
        control.value = faceExtrusionMode;
    });
  },
});

export const HP = {
  state,
  events: new EventTarget(),
};
HP.emit = (name) => HP.events.dispatchEvent(new Event(name));
