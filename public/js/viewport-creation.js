import { roundToGrid } from "./grid.js";
import { stagedBrushHandles } from "./brush-tool.js";
import { PATH_VERSION } from "./path-spline.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportCreation(VP) {
  VP.prototype.cancelInteraction = function() {
    if (!this.drag && !this.creationBox && !this.pathPoints.length)
      return false;
    if (this.drag?.type === "move" || this.drag?.type === "object-transform")
      for (const brush of this.state.brushes)
        brush.vertices.forEach((vertex, index) => {
          const original = this.drag.original.get(`${brush.id}:v:${index}`);
          if (original) Object.assign(vertex, original);
        });
    if (this.drag?.type === "paint")
      this.state.selection = this.drag.originalSelection;
    if (this.drag?.type === "face-extrude")
      this.state.faceSelection = this.drag.originalSelection;
    if (this.drag?.type?.startsWith("path-") && this.drag.originalPath)
      this.pathPoints = this.drag.originalPath;
    this.drag = null;
    this.creationBox = null;
    this.previewBrushes = [];
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
    this.pathGhostLine = null;
    this.pathGhostSource = null;
    this.previewErrors = [];
    this.extrusionCandidate = null;
    this.extrusionMatchDebug = [];
    this.extrusionSolvedDebug = null;
    this.extrusionAcquisitionDebug = null;
    if (this.drag) {
      this.drag.geometryBlocked = false;
      this.drag.geometryBlockedReason = null;
      this.drag.startRailPair = null;
      this.drag.startRailState = "pending";
      this.drag.sideRailLocks = null;
      this.drag.sideRailEndpointLocks = null;
      this.drag.sideRailEndpointDistances = null;
    }
    this.requestDraw();
    return true;
  }

  VP.prototype.commitCreation = function() {
    if (!this.creationBox) return false;
    const bounds = this.creationBox;
    this.creationBox = null;
    this.creationPreviewBrushes = [];
    this.onCreateBox(bounds);
    this.requestDraw();
    return true;
  }

  VP.prototype.creationBoundsFromDrag = function() {
    if (this.drag?.type !== "box") return null;
    const start = this.world({ x: this.drag.x, y: this.drag.y }),
      end = this.world({ x: this.drag.currentX, y: this.drag.currentY }),
      axes = this.axes();
    for (const axis of axes.slice(0, 2)) {
      start[axis] = roundToGrid(start[axis], this.state.grid);
      end[axis] = roundToGrid(end[axis], this.state.grid);
    }
    return { start, end, axes };
  }

  VP.prototype.creationShapeHandles = function() {
    return stagedBrushHandles(
      this.creationBox,
      this.state.generator,
      this.state.grid,
    ).map((handle) => ({ ...handle, point: this.screen(handle.point) }));
  }

  VP.prototype.creationHandleAt = function(x, y) {
    if (!this.creationBox) return null;
    const shapeHandle = [...this.creationShapeHandles()]
      .reverse()
      .find(
        (handle) => Math.hypot(x - handle.point.x, y - handle.point.y) <= 11,
      );
    if (shapeHandle) return shapeHandle;
    const { axes, start, end } = this.creationBox,
      a = this.screen({ x: 0, y: 0, z: 0, ...start }),
      b = this.screen({ x: 0, y: 0, z: 0, ...end }),
      minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x),
      minY = Math.min(a.y, b.y),
      maxY = Math.max(a.y, b.y),
      centerX = (minX + maxX) / 2,
      centerY = (minY + maxY) / 2;
    const handles = [
      ["nw", minX, minY],
      ["n", centerX, minY],
      ["ne", maxX, minY],
      ["e", maxX, centerY],
      ["se", maxX, maxY],
      ["s", centerX, maxY],
      ["sw", minX, maxY],
      ["w", minX, centerY],
    ];
    const handle = handles.find(
      ([, hx, hy]) => Math.hypot(x - hx, y - hy) <= 9,
    );
    if (handle)
      return { type: handle[0], axes, start: { ...start }, end: { ...end } };
    if (x >= minX && x <= maxX && y >= minY && y <= maxY)
      return { type: "move", axes, start: { ...start }, end: { ...end } };
    return null;
  }

}
