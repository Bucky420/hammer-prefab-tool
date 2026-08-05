import { moveBrushes, moveVertices } from "./geometry-model.js";
import {
  applySelection,
  connectedFaceIds,
  faceRole,
  isFuncDetailBrush,
  selectByShape,
  selectionKey,
  selectionTargets,
} from "./selection.js";
import { roundToGrid } from "./grid.js";
import { distanceToSegment, pointInPolygon } from "./math.js";
import {
  extrudeSelectedFaces,
  faceDirection,
  resolveExtrusion,
  solveSingleFaceExtrusion,
} from "./face-extrusion.js";
import {
  extrusionPolicyForMode,
  railWithinAngleLimit,
} from "./extrusion-policy.js";
import { duplicateBrushes } from "./geometry-model.js";
import {
  dedupeFirst,
  isNoDrawMaterial,
  passesProbeValidation,
  projectedRailKey,
  chooseProjectedBoundaryFace,
  movingCornerTouchesRail,
  solvedEdgeMatchesRail,
  projectPointToSegment,
  availableForwardSegmentLength,
} from "./rail-acquisition.js";
import { assertBrushesGeometry } from "./geometry-runtime.js";
import { normalizePath, PATH_VERSION, samplePath } from "./path-spline.js";
import { pathClearsObstacles } from "./path-routing.js";
import {
  applyStagedBrushHandle,
  stagedBrushHandles,
} from "./brush-tool.js";

import { AXES } from "./viewport-constants.js";
import { applyViewportCore } from "./viewport-core.js";
import { applyViewportDraw } from "./viewport-draw.js";
import { applyViewportPath } from "./viewport-path.js";
import { applyViewportCreation } from "./viewport-creation.js";
import { applyViewportFace } from "./viewport-face.js";
import { applyViewportExtrusion } from "./viewport-extrusion.js";
import { applyViewportBrush } from "./viewport-brush.js";
import { applyViewportInteraction } from "./viewport-interaction.js";

/**
 * @typedef {import("./face-extrusion.js").ResolvedExtrusion} ResolvedExtrusion
 */

/**
 * @callback ExtrudeFacesCallback
 * @param {ResolvedExtrusion} resolved
 * @returns {void}
 */

export class Viewport {
  constructor(
    canvas,
    kind,
    state,
    onChange = () => {},
    onCreateBox = () => {},
    onExtrudeFaces = () => {},
    onBrushPreview = () => {},
    onPathPreview = () => ({ brushes: [], errors: [] }),
    onPathCommit = () => {},
    onPathSource = () => null,
    onPathEndSnap = () => null,
    onPathRoute = () => ({ points: [], obstacles: [], errors: [] }),
  ) {
    this.canvas = canvas;
    this.canvas.tabIndex = 0;
    this.kind = kind;
    this.state = state;
    this.onChange = onChange;
    this.onCreateBox = onCreateBox;
    this.onExtrudeFaces = onExtrudeFaces;
    this.onBrushPreview = onBrushPreview;
    this.onPathPreview = onPathPreview;
    this.onPathCommit = onPathCommit;
    this.onPathSource = onPathSource;
    this.onPathEndSnap = onPathEndSnap;
    this.onPathRoute = onPathRoute;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.rect = canvas.getBoundingClientRect();
    this.scale = 1;
    this.offset = { x: 0, y: 0 };
    this.drag = null;
    this.creationBox = null;
    this.creationPreviewBrushes = [];
    this.pathPoints = [];
    this.pathModel = {
      version: PATH_VERSION,
      nodes: this.pathPoints,
      segmentModes: [],
      closed: false,
      detail: { maxAngleDegrees: 10, maxSegmentLength: 64, chordError: 1 },
    };
    this.pathAssemblyId = null;
    this.pathSourceBrushIds = [];
    this.pathSourceAttachment = null;
    this.pathSourceCandidate = null;
    this.pathEndAttachment = null;
    this.pathEndCandidate = null;
    this.pathStations = [];
    this.selectedPathNode = null;
    this.selectedPathSegment = null;
    this.pathPreviewBrushes = [];
    this.pathPreviewErrors = [];
    this.previewBrushes = [];
    this.previewErrors = [];
    this.extrusionCandidate = null;
    this.extrusionMatchDebug = [];
    this.extrusionSolvedDebug = null;
    this.extrusionAcquisitionDebug = null;
    this.hoverFaceIds = new Set();
    this.hoverFillPolygon = null;
    this.drawFrame = 0;
    this.pathPreviewFrame = 0;
    this.fpsFrames = 0;
    this.fpsSampleAt = performance.now();
    this.trackFps = (now) => {
      if (!this.canvas.isConnected) return;
      this.fpsFrames++;
      const elapsed = now - this.fpsSampleAt;
      if (elapsed >= 500) {
        const fps = document.getElementById("fps");
        if (fps)
          fps.textContent = `FPS: ${Math.round((this.fpsFrames * 1000) / elapsed)}`;
        this.fpsFrames = 0;
        this.fpsSampleAt = now;
      }
      requestAnimationFrame(this.trackFps);
    };
    requestAnimationFrame(this.trackFps);
    this.bindPaintSelection();
    this.bind();
    new ResizeObserver(() => {
      this.rect = canvas.getBoundingClientRect();
      this.draw();
    }).observe(canvas);
  }
}

applyViewportCore(Viewport);
applyViewportDraw(Viewport);
applyViewportPath(Viewport);
applyViewportCreation(Viewport);
applyViewportFace(Viewport);
applyViewportExtrusion(Viewport);
applyViewportBrush(Viewport);
applyViewportInteraction(Viewport);
