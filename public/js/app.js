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
import { bindContextMenu } from "./context-menu.js";
import { createDocumentChrome } from "./document-chrome.js";
import { bindFacePanel, createFacePanel } from "./face-panel.js";
import { bindFileBrowser } from "./file-browser.js";
import { bindFileDrop } from "./file-drop.js";
import { generateHallway } from "./hallway-generator.js";
import { bindGridControls } from "./grid-controls.js";
import { bindMenuBar } from "./menu-bar.js";
import { bindPathPanel, createPathPanel } from "./path-panel.js";
import { bindSelectionControls } from "./selection-controls.js";
import { createToolRail } from "./tool-rail.js";
import { bindViewControls } from "./view-controls.js";
import {
  acquireNearestPathSource,
  acquirePathSource,
} from "./path-source-acquisition.js";
import { routePathAroundBrushes } from "./path-routing.js";
import { validateAll } from "./brush-validation.js";
import { History } from "./history.js";
import { Viewport } from "./viewport.js";
import { VMF_EXPORT_PURPOSE, writeVMFDocument } from "./vmf-writer.js";
import { parseVMFDocument } from "./vmf-parser.js";
import {
  alignAllFacesToCenter,
  alignAllFacesToOuter,
} from "./texture-alignment.js";
import { ringVertexIds } from "./selection.js";
import { applyNodrawToHiddenFaces } from "./nodraw.js";
import { fillSelectedLoop } from "./face-fill.js";
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
  avoidShapes: true,
  routeMargin: 32,
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
const serverFiles =
  storageMode === "server" ? createLocalServerFileAdapter(api) : null;
