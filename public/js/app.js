import { HP } from "./namespace.js";
import { api } from "./api.js";
import {
  box,
  clone,
  snapAllVertices,
  countOffGridCoordinates,
} from "./geometry-model.js";
import { generateRing } from "./ring-generator.js";
import { generateArch } from "./arch-generator.js";
import {
  generateCylinder,
  generateSphere,
  generateTorus,
} from "./primitive-generator.js";
import { validateAll } from "./brush-validation.js";
import { History } from "./history.js";
import { Viewport } from "./viewport.js";
import { writeVMF } from "./vmf-writer.js";
import { parseVMF } from "./vmf-parser.js";
import {
  alignAllFacesToCenter,
  alignAllFacesToOuter,
} from "./texture-alignment.js";
import { GRID_VALUES, roundToGrid } from "./grid.js";
import { ringVertexIds } from "./selection.js";
import { applyNodrawToHiddenFaces } from "./nodraw.js";
import {
  extrudeSelectedFaces,
  limitExtrusionDistance,
} from "./face-extrusion.js";
import { fillSelectedLoop } from "./face-fill.js";
import {
  nudge,
  scaleVertices,
  setRingRadius,
  selectionBounds,
} from "./vertex-editor.js";

const $ = (id) => document.getElementById(id);
const state = HP.state;
state.faceSelection ||= new Set();
state.hiddenBrushes ||= new Set();
state.faceSelectionScope ||= "group";
state.faceToolMode ||= "extrude";
const history = state.history || (state.history = new History());
const status = $("status");
document.querySelector(".live-indicator")?.remove();
const hmrIndicator = document.createElement("span");
hmrIndicator.className = "live-indicator";
hmrIndicator.dataset.state = "connecting";
hmrIndicator.title = "Development reload connecting";
document.querySelector("header").append(hmrIndicator);
window.addEventListener("error", (event) => {
  if (status)
    setTimeout(() => setStatus(`UI error: ${event.message}`, true), 0);
});
window.addEventListener("unhandledrejection", (event) => {
  if (status)
    setTimeout(
      () =>
        setStatus(`UI error: ${event.reason?.message || event.reason}`, true),
      0,
    );
});
const browser = $("project-browser");
const search = $("file-search");
const viewNames = ["top", "front", "side"];
const viewLabels = { top: "TOP / XY", front: "FRONT / YZ", side: "SIDE / XZ" };
let activeView = state.view || "top";
const view = new Viewport(
  $("editor"),
  activeView,
  state,
  (changeType) => {
    if (changeType === "selection-commit") changed();
    else if (changeType === "duplicate-commit") {
      changed();
      setStatus("Duplicated selected brushes");
    } else if (changeType === "brush-preview") {
      redraw();
      setStatus(
        "Block bounds ready; press Enter to create or Escape to cancel",
      );
    } else if (changeType === "brush-created") {
      redraw();
    } else if (
      typeof changeType === "string" &&
      changeType.startsWith("face-selected:")
    ) {
      activeView = changeType.slice("face-selected:".length);
      state.view = activeView;
      view.kind = activeView;
      redraw();
      setStatus("Face selected; switched to an edge-on view for extrusion");
    } else if (changeType === "face-incompatible") {
      redraw();
      setStatus(
        "Face not selected: use faces with the same angle and role",
        true,
      );
    } else if (
      typeof changeType === "string" &&
      changeType.startsWith("extrusion-invalid:")
    ) {
      redraw();
      setStatus(
        `Extrusion blocked: ${changeType.slice("extrusion-invalid:".length)}`,
        true,
      );
    } else if (
      typeof changeType === "string" &&
      changeType.startsWith("transform-invalid:")
    ) {
      redraw();
      setStatus(
        `Transform blocked: ${changeType.slice("transform-invalid:".length)}`,
        true,
      );
    } else if (changeType) redraw();
    else changed();
  },
  (bounds) => {
    createBrushFromBounds(bounds);
  },
  (selection, distance, guideSelection, mode, snapTarget) =>
    commitFaceExtrusion(selection, distance, guideSelection, mode, snapTarget),
  (bounds) => {
    view.creationPreviewBrushes = buildBrushesFromBounds(bounds) || [];
    view.requestDraw();
  },
);
/*
  Brush creation is intentionally staged: Hammer lets the user resize the
  selection box and change Arch Properties before Enter commits the solid.
*/
function createBrushFromBounds(bounds) {
  const created = buildBrushesFromBounds(bounds);
  if (created?.length)
    add(
      created,
      state.generator.shape === "arch" ? "Arch created" : "Block created",
      true,
    );
}
function buildBrushesFromBounds(bounds) {
  const [horizontal, vertical, depth] = bounds.axes;
  const min = { x: 0, y: 0, z: 0 },
    max = { x: 0, y: 0, z: 0 };
  min[horizontal] = Math.min(bounds.start[horizontal], bounds.end[horizontal]);
  max[horizontal] = Math.max(bounds.start[horizontal], bounds.end[horizontal]);
  min[vertical] = Math.min(bounds.start[vertical], bounds.end[vertical]);
  max[vertical] = Math.max(bounds.start[vertical], bounds.end[vertical]);
  const selectedVertices = state.brushes
    .filter((brush) => state.brushSelection.has(brush.id))
    .flatMap((brush) => brush.vertices);
  if (selectedVertices.length) {
    min[depth] = Math.min(...selectedVertices.map((vertex) => vertex[depth]));
    max[depth] = Math.max(...selectedVertices.map((vertex) => vertex[depth]));
  } else {
    const depthSize =
      depth === "x"
        ? state.generator.width
        : depth === "y"
          ? brushDepth
          : state.generator.height;
    min[depth] = depth === "z" ? state.generator.addHeight : -depthSize / 2;
    max[depth] =
      depth === "z" ? state.generator.addHeight + depthSize : depthSize / 2;
  }
  for (const axis of ["x", "y", "z"]) {
    min[axis] = roundToGrid(min[axis], state.grid);
    max[axis] = roundToGrid(max[axis], state.grid);
  }
  if (["x", "y", "z"].some((axis) => min[axis] === max[axis]))
    return setStatus("Brush creation collapsed on the current grid", true);
  if (state.generator.shape === "arch") {
    const width = max[horizontal] - min[horizontal],
      height = max[vertical] - min[vertical],
      wall = state.generator.width,
      arch = generateArch({
        width,
        height,
        depth: max[depth] - min[depth],
        wallWidth: wall,
        sides: state.generator.segments,
        startAngle: state.generator.startAngle,
        arc: state.generator.arc,
        addHeight: state.generator.addHeight,
        grid: state.grid,
      });
    const center = {
      [horizontal]: (min[horizontal] + max[horizontal]) / 2,
      [vertical]: (min[vertical] + max[vertical]) / 2,
      [depth]: min[depth],
    };
    arch.forEach((brush) => {
      brush.vertices.forEach((vertex) => {
        const local = { x: vertex.x, y: vertex.y, z: vertex.z };
        vertex[horizontal] = local.x + center[horizontal];
        vertex[vertical] = local.y + center[vertical];
        vertex[depth] = local.z + center[depth];
      });
      brush.generator.extrusionCenter = { ...center };
      brush.generator.extrusionAxes = [horizontal, vertical];
    });
    return arch;
  }
  return [box(min, max)];
}
document.querySelector(".tool-rail")?.remove();
document.querySelector(".brush-panel")?.remove();
const toolRail = document.createElement("aside");
toolRail.className = "tool-rail";
const railSizeObserver = new ResizeObserver((entries) => {
  const width = entries[0].contentRect.width;
  toolRail.classList.toggle("compact", width < 56);
});
toolRail.innerHTML = `<button type="button" data-tool-mode="selection" title="Object selection tool"><svg viewBox="0 0 24 24"><path d="M5 3l12 10-6 1-3 7-3-18z"/></svg><span>Object</span></button><button type="button" data-tool-mode="brush" title="Brush tool"><svg viewBox="0 0 24 24"><path d="M4 18h16M6 14h12V5H6z"/></svg><span>Brush</span></button><button type="button" data-tool-mode="face" title="Face selection and extrusion"><svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4zM4 7v9l8 5v-10M20 7v9l-8 5"/></svg><span>Face</span></button><button type="button" data-tool-mode="vertex" title="Vertex editing"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19M5 5h14v14H5z"/></svg><span>Vertex</span></button>`;
document.querySelector("main").prepend(toolRail);
railSizeObserver.observe(toolRail);
let selectionShape = "box";
toolRail.querySelectorAll("[data-tool-mode]").forEach(
  (button) =>
    (button.onclick = () => {
      const mode = button.dataset.toolMode;
      if (state.mode !== mode) view.cancelInteraction();
      if (mode === "selection") {
        state.mode = "selection";
        state.tool = "box";
        railDock.classList.remove("available");
        setRailExpanded(false);
        setStatus("Square selection active");
      } else if (mode === "brush") {
        state.mode = "brush";
        state.tool = "brush";
        setRailExpanded(true);
        showBrushDock();
        setStatus("Brush tool active");
      } else if (mode === "face") {
        state.mode = "face";
        state.tool = "box";
        setRailExpanded(true);
        showFaceDock();
        setStatus("Face selection active; press E to extrude selected faces");
      } else {
        state.mode = "vertex";
        state.tool = "box";
        railDock.classList.remove("available");
        setRailExpanded(false);
        setStatus("Vertex editing active");
      }
      updateSelectionScopeToggle();
      toolRail
        .querySelectorAll("[data-tool-mode]")
        .forEach((item) => item.classList.toggle("active", item === button));
      redraw();
    }),
);
toolRail.querySelector('[data-tool-mode="selection"]').classList.add("active");
const RELOAD_STATE_KEY = "hammer-prefab-tool-hmr-state";
let allFiles = [];
let visibleFiles = [];
let browserSelected = null;

