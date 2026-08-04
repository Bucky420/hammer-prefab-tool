import { HP } from "./namespace.js";
import { api } from "./api.js";
import {
  box,
  clone,
  snapAllVertices,
  countOffGridCoordinates,
} from "./geometry-model.js";
import { generateRing } from "./ring-generator.js";
import { buildStagedBrushes } from "./brush-tool.js";
import { bindBrushPanel, createBrushPanel } from "./brush-panel.js";
import { generateHallway } from "./hallway-generator.js";
import {
  acquireNearestPathSource,
  acquirePathSource,
} from "./path-source-acquisition.js";
import { validateAll } from "./brush-validation.js";
import { History } from "./history.js";
import { Viewport } from "./viewport.js";
import { VMF_EXPORT_PURPOSE, writeVMFDocument } from "./vmf-writer.js";
import { parseVMFDocument } from "./vmf-parser.js";
import {
  alignAllFacesToCenter,
  alignAllFacesToOuter,
} from "./texture-alignment.js";
import { GRID_VALUES, roundToGrid } from "./grid.js";
import { ringVertexIds } from "./selection.js";
import { applyNodrawToHiddenFaces } from "./nodraw.js";
import { fillSelectedLoop } from "./face-fill.js";
import { bindExtrusionModeButtons } from "./extrusion-policy.js";
import { assignExtrusionBrushIds, resolveExtrusion } from "./face-extrusion.js";
import { createProject, normalizeProject } from "./project-format.js";
import {
  canonicalProjectHash,
  createDirtyStateService,
} from "./dirty-state.js";
import {
  downloadText,
  FILE_KINDS,
  readSingleBrowserFile,
  vmfFilename,
} from "./files/browser-files.js";
import {
  createFileSystemAccessAdapter,
  openVmfFile,
  saveVmfFile,
} from "./files/file-system-access.js";
import { createLocalServerFileAdapter } from "./files/local-server-files.js";
import { createProjectStore } from "./storage/project-store.js";
import {
  createSharedPrefabBackingBrushes,
  writeRingPrefabVMF,
} from "./ring-export.js";
import {
  createVmfSourceIdentity,
  findMatchingAutosave,
} from "./autosave-recovery.js";

/**
 * @typedef {import("./face-extrusion.js").ResolvedExtrusion} ResolvedExtrusion
 */

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
state.squareBox ??= localStorage.getItem("squareBox") === "1";
state.faceSelectionScope ||= "group";
state.faceToolMode ||= "extrude";
state.pathSettings ||= {};
state.pathSettings = {
  type: "hallway",
  interiorWidth: 128,
  interiorHeight: 128,
  wallThickness: 16,
  floorThickness: 16,
  ceilingThickness: 16,
  baseElevation: 0,
  segmentMode: "spline",
  maxAngleDegrees: 10,
  maxSegmentLength: 64,
  chordError: 1,
  snapEnds: true,
  flare: 0,
  blendLength: 128,
  materials: {
    floor: "dev/dev_measuregeneric01b",
    wall: "dev/dev_measurewall01a",
    ceiling: "dev/dev_measuregeneric01b",
  },
  ...state.pathSettings,
  materials: {
    floor: "dev/dev_measuregeneric01b",
    wall: "dev/dev_measurewall01a",
    ceiling: "dev/dev_measuregeneric01b",
    ...state.pathSettings.materials,
  },
};
state.entities ||= [];
state.groups ||= [];
state.ringMaterialRoles ||= {};
state.ringSettings ||= {};
state.projectSettings ||= {};
state.projectSettings.prefab ||= {
  ownership: "func_detail",
  backing: "none",
};
state.vmf ||= {};
const history = state.history || (state.history = new History());
const status = $("status");
document.querySelector(".live-indicator")?.remove();
let hmrIndicator = null;
if (import.meta.hot) {
  hmrIndicator = document.createElement("span");
  hmrIndicator.className = "live-indicator";
  hmrIndicator.dataset.state = "connecting";
  hmrIndicator.title = "Development reload connecting";
  document.querySelector("header").append(hmrIndicator);
}
const storageMode =
  new URLSearchParams(location.search).get("storage") === "server"
    ? "server"
    : "browser";
const fileSystem = createFileSystemAccessAdapter(window);
const fileAccessWarning = $("file-access-warning");
const fileAccessWarningText = $("file-access-warning-text");
const fileAccessHelp = $("file-access-help");
const braveFileAccessUrl = "brave://flags/#file-system-access-api";
async function updateFileAccessWarning() {
  if (
    window.self !== window.top ||
    fileSystem.supported ||
    storageMode === "server"
  )
    return;
  let isBrave = false;
  try {
    isBrave = (await navigator.brave?.isBrave?.()) === true;
  } catch {
    // Browser detection is advisory only.
  }
  fileAccessWarningText.textContent = isBrave
    ? "Brave has its File System Access API disabled. Click the address, paste it into the address bar, enable the flag, and relaunch Brave."
    : "This browser cannot overwrite opened files. Use Chrome or Edge for direct Ctrl+S saving.";
  fileAccessHelp.hidden = !isBrave;
  fileAccessWarning.hidden = false;
  document.body.classList.add("file-access-warning-visible");
}
fileAccessHelp.onclick = async () => {
  try {
    await navigator.clipboard.writeText(braveFileAccessUrl);
    setStatus("Brave File System Access flag address copied");
  } catch {
    window.prompt("Copy this address into Brave", braveFileAccessUrl);
  }
};
void updateFileAccessWarning();
const serverFiles =
  storageMode === "server" ? createLocalServerFileAdapter(api) : null;