const dirtyState = createDirtyStateService();
const documentChrome = createDocumentChrome({
  state,
  isDirty: () => dirtyState.isDirty(),
});
void documentChrome.showFileAccessWarning({
  supported: fileSystem.supported,
  storageMode,
});
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
  setTimeout(() => setStatus(`UI error${location}: ${details}`, true), 0);
});
window.addEventListener("unhandledrejection", (event) => {
  const details = describeUIError(event.reason);
  console.error("[UI unhandled rejection]", event.reason);
  setTimeout(() => setStatus(`UI error: ${details}`, true), 0);
});
let activeView = state.view || "top";
let brushPanelController = null;
let facePanelController = null;
let pathPanelController = null;
let toolRailController = null;
let selectionControls = null;
let gridControls = null;
let viewControls = null;
let menuBar = null;
let fileBrowser = null;
const view = new Viewport(
  $("editor"),
  activeView,
  state,
  (changeType) => {
    if (changeType === "selection-commit") changed("session");
    else if (changeType === "duplicate-commit") {
      changed("document");
      setStatus("Duplicated selected brushes");
    } else if (changeType === "brush-preview") {
      brushPanelController?.syncStagedSettings();
      redraw();
      setStatus(
        `${state.generator.shape[0].toUpperCase()}${state.generator.shape.slice(1)} preview ready; drag grid handles to adjust, Enter to create, or Escape to cancel`,
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
      pathPanelController?.updateControls();
      redraw();
      setStatus(
        `Hallway start matched to ${view.pathSourceBrushIds.length} selected floor brush${view.pathSourceBrushIds.length === 1 ? "" : "es"}`,
      );
    } else if (
      typeof changeType === "string" &&
      changeType.startsWith("path-source-invalid:")
    ) {
      setStatus(changeType.slice("path-source-invalid:".length), true);
    } else if (
      typeof changeType === "string" &&
      changeType.startsWith("path-route-invalid:")
    ) {
      setStatus(
        `Hallway route blocked: ${changeType.slice("path-route-invalid:".length)}`,
        true,
      );
    } else if (changeType === "path-control-selected") {
      pathPanelController?.updateControls();
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
  ({ start, end, outsideWidth, height, floorZ, excludeBrushIds }) =>
    routePathAroundBrushes({
      start,
      end,
      brushes: state.brushes.filter(
        (brush) =>
          !state.hiddenBrushes.has(brush.id) &&
          (String(brush.entityClassname || "").toLowerCase() === "func_detail"
            ? state.showFuncDetailBrushes !== false
            : state.showRegularBrushes !== false),
      ),
      outsideWidth,
      margin: Number(state.pathSettings.routeMargin) || 0,
      floorZ,
      height,
      excludeBrushIds,
    }),
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
document.querySelector(".brush-panel")?.remove();
let selectionShape = "box";
const RELOAD_STATE_KEY = "hammer-prefab-tool-hmr-state";
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
const facePanel = createFacePanel();
facePanelController = bindFacePanel({
  panel: facePanel,
  state,
  changed,
  redraw,
  setStatus,
});
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
const pathPanel = createPathPanel(state.grid);
pathPanelController = bindPathPanel({
  panel: pathPanel,
  state,
  view,
  redraw,
  setStatus,
});
function activateToolMode(mode) {
  if (state.mode !== mode) view.cancelInteraction();
  state.mode = mode;
  state.tool = mode === "brush" || mode === "path" ? mode : "box";
  if (mode === "selection") setStatus("Square selection active");
  else if (mode === "brush") setStatus("Brush tool active");
  else if (mode === "face")
    setStatus("Face selection active; press E to extrude selected faces");
  else if (mode === "vertex") setStatus("Vertex editing active");
  else activatePathMode();
  toolRailController.syncMode();
  if (["brush", "face", "path"].includes(mode)) {
    toolRailController.setExpanded(true);
    toolRailController.showDock();
  } else {
    toolRailController.closeDock();
    toolRailController.setExpanded(false);
  }
  selectionControls.sync();
  redraw();
}
function activatePathMode() {
  const selectedHallway = state.brushes.find(
    (brush) =>
      state.brushSelection.has(brush.id) && brush.generator?.type === "hallway",
  );
  if (!selectedHallway) {
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
    return;
  }
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
      Number(persistedAttachment.blendLength) || state.pathSettings.blendLength;
  }
  view.setPath(
    selectedHallway.generator.path,
    selectedHallway.assemblyId || selectedHallway.generator.assemblyId,
    {
      sourceBrushIds: sourceAttachment?.sourceBrushIds || [],
      sourceAttachment,
      endAttachment,
    },
  );
  pathPanelController?.updateControls();
  setStatus("Editing hallway path; Enter applies changes");
}
toolRailController = createToolRail({
  state,
  panels: { brush: brushPanel, face: facePanel, path: pathPanel },
  onModeChange: activateToolMode,
});
selectionControls = bindSelectionControls({
  state,
  changed,
  redraw,
  setStatus,
  activateObjectMode,
});
gridControls = bindGridControls({ state, changed });
viewControls = bindViewControls({
  state,
  getActiveView: () => activeView,
  setActiveView: (value) => {
    activeView = value;
    state.view = value;
  },
  changed,
  redraw,
  setStatus,
  captureScreenshot: captureGridScreenshot,
});
menuBar = bindMenuBar({ run });
bindContextMenu({ editor: $("editor"), run });
fileBrowser = bindFileBrowser({
  loadFiles: async () => (await serverFiles.listFiles("export")).files,
  openFile: loadSelected,
});
bindFileDrop({
  input: $("vmf-file-input"),
  onFiles: (files) =>
    runFileAction(
      importBrowserFiles(files, { allowedKinds: [FILE_KINDS.VMF] }),
    ),
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
  viewControls?.sync();
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
  documentChrome.syncDocument();
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
  documentChrome.setStatus(text, error);
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
  selectionControls.sync();
  viewControls.sync();
  toolRailController.syncMode();
  if (data.camera) {
    view.scale = data.camera.scale || 1;
    view.offset = data.camera.offset || { x: 0, y: 0 };
  }
  gridControls.sync();
  updateDirtyState();
  redraw();
}
function saveHmrState() {
  // Vite's debug full reload must never be blocked by the dirty-state guard.
  reloadAfterAutosave = true;
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
  toolRailController.closeDock();
  toolRailController.setExpanded(false);
  toolRailController.syncMode();
  selectionControls.sync();
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
  gridControls.setDelta(delta);
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
  gridControls.sync();
  facePanelController?.syncControls();
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
    handle: opened.handle,
    directSaveSupported: opened.directSaveSupported,
  });
}
function syncFilenameControls() {
  localStorage.setItem("hammer-vmf-filename", state.vmfFilename);
  documentChrome.syncFilename();
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
async function openBrowser() {
  await fileBrowser.open();
}
async function loadSelected(file) {
  const result = await serverFiles.openVmf(file.name, "export");
  const documentModel = parseVMFDocument(result.vmf);
  const freshProject = projectFromVMF(documentModel, result.path);
  const source = await createVmfSourceIdentity(null, result.vmf, {
    access: "server",
    name: result.path || file.name,
    locator: `server:export:${result.path || file.name}`,
    size: file.size,
    modifiedAt: file.modified,
  });
  const matching = autosaveStore
    ? await findMatchingAutosave(autosaveSnapshots, source, freshProject)
    : null;
  const project = matching
    ? await autosaveStore.restoreSnapshot(matching.id)
    : freshProject;
  const kind = matching?.documentKind || kindForVMF(documentModel);
  const replaced = replaceDocument(project, {
    filename: result.path || file.name,
    serverPath: result.path,
    clean: !matching,
    documentKind: kind,
    documentSessionId: matching?.documentSessionId,
    sourceIdentity: source,
    directSaveAllowed: true,
  });
  if (replaced)
    setStatus(
      matching
        ? "Recovered autosave; direct server save linked."
        : `Opened ${result.path || file.name}: ${state.brushes.length} brushes${kind === "complete-map" ? " · complete-map editing is experimental" : ""} · direct server save linked`,
    );
  return replaced;
}
function renderAutosaveState(message, error = false) {
  documentChrome.setAutosave(message, error);
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

window.addEventListener("keydown", (event) => {
  if (fileBrowser.isOpen() && event.key === "Escape") {
    fileBrowser.close();
    return;
  }
  if (event.key === "Escape" && menuBar.closeForEscape()) return;
  if (event.key === "Escape" && view.cancelInteraction()) {
    setStatus("Interaction cancelled");
    return;
  }
  if (event.key === "F5") {
    event.preventDefault();
    void reloadWithAutosave();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
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