state.generator = {
  radius: 256,
  width: 64,
  height: 128,
  segments: 32,
  startAngle: 0,
  arc: 180,
  addHeight: 0,
  bevel: 0,
  shape: "block",
  rings: 12,
};
state.grid = 16;
const brushPanel = document.createElement("aside");
brushPanel.className = "brush-panel";
brushPanel.hidden = false;
brushPanel.innerHTML = `<header><strong>BRUSH TOOLS</strong></header><label>Shape <select data-shape><option value="block">Block</option><option value="arch">Arch</option><option value="cylinder">Cylinder</option><option value="sphere">Sphere</option><option value="torus">Torus</option></select></label><label>Width <input type="number" data-setting="width" min="1" max="4096" step="${state.grid}" value="64"><output data-output="width">64</output></label><label>Depth <input type="number" data-setting="depth" min="1" max="4096" step="${state.grid}" value="64"><output data-output="depth">64</output></label><label>Height <input type="number" data-setting="height" min="1" max="4096" step="${state.grid}" value="128"><output data-output="height">128</output></label><label>Radius <input type="number" data-setting="radius" min="8" max="4096" step="${state.grid}" value="256"><output data-output="radius">256</output></label><label>Sides <input type="number" data-setting="segments" min="3" max="128" step="1" value="32"><output data-output="segments">32</output></label><label>Rings <input type="number" data-setting="rings" min="2" max="64" step="1" value="12"><output data-output="rings">12</output></label><label>Arc <input type="number" data-setting="arc" min="1" max="360" step="1" value="180"><output data-output="arc">180</output></label><label data-arch-setting>Bevel <input type="number" data-setting="bevel" min="0" max="128" step="${state.grid}" value="0"><output data-output="bevel">0</output></label><label class="check-row"><input type="checkbox" data-setting="powerOfTwo"> Power of 2</label><label class="advanced-setting">Elevation <input type="number" data-setting="addHeight" min="-4096" max="4096" step="${state.grid}" value="0"><output data-output="addHeight">0</output></label><button class="generate-brush" data-generate>Generate Brush</button>`;
toolRail.append(brushPanel);
brushPanel
  .querySelector('[data-setting="powerOfTwo"]')
  ?.closest("label")
  .remove();