const dirtyState = createDirtyStateService();
let cleanProject = null;
let vmfHandle = null;
let documentKind = "prefab";
let sourceIdentity = null;
let directSaveAllowed = false;
let documentSessionId = crypto.randomUUID();
let autosaveStore = null;
let autosaveSnapshots = [];
let autosaveTimer = null;
let autosaveDebounce = null;
let autosaveIntervalMs = 30000;
let reloadAfterAutosave = false;
const UPDATE_RECOVERY_KEY = "hammer-pending-update-snapshot";
function describeUIError(error, fallbackMessage = "Unknown UI error") {
  const message = error?.message || String(error || fallbackMessage);
  const stack = error?.stack;
  return stack ? `${message}\n${stack}` : message;
}
window.addEventListener("error", (event) => {
  const location = event.filename
    ? ` (${event.filename}:${event.lineno || 0}:${event.colno || 0})`
    : "";
  const details = describeUIError(event.error, event.message);
  console.error(`[UI error]${location}`, event.error || event.message);
  if (status)
    setTimeout(() => setStatus(`UI error${location}: ${details}`, true), 0);
});
window.addEventListener("unhandledrejection", (event) => {
  const details = describeUIError(event.reason);
  console.error("[UI unhandled rejection]", event.reason);
  if (status) setTimeout(() => setStatus(`UI error: ${details}`, true), 0);
});
const browser = $("project-browser");
const search = $("file-search");
search.value = localStorage.getItem("hammer-vmf-search") || "";
const viewNames = ["top", "front", "side"];
const viewLabels = { top: "TOP / XY", front: "FRONT / YZ", side: "SIDE / XZ" };
let activeView = state.view || "top";
const view = new Viewport(
  $("editor"),
  activeView,
let brushPanelController = null;
  state,
  (changeType) => {
    if (changeType === "selection-commit") changed("session");
    else if (changeType === "duplicate-commit") {
      changed("document");
      setStatus("Duplicated selected brushes");
    } else if (changeType === "brush-preview") {
      redraw();
      setStatus(
        `${state.generator.shape[0].toUpperCase()}${state.generator.shape.slice(1)} preview ready; drag grid handles to adjust, Enter to create, or Escape to cancel`,
      brushPanelController?.syncStagedSettings();
      );
    } else if (changeType === "brush-created") {
      redraw();
    } else if (changeType === "path-preview") {
      redraw();
      setStatus(
        view.pathPreviewErrors[0] ||
          `${view.pathPoints.length} path point${view.pathPoints.length === 1 ? "" : "s"}; Enter commits, Backspace removes the last point`,
        Boolean(view.pathPreviewErrors.length),
      );
    } else if (changeType === "path-top-view-required") {
      setStatus(
        "Add hallway points in Top view; use Front or Side to edit elevations",
        true,
      );
    } else if (changeType === "path-source-acquired") {
      state.pathSettings.interiorWidth =
        view.pathSourceAttachment.interiorWidth;
      state.pathSettings.baseElevation = view.pathSourceAttachment.elevation;
      updatePathControls();
      redraw();
      setStatus(
        `Hallway start matched to ${view.pathSourceBrushIds.length} selected floor brush${view.pathSourceBrushIds.length === 1 ? "" : "es"}`,
      );
    } else if (
      typeof changeType === "string" &&
      changeType.startsWith("path-source-invalid:")
    ) {
      setStatus(changeType.slice("path-source-invalid:".length), true);
    } else if (changeType === "path-control-selected") {
      updatePathControls();
      redraw();
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
  (resolved) => commitFaceExtrusion(resolved),
  (bounds) => {
    view.creationPreviewBrushes = buildBrushesFromBounds(bounds) || [];
    view.requestDraw();
  },
  (path, assemblyId, sourceAttachment, endAttachment) =>
    generateHallway({
      path,
      assemblyId,
      sourceAttachment,
      endAttachment,
      ...state.pathSettings,
      grid: state.grid,
    }),
  ({ assemblyId, brushes }) => commitHallway(assemblyId, brushes),
  (pointer, sourceBrushIds) =>
    acquirePathSource(
      state.brushes.filter((brush) => sourceBrushIds.includes(brush.id)),
      pointer,
      Number(state.pathSettings.wallThickness),
      0.01,
    ),
  (pointer, sourceBrushIds, assemblyId) => {
    const radius = Math.max(state.grid, 14 / Math.max(view.scale, 0.0001));
    return acquireNearestPathSource(
      state.brushes.filter(
        (brush) =>
          !sourceBrushIds.includes(brush.id) &&
          brush.assemblyId !== assemblyId &&
          brush.generator?.type !== "hallway" &&
          !state.hiddenBrushes.has(brush.id),
      ),
      pointer,
      Number(state.pathSettings.wallThickness),
      radius,
      0.01,
    );
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
      `${state.generator.shape[0].toUpperCase()}${state.generator.shape.slice(1)} created`,
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
  const result = buildStagedBrushes({
    bounds,
    shape: state.generator.shape,
    settings: state.generator,
    grid: state.grid,
    selectedVertices,
    brushDepth: brushPanelController?.brushDepth || 64,
  });
  if (result.error) return setStatus(result.error, true);
  return result.brushes;
}
document.querySelector(".tool-rail")?.remove();
document.querySelector(".brush-panel")?.remove();
const toolRail = document.createElement("aside");
toolRail.className = "tool-rail";
const railSizeObserver = new ResizeObserver((entries) => {
  const width = entries[0].contentRect.width;
  toolRail.classList.toggle("compact", width < 56);
});
toolRail.innerHTML = `<button type="button" data-tool-mode="selection" title="Object selection tool"><svg viewBox="0 0 24 24"><path d="M5 3l12 10-6 1-3 7-3-18z"/></svg><span>Object</span></button><button type="button" data-tool-mode="brush" title="Brush tool"><svg viewBox="0 0 24 24"><path d="M4 18h16M6 14h12V5H6z"/></svg><span>Brush</span></button><button type="button" data-tool-mode="path" title="Path generator tool"><svg viewBox="0 0 24 24"><path d="M4 18l5-10 6 8 5-11"/><circle cx="4" cy="18" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="16" r="1.5"/><circle cx="20" cy="5" r="1.5"/></svg><span>Path</span></button><button type="button" data-tool-mode="face" title="Face selection and extrusion"><svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4zM4 7v9l8 5v-10M20 7v9l-8 5"/></svg><span>Face</span></button><button type="button" data-tool-mode="vertex" title="Vertex editing"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19M5 5h14v14H5z"/></svg><span>Vertex</span></button>`;
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
      } else if (mode === "path") {
        state.mode = "path";
        state.tool = "path";
        setRailExpanded(true);
        showPathDock();
        const selectedHallway = state.brushes.find(
          (brush) =>
            state.brushSelection.has(brush.id) &&
            brush.generator?.type === "hallway",
        );
        if (selectedHallway) {
          state.pathSettings = {
            ...state.pathSettings,
            ...clone(selectedHallway.generator.settings || {}),
            baseElevation:
              selectedHallway.generator.path?.nodes?.[0]?.z ??
              selectedHallway.generator.path?.[0]?.z ??
              0,
          };
          const attachmentExists = (attachment) =>
            attachment?.sourceBrushIds?.length &&
            attachment.sourceBrushIds.every((id) =>
              state.brushes.some((brush) => brush.id === id),
            );
          const sourceAttachment = attachmentExists(
            selectedHallway.generator.sourceAttachment,
          )
            ? selectedHallway.generator.sourceAttachment
            : null;
          const endAttachment = attachmentExists(
            selectedHallway.generator.endAttachment,
          )
            ? selectedHallway.generator.endAttachment
            : null;
          const persistedAttachment = sourceAttachment || endAttachment;
          if (persistedAttachment) {
            state.pathSettings.flare = Number(persistedAttachment.flare) || 0;
            state.pathSettings.blendLength =
              Number(persistedAttachment.blendLength) ||
              state.pathSettings.blendLength;
          }
          view.setPath(
            selectedHallway.generator.path,
            selectedHallway.assemblyId || selectedHallway.generator.assemblyId,
            {
              sourceBrushIds:
                sourceAttachment?.sourceBrushIds || [],
              sourceAttachment,
              endAttachment,
            },
          );
          updatePathControls();
          setStatus("Editing hallway path; Enter applies changes");
        } else {
          const sourceBrushIds = [...state.brushSelection].filter((id) =>
            state.brushes.some(
              (brush) => brush.id === id && brush.generator?.type !== "hallway",
            ),
          );
          view.setPath([], `hallway-assembly-${crypto.randomUUID()}`, {
            sourceBrushIds,
          });
          setStatus(
            sourceBrushIds.length
              ? "Move toward the exit side to preview the selected floor mouth; click to start"
              : "Click points in Top view to draw a spline hallway centerline",
            sourceBrushIds.length > 2,
          );
        }
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

state.generator ||= {
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
state.grid ||= 16;
state.vmfFilename =
  localStorage.getItem("hammer-vmf-filename") || state.vmfFilename;
const brushPanel = createBrushPanel(state.grid);
toolRail.append(brushPanel);
const prefabOwnershipInput = brushPanel.querySelector(
  "[data-prefab-ownership]",
);
const prefabBackingInput = brushPanel.querySelector("[data-prefab-backing]");
prefabOwnershipInput.value = state.projectSettings.prefab.ownership;
prefabBackingInput.value = state.projectSettings.prefab.backing;
for (const input of [prefabOwnershipInput, prefabBackingInput]) {
  input.onchange = () => {
    state.projectSettings.prefab = {
      ownership: prefabOwnershipInput.value,
      backing: prefabBackingInput.value,
    };
    changed("document", false);
    setStatus("Prefab save settings updated");
  };
}
brushPanelController = bindBrushPanel({ panel: brushPanel, state, view });
const railButtons = [...toolRail.querySelectorAll("[data-tool-mode]")];
const railTools = document.createElement("div");
railTools.className = "rail-tools";
railButtons.forEach((button) => railTools.append(button));
const selectionScopeToggle = $("selection-scope-toggle");
const selectionModeToggle = $("selection-mode-toggle");
const selectionScopes = ["solid", "object", "group"];
const selectionScopeLabels = {
  solid: "Solids",
  object: "Objects",
  group: "Groups",
};
function updateSelectionScopeToggle() {
  const faceMode = state.mode === "face";
  selectionScopeToggle.hidden = !faceMode;
  selectionModeToggle.hidden = faceMode;
  selectionModeToggle.dataset.scope = state.selectionScope;
  const currentIndex = selectionScopes.indexOf(state.selectionScope);
  const nextScope = selectionScopes[(currentIndex + 1) % selectionScopes.length];
  const title = `${selectionScopeLabels[state.selectionScope]} selection; click for ${selectionScopeLabels[nextScope]}`;
  selectionModeToggle.title = title;
  selectionModeToggle.setAttribute("aria-label", title);
  selectionScopeToggle.dataset.scope = state.faceSelectionScope;
  selectionScopeToggle.title = `${state.faceSelectionScope === "group" ? "Grouped semantic faces" : "Single face"} selection`;
}
selectionScopeToggle.onclick = () => {
  const nextScope = state.faceSelectionScope === "group" ? "object" : "group";
  state.faceSelectionScope = nextScope;
  state.faceSelection.clear();
  updateSelectionScopeToggle();
  setStatus(
    `${state.faceSelectionScope === "group" ? "Grouped inner, outer, top, or bottom faces" : "Single-face"} selection active`,
  );
  changed("session");
};
selectionModeToggle.onclick = () => {
  const currentIndex = selectionScopes.indexOf(state.selectionScope);
  state.selectionScope =
    selectionScopes[(currentIndex + 1) % selectionScopes.length];
  activateObjectMode();
  redraw();
  setStatus(`${selectionScopeLabels[state.selectionScope]} selection active`);
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
facePanel.innerHTML = `<header><strong>FACE TOOLS</strong></header><label>Mode <select data-face-mode><option value="extrude">Extrude</option><option value="fill">Planar Fill</option></select></label><label>Side material <select data-face-side-material><option value="dev/dev_measuregeneric01">Orange</option><option value="dev/dev_measuregeneric01b">Gray</option></select></label><label>Top material <select data-face-top-material><option value="dev/dev_measuregeneric01b">Gray</option><option value="dev/dev_measuregeneric01">Orange</option></select></label><label title="Maximum angle between an external rail and the extrusion normal">Max rail angle <input type="number" data-face-rail-angle min="15" max="89" step="1" value="89"> deg</label><label title="Signed source-side angle; 135 degrees is a 45-degree undirected line deviation">Max source angle <input type="number" data-face-source-angle min="90" max="179" step="1" value="135"> deg</label><label class="check-row" title="Snap the grabbed extrusion distance to the active grid"><input type="checkbox" data-face-grid-snap> Grid snap</label><div class="extrusion-toggles"><button type="button" class="extrusion-toggle" data-extrude-mode="parallel" aria-pressed="false" title="Keep the dragged cap parallel to the selected face while following adjacent source sides">Parallel</button><button type="button" class="extrusion-toggle" data-extrude-mode="snap" aria-pressed="false">Snap</button></div>`;
const faceModeSelect = facePanel.querySelector("[data-face-mode]");
const sideMaterialSelect = facePanel.querySelector("[data-face-side-material]");
const topMaterialSelect = facePanel.querySelector("[data-face-top-material]");
const railAngleInput = facePanel.querySelector("[data-face-rail-angle]");
const sourceAngleInput = facePanel.querySelector("[data-face-source-angle]");
const faceGridSnapInput = facePanel.querySelector("[data-face-grid-snap]");
const faceModeButtons = facePanel.querySelectorAll("[data-extrude-mode]");
if (
  !faceModeSelect ||
  !sideMaterialSelect ||
  !topMaterialSelect ||
  !railAngleInput ||
  !sourceAngleInput ||
  !faceGridSnapInput ||
  faceModeButtons.length !== 2
)
  throw new Error("Face panel markup is incomplete");
bindExtrusionModeButtons(facePanel, state, (mode) => {
  changed("document", false);
  redraw();
  setStatus(
    mode === "parallel"
      ? "Parallel extrusion: following adjacent source sides"
      : mode === "straight"
        ? "Straight extrusion: forward-cap snapping active"
        : "Snap extrusion: forward cap and external side rails active",
  );
});
railAngleInput.value = String(state.faceRailMaxAngle);
railAngleInput.onchange = () => {
  state.faceRailMaxAngle = Math.max(
    15,
    Math.min(89, Number(railAngleInput.value) || 89),
  );
  railAngleInput.value = String(state.faceRailMaxAngle);
  try {
    localStorage.setItem("faceRailMaxAngle", String(state.faceRailMaxAngle));
  } catch {}
  changed("document", false);
  setStatus(`Maximum rail angle: ${state.faceRailMaxAngle} deg`);
};
sourceAngleInput.value = String(state.faceSourceMaxAngle);
sourceAngleInput.onchange = () => {
  state.faceSourceMaxAngle = Math.max(
    90,
    Math.min(179, Number(sourceAngleInput.value) || 135),
  );
  sourceAngleInput.value = String(state.faceSourceMaxAngle);
  try {
    localStorage.setItem(
      "faceSourceMaxAngle",
      String(state.faceSourceMaxAngle),
    );
  } catch {}
  changed("document", false);
  setStatus(`Maximum source-side angle: ${state.faceSourceMaxAngle} deg`);
};
faceGridSnapInput.checked = state.faceExtrusionGridSnap;
faceGridSnapInput.onchange = () => {
  state.faceExtrusionGridSnap = faceGridSnapInput.checked;
  try {
    localStorage.setItem(
      "faceExtrusionGridSnap",
      String(state.faceExtrusionGridSnap),
    );
  } catch {}
  changed("document", false);
  setStatus(
    `Extrusion grid snap ${state.faceExtrusionGridSnap ? "enabled" : "disabled"}`,
  );
};
function updateFaceToolMode() {
  faceModeSelect.value = state.faceToolMode;
}
function setFaceToolMode(event) {
  event?.stopPropagation();
  const mode = event?.currentTarget?.value || faceModeSelect.value;
  if (mode === state.faceToolMode) return;
  state.faceToolMode = mode;
  setStatus(
    mode === "fill"
      ? "Planar Fill: select a closed vertical boundary loop, then press E"
      : "Extrude: drag selected faces outward",
  );
  changed("session");
}
faceModeSelect.addEventListener("input", setFaceToolMode);
faceModeSelect.addEventListener("change", setFaceToolMode);
faceModeSelect.addEventListener("pointerdown", (event) =>
  event.stopPropagation(),
);
function applyFaceMaterials() {
  if (!state.faceSelection.size)
    return setStatus("Select one or more faces first", true);
  const sideMaterial = sideMaterialSelect.value,
    topMaterial = topMaterialSelect.value;
  let applied = 0;
  for (const id of state.faceSelection) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && state.brushes.find((item) => item.id === match[1]),
      faceIndex = Number(match?.[2]);
    if (!brush || !brush.faces[faceIndex]) continue;
    brush.faceMaterials ||= brush.faces.map(
      () => brush.material || "tools/toolsnodraw",
    );
    const face = brush.faces[faceIndex],
      a = brush.vertices[face[0]],
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
  setStatus(`Applied materials to ${applied} faces`);
}
sideMaterialSelect.addEventListener("change", applyFaceMaterials);
topMaterialSelect.addEventListener("change", applyFaceMaterials);
function fillSelectedLoopAction() {
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
}
const pathPanel = document.createElement("aside");
pathPanel.className = "brush-panel path-panel";
pathPanel.hidden = true;
pathPanel.innerHTML = `<header><strong>PATH TOOLS</strong></header><label>Type <select data-path-type><option value="hallway">Hallway</option></select></label><label>Next <select data-path-segment-mode><option value="spline">Spline</option><option value="straight">Straight</option></select></label><label>Node <select data-path-node-mode><option value="auto">Auto</option><option value="smooth">Smooth</option><option value="corner">Corner</option></select></label><div class="path-actions"><button type="button" data-path-close>Close Path</button><button type="button" data-path-detach>Detach Start</button></div><label>Inside width <input type="number" data-path-setting="interiorWidth" min="1" max="8192" step="${state.grid}"></label><label>Height <input type="number" data-path-setting="interiorHeight" min="1" max="8192" step="${state.grid}"></label><label>Wall <input type="number" data-path-setting="wallThickness" min="1" max="1024" step="${state.grid}"></label><label>Floor <input type="number" data-path-setting="floorThickness" min="1" max="1024" step="${state.grid}"></label><label>Ceiling <input type="number" data-path-setting="ceilingThickness" min="1" max="1024" step="${state.grid}"></label><label>Elevation <input type="number" data-path-setting="baseElevation" min="-32768" max="32768" step="${state.grid}"></label><label>Max angle <input type="number" data-path-setting="maxAngleDegrees" min="1" max="90" step="1"></label><label>Max length <input type="number" data-path-setting="maxSegmentLength" min="1" max="1024" step="${state.grid}"></label><label>Curve error <input type="number" data-path-setting="chordError" min="0.125" max="64" step="0.125"></label><label>Flare <input type="number" data-path-setting="flare" min="0" max="4096" step="${state.grid}"></label><label>Blend length <input type="number" data-path-setting="blendLength" min="1" max="8192" step="${state.grid}"></label><label class="check-row"><input type="checkbox" data-path-snap> Snap ends</label><section class="path-materials"><strong>MATERIALS</strong><label>Floor <input type="text" data-path-material="floor"></label><label>Walls <input type="text" data-path-material="wall"></label><label>Ceiling <input type="text" data-path-material="ceiling"></label></section><p class="panel-note">Select one or two floor solids before Path to match the starting mouth. Drag cyan handles to edit width, height, and tangents. Enter commits.</p>`;
const pathInputs = new Map(
  [...pathPanel.querySelectorAll("[data-path-setting]")].map((input) => [
    input.dataset.pathSetting,
    input,
  ]),
);
const pathMaterialInputs = new Map(
  [...pathPanel.querySelectorAll("[data-path-material]")].map((input) => [
    input.dataset.pathMaterial,
    input,
  ]),
);
function updatePathControls() {
  const selectedNode = view.pathPoints[view.selectedPathNode];
  for (const [name, input] of pathInputs) {
    let value = state.pathSettings[name];
    if (selectedNode && name === "interiorWidth")
      value = selectedNode.width - 2 * state.pathSettings.wallThickness;
    if (selectedNode && name === "interiorHeight") value = selectedNode.height;
    if (selectedNode && name === "baseElevation") value = selectedNode.z;
    input.value = String(value);
  }
  for (const [name, input] of pathMaterialInputs)
    input.value = state.pathSettings.materials[name];
  pathPanel.querySelector("[data-path-segment-mode]").value =
    Number.isInteger(view.selectedPathSegment)
      ? view.pathModel.segmentModes[view.selectedPathSegment]
      : state.pathSettings.segmentMode;
  pathPanel.querySelector("[data-path-node-mode]").value =
    selectedNode?.tangentMode || "auto";
  pathPanel.querySelector("[data-path-close]").textContent = view.pathModel.closed
    ? "Open Path"
    : "Close Path";
  pathPanel.querySelector("[data-path-detach]").disabled =
    !view.pathSourceAttachment;
  pathPanel.querySelector("[data-path-snap]").checked =
    state.pathSettings.snapEnds !== false;
}
for (const [name, input] of pathInputs) {
  input.onchange = () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      updatePathControls();
      return;
    }
    const selectedNode = view.pathPoints[view.selectedPathNode];
    if (selectedNode && name === "interiorWidth")
      selectedNode.width =
        value + 2 * Number(state.pathSettings.wallThickness);
    else if (selectedNode && name === "interiorHeight")
      selectedNode.height = value;
    else if (selectedNode && name === "baseElevation") selectedNode.z = value;
    else if (name === "baseElevation" && view.pathPoints.length) {
      const delta = value - state.pathSettings.baseElevation;
      view.pathPoints.forEach((point) => {
        point.z = roundToGrid(point.z + delta, state.grid);
      });
    } else if (name === "interiorWidth" && view.pathPoints.length)
      view.pathPoints.forEach((point) => {
        point.width = value + 2 * Number(state.pathSettings.wallThickness);
      });
    else if (name === "interiorHeight" && view.pathPoints.length)
      view.pathPoints.forEach((point) => {
        point.height = value;
      });
    if (["maxAngleDegrees", "maxSegmentLength", "chordError"].includes(name))
      view.pathModel.detail[name] = value;
    if (name === "flare") {
      if (view.pathSourceAttachment) view.pathSourceAttachment.flare = value;
      if (view.pathEndAttachment) view.pathEndAttachment.flare = value;
    }
    if (name === "blendLength") {
      if (view.pathSourceAttachment)
        view.pathSourceAttachment.blendLength = value;
      if (view.pathEndAttachment) view.pathEndAttachment.blendLength = value;
    }
    state.pathSettings[name] = value;
    updatePathControls();
    if (state.mode === "path") {
      view.refreshPathPreview();
      redraw();
    }
  };
}
pathPanel.querySelector("[data-path-segment-mode]").onchange = (event) => {
  state.pathSettings.segmentMode = event.target.value;
  view.setSelectedPathSegmentMode(event.target.value);
  updatePathControls();
  redraw();
};
pathPanel.querySelector("[data-path-node-mode]").onchange = (event) => {
  view.setSelectedPathNodeMode(event.target.value);
  updatePathControls();
  redraw();
};
pathPanel.querySelector("[data-path-close]").onclick = () => {
  if (!view.togglePathClosed())
    return setStatus("Closing a path requires at least three nodes", true);
  updatePathControls();
  redraw();
  setStatus(view.pathModel.closed ? "Hallway path closed" : "Hallway path opened");
};
pathPanel.querySelector("[data-path-detach]").onclick = () => {
  view.pathSourceAttachment = null;
  view.pathSourceBrushIds = [];
  view.refreshPathPreview();
  updatePathControls();
  setStatus("Hallway start detached from source floor");
};
pathPanel.querySelector("[data-path-snap]").onchange = (event) => {
  state.pathSettings.snapEnds = event.target.checked;
  if (!event.target.checked) view.pathEndAttachment = null;
  view.refreshPathPreview();
};
for (const [name, input] of pathMaterialInputs) {
  input.onchange = () => {
    state.pathSettings.materials[name] = input.value.trim();
    if (state.mode === "path") {
      view.refreshPathPreview();
      redraw();
    }
  };
}
updatePathControls();
railDock.append(dockDivider, brushPanel, facePanel, pathPanel);
const railWidthGrip = document.createElement("div");
railWidthGrip.className = "rail-width-grip";
toolRail.append(railTools, railDock, railWidthGrip);
let railWidth = 132;
const editorMain = document.querySelector("main");
const railExpandedMinimum = 220;
const railToolsMinimumHeight = 172;
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
    pathPanel.hidden = true;
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
  pathPanel.hidden = true;
  railDock.classList.remove("closing", "collapsed");
  railDock.classList.add("available");
  toolRail.style.setProperty(
    "--dock-height",
    `${Math.min(dockHeight, availableHeight)}px`,
  );
}
function showPathDock() {
  if (state.mode !== "path") return;
  clearTimeout(dockFadeTimer);
  clearTimeout(dockHideTimer);
  const availableHeight = toolRail.clientHeight - railToolsMinimumHeight;
  if (availableHeight < dockMinimumHeight) {
    railDock.classList.remove("available");
    return;
  }
  brushPanel.hidden = true;
  facePanel.hidden = true;
  pathPanel.hidden = false;
  railDock.classList.remove("closing", "collapsed");
  railDock.classList.add("available");
  toolRail.style.setProperty(
    "--dock-height",
    `${Math.min(dockHeight, availableHeight)}px`,
  );
}
function hideBrushDock() {
  if (
    (state.mode === "brush" ||
      state.mode === "face" ||
      state.mode === "path") &&
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
toolRail.addEventListener("mouseenter", () => {
  setRailExpanded(true);
  if (state.mode === "brush") showBrushDock();
  if (state.mode === "face") showFaceDock();
  if (state.mode === "path") showPathDock();
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
function entityMetadata(entity) {
  const metadata = { ...entity };
  delete metadata.brushes;
  return metadata;
}
function canonicalGroups() {
  const groups = state.groups.map((group) => ({ ...group }));
  const known = new Set(
    groups.flatMap((group) => {
      const id = group.id ?? group.keys?.id;
      return [
        id,
        id === undefined ? undefined : `vmf-group-${id}`,
        group.exportKey,
      ]
        .filter((value) => value !== undefined)
        .map(String);
    }),
  );
  for (const groupId of new Set(
    state.brushes.map((brush) => brush.groupId).filter(Boolean),
  )) {
    if (known.has(String(groupId))) continue;
    groups.push({ exportKey: groupId });
    known.add(String(groupId));
  }
  return groups;
}
function currentProject() {
  return createProject({
    projectName: state.projectName,
    brushes: [...state.brushes],
    entities: state.entities.map(entityMetadata),
    groups: canonicalGroups(),
    ringMaterialRoles: state.ringMaterialRoles,
    ringSettings: state.ringSettings,
    projectSettings: state.projectSettings,
    grid: state.grid,
    faceExtrusionMode: state.faceExtrusionMode,
    faceExtrusionGridSnap: state.faceExtrusionGridSnap,
    faceRailMaxAngle: state.faceRailMaxAngle,
    faceSourceMaxAngle: state.faceSourceMaxAngle,
    vmf: state.vmf,
  });
}
function brushBelongsToEntity(brush, entity) {
  const entityId = String(entity.id ?? entity.keys?.id ?? "");
  return (
    (brush.hammerEntityId !== undefined &&
      String(brush.hammerEntityId) === entityId) ||
    brush.entityId === `vmf-entity-${entityId}`
  );
}
function currentVMFDocument() {
  const assigned = new Set();
  const groups = canonicalGroups();
  const entities = state.entities.map((entity) => {
    const brushes = state.brushes.filter((brush) => {
      const belongs = brushBelongsToEntity(brush, entity);
      if (belongs) assigned.add(brush.id);
      return belongs;
    });
    return { ...entityMetadata(entity), brushes };
  });
  return {
    format: "hammer-prefab-tool-vmf-document",
    version: 1,
    versionInfo: state.vmf.versionInfo || {},
    versionProperties: state.vmf.versionProperties || [],
    versionChildren: state.vmf.versionChildren || [],
    children: state.vmf.children || [],
    world: {
      ...(state.vmf.world || {}),
      brushes: state.brushes.filter((brush) => !assigned.has(brush.id)),
      groups,
    },
    entities,
    groups,
    brushes: [...state.brushes],
  };
}
function snapshot() {
  const project = currentProject();
  return {
    extrusionModeVersion: 1,
    selectionScopeVersion: 1,
    brushes: clone(state.brushes),
    entities: project.entities,
    groups: project.groups,
    ringMaterialRoles: project.ring.materialRoles,
    ringSettings: project.ring.settings,
    projectSettings: project.settings.project,
    vmf: project.vmf,
    projectName: project.name,
    selection: [...state.selection],
    brushSelection: [...state.brushSelection],
    hiddenBrushes: [...state.hiddenBrushes],
    showFuncDetailBrushes: state.showFuncDetailBrushes,
    showRegularBrushes: state.showRegularBrushes,
    faceSelection: [...state.faceSelection],
    faceSelectionScope: state.faceSelectionScope,
    faceToolMode: state.faceToolMode,
    selectionScope: state.selectionScope,
    mode: state.mode,
    tool: state.tool,
    showTextureAxes: state.showTextureAxes,
    textureLock: state.textureLock,
    faceExtrusionMode: state.faceExtrusionMode,
    vmfPath: state.vmfPath,
    documentKind,
    sourceIdentity,
    documentSessionId,
  };
}
function redraw() {
  view.kind = activeView;
  view.draw();
  $("view-selector").textContent = viewLabels[activeView];
  const selected =
    state.mode === "path"
      ? `${view.pathPoints.length} path nodes`
      : state.mode === "face"
        ? `${state.faceSelection.size} selected faces`
        : state.mode === "selection"
          ? `${state.brushSelection.size} selected objects`
          : `${state.selection.size} selected vertices`;
  $("stats").textContent =
    `${state.brushes.length} brush${state.brushes.length === 1 ? "" : "es"} · ${selected}`;
}

async function captureGridScreenshot() {
  const source = view.canvas;
  const maxEdge = 768;
  const scale = Math.min(1, maxEdge / source.width, maxEdge / source.height);
  const capture = document.createElement("canvas");
  capture.width = Math.max(1, Math.round(source.width * scale));
  capture.height = Math.max(1, Math.round(source.height * scale));
  const context = capture.getContext("2d");
  if (!context) throw new Error("Could not prepare screenshot canvas");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, capture.width, capture.height);
  const blob = await new Promise((resolve) =>
    capture.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not encode screenshot");

  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setStatus("Clean grid screenshot copied to clipboard");
      return;
    } catch {
      // Clipboard access can be denied outside a secure browser context.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `hammer-grid-${activeView}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus("Clean grid screenshot downloaded");
}

function updateDocumentStatus() {
  const dirty = dirtyState.isDirty();
  const title = state.projectName || "Untitled";
  $("document-title").textContent = title;
  $("footer-filename").textContent = state.vmfFilename;
  $("footer-filename").title = state.vmfFilename;
  $("footer-grid").textContent = `Grid: ${state.grid}`;
  $("dirty-indicator").textContent = dirty ? "Unsaved" : "Saved";
  $("dirty-indicator").dataset.dirty = String(dirty);
  $("dirty-indicator").title = dirty
    ? "Document has unsaved changes"
    : "Document matches the saved checkpoint";
  document.title = `${dirty ? "* " : ""}${title} - Hammer Prefab Tool`;
}
function updateDirtyState() {
  dirtyState.update(currentProject());
  updateDocumentStatus();
}
function markDocumentClean(savedProject = currentProject()) {
  cleanProject = normalizeProject(savedProject);
  dirtyState.markClean(cleanProject);
  dirtyState.update(currentProject());
  updateDocumentStatus();
}
function changed(kind = "document", recordHistory = true) {
  if (recordHistory) history.push(snapshot());
  if (kind === "document") {
    updateDirtyState();
    scheduleAutosave();
  }
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
  state.entities = data.entities || state.entities || [];
  state.groups = data.groups || state.groups || [];
  state.ringMaterialRoles =
    data.ringMaterialRoles || state.ringMaterialRoles || {};
  state.ringSettings = data.ringSettings || state.ringSettings || {};
  state.projectSettings = data.projectSettings || state.projectSettings || {};
  state.vmf = data.vmf || state.vmf || {};
  state.projectName = data.projectName || state.projectName || "Untitled";
  state.selection = new Set(data.selection || []);
  state.brushSelection = new Set(data.brushSelection || []);
  state.hiddenBrushes = new Set(data.hiddenBrushes || []);
  state.showFuncDetailBrushes = data.showFuncDetailBrushes !== false;
  state.showRegularBrushes = data.showRegularBrushes !== false;
  state.faceSelection = new Set(data.faceSelection || []);
  state.faceSelectionScope =
    data.selectionScopeVersion === 1
      ? data.faceSelectionScope || "group"
      : "group";
  state.faceToolMode = data.faceToolMode || "extrude";
  state.selectionScope =
    data.selectionScopeVersion === 1
      ? ["group", "object", "solid"].includes(data.selectionScope)
        ? data.selectionScope
        : "object"
      : "object";
  state.mode = data.mode || "selection";
  state.tool = data.tool || "box";
  state.showTextureAxes = Boolean(data.showTextureAxes);
  state.textureLock = data.textureLock || "world";
  state.vmfPath = data.vmfPath || null;
  documentKind =
    data.documentKind === "complete-map" ? "complete-map" : "prefab";
  sourceIdentity = data.sourceIdentity || null;
  documentSessionId = data.documentSessionId || crypto.randomUUID();
  directSaveAllowed = false;
  activeView = data.view || activeView;
  state.view = activeView;
  view.kind = activeView;
  updateSelectionScopeToggle();
  updateTextureAxesToggle();
  updateViewFilters();
  railButtons.forEach((item) =>
    item.classList.toggle("active", item.dataset.toolMode === state.mode),
  );
  if (data.camera) {
    view.scale = data.camera.scale || 1;
    view.offset = data.camera.offset || { x: 0, y: 0 };
  }
  $("grid").value = state.grid;
  updateDirtyState();
  redraw();
}
function saveHmrState() {
  try {
    sessionStorage.setItem(
      RELOAD_STATE_KEY,
      JSON.stringify({
        ...snapshot(),
        project: currentProject(),
        cleanProject,
        view: activeView,
        camera: { scale: view.scale, offset: view.offset },
        history: history.items,
        historyIndex: history.index,
      }),
    );
    return true;
  } catch (error) {
    console.warn("[Hammer Prefab Tool] HMR state save failed", error);
    return false;
  }
}
function restoreHmrState() {
  try {
    const raw = sessionStorage.getItem(RELOAD_STATE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(RELOAD_STATE_KEY);
    const data = JSON.parse(raw);
    if (data.project) applyProjectSettings(data.project);
    restore(data);
    dirtyState.reset();
    cleanProject = data.cleanProject || null;
    if (cleanProject) dirtyState.markClean(cleanProject);
    dirtyState.update(currentProject());
    updateDocumentStatus();
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
  const usedIds = new Set(state.brushes.map((brush) => brush.id));
  brushes.forEach((brush) => {
    if (!brush.id || usedIds.has(brush.id))
      brush.id = globalThis.crypto?.randomUUID
        ? `brush-${globalThis.crypto.randomUUID()}`
        : `brush-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    usedIds.add(brush.id);
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
  setStatus(
    `${label}: ${brushes.length} brush solid${brushes.length === 1 ? "" : "s"}`,
  );
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
  $("footer-grid").textContent = `Grid: ${state.grid}`;
  changed("document", false);
}
function clearVMF() {
  if (!state.brushes.length) return;
  if (!confirmDestructive("clear the current document")) return;
  state.brushes = [];
  state.entities = [];
  state.groups = [];
  state.vmf = {};
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
function confirmDestructive(action) {
  return (
    !dirtyState.isDirty() ||
    confirm(`Unsaved changes will be lost. Continue and ${action}?`)
  );
}
function assertExportable(label = "VMF") {
  if (!state.brushes.length)
    throw new Error(`${label} export requires at least one brush`);
  const issues = validateAll(state.brushes);
  if (issues.length) throw new Error(`Validation failed: ${issues[0]}`);
}
function applyProjectSettings(project) {
  state.grid = project.settings.grid;
  state.faceExtrusionMode = project.settings.extrusion.mode;
  state.faceExtrusionGridSnap = project.settings.extrusion.gridSnap;
  state.faceRailMaxAngle = project.settings.extrusion.railMaxAngle;
  state.faceSourceMaxAngle = project.settings.extrusion.sourceMaxAngle;
  state.projectSettings.prefab ||= {
    ownership: "func_detail",
    backing: "none",
  };
  $("grid").value = String(state.grid);
  faceGridSnapInput.checked = state.faceExtrusionGridSnap;
  railAngleInput.value = String(state.faceRailMaxAngle);
  sourceAngleInput.value = String(state.faceSourceMaxAngle);
  prefabOwnershipInput.value = state.projectSettings.prefab.ownership;
  prefabBackingInput.value = state.projectSettings.prefab.backing;
}
function replaceDocument(projectInput, options = {}) {
  const project = normalizeProject(projectInput);
  const issues = validateAll(project.brushes);
  if (issues.length) throw new Error(`File validation failed: ${issues[0]}`);
  if (!confirmDestructive(`open ${options.filename || "this file"}`))
    return false;

  view.cancelInteraction();
  view.previewBrushes = [];
  view.creationPreviewBrushes = [];
  view.creationBox = null;
  state.brushes = project.brushes;
  ensureArchExtrusionMetadata(state.brushes);
  state.entities = project.entities.map(entityMetadata);
  state.groups = project.groups;
  state.ringMaterialRoles = project.ring.materialRoles;
  state.ringSettings = project.ring.settings;
  state.projectSettings = project.settings.project;
  state.vmf = project.vmf;
  state.projectName = project.name;
  applyProjectSettings(project);
  state.selection = new Set();
  state.brushSelection = new Set();
  state.hiddenBrushes = new Set();
  state.faceSelection = new Set();
  activateObjectMode();

  state.vmfFilename = vmfFilename(options.filename || state.vmfFilename);
  state.vmfPath = options.serverPath || null;
  vmfHandle = options.handle || null;
  documentKind = options.documentKind || "prefab";
  sourceIdentity = options.sourceIdentity || null;
  directSaveAllowed = Boolean(options.directSaveAllowed);
  documentSessionId = options.documentSessionId || crypto.randomUUID();
  syncFilenameControls();
  history.items = [];
  history.index = -1;
  history.push(snapshot());
  dirtyState.reset();
  cleanProject = null;
  if (options.clean) markDocumentClean();
  else updateDirtyState();
  view.focus();
  redraw();
  refreshAutosaves();
  return true;
}
function kindForVMF(documentModel) {
  return documentModel.versionInfo?.prefab === "1" ||
    documentModel.world?.keys?.hammer_prefab_tool_version === "1"
    ? "prefab"
    : "complete-map";
}
function projectFromVMF(documentModel, name) {
  const ownership = documentModel.world?.keys?.hammer_prefab_ownership;
  const backing = documentModel.world?.keys?.hammer_prefab_backing;
  return createProject({
    projectName: String(name || "Imported VMF").replace(/\.vmf$/i, ""),
    brushes: documentModel.brushes,
    entities: documentModel.entities.map(entityMetadata),
    groups: documentModel.groups,
    ringMaterialRoles: {},
    ringSettings: {},
    projectSettings: {
      prefab: {
        ownership: ["func_detail", "group", "world"].includes(ownership)
          ? ownership
          : "func_detail",
        backing: ["none", "floor", "ceiling", "both"].includes(backing)
          ? backing
          : "none",
      },
    },
    grid: state.grid,
    faceExtrusionMode: state.faceExtrusionMode,
    faceExtrusionGridSnap: state.faceExtrusionGridSnap,
    faceRailMaxAngle: state.faceRailMaxAngle,
    faceSourceMaxAngle: state.faceSourceMaxAngle,
    vmf: documentModel,
  });
}
async function importBrowserFiles(files, options = {}) {
  const loaded =
    options.opened ||
    (await readSingleBrowserFile(files, { allowedKinds: [FILE_KINDS.VMF] }));
  const documentModel = parseVMFDocument(loaded.contents || loaded.text);
  const freshProject = projectFromVMF(documentModel, loaded.name);
  const contents = loaded.contents || loaded.text;
  const source = await createVmfSourceIdentity(loaded.file || null, contents, {
    access: options.handle ? "file-system-access" : "browser",
  });
  const matching = autosaveStore
    ? await findMatchingAutosave(
        autosaveSnapshots,
        source,
        freshProject,
        options.handle,
      )
    : null;
  const project = matching
    ? await autosaveStore.restoreSnapshot(matching.id)
    : freshProject;
  const recoveredHandle = options.handle || matching?.fileHandle || null;
  const replaced = replaceDocument(project, {
    filename: loaded.name,
    handle: recoveredHandle,
    clean: !matching,
    documentKind: matching?.documentKind || kindForVMF(documentModel),
    documentSessionId: matching?.documentSessionId,
    sourceIdentity: source,
    directSaveAllowed:
      kindForVMF(documentModel) === "prefab" || Boolean(recoveredHandle),
  });
  if (replaced) {
    const gridReport = countOffGridCoordinates(state.brushes, state.grid);
    setStatus(
      matching
        ? `Recovered autosave${recoveredHandle ? "; direct save linked." : "; direct save unavailable."}`
        : `Opened ${loaded.name}: ${state.brushes.length} brushes · ${gridReport.offGrid}/${gridReport.total} coordinates off grid ${state.grid}${kindForVMF(documentModel) === "complete-map" ? ` · complete-map editing is experimental${recoveredHandle ? " · direct save linked" : "; direct save unavailable"}` : recoveredHandle ? " · direct save linked" : ""}`,
      !matching && gridReport.offGrid > 0,
    );
  }
  return replaced;
}
const PICKER_TYPES = {
  vmf: [
    { description: "Valve Map Format", accept: { "text/plain": [".vmf"] } },
  ],
};
async function openLocalFile() {
  if (serverFiles) return openBrowser();
  const opened = await openVmfFile(window);
  await importBrowserFiles([], {
    opened,
    directSaveSupported: opened.directSaveSupported,
    handle: opened.handle,
  });
}
function syncFilenameControls() {
  localStorage.setItem("hammer-vmf-filename", state.vmfFilename);
  $("footer-filename").textContent = state.vmfFilename;
  $("footer-filename").title = state.vmfFilename;
}
function removeGroupOwnership(brush) {
  const copy = clone(brush);
  const preservedGroup =
    copy.groupId ||
    copy.hammerGroupId ||
    copy.assemblyId ||
    copy.editor?.keys?.hammer_prefab_group;
  delete copy.groupId;
  delete copy.hammerGroupId;
  if (preservedGroup) {
    copy.editor ||= { keys: {}, properties: [] };
    copy.editor.keys ||= {};
    copy.editor.keys.hammer_prefab_group = String(preservedGroup);
  }
  if (copy.editor?.keys) delete copy.editor.keys.groupid;
  if (copy.editor?.properties)
    copy.editor.properties = copy.editor.properties.filter(
      ({ key }) => key !== "groupid",
    );
  return copy;
}
function prefabVMFText() {
  const backing = state.projectSettings.prefab.backing;
  const prefabOptions = {
    backingBelow: backing === "floor" || backing === "both",
    backingAbove: backing === "ceiling" || backing === "both",
    grid: state.grid,
    worldKeys: {
      hammer_prefab_ownership: state.projectSettings.prefab.ownership,
      hammer_prefab_backing: state.projectSettings.prefab.backing,
    },
  };
  const source = currentVMFDocument();
  const ownership = state.projectSettings.prefab.ownership;
  source.world.brushes = source.world.brushes.filter(
    (brush) => brush.editor?.keys?.hammer_prefab_backing !== "1",
  );
  if (ownership !== "func_detail") {
    const generatedEntities = source.entities.filter(
      (entity) => entity.keys?.hammer_prefab_generated_group === "1",
    );
    source.entities = source.entities.filter(
      (entity) => entity.keys?.hammer_prefab_generated_group !== "1",
    );
    for (const brush of generatedEntities.flatMap(
      (entity) => entity.brushes || [],
    )) {
      const restored = clone(brush);
      const preservedGroup = restored.editor?.keys?.hammer_prefab_group;
      if (ownership === "group" && preservedGroup)
        restored.groupId = preservedGroup;
      source.world.brushes.push(
        ownership === "world" ? removeGroupOwnership(restored) : restored,
      );
    }
  }
  source.brushes = [
    ...source.world.brushes,
    ...source.entities.flatMap((entity) => entity.brushes || []),
  ];
  if (ownership === "func_detail")
    return writeRingPrefabVMF(source, prefabOptions);
  const documentModel = {
    ...source,
    world: { ...source.world, brushes: [...source.world.brushes] },
    entities: source.entities.map((entity) => ({
      ...entity,
      brushes: [...(entity.brushes || [])],
    })),
  };
  const backingBrushes = createSharedPrefabBackingBrushes(
    source,
    prefabOptions,
  );
  if (ownership === "world") {
    documentModel.world.brushes =
      documentModel.world.brushes.map(removeGroupOwnership);
  }
  documentModel.world.keys = {
    ...(documentModel.world.keys || {}),
    ...prefabOptions.worldKeys,
  };
  documentModel.world.brushes.push(...backingBrushes);
  documentModel.brushes = [
    ...documentModel.world.brushes,
    ...documentModel.entities.flatMap((entity) => entity.brushes || []),
  ];
  return writeVMFDocument(documentModel, {
    purpose: VMF_EXPORT_PURPOSE.PREFAB,
  });
}
function savedVMFText() {
  assertExportable("VMF");
  const text =
    documentKind === "prefab"
      ? prefabVMFText()
      : writeVMFDocument(currentVMFDocument());
  const reparsed = parseVMFDocument(text);
  const issues = validateAll(reparsed.brushes);
  if (issues.length)
    throw new Error(`Saved VMF validation failed: ${issues[0]}`);
  return text;
}
async function updateSavedSource(text, options = {}) {
  let file = options.file || null;
  if (!file && vmfHandle?.getFile) {
    try {
      file = await vmfHandle.getFile();
    } catch {
      // The successful write remains valid even if metadata cannot be refreshed.
    }
  }
  sourceIdentity = await createVmfSourceIdentity(file, text, {
    access: options.access || (vmfHandle ? "file-system-access" : "browser"),
    name: state.vmfFilename,
    locator: options.locator || null,
    modifiedAt: options.modifiedAt || new Date().toISOString(),
  });
}
async function saveVMF({ saveAs = false } = {}) {
  const protectingCompleteMap =
    documentKind === "complete-map" &&
    !directSaveAllowed &&
    !vmfHandle &&
    !state.vmfPath;
  const savedProject = currentProject();
  const text = savedVMFText();
  let filename = vmfFilename(state.vmfFilename);
  let downloaded = false;
  if (serverFiles) {
    if (saveAs || !directSaveAllowed) {
      const suggested = protectingCompleteMap
        ? filename.replace(/\.vmf$/i, "-edited.vmf")
        : filename;
      const requested = prompt("Save VMF as:", suggested);
      if (!requested) return false;
      filename = vmfFilename(requested);
      if (
        protectingCompleteMap &&
        filename.toLowerCase() === state.vmfFilename.toLowerCase()
      )
        throw new Error(
          "Choose a new VMF filename so the original complete map is not overwritten",
        );
    }
    const result = await serverFiles.saveVmf(filename, text);
    state.vmfPath = result.path || filename;
    state.vmfFilename = vmfFilename(state.vmfPath);
    directSaveAllowed = true;
    await updateSavedSource(text, {
      access: "server",
      locator: `server:export:${state.vmfPath}`,
    });
  } else if (saveAs && fileSystem.supported) {
    const result = await fileSystem.save(text, {
      suggestedName: filename,
      types: PICKER_TYPES.vmf,
    });
    if (!result) return false;
    vmfHandle = result.handle;
    state.vmfFilename = vmfFilename(result.handle.name || filename);
    directSaveAllowed = true;
    await updateSavedSource(text);
  } else if (vmfHandle) {
    await saveVmfFile({ contents: text, handle: vmfHandle, filename }, window);
    await updateSavedSource(text);
  } else {
    await saveVmfFile({ contents: text, filename }, window);
    state.vmfFilename = filename;
    downloaded = true;
    directSaveAllowed = false;
    await updateSavedSource(text, { access: "download" });
  }
  syncFilenameControls();
  markDocumentClean(savedProject);
  for (const snapshot of autosaveSnapshots) {
    if (snapshot.documentSessionId === documentSessionId)
      await autosaveStore?.discardSnapshot(snapshot.id);
  }
  await refreshAutosaves();
  setStatus(
    downloaded
      ? `Downloaded VMF ${state.vmfFilename}`
      : `Saved VMF ${state.vmfFilename}`,
  );
  return true;
}
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
function wildcard(expression) {
  const query = expression.trim();
  const pattern = query.includes("*") ? query : `*${query}*`;
  return new RegExp(
    `^${pattern
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
    list.innerHTML = `<p class="browser-empty">No files match this search.</p>`;
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
  browser.querySelector("strong").textContent = "OPEN VMF";
  $("browser-status").textContent = "Loading...";
  browser.showModal();
  search.focus();
  try {
    allFiles = (await serverFiles.listFiles("export")).files.filter((file) =>
      file.name.toLowerCase().endsWith(".vmf"),
    );
    visibleFiles = allFiles;
    filterFiles();
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
    const result = await serverFiles.openVmf(browserSelected.name, "export");
    const documentModel = parseVMFDocument(result.vmf);
    const freshProject = projectFromVMF(documentModel, result.path);
    const source = await createVmfSourceIdentity(null, result.vmf, {
      access: "server",
      name: result.path || browserSelected.name,
      locator: `server:export:${result.path || browserSelected.name}`,
      size: browserSelected.size,
      modifiedAt: browserSelected.modified,
    });
    const matching = autosaveStore
      ? await findMatchingAutosave(autosaveSnapshots, source, freshProject)
      : null;
    const project = matching
      ? await autosaveStore.restoreSnapshot(matching.id)
      : freshProject;
    const kind = matching?.documentKind || kindForVMF(documentModel);
    const replaced = replaceDocument(project, {
      filename: result.path || browserSelected.name,
      serverPath: result.path,
      clean: !matching,
      documentKind: kind,
      documentSessionId: matching?.documentSessionId,
      sourceIdentity: source,
      directSaveAllowed: true,
    });
    if (replaced) {
      browser.close();
      setStatus(
        matching
          ? "Recovered autosave; direct server save linked."
          : `Opened ${result.path || browserSelected.name}: ${state.brushes.length} brushes${kind === "complete-map" ? " · complete-map editing is experimental" : ""} · direct server save linked`,
      );
    }
  } catch (error) {
    $("browser-status").textContent = error.message;
  }
}
function renderAutosaveState(message, error = false) {
  const element = $("autosave-status");
  element.textContent = message;
  element.style.color = error ? "#ff8290" : "";
}
async function refreshAutosaves() {
  if (!autosaveStore) return;
  try {
    autosaveSnapshots = await autosaveStore.listSnapshots();
  } catch (error) {
    renderAutosaveState(`Autosave unavailable: ${error.message}`, true);
  }
}
async function autosaveNow(reason = "autosave", force = false) {
  if (!autosaveStore || (!force && !dirtyState.isDirty())) return null;
  renderAutosaveState("Autosaving...");
  try {
    const project = currentProject();
    const record = await autosaveStore.saveSnapshot(project, {
      reason: `${reason}:${state.vmfFilename}`,
      projectName: state.projectName,
      lastModifiedAt: new Date(),
      projectHash: canonicalProjectHash(project),
      source: sourceIdentity,
      documentKind,
      documentSessionId,
      fileHandle: vmfHandle,
      applicationVersion:
        document
          .querySelector('meta[name="hammer-build-id"]')
          ?.getAttribute("content") || "development",
    });
    await refreshAutosaves();
    renderAutosaveState(
      `Autosaved ${new Date(record.updatedAt).toLocaleTimeString()}`,
    );
    return record;
  } catch (error) {
    renderAutosaveState(`Autosave failed: ${error.message}`, true);
    return null;
  }
}
function scheduleAutosave() {
  if (!autosaveStore) return;
  clearTimeout(autosaveDebounce);
  autosaveDebounce = setTimeout(() => void autosaveNow("change"), 1500);
}
function startAutosaveTimer() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(
    () => void autosaveNow("interval"),
    autosaveIntervalMs,
  );
}
async function reloadWithAutosave() {
  await autosaveNow("reload", true);
  reloadAfterAutosave = true;
  location.reload();
}
/**
 * @param {ResolvedExtrusion | null} [resolved]
 * @returns {void}
 */
function commitFaceExtrusion(resolved = null) {
  if (!state.faceSelection.size)
    return setStatus("Select one or more faces first", true);
  if (!resolved) {
    const distance = Number(
      prompt(
        "Extrusion distance along the selected extrusion direction:",
        String(state.grid * 2),
      ),
    );
    if (!Number.isFinite(distance) || distance <= 0)
      return setStatus("Extrusion distance must be greater than zero", true);
    resolved = resolveExtrusion({
      sourceBrushes: state.brushes,
      selection: state.faceSelection,
      rawDistance: distance,
      grid: state.grid,
      guideSelection: state.faceSelection,
      mode: state.faceExtrusionMode,
      snapTarget: null,
      maxSourceAngleDegrees: state.faceSourceMaxAngle,
    });
  }
  if (resolved.blocked || !resolved.brushes.length)
    return setStatus(
      `Extrusion rejected: ${resolved.blockedReason || "no valid faces"}`,
      true,
    );
  assignExtrusionBrushIds(resolved.brushes, state.brushes);
  state.faceSelection = new Set(resolved.selection);
  for (const id of resolved.selection) {
    const match = id.match(/^(.*):f:(\d+)$/);
    const brush = match && state.brushes.find((item) => item.id === match[1]);
    const faceIndex = Number(match?.[2]);
    if (!brush?.faces?.[faceIndex]) continue;
    brush.faceMaterials ||= brush.faces.map(
      () => brush.material || "tools/toolsnodraw",
    );
    brush.faceMaterials[faceIndex] = "tools/toolsnodraw";
  }
  applyNodrawToHiddenFaces(
    [...state.brushes, ...resolved.brushes],
    new Set(resolved.brushes.map((brush) => brush.id)),
  );
  state.faceSelection = new Set(
    resolved.brushes.map((brush) => `${brush.id}:f:1`),
  );
  add(resolved.brushes, "Faces extruded");
  setStatus(
    `Extruded ${resolved.brushes.length} face${resolved.brushes.length === 1 ? "" : "s"} by ${resolved.finalDistance} units`,
  );
}
function commitHallway(assemblyId, brushes) {
  if (!assemblyId || !brushes.length)
    return setStatus("Hallway requires at least two valid path points", true);
  const previousIds = new Set(
    state.brushes
      .filter((brush) => brush.assemblyId === assemblyId)
      .map((brush) => brush.id),
  );
  state.brushes = state.brushes.filter(
    (brush) => brush.assemblyId !== assemblyId,
  );
  applyNodrawToHiddenFaces(
    [...state.brushes, ...brushes],
    new Set(brushes.map((brush) => brush.id)),
  );
  state.brushes.push(...brushes);
  state.selection.clear();
  state.faceSelection.clear();
  state.brushSelection = new Set(brushes.map((brush) => brush.id));
  for (const id of previousIds) state.hiddenBrushes.delete(id);
  changed();
  setStatus(
    `${previousIds.size ? "Updated" : "Created"} hallway: ${brushes.length} convex brushes`,
  );
}
function run(command) {
  if (command === "select-none") {
    state.selection.clear();
    state.brushSelection.clear();
    state.faceSelection.clear();
    changed("session");
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
  if (command === "apply-ring-material") {
    const role = $("ring-material-role").value;
    const material = $("ring-role-material").value.trim();
    if (!material || /["\r\n]/.test(material))
      return setStatus("Enter a valid Source material path", true);
    const selectedIds = new Set(state.brushSelection);
    state.selection.forEach((id) => selectedIds.add(id.split(":v:")[0]));
    state.faceSelection.forEach((id) => selectedIds.add(id.split(":f:")[0]));
    const owner = (brush) =>
      brush.assemblyId || brush.groupId || brush.entityId || brush.id;
    const owners = new Set(
      state.brushes.filter((brush) => selectedIds.has(brush.id)).map(owner),
    );
    if (!owners.size) return setStatus("Select a ring first", true);
    let applied = 0;
    for (const brush of state.brushes) {
      if (!owners.has(owner(brush))) continue;
      const indices = brush.faceRoles?.[role] || [];
      brush.faceMaterials ||= brush.faces.map(
        () => brush.material || "tools/toolsnodraw",
      );
      for (const index of indices) {
        if (brush.faceMaterials[index]?.toLowerCase() === "tools/toolsnodraw")
          continue;
        brush.faceMaterials[index] = material;
        applied++;
      }
      if (indices.length) {
        brush.materialRoles ||= {};
        brush.materialRoles[role] = material;
        state.ringMaterialRoles[owner(brush)] ||= {};
        state.ringMaterialRoles[owner(brush)][role] = material;
      }
    }
    if (!applied)
      return setStatus(
        `The selected object has no visible ${role} ring faces`,
        true,
      );
    changed();
    setStatus(`Applied ${material} to ${applied} ${role} ring faces`);
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
    changed("session");
    setStatus(`${state.selection.size} inner-ring vertices selected`);
  }
  if (command === "select-outer") {
    state.selection = new Set(ringVertexIds(state.brushes, "outer"));
    changed("session");
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
  if (command === "open-vmf") runFileAction(openLocalFile());
  if (command === "save-vmf") runFileAction(saveVMF());
  if (command === "save-vmf-as") runFileAction(saveVMF({ saveAs: true }));
}

function runFileAction(action) {
  Promise.resolve(action).catch((error) =>
    setStatus(error.message || String(error), true),
  );
}

$("grid").onchange = (event) => {
  state.grid = +event.target.value;
  document.querySelector(".menu-note").textContent =
    `Current grid: ${state.grid}. Use [ and ] to change.`;
  $("footer-grid").textContent = `Grid: ${state.grid}`;
  changed("document", false);
};
const showFuncDetailInput = $("show-func-detail");
const showRegularBrushesInput = $("show-regular-brushes");
function updateViewFilters() {
  showFuncDetailInput.checked = state.showFuncDetailBrushes !== false;
  showRegularBrushesInput.checked = state.showRegularBrushes !== false;
}
for (const input of [showFuncDetailInput, showRegularBrushesInput])
  input.onchange = () => {
    state.showFuncDetailBrushes = showFuncDetailInput.checked;
    state.showRegularBrushes = showRegularBrushesInput.checked;
    changed("session");
    setStatus(
      `${input === showFuncDetailInput ? "func_detail" : "Regular"} brushes ${input.checked ? "shown" : "hidden"}`,
    );
  };
updateViewFilters();
const handleVmfInput = (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (files.length)
    runFileAction(
      importBrowserFiles(files, { allowedKinds: [FILE_KINDS.VMF] }),
    );
};
$("vmf-file-input").oninput = handleVmfInput;
$("vmf-file-input").onchange = handleVmfInput;
$("view-selector").onclick = () => {
  activeView =
    viewNames[(viewNames.indexOf(activeView) + 1) % viewNames.length];
  state.view = activeView;
  redraw();
  setStatus(`View: ${viewLabels[activeView]}`);
};
$("grid-screenshot").onclick = () => {
  captureGridScreenshot().catch((error) =>
    setStatus(`Screenshot failed: ${error.message}`, true),
  );
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
let dragDepth = 0;
function supportedDrag(event) {
  const items = Array.from(event.dataTransfer?.items || []);
  return items.length === 1 && items[0].kind === "file";
}
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (!supportedDrag(event)) return;
  dragDepth++;
  document.body.classList.add("file-drag-active");
});
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = supportedDrag(event) ? "copy" : "none";
});
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("file-drag-active");
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("file-drag-active");
  runFileAction(
    importBrowserFiles(event.dataTransfer?.files, {
      allowedKinds: [FILE_KINDS.VMF],
    }),
  );
});
search.oninput = () => {
  localStorage.setItem("hammer-vmf-search", search.value);
  filterFiles();
};
search.onkeydown = (event) => {
  event.stopPropagation();
  if (event.key === "Enter" && browserSelected) {
    event.preventDefault();
    loadSelected();
  }
};
document.querySelectorAll("[data-command]").forEach(
  (button) =>
    (button.onclick = () => {
      run(button.dataset.command);
      if (button.closest(".drop-menu")) closeMenus();
    }),
);
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
  document.querySelectorAll("[data-menu]").forEach((item) => {
    item.classList.remove("active");
    item.setAttribute("aria-expanded", "false");
  });
}
document.querySelectorAll("[data-menu]").forEach((button) =>
  button.addEventListener("mouseenter", () => {
    if (!menus.some((menu) => menu.classList.contains("open"))) return;
    const menu = $(button.dataset.menu);
    closeMenus();
    menu.classList.add("open");
    button.classList.add("active");
    button.setAttribute("aria-expanded", "true");
    menu.style.left = `${button.getBoundingClientRect().left}px`;
  }),
);
document.querySelectorAll("[data-menu]").forEach(
  (button) =>
    (button.onclick = (event) => {
      event.stopPropagation();
      const menu = $(button.dataset.menu);
      const opening = !menu.classList.contains("open");
      closeMenus();
      if (opening) {
        menu.classList.add("open");
        button.classList.add("active");
        button.setAttribute("aria-expanded", "true");
        menu.style.left = `${button.getBoundingClientRect().left}px`;
        menu
          .querySelector("button:not([hidden]):not(:disabled), input, select")
          ?.focus();
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
    closeMenus();
  }
});
window.addEventListener("keydown", (event) => {
  if (browser.open && event.key === "Escape") {
    browser.close();
    return;
  }
  if (
    event.key === "Escape" &&
    menus.some((menu) => menu.classList.contains("open"))
  ) {
    const trigger = document.querySelector("[data-menu].active");
    closeMenus();
    trigger?.focus();
    return;
  }
  if (event.key === "Escape" && view.cancelInteraction()) {
    setStatus("Interaction cancelled");
    return;
  }
  if (event.key === "F5") {
    event.preventDefault();
    void reloadWithAutosave();
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s"
  ) {
    event.preventDefault();
    run(event.shiftKey ? "save-vmf-as" : "save-vmf");
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
    if (state.mode === "path") {
      if (!view.commitPath())
        setStatus(
          view.pathPreviewErrors[0] ||
            "Hallway requires at least two path points",
          true,
        );
      return;
    }
    if (view.commitCreation()) return;
    setStatus(`${state.selection.size} vertices selected`);
    return;
  }
  if (event.key === "Backspace" && state.mode === "path") {
    event.preventDefault();
    if (view.removeLastPathPoint()) {
      redraw();
      setStatus("Removed last hallway path point");
    }
    return;
  }
  if (key === "e" && state.mode === "face") {
    event.preventDefault();
    if (state.faceToolMode === "fill") fillSelectedLoopAction();
    else run("extrude-faces");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "c") {
    event.preventDefault();
    captureGridScreenshot().catch((error) =>
      setStatus(`Screenshot failed: ${error.message}`, true),
    );
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "o") {
    event.preventDefault();
    run("open-vmf");
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
      return setStatus("Select objects, faces, or vertices first", true);
    const hidden = event.ctrlKey
      ? state.brushes.filter((brush) => !selected.has(brush.id))
      : state.brushes.filter((brush) => selected.has(brush.id));
    hidden.forEach((brush) => state.hiddenBrushes.add(brush.id));
    changed("session");
    setStatus(
      event.ctrlKey
        ? `Hidden unselected brushes; ${selected.size} selected remain visible`
        : `Hidden ${hidden.length} selected brushes`,
    );
    return;
  }
  if (key === "u") {
    event.preventDefault();
    const count = state.hiddenBrushes.size;
    state.hiddenBrushes.clear();
    changed("session");
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
window.addEventListener("beforeunload", (event) => {
  if (reloadAfterAutosave) return;
  if (!dirtyState.isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});
async function restoreStartupAutosave() {
  for (const record of autosaveSnapshots) {
    if (!record.fileHandle?.getFile) continue;
    try {
      const file = await record.fileHandle.getFile();
      const text = await file.text();
      const documentModel = parseVMFDocument(text);
      const freshProject = projectFromVMF(documentModel, file.name);
      const source = await createVmfSourceIdentity(file, text, {
        access: "file-system-access",
      });
      const matching = await findMatchingAutosave(
        [record],
        source,
        freshProject,
        record.fileHandle,
      );
      if (!matching) continue;
      const project = await autosaveStore.restoreSnapshot(record.id);
      replaceDocument(project, {
        filename: file.name,
        handle: record.fileHandle,
        clean: false,
        documentKind: record.documentKind || kindForVMF(documentModel),
        documentSessionId: record.documentSessionId,
        sourceIdentity: source,
        directSaveAllowed: kindForVMF(documentModel) === "prefab",
      });
      setStatus("Recovered autosave; direct save linked.");
      return true;
    } catch {
      // Permission can be unavailable until the user explicitly opens the VMF.
    }
  }
  const candidate = autosaveSnapshots.find(
    (record) => record.source || record.documentSessionId,
  );
  if (
    candidate &&
    confirm(
      `Recover the autosave for ${candidate.source?.name || candidate.projectName || "the previous document"}?`,
    )
  ) {
    const project = await autosaveStore.restoreSnapshot(candidate.id);
    replaceDocument(project, {
      filename: candidate.source?.name || "recovered.vmf",
      handle: candidate.fileHandle || null,
      clean: false,
      documentKind: candidate.documentKind || "prefab",
      documentSessionId: candidate.documentSessionId,
      sourceIdentity: candidate.source || null,
      directSaveAllowed: Boolean(candidate.fileHandle),
    });
    setStatus(
      `Recovered autosave${candidate.fileHandle ? "; direct save linked." : "; direct save unavailable."}`,
    );
    return true;
  }
  return false;
}
async function start() {
  if (serverFiles) {
    try {
      const result = await api.config();
      const seconds = Number(result.config?.autosaveIntervalSeconds);
      if (Number.isFinite(seconds) && seconds >= 10)
        autosaveIntervalMs = seconds * 1000;
    } catch (error) {
      setStatus(error.message, true);
    }
  }
  const restoredSession = state.__initialized || restoreHmrState();
  if (!restoredSession) {
    state.brushes = [];
    history.items = [];
    history.index = -1;
    history.push(snapshot());
    markDocumentClean();
  }
  state.__initialized = true;
  try {
    autosaveStore = createProjectStore({ retention: 20 });
    await refreshAutosaves();
    const pendingUpdateSnapshot = localStorage.getItem(UPDATE_RECOVERY_KEY);
    if (pendingUpdateSnapshot) {
      try {
        const record = await autosaveStore.getSnapshot(pendingUpdateSnapshot);
        const project = await autosaveStore.restoreSnapshot(
          pendingUpdateSnapshot,
        );
        replaceDocument(project, {
          filename: record?.source?.name || "recovered.vmf",
          clean: false,
          documentKind: record?.documentKind || "prefab",
          documentSessionId: record?.documentSessionId,
          sourceIdentity: record?.source || null,
          handle: record?.fileHandle || null,
          directSaveAllowed: false,
        });
        localStorage.removeItem(UPDATE_RECOVERY_KEY);
        setStatus("Restored editing state after update");
      } catch (error) {
        localStorage.removeItem(UPDATE_RECOVERY_KEY);
        setStatus(`Update recovery failed: ${error.message}`, true);
      }
    } else if (!restoredSession) {
      await restoreStartupAutosave();
    }
    renderAutosaveState(
      autosaveSnapshots.length
        ? `Autosave available from ${new Date(autosaveSnapshots[0].updatedAt).toLocaleTimeString()}`
        : "Autosave ready",
    );
    startAutosaveTimer();
  } catch (error) {
    renderAutosaveState(`Autosave unavailable: ${error.message}`, true);
  }
  syncFilenameControls();
  updateDocumentStatus();
  redraw();
}
start().catch((error) => setStatus(error.message || String(error), true));
