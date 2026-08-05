import { isFuncDetailBrush } from "./selection.js";
import { assertBrushesGeometry } from "./geometry-runtime.js";
import { PATH_VERSION } from "./path-spline.js";
import { AXES, ZOOM_MIN, ZOOM_MAX } from "./viewport-constants.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportCore(VP) {
  VP.prototype.axes = function() {
    return AXES[this.kind];
  }

  VP.prototype.requestDraw = function() {
    if (this.drawFrame) return;
    this.drawFrame = requestAnimationFrame(() => {
      this.drawFrame = 0;
      if (this.canvas.isConnected) this.draw();
    });
  }

  VP.prototype.plane = function(vertex) {
    const [horizontal, vertical] = this.axes();
    return { x: vertex[horizontal], y: -vertex[vertical] };
  }

  VP.prototype.world = function(point) {
    const rect = this.rect,
      axes = this.axes();
    return {
      [axes[0]]: (point.x - rect.width / 2 - this.offset.x) / this.scale,
      [axes[1]]: -(point.y - rect.height / 2 - this.offset.y) / this.scale,
    };
  }

  VP.prototype.screen = function(vertex) {
    const point = this.plane(vertex),
      rect = this.rect;
    return {
      x: rect.width / 2 + point.x * this.scale + this.offset.x,
      y: rect.height / 2 + point.y * this.scale + this.offset.y,
    };
  }

  VP.prototype.toScreenEdges = function(edges) {
    const [axX, axY] = this.axes();
    const out = {};
    for (const [k, pair] of Object.entries(edges || {})) {
      if (!pair) continue;
      const aPt = { x: 0, y: 0, z: 0 };
      aPt[axX] = pair[0].x;
      aPt[axY] = pair[0].y;
      const bPt = { x: 0, y: 0, z: 0 };
      bPt[axX] = pair[1].x;
      bPt[axY] = pair[1].y;
      out[k] = [this.screen(aPt), this.screen(bPt)];
    }
    return out;
  }

  VP.prototype.visibleBrushes = function() {
    const brushes = this.state.brushes.filter(
      (brush) =>
        !this.state.hiddenBrushes?.has(brush.id) &&
        !(
          this.state.mode === "path" &&
          this.pathPreviewBrushes.length &&
          brush.assemblyId === this.pathAssemblyId
        ) &&
        (isFuncDetailBrush(brush)
          ? this.state.showFuncDetailBrushes !== false
          : this.state.showRegularBrushes !== false),
    );
    assertBrushesGeometry(brushes, "viewport visible brushes");
    return brushes;
  }

  VP.prototype.zoomAt = function(x, y, factor) {
    const rect = this.canvas.getBoundingClientRect(),
      worldX = (x - rect.width / 2 - this.offset.x) / this.scale,
      worldY = (y - rect.height / 2 - this.offset.y) / this.scale,
      nextScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.scale * factor));
    if (nextScale === this.scale) return;
    this.scale = nextScale;
    this.offset = {
      x: x - rect.width / 2 - worldX * nextScale,
      y: y - rect.height / 2 - worldY * nextScale,
    };
    this.draw();
  }

  VP.prototype.focus = function() {
    const vertices = this.state.brushes.flatMap((brush) => brush.vertices);
    if (!vertices.length) {
      this.scale = 1;
      this.offset = { x: 0, y: 0 };
      this.draw();
      return;
    }
    const points = vertices.map((vertex) => this.plane(vertex)),
      minX = Math.min(...points.map((point) => point.x)),
      maxX = Math.max(...points.map((point) => point.x)),
      minY = Math.min(...points.map((point) => point.y)),
      maxY = Math.max(...points.map((point) => point.y)),
      rect = this.canvas.getBoundingClientRect();
    this.scale = Math.max(
      ZOOM_MIN,
      Math.min(
        ZOOM_MAX,
        (rect.width - 72) / Math.max(1, maxX - minX),
        (rect.height - 72) / Math.max(1, maxY - minY),
      ),
    );
    this.offset = {
      x: (-(minX + maxX) * this.scale) / 2,
      y: (-(minY + maxY) * this.scale) / 2,
    };
    this.draw();
  }

  VP.prototype.centerWorld = function() {
    this.offset = { x: 0, y: 0 };
    this.draw();
  }

}