brushPanel.querySelector('[data-setting="bevel"]')?.closest("label").remove();
const railButtons = [...toolRail.querySelectorAll("[data-tool-mode]")];
const railTools = document.createElement("div");
railTools.className = "rail-tools";
railButtons.forEach((button) => railTools.append(button));
const selectionScopeToggle = $("selection-scope-toggle");
function updateSelectionScopeToggle() {
  const scope =
    state.mode === "face" ? state.faceSelectionScope : state.selectionScope;
  selectionScopeToggle.hidden = false;
  selectionScopeToggle.dataset.scope = scope;
  selectionScopeToggle.title =
    state.mode === "face"
      ? `${scope === "group" ? "Grouped semantic faces" : "Single face"} selection`
      : `${scope === "group" ? "Group" : "Object"} selection`;
}
selectionScopeToggle.onclick = () => {
  const faceMode = state.mode === "face";
  const nextScope =
    (faceMode ? state.faceSelectionScope : state.selectionScope) === "group"
      ? "object"
      : "group";
  state.faceSelectionScope = nextScope;
  state.selectionScope = nextScope;
  if (faceMode) state.faceSelection.clear();
  else {
    state.mode = "selection";
    state.tool = "box";
    railButtons.forEach((item) =>
      item.classList.toggle("active", item.dataset.toolMode === "selection"),
    );
  }
  updateSelectionScopeToggle();
  setStatus(
    faceMode
      ? `${state.faceSelectionScope === "group" ? "Grouped inner, outer, top, or bottom faces" : "Single-face"} selection active`
      : `${state.selectionScope === "group" ? "Group" : "Object"} selection active`,
  );
  if (faceMode) changed();
  else redraw();
};
updateSelectionScopeToggle();
const textureAxesToggle = $("texture-axes-toggle");
function updateTextureAxesToggle() {
  textureAxesToggle.classList.toggle("active", state.showTextureAxes);
  textureAxesToggle.setAttribute("aria-pressed", String(state.showTextureAxes));
  textureAxesToggle.title = `${state.showTextureAxes ? "Hide" : "Show"} texture alignment`;
}
textureAxesToggle.onclick = () => {
  state.showTextureAxes = !state.showTextureAxes;
  updateTextureAxesToggle();
  redraw();
  setStatus(`Texture alignment ${state.showTextureAxes ? "shown" : "hidden"}`);
};
updateTextureAxesToggle();
const railDock = document.createElement("div");
railDock.className = "rail-dock";
const dockDivider = document.createElement("div");
dockDivider.className = "dock-divider";
dockDivider.title = "Drag to resize generator pane";
const facePanel = document.createElement("aside");
facePanel.className = "brush-panel";
facePanel.hidden = true;
facePanel.innerHTML = `<header><strong>FACE TOOLS</strong></header><label>Mode <select data-face-mode><option value="extrude">Extrude</option><option value="fill">Planar Fill</option></select><output data-face-mode-status>Live</output></label><label>Material <select data-face-material><option value="customdev/dev_measuregeneric01red">Generic Red</option><option value="customdev/dev_measuregeneric01blu">Generic Blue</option><option value="customdev/dev_measurewall01blu">Wall Blue</option><option value="customdev/dev_measurewall01red">Wall Red</option><option value="dev/dev_measuregeneric01b">Generic Gray</option><option value="dev/dev_measuregeneric01">Generic Orange</option><option value="dev/dev_measurewall01a">Wall A</option><option value="dev/dev_measurewall01d">Wall D</option><option value="dev/graygrid">Gray Grid</option><option value="tools/toolsnodraw">No Draw</option></select><output></output></label><div class="extrusion-toggles"><button type="button" class="extrusion-toggle" data-extrusion-parallel aria-pressed="false">Parallel</button><button type="button" class="extrusion-toggle" data-extrusion-snap aria-pressed="false">Snap</button></div><button type="button" data-fill-selected-loop hidden>Fill Selected Loop</button><button type="button" data-apply-face-material>Apply to Selected Faces</button>`;
facePanel.querySelector("[data-face-mode-status]")?.remove();
const materialLabel = facePanel
  .querySelector("[data-face-material]")
  ?.closest("label");
if (materialLabel)
  materialLabel.innerHTML =
    '<span>Side material</span><select data-face-side-material><option value="dev/dev_measuregeneric01">Orange</option><option value="dev/dev_measuregeneric01b">Gray</option></select><span>Top material</span><select data-face-top-material><option value="dev/dev_measuregeneric01b">Gray</option><option value="dev/dev_measuregeneric01">Orange</option></select>';
const parallelToggle = facePanel.querySelector("[data-extrusion-parallel]");
const snapToggle = facePanel.querySelector("[data-extrusion-snap]");
if (parallelToggle) {
  parallelToggle.classList.toggle(
    "active",
    state.faceExtrusionMode === "parallel",
  );
  parallelToggle.setAttribute(
    "aria-pressed",
    state.faceExtrusionMode === "parallel" ? "true" : "false",
  );
  parallelToggle.onclick = () => {
    state.faceExtrusionMode =
      state.faceExtrusionMode === "parallel" ? "normal" : "parallel";
  };
}
if (snapToggle) {
  snapToggle.classList.toggle("active", Boolean(state.faceSnapEnabled));
  snapToggle.setAttribute(
    "aria-pressed",
    state.faceSnapEnabled ? "true" : "false",
  );
  snapToggle.onclick = () => {
    state.faceSnapEnabled = !state.faceSnapEnabled;
  };
}
railDock.append(dockDivider, brushPanel, facePanel);
const railWidthGrip = document.createElement("div");
railWidthGrip.className = "rail-width-grip";
toolRail.append(railTools, railDock, railWidthGrip);
let railWidth = 132;
const editorMain = document.querySelector("main");
const railExpandedMinimum = 220;
const railToolsMinimumHeight = 108;
function setRailExpanded(expanded) {
  const width = expanded ? Math.max(railExpandedMinimum, railWidth) : 42;
  toolRail.classList.toggle("tool-active", expanded);
  editorMain.classList.toggle("rail-open", expanded);
  toolRail.style.setProperty("--rail-width", `${width}px`);
  editorMain.style.setProperty("--rail-overlay-width", `${width}px`);
}
let dockHideTimer = null;
let dockFadeTimer = null;
function showBrushDock() {
  if (state.mode === "brush") {
    clearTimeout(dockFadeTimer);
    clearTimeout(dockHideTimer);
    const availableHeight = toolRail.clientHeight - railToolsMinimumHeight;
    if (availableHeight < dockMinimumHeight) {
      railDock.classList.remove("available");
      return;
    }
    railDock.classList.remove("closing", "collapsed");
    brushPanel.hidden = false;
    facePanel.hidden = true;
    railDock.classList.add("available");
    toolRail.style.setProperty(
      "--dock-height",
      `${Math.min(dockHeight, availableHeight)}px`,
    );
  }
}
function showFaceDock() {
  if (state.mode !== "face") return;
  clearTimeout(dockFadeTimer);
  clearTimeout(dockHideTimer);
  const availableHeight = toolRail.clientHeight - railToolsMinimumHeight;
  if (availableHeight < dockMinimumHeight) {
    railDock.classList.remove("available");
    return;
  }
  brushPanel.hidden = true;
  facePanel.hidden = false;
  updateFaceToolMode();
  railDock.classList.remove("closing", "collapsed");
  railDock.classList.add("available");
  toolRail.style.setProperty(
    "--dock-height",
    `${Math.min(dockHeight, availableHeight)}px`,
  );
}
function hideBrushDock() {
  if (
    (state.mode === "brush" || state.mode === "face") &&
    railDock.classList.contains("available")
  ) {
    clearTimeout(dockFadeTimer);
    clearTimeout(dockHideTimer);
    dockFadeTimer = setTimeout(() => {
      if (!toolRail.matches(":hover")) railDock.classList.add("closing");
    }, 180);
    dockHideTimer = setTimeout(() => {
      if (!toolRail.matches(":hover"))
        railDock.classList.remove("available", "closing");
    }, 530);
  }
}
const applyMaterialBtn = facePanel.querySelector("[data-apply-face-material]");
if (applyMaterialBtn)
  applyMaterialBtn.onclick = () => {
    if (!state.faceSelection.size)
      return setStatus("Select one or more faces first", true);
    const sideMaterial = facePanel.querySelector(
      "[data-face-side-material]",
    ).value;
    const topMaterial = facePanel.querySelector(
      "[data-face-top-material]",
    ).value;
    let applied = 0;
    for (const id of state.faceSelection) {
      const match = id.match(/^(.*):f:(\d+)$/),
        brush = match && state.brushes.find((item) => item.id === match[1]),
        faceIndex = Number(match?.[2]);
      if (!brush || !brush.faces[faceIndex]) continue;
      brush.faceMaterials ||= brush.faces.map(
        () => brush.material || "tools/toolsnodraw",
      );
      const face = brush.faces[faceIndex];
      const a = brush.vertices[face[0]],
        b = brush.vertices[face[1]],
        c = brush.vertices[face[2]],
        normal = {
          x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
          y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
          z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
        };
      brush.faceMaterials[faceIndex] =
        Math.abs(normal.z) > Math.max(Math.abs(normal.x), Math.abs(normal.y))
          ? topMaterial
          : sideMaterial;
      applied++;
    }
    if (!applied) return setStatus("Selected faces no longer exist", true);
    changed();
    setStatus(`Applied side/top materials to ${applied} faces`);
  };
