export const HP = {
  state: {
    brushes: [],
    selection: new Set(),
    brushSelection: new Set(),
    hiddenBrushes: new Set(),
    faceSelection: new Set(),
    faceSelectionScope: "group",
    faceToolMode: "extrude",
    faceExtrusionMode: "normal",
    selectionScope: "group",
    showTextureAxes: false,
    mode: "selection",
    tool: "box",
    view: "top",
    grid: 16,
    textureLock: "world",
    projectName: "untitled.json",
  },
  events: new EventTarget(),
};
HP.emit = (name) => HP.events.dispatchEvent(new Event(name));