const faceModeSelect = facePanel.querySelector("[data-face-mode]");
function updateFaceToolMode() {
  faceModeSelect.value = state.faceToolMode;
  facePanel.querySelector("[data-fill-selected-loop]").hidden =
    state.faceToolMode !== "fill";
}
function setFaceToolMode(event) {
  event?.stopPropagation();
  const mode = event?.currentTarget?.value || faceModeSelect.value;
  if (mode === state.faceToolMode) return;
  state.faceToolMode = mode;
  updateFaceToolMode();
  setStatus(
    state.faceToolMode === "fill"
      ? "Planar Fill: select a closed vertical boundary loop, then Fill Selected Loop"
      : "Extrude: drag selected faces outward",
  );
  changed();
}
faceModeSelect.addEventListener("input", setFaceToolMode);
faceModeSelect.addEventListener("change", setFaceToolMode);
faceModeSelect.addEventListener("pointerdown", (event) =>
  event.stopPropagation(),
);
facePanel.querySelector("[data-fill-selected-loop]").onclick = () => {
  const result = fillSelectedLoop(state.brushes, state.faceSelection);
  if (!result.brushes.length)
    return setStatus(
      `Fill blocked: ${result.errors[0] || "no closed loop"}`,
      true,
    );
  applyNodrawToHiddenFaces(
    [...state.brushes, ...result.brushes],
    new Set(result.brushes.map((brush) => brush.id)),
  );
  add(
    result.brushes,
    `Filled loop with ${result.brushes.length} convex brushes`,
  );
};
updateFaceToolMode();
toolRail.addEventListener("mouseenter", () => {
  setRailExpanded(true);
  if (state.mode === "brush") showBrushDock();
  if (state.mode === "face") showFaceDock();
});
toolRail.addEventListener("mouseleave", () => {
  hideBrushDock();
  setRailExpanded(false);
});
let resizingRail = null;
const dockMinimumHeight = 140;
let dockHeight = 560;
dockDivider.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  dockDivider.setPointerCapture(event.pointerId);
  resizingRail = {
    type: "dock",
    start: event.clientY,
    height: railDock.getBoundingClientRect().height,
  };
});
railWidthGrip.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  railWidthGrip.setPointerCapture(event.pointerId);
  resizingRail = {
    type: "rail",
    start: event.clientX,
    width: toolRail.getBoundingClientRect().width,
  };
});
window.addEventListener("pointermove", (event) => {
  if (!resizingRail) return;
  if (resizingRail.type === "dock") {
    const maxHeight = Math.max(
      0,
      toolRail.clientHeight - railToolsMinimumHeight,
    );
    const requested =
      resizingRail.height - (event.clientY - resizingRail.start);
    const height = Math.max(0, Math.min(maxHeight, requested));
    if (height < dockMinimumHeight) {
      railDock.classList.add("collapsed");
    } else {
      dockHeight = height;
      railDock.classList.remove("collapsed");
      toolRail.style.setProperty("--dock-height", `${dockHeight}px`);
    }
  } else {
    railWidth = Math.max(
      railExpandedMinimum,
      Math.min(320, resizingRail.width + event.clientX - resizingRail.start),
    );
    toolRail.style.setProperty("--rail-width", `${railWidth}px`);
    editorMain.style.setProperty("--rail-overlay-width", `${railWidth}px`);
  }
});
window.addEventListener("pointerup", () => {
  resizingRail = null;
});
let brushShape = "block";
let brushDepth = 64;
let powerOfTwo = false;
const shapeSelect = brushPanel.querySelector("[data-shape]");
const startAngleLabel = document.createElement("label");
startAngleLabel.innerHTML =
  'Start Angle <input type="number" data-setting="startAngle" min="0" max="360" step="1" value="0"><output data-output="startAngle">0</output>';
shapeSelect.closest("label").after(startAngleLabel);
const archActions = document.createElement("div");
archActions.className = "arch-actions";
archActions.innerHTML = '<button type="button" data-circle>Circle</button>';
const arcLabel = brushPanel
  .querySelector('[data-setting="arc"]')
  .closest("label");
archActions.querySelector("[data-circle]").onclick = () => {
  const arcInput = brushPanel.querySelector('[data-setting="arc"]');
  arcInput.value = 360;
  arcInput.dispatchEvent(new Event("change", { bubbles: true }));
};
shapeSelect.onchange = () => {
  brushShape = shapeSelect.value;
  state.generator.shape = brushShape;
  const archSetting = brushPanel.querySelector("[data-arch-setting]");
  if (archSetting) archSetting.hidden = !["arch", "torus"].includes(brushShape);
  const widthInput = brushPanel.querySelector('[data-setting="width"]');
  if (widthInput) {
    widthInput.closest("label").firstChild.textContent =
      brushShape === "arch" ? "Wall width " : "Width ";
    widthInput.min = brushShape === "arch" ? 2 : 1;
  }
  const sidesInput = brushPanel.querySelector('[data-setting="segments"]');
  if (sidesInput) {
    sidesInput.closest("label").firstChild.textContent =
      brushShape === "arch" ? "Number of Sides " : "Sides ";
    sidesInput.max = brushShape === "arch" ? 2048 : 128;
  }
  for (const setting of ["radius", "rings"]) {
    const input = brushPanel.querySelector(`[data-setting="${setting}"]`);
    if (input)
      input.closest("label").style.display =
        brushShape === "arch" ? "none" : "";
  }
  for (const setting of ["depth", "height"]) {
    const input = brushPanel.querySelector(`[data-setting="${setting}"]`);
    if (input)
      input.closest("label").style.display =
        brushShape === "arch" ? "none" : "";
  }
  startAngleLabel.hidden = brushShape !== "arch";
  archActions.hidden = brushShape !== "arch";
  const elevationInput = brushPanel.querySelector('[data-setting="addHeight"]');
  if (elevationInput) {
    const elevationLabel = elevationInput.closest("label");
    elevationLabel.classList.toggle("enabled", brushShape === "arch");
    elevationLabel.firstChild.textContent =
      brushShape === "arch" ? "Add height " : "Elevation ";
  }
  if (brushShape === "arch") {
    archActions.append(arcLabel);
    const addHeightLabel = elevationInput.closest("label");
    [
      widthInput.closest("label"),
      sidesInput.closest("label"),
      archActions,
      startAngleLabel,
      addHeightLabel,
    ].forEach((control) =>
      brushPanel.insertBefore(
        control,
        brushPanel.querySelector("[data-generate]"),
      ),
    );
  } else {
    brushPanel.insertBefore(
      arcLabel,
      brushPanel.querySelector("[data-generate]"),
    );
  }
  brushPanel.querySelector("[data-generate]").hidden = brushShape === "arch";
  if (view.creationBox) view.onBrushPreview(view.creationBox);
};
shapeSelect.onchange();
brushPanel.querySelectorAll("[data-setting]").forEach(
  (input) =>
    (input.oninput = () => {
      let value =
        input.type === "checkbox" ? input.checked : Number(input.value);
      if (input.dataset.setting === "powerOfTwo") powerOfTwo = value;
      if (
        powerOfTwo &&
        ["width", "depth", "height", "radius"].includes(input.dataset.setting)
      )
        value = 2 ** Math.round(Math.log2(Math.max(1, value)));
      if (input.dataset.setting === "depth") brushDepth = value;
      if (input.dataset.setting in state.generator)
        state.generator[input.dataset.setting] = value;
      input.value = value;
      const output = brushPanel.querySelector(
        `[data-output="${input.dataset.setting}"]`,
      );
      if (output) output.value = value;
      if (view.creationBox) view.onBrushPreview(view.creationBox);
      brushPanel
        .querySelector(".advanced-setting")
        .classList.toggle(
          "enabled",
          Boolean(brushPanel.querySelector('[data-setting="sloped"]')?.checked),
        );
    }),
);
brushPanel.querySelectorAll("[data-setting]").forEach((input) => {
  input.onchange = input.oninput;
});
brushPanel.querySelector("[data-generate]").onclick = () => {
  if (brushShape === "block")
    add(
      [
        box(
          { x: -state.generator.width / 2, y: -brushDepth / 2, z: 0 },
          {
            x: state.generator.width / 2,
            y: brushDepth / 2,
            z: state.generator.height,
          },
        ),
      ],
      "Block created",
      true,
    );
  else {
    const settings = options();
    const generated =
      brushShape === "arch"
        ? generateArch({
            width: settings.radius * 2,
            height: settings.radius * 2,
            depth: settings.height,
            wallWidth: settings.width,
            sides: settings.segments,
            startAngle: settings.startAngle,
            arc: settings.arc,
            addHeight: settings.addHeight,
            grid: state.grid,
          })
        : brushShape === "cylinder"
          ? generateCylinder({
              radius: settings.radius,
              height: settings.height,
              segments: settings.segments,
              addHeight: settings.addHeight,
              grid: state.grid,
            })
          : brushShape === "sphere"
            ? generateSphere({
                radius: settings.radius,
                segments: settings.segments,
                rings: settings.rings,
                grid: state.grid,
              })
            : brushShape === "torus"
              ? generateTorus({
                  radius: settings.radius,
                  width: settings.width,
                  height: settings.height,
                  segments: settings.segments,
                  grid: state.grid,
                })
              : generateRing({
                  ...settings,
                  endAngle: settings.startAngle + 360,
                });
    add(
      generated,
      `${brushShape[0].toUpperCase()}${brushShape.slice(1)} created`,
      true,
    );
  }
};
const snapshot = () => ({
  extrusionModeVersion: 1,
  selectionScopeVersion: 1,
  brushes: clone(state.brushes),
  selection: [...state.selection],
  brushSelection: [...state.brushSelection],
  hiddenBrushes: [...state.hiddenBrushes],
  faceSelection: [...state.faceSelection],
  faceSelectionScope: state.faceSelectionScope,
  faceToolMode: state.faceToolMode,
  selectionScope: state.selectionScope,
  mode: state.mode,
  tool: state.tool,
  showTextureAxes: state.showTextureAxes,
  textureLock: state.textureLock,
  faceExtrusionMode: state.faceExtrusionMode,
  faceSnapEnabled: state.faceSnapEnabled,
});
function redraw() {
  view.kind = activeView;
  view.draw();
  $("view-selector").textContent = viewLabels[activeView];
  const selected =
    state.mode === "face"
      ? `${state.faceSelection.size} selected faces`
      : state.mode === "selection"
        ? `${state.brushSelection.size} selected objects`
        : `${state.selection.size} selected vertices`;
  $("stats").textContent =
    `${state.brushes.length} brush${state.brushes.length === 1 ? "" : "es"} · ${selected}`;
}
function changed() {
  history.push(snapshot());
  redraw();
}
function setStatus(text, error = false) {
  status.textContent = text;
  status.style.color = error ? "#ff8290" : "";
}
function ensureArchExtrusionMetadata(brushes) {
  const byId = new Map(brushes.map((brush) => [brush.id, brush]));
  for (const brush of brushes) {
    if (brush.generator?.type !== "arch" || brush.generator.extrusionCenter)
      continue;
    const source = brush.generator.sourceBrushId
      ? byId.get(brush.generator.sourceBrushId)
      : null;
    if (source?.generator?.extrusionCenter) {
      brush.generator.extrusionCenter = { ...source.generator.extrusionCenter };
      brush.generator.extrusionAxes = source.generator.extrusionAxes || [
        "x",
        "y",
      ];
      continue;
    }
    const group = brush.groupId || brush.id,
      grouped = brushes.filter(
        (item) =>
          item.generator?.type === "arch" &&
          (item.groupId || item.id) === group,
      ),
      points = grouped.flatMap((item) => item.vertices);
    if (points.length <= brush.vertices.length) continue;
    const axes = brush.generator.extrusionAxes || ["x", "y"];
    brush.generator.extrusionCenter = Object.fromEntries(
      axes.map((axis) => {
        const values = points.map((point) => point[axis]);
        return [axis, (Math.min(...values) + Math.max(...values)) / 2];
      }),
    );
    brush.generator.extrusionAxes = axes;
  }
}
function restore(data) {
  if (!data) return;
  state.brushes = data.brushes || [];
  ensureArchExtrusionMetadata(state.brushes);
  applyNodrawToHiddenFaces(state.brushes);
  state.selection = new Set(data.selection || []);
  state.brushSelection = new Set(data.brushSelection || []);
  state.hiddenBrushes = new Set(data.hiddenBrushes || []);
  state.faceSelection = new Set(data.faceSelection || []);
  state.faceSelectionScope =
    data.selectionScopeVersion === 1
      ? data.faceSelectionScope || "group"
      : "group";
  state.faceToolMode = data.faceToolMode || "extrude";
  state.faceExtrusionMode =
    data.extrusionModeVersion === 1
      ? data.faceExtrusionMode || "normal"
      : "normal";
  state.faceSnapEnabled = Boolean(data.faceSnapEnabled);
  state.selectionScope =
    data.selectionScopeVersion === 1 ? data.selectionScope || "group" : "group";
  state.mode = data.mode || "selection";
  state.tool = data.tool || "box";
  state.showTextureAxes = Boolean(data.showTextureAxes);
  state.textureLock = data.textureLock || "world";
  activeView = data.view || activeView;
  state.view = activeView;
  view.kind = activeView;
  updateSelectionScopeToggle();
  updateTextureAxesToggle();
  railButtons.forEach((item) =>
    item.classList.toggle("active", item.dataset.toolMode === state.mode),
  );
  if (data.camera) {
    view.scale = data.camera.scale || 1;
    view.offset = data.camera.offset || { x: 0, y: 0 };
  }
  $("grid").value = state.grid;
  redraw();
}
function saveHmrState() {
  try {
    sessionStorage.setItem(
      RELOAD_STATE_KEY,
      JSON.stringify({
        ...snapshot(),
        view: activeView,
        camera: { scale: view.scale, offset: view.offset },
        history: history.items,
        historyIndex: history.index,
      }),
    );
  } catch (error) {
    console.warn("[Hammer Prefab Tool] HMR state save failed", error);
  }
}
function restoreHmrState() {
  try {
    const raw = sessionStorage.getItem(RELOAD_STATE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(RELOAD_STATE_KEY);
    const data = JSON.parse(raw);
    restore(data);
    if (Array.isArray(data.history)) {
      history.items = data.history;
      history.index = data.historyIndex ?? data.history.length - 1;
    }
    return true;
  } catch (error) {
    sessionStorage.removeItem(RELOAD_STATE_KEY);
    console.warn("[Hammer Prefab Tool] HMR state restore failed", error);
    return false;
  }
}
function options() {
  const settings = state.generator;
  return {
    radius: settings.radius,
    width: settings.width,
    height: settings.height,
    segments: settings.segments,
    startAngle: settings.startAngle,
    endAngle: settings.startAngle + settings.arc,
    addHeight: settings.addHeight,
    bevel: settings.bevel,
    rings: settings.rings,
    grid: state.grid,
  };
}
function activateObjectMode() {
  state.mode = "selection";
  state.tool = "box";
  railDock.classList.remove("available");
  setRailExpanded(false);
  railButtons.forEach((item) =>
    item.classList.toggle("active", item.dataset.toolMode === "selection"),
  );
  updateSelectionScopeToggle();
}
function add(brushes, label, selectCreated = false) {
  const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  brushes.forEach((brush) => {
    brush.groupId = groupId;
  });
  state.brushes.push(...brushes);
  ensureArchExtrusionMetadata(state.brushes);
  applyNodrawToHiddenFaces(state.brushes);
  if (selectCreated) {
    state.selection.clear();
    state.faceSelection.clear();
    state.brushSelection = new Set(brushes.map((brush) => brush.id));
    activateObjectMode();
  }
  changed();
  setStatus(`${label}: ${brushes.length} snapped brush segments`);
}
function setGrid(delta) {
  const index = Math.max(
    0,
    Math.min(GRID_VALUES.length - 1, GRID_VALUES.indexOf(state.grid) + delta),
  );
  state.grid = GRID_VALUES[index];
  $("grid").value = state.grid;
  document.querySelector(".menu-note").textContent =
    `Current grid: ${state.grid}. Use [ and ] to change.`;
  redraw();
}
function clearVMF() {
  if (!state.brushes.length) return;
  state.brushes = [];
  state.selection.clear();
  state.brushSelection.clear();
  state.faceSelection.clear();
  changed();
  setStatus("VMF cleared");
}
function validate() {
  const issues = validateAll(state.brushes);
  setStatus(
    issues.length
      ? `Validation: ${issues[0]}`
      : `Validated ${state.brushes.length} brush solids${state.brushes.length ? "" : " (empty)"}`,
    !!issues.length,
  );
  return issues;
}
async function exportVMF() {
  const path = prompt("VMF filename:", "prefab.vmf");
  if (!path) return;
  try {
    const issues = validate();
    if (issues.length) return;
    const result = await api.exportVMF(
      path.endsWith(".vmf") ? path : `${path}.vmf`,
      writeVMF(state.brushes),
    );
    setStatus(`Exported ${result.path}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
function wildcard(expression) {
  return new RegExp(
    `^${expression
      .trim()
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  );
}
function filterFiles() {
  const query = search.value.trim();
  const matcher = query ? wildcard(query) : null;
  visibleFiles = allFiles.filter((file) => !matcher || matcher.test(file.name));
  browserSelected = null;
  renderBrowser();
}
function renderBrowser() {
  const list = $("browser-list");
  if (!visibleFiles.length) {
    list.innerHTML = `<p class="browser-empty">No VMF files match this search.</p>`;
    return;
  }
  list.innerHTML = visibleFiles
    .map(
      (file, index) =>
        `<button type="button" data-file="${index}" class="${browserSelected?.name === file.name ? "active" : ""}"><span>${escapeHtml(file.name)}</span><small>${new Date(file.modified).toLocaleString()} · ${file.size} B</small></button>`,
    )
    .join("");
  list.querySelectorAll("[data-file]").forEach((button) => {
    button.onclick = () => {
      browserSelected = visibleFiles[+button.dataset.file];
      renderBrowser();
    };
    button.ondblclick = loadSelected;
  });
}
async function openBrowser() {
  browserSelected = null;
  search.value = "";
  $("browser-status").textContent = "Loading...";
  browser.showModal();
  try {
    allFiles = (await api.files("export")).files.filter((file) =>
      file.name.toLowerCase().endsWith(".vmf"),
    );
    visibleFiles = allFiles;
    renderBrowser();
    $("browser-status").textContent =
      `${allFiles.length} VMF file${allFiles.length === 1 ? "" : "s"} · double-click to open`;
    search.focus();
  } catch (error) {
    allFiles = [];
    visibleFiles = [];
    renderBrowser();
    $("browser-status").textContent = error.message;
  }
}
async function loadSelected() {
  if (!browserSelected) return;
  try {
    const result = await api.openVMF(browserSelected.name, "export");
    state.brushes = parseVMF(result.vmf);
    state.selection = new Set();
    state.brushSelection = new Set();
    state.faceSelection = new Set();
    history.push(snapshot());
    redraw();
    view.focus();
    browser.close();
    const groupCount = new Set(
        state.brushes.map((brush) => brush.groupId).filter(Boolean),
      ).size,
      gridReport = countOffGridCoordinates(state.brushes, state.grid);
    setStatus(
      `Opened ${result.path}: ${state.brushes.length} brushes · ${groupCount} groups · ${gridReport.offGrid}/${gridReport.total} coordinates off grid ${state.grid}`,
      gridReport.offGrid > 0,
    );
  } catch (error) {
    $("browser-status").textContent = error.message;
  }
}
function commitFaceExtrusion(
  selection = state.faceSelection,
  distance = null,
  guideSelection = selection,
  mode = state.faceExtrusionMode,
  snapTarget = null,
) {
  state.faceSelection = new Set(selection);
  if (!state.faceSelection.size)
    return setStatus("Select one or more faces first", true);
  if (distance == null)
    distance = Number(
      prompt(
        "Extrusion distance along the selected extrusion direction:",
        String(state.grid * 2),
      ),
    );
  if (!Number.isFinite(distance) || distance <= 0)
    return setStatus("Extrusion distance must be greater than zero", true);
  distance = limitExtrusionDistance(
    state.brushes,
    state.faceSelection,
    distance,
    state.grid,
    guideSelection,
    mode,
    snapTarget,
  );
  if (distance <= 0.0001)
    return setStatus("Extrusion blocked by an adjacent brush", true);
  const result = extrudeSelectedFaces(
    state.brushes,
    state.faceSelection,
    distance,
    state.grid,
    guideSelection,
    mode,
    snapTarget,
  );
  if (!result.brushes.length)
    return setStatus(
      `Extrusion rejected: ${result.errors[0] || "no valid faces"}`,
      true,
    );
  applyNodrawToHiddenFaces(
    [...state.brushes, ...result.brushes],
    new Set(result.brushes.map((brush) => brush.id)),
  );
  state.faceSelection = new Set(
    result.brushes.map((brush) => `${brush.id}:f:1`),
  );
  add(result.brushes, "Faces extruded");
  setStatus(
    `Extruded ${result.brushes.length} face${result.brushes.length === 1 ? "" : "s"} by ${distance} units${result.errors.length ? `; ${result.errors.length} rejected` : ""}`,
    Boolean(result.errors.length),
  );
}
function run(command) {
  if (command === "select-none") {
    state.selection.clear();
    state.brushSelection.clear();
    state.faceSelection.clear();
    changed();
    setStatus("Selection cleared");
  }
  if (command === "delete") {
    const ids = new Set(state.brushSelection);
    state.selection.forEach((vertexId) => ids.add(vertexId.split(":v:")[0]));
    state.faceSelection.forEach((faceId) => ids.add(faceId.split(":f:")[0]));
    if (!ids.size)
      return setStatus("Select brushes, faces, or vertices first", true);
    state.brushes = state.brushes.filter((brush) => !ids.has(brush.id));
    state.selection.clear();
    state.brushSelection.clear();
    state.faceSelection.clear();
    changed();
    setStatus(`Deleted ${ids.size} brush${ids.size === 1 ? "" : "es"}`);
  }
  if (command === "block") add([box()], "Block created", true);
  if (command === "ring") {
    const settings = options();
    add(
      generateRing({
        ...settings,
        bevel: 0,
        endAngle: settings.startAngle + 360,
      }),
      "Ring created",
      true,
    );
  }
  if (command === "arch") {
    shapeSelect.value = "arch";
    shapeSelect.onchange();
    state.mode = "brush";
    redraw();
    setStatus(
      "Drag an Arch bounding box; press Enter to create or Escape to cancel",
    );
  }
  if (command === "extrude-faces") commitFaceExtrusion();
  if (command === "nodraw-hidden") {
    const count = applyNodrawToHiddenFaces(state.brushes, state.brushSelection);
    if (count) changed();
    else redraw();
    setStatus(
      count
        ? `Applied nodraw to ${count} fully hidden face${count === 1 ? "" : "s"}`
        : "No fully hidden faces found",
      !count,
    );
  }
  if (command === "undo") restore(history.undo());
  if (command === "redo") restore(history.redo());
  if (command === "center") {
    view.focus();
    setStatus("Preview fitted to geometry");
  }
  if (command === "world") {
    view.centerWorld();
    setStatus("World origin centered");
  }
  if (command === "validate") validate();
  if (command === "clear") clearVMF();
  if (command === "grid-down") setGrid(-1);
  if (command === "grid-up") setGrid(1);
  if (command === "snap-grid") {
    const moved = snapAllVertices(state.brushes, state.grid);
    if (moved) changed();
    else redraw();
    setStatus(
      moved
        ? `Snapped ${moved} vertex coordinates to grid ${state.grid}`
        : `All vertices are already on grid ${state.grid}`,
    );
  }
  if (command === "align-center" || command === "align-outer") {
    const outer = command === "align-outer",
      count = outer
        ? alignAllFacesToOuter(state.brushes)
        : alignAllFacesToCenter(state.brushes);
    if (count) changed();
    else redraw();
    setStatus(
      count
        ? `${outer ? "Outer" : "Center"}-aligned ${count} face${count === 1 ? "" : "s"}`
        : `No faces could be ${outer ? "outer" : "center"}-aligned`,
      !count,
    );
  }
  if (command === "select-inner") {
    state.selection = new Set(ringVertexIds(state.brushes, "inner"));
    changed();
    setStatus(`${state.selection.size} inner-ring vertices selected`);
  }
  if (command === "select-outer") {
    state.selection = new Set(ringVertexIds(state.brushes, "outer"));
    changed();
    setStatus(`${state.selection.size} outer-ring vertices selected`);
  }
  if (command === "scale") {
    const bounds = selectionBounds(state);
    if (!bounds) return setStatus("Select vertices first", true);
    const pivot = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    const factor = Number(prompt("Scale factor:", "1.1"));
    if (!Number.isFinite(factor)) return;
    const before = clone(state.brushes);
    scaleVertices(state, pivot, { x: factor, y: factor, z: factor });
    const issues = validateAll(state.brushes);
    if (issues.length) {
      state.brushes = before;
      return setStatus(`Scale rejected: ${issues[0]}`, true);
    }
    changed();
    setStatus(
      `Scaled ${state.selection.size} vertices around selection center`,
    );
  }
  if (command === "inner-radius" || command === "outer-radius") {
    const radius = Number(
      prompt("Radius:", command === "inner-radius" ? "224" : "288"),
    );
    if (!Number.isFinite(radius) || radius <= 0) return;
    const before = clone(state.brushes);
    const count = setRingRadius(
      state,
      radius,
      command === "inner-radius" ? "inner" : "outer",
    );
    const issues = validateAll(state.brushes);
    if (issues.length) {
      state.brushes = before;
      return setStatus(`Radius change rejected: ${issues[0]}`, true);
    }
    if (count) changed();
    setStatus(
      `${command === "inner-radius" ? "Inner" : "Outer"} radius set for ${count} vertices`,
    );
  }
  if (command === "export") exportVMF();
}

$("grid").onchange = (event) => {
  state.grid = +event.target.value;
  document.querySelector(".menu-note").textContent =
    `Current grid: ${state.grid}. Use [ and ] to change.`;
  redraw();
};
$("view-selector").onclick = () => {
  activeView =
    viewNames[(viewNames.indexOf(activeView) + 1) % viewNames.length];
  state.view = activeView;
  redraw();
  setStatus(`View: ${viewLabels[activeView]}`);
};
$("key-toggle").onclick = () => {
  const key = $("editor-key");
  const open = !key.classList.contains("open");
  key.classList.toggle("open", open);
  key.setAttribute("aria-hidden", String(!open));
  $("key-toggle").setAttribute("aria-expanded", String(open));
  $("key-toggle").title = open
    ? "Hide controls and key"
    : "Show controls and key";
};
$("open-browser").onclick = openBrowser;
search.oninput = filterFiles;
search.onkeydown = (event) => {
  if (event.key === "Enter" && browserSelected) {
    event.preventDefault();
    loadSelected();
  }
};
document
  .querySelectorAll("[data-command]")
  .forEach((button) => (button.onclick = () => run(button.dataset.command)));
const contextMenu = $("context-menu");
$("editor").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.add("open");
});
document.addEventListener("pointerdown", (event) => {
  if (!contextMenu.contains(event.target)) contextMenu.classList.remove("open");
});
contextMenu.querySelectorAll("[data-command]").forEach(
  (button) =>
    (button.onclick = () => {
      run(button.dataset.command);
      contextMenu.classList.remove("open");
    }),
);
const menus = [...document.querySelectorAll(".drop-menu")];
function closeMenus() {
  menus.forEach((item) => item.classList.remove("open"));
  document
    .querySelectorAll("[data-menu]")
    .forEach((item) => item.classList.remove("active"));
}
document.querySelectorAll("[data-menu]").forEach((button) =>
  button.addEventListener("mouseenter", () => {
    if (!menus.some((menu) => menu.classList.contains("open"))) return;
    const menu = $(button.dataset.menu);
    menus.forEach((item) => item.classList.remove("open"));
    document
      .querySelectorAll("[data-menu]")
      .forEach((item) => item.classList.remove("active"));
    menu.classList.add("open");
    button.classList.add("active");
    menu.style.left = `${button.getBoundingClientRect().left}px`;
  }),
);
document.querySelectorAll("[data-menu]").forEach(
  (button) =>
    (button.onclick = (event) => {
      event.stopPropagation();
      const menu = $(button.dataset.menu);
      const opening = !menu.classList.contains("open");
      menus.forEach((item) => item.classList.remove("open"));
      document
        .querySelectorAll("[data-menu]")
        .forEach((item) => item.classList.remove("active"));
      if (opening) {
        menu.classList.add("open");
        button.classList.add("active");
        menu.style.left = `${button.getBoundingClientRect().left}px`;
      }
    }),
);
document.addEventListener("pointermove", (event) => {
  if (
    menus.some((menu) => menu.classList.contains("open")) &&
    !event.target.closest(".menu-bar") &&
    !event.target.closest(".drop-menu")
  )
    closeMenus();
});
document.addEventListener("pointerdown", (event) => {
  if (
    !event.target.closest(".menu-bar") &&
    !event.target.closest(".drop-menu")
  ) {
    menus.forEach((item) => item.classList.remove("open"));
    document
      .querySelectorAll("[data-menu]")
      .forEach((item) => item.classList.remove("active"));
  }
});
window.addEventListener("keydown", (event) => {
  if (browser.open && event.key === "Escape") {
    browser.close();
    return;
  }
  if (event.key === "Escape" && view.cancelInteraction()) {
    setStatus("Interaction cancelled");
    return;
  }
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName))
    return;
  const key = event.key.toLowerCase();
  if (event.key === "Delete") {
    event.preventDefault();
    run("delete");
    return;
  }
  if (event.key === "Enter") {
    if (view.commitCreation()) return;
    setStatus(`${state.selection.size} vertices selected`);
    return;
  }
  if (key === "e" && state.mode === "face") {
    event.preventDefault();
    if (state.faceToolMode === "fill")
      facePanel.querySelector("[data-fill-selected-loop]").click();
    else run("extrude-faces");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "o") {
    event.preventDefault();
    openBrowser();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    run("export");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    run(event.shiftKey ? "redo" : "undo");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    run("redo");
    return;
  }
  if (key === "b") run("block");
  if (key === "s") {
    event.preventDefault();
    activateObjectMode();
    redraw();
    setStatus("Object selection active; drag yellow resize handles to resize");
    return;
  }
  if (key === "r") run("ring");
  if (key === "a") run("arch");
  if (key === "h") {
    event.preventDefault();
    const selected = new Set(state.brushSelection);
    state.selection.forEach((id) => selected.add(id.split(":v:")[0]));
    state.faceSelection.forEach((id) => selected.add(id.split(":f:")[0]));
    if (!selected.size)
      return setStatus(
        "Select objects, faces, or vertices to keep visible",
        true,
      );
    state.hiddenBrushes = new Set(
      state.brushes
        .filter((brush) => !selected.has(brush.id))
        .map((brush) => brush.id),
    );
    changed();
    setStatus(
      `Hidden ${state.hiddenBrushes.size} brushes; ${selected.size} remain visible`,
    );
    return;
  }
  if (key === "u") {
    event.preventDefault();
    const count = state.hiddenBrushes.size;
    state.hiddenBrushes.clear();
    changed();
    setStatus(
      count ? `Unhid ${count} brushes` : "All brushes are already visible",
    );
    return;
  }
  if (key === "f") run("center");
  if (event.key === "Home") run("world");
  if (key === "[") setGrid(-1);
  if (key === "]") setGrid(1);
  if (
    event.key.startsWith("Arrow") &&
    (state.mode === "selection" || state.mode === "vertex")
  ) {
    event.preventDefault();
    const selected =
      state.mode === "vertex"
        ? state.selection.size
        : state.brushSelection.size;
    if (!selected) return setStatus("Select objects or vertices first", true);
    const [horizontal, vertical] = view.axes();
    const axis =
      event.key === "ArrowLeft" || event.key === "ArrowRight"
        ? horizontal
        : vertical;
    nudge(
      state,
      axis,
      (event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1) *
        state.grid *
        (event.shiftKey ? 8 : 1),
    );
    changed();
    setStatus(
      `Nudged ${selected} ${state.mode === "vertex" ? "vertices" : "objects"} ${event.shiftKey ? state.grid * 8 : state.grid} units`,
    );
  }
});
if (import.meta.hot) {
  hmrIndicator.dataset.state = "connected";
  hmrIndicator.title = "Development HMR connected";
  import.meta.hot.on("vite:beforeUpdate", () => {
    hmrIndicator.dataset.state = "reloading";
    hmrIndicator.title = "HMR update pending";
  });
  import.meta.hot.on("vite:afterUpdate", () => {
    hmrIndicator.dataset.state = "connected";
    hmrIndicator.title = "Development HMR connected";
  });
  import.meta.hot.on("vite:error", () => {
    hmrIndicator.dataset.state = "offline";
    hmrIndicator.title = "HMR error";
  });
  import.meta.hot.on("vite:beforeFullReload", saveHmrState);
}
async function start() {
  try {
    await api.config();
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  }
  if (!state.__initialized && !restoreHmrState()) {
    state.brushes = [];
    history.push(snapshot());
  }
  state.__initialized = true;
  redraw();
}
start();
