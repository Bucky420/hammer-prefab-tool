import { roundToGrid } from "./grid.js";
import { distanceToSegment, pointInPolygon } from "./math.js";
import { insideRect, segmentsIntersect } from "./viewport-constants.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportBrush(VP) {
  VP.prototype.vertexPoints = function() {
    return this.visibleBrushes().flatMap((brush) =>
      brush.vertices.map((vertex, index) => ({
        ...this.screen(vertex),
        id: `${brush.id}:v:${index}`,
      })),
    );
  }

  VP.prototype.brushAt = function(x, y) {
    const point = { x, y };
    return [...this.visibleBrushes()].reverse().find((brush) =>
      brush.faces.some((face) => {
        const polygon = face.map((index) => this.screen(brush.vertices[index]));
        return (
          pointInPolygon(point, polygon) ||
          polygon.some(
            (start, index) =>
              distanceToSegment(
                point,
                start,
                polygon[(index + 1) % polygon.length],
              ) <= 5,
          )
        );
      }),
    );
  }

  VP.prototype.objectBounds = function() {
    const vertices = this.state.brushes
      .filter((brush) => this.state.brushSelection.has(brush.id))
      .flatMap((brush) => brush.vertices);
    if (!vertices.length) return null;
    const [horizontal, vertical] = this.axes();
    const min = {
        [horizontal]: Math.min(...vertices.map((vertex) => vertex[horizontal])),
        [vertical]: Math.min(...vertices.map((vertex) => vertex[vertical])),
      },
      max = {
        [horizontal]: Math.max(...vertices.map((vertex) => vertex[horizontal])),
        [vertical]: Math.max(...vertices.map((vertex) => vertex[vertical])),
      },
      start = this.screen({ x: 0, y: 0, z: 0, ...min }),
      end = this.screen({ x: 0, y: 0, z: 0, ...max });
    return {
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
      min,
      max,
    };
  }

  VP.prototype.objectHandleAt = function(x, y) {
    const bounds = this.objectBounds();
    if (!bounds) return null;
    const centerX = (bounds.minX + bounds.maxX) / 2,
      centerY = (bounds.minY + bounds.maxY) / 2,
      handles = [
        ["nw", bounds.minX, bounds.minY],
        ["n", centerX, bounds.minY],
        ["ne", bounds.maxX, bounds.minY],
        ["e", bounds.maxX, centerY],
        ["se", bounds.maxX, bounds.maxY],
        ["s", centerX, bounds.maxY],
        ["sw", bounds.minX, bounds.maxY],
        ["w", bounds.minX, centerY],
        ["rotate", centerX, bounds.minY - 28],
      ];
    return handles.reduce((hit, [type, handleX, handleY]) => {
      const distance = Math.hypot(x - handleX, y - handleY);
      return distance <= (type === "rotate" ? 9 : 7) &&
        (!hit || distance < hit.distance)
        ? { type, x: handleX, y: handleY, distance, bounds }
        : hit;
    }, null);
  }

  VP.prototype.beginObjectTransform = function(handle, event) {
    const original = new Map();
    for (const brush of this.state.brushes)
      if (this.state.brushSelection.has(brush.id))
        brush.vertices.forEach((vertex, index) =>
          original.set(`${brush.id}:v:${index}`, { ...vertex }),
        );
    const [horizontal, vertical] = this.axes(),
      center = {
        [horizontal]:
          (handle.bounds.min[horizontal] + handle.bounds.max[horizontal]) / 2,
        [vertical]:
          (handle.bounds.min[vertical] + handle.bounds.max[vertical]) / 2,
      };
    this.canvas.setPointerCapture(event.pointerId);
    this.drag = {
      type: "object-transform",
      handle: handle.type,
      bounds: handle.bounds,
      center,
      start: { x: event.offsetX, y: event.offsetY },
      original,
      moved: false,
    };
  }

  VP.prototype.applyObjectTransform = function(current) {
    const drag = this.drag,
      [horizontal, vertical] = this.axes(),
      startWorld = this.world(drag.start),
      currentWorld = this.world(current);
    if (drag.handle === "rotate") {
      const startAngle = Math.atan2(
          startWorld[vertical] - drag.center[vertical],
          startWorld[horizontal] - drag.center[horizontal],
        ),
        currentAngle = Math.atan2(
          currentWorld[vertical] - drag.center[vertical],
          currentWorld[horizontal] - drag.center[horizontal],
        ),
        angle = currentAngle - startAngle,
        cosine = Math.cos(angle),
        sine = Math.sin(angle);
      for (const brush of this.state.brushes)
        for (const [index, vertex] of brush.vertices.entries()) {
          const original = drag.original.get(`${brush.id}:v:${index}`);
          if (!original) continue;
          const dx = original[horizontal] - drag.center[horizontal],
            dy = original[vertical] - drag.center[vertical];
          vertex[horizontal] =
            drag.center[horizontal] + dx * cosine - dy * sine;
          vertex[vertical] = drag.center[vertical] + dx * sine + dy * cosine;
        }
      return true;
    }
    // Source SDK Box3D snaps the dragged handle before transforming anything.
    // It then clamps that handle before it can cross the fixed opposite bound.
    const nextMin = { ...drag.bounds.min },
      nextMax = { ...drag.bounds.max };
    if (drag.handle.includes("e"))
      nextMax[horizontal] = Math.max(
        nextMin[horizontal] + this.state.grid,
        roundToGrid(currentWorld[horizontal], this.state.grid),
      );
    if (drag.handle.includes("w"))
      nextMin[horizontal] = Math.min(
        nextMax[horizontal] - this.state.grid,
        roundToGrid(currentWorld[horizontal], this.state.grid),
      );
    if (drag.handle.includes("n"))
      nextMax[vertical] = Math.max(
        nextMin[vertical] + this.state.grid,
        roundToGrid(currentWorld[vertical], this.state.grid),
      );
    if (drag.handle.includes("s"))
      nextMin[vertical] = Math.min(
        nextMax[vertical] - this.state.grid,
        roundToGrid(currentWorld[vertical], this.state.grid),
      );
    const originalWidth =
        drag.bounds.max[horizontal] - drag.bounds.min[horizontal],
      originalHeight = drag.bounds.max[vertical] - drag.bounds.min[vertical],
      scaleHorizontal =
        (nextMax[horizontal] - nextMin[horizontal]) / originalWidth,
      scaleVertical = (nextMax[vertical] - nextMin[vertical]) / originalHeight;
    for (const brush of this.state.brushes)
      for (const [index, vertex] of brush.vertices.entries()) {
        const original = drag.original.get(`${brush.id}:v:${index}`);
        if (!original) continue;
        vertex[horizontal] =
          nextMin[horizontal] +
          (original[horizontal] - drag.bounds.min[horizontal]) *
            scaleHorizontal;
        vertex[vertical] =
          nextMin[vertical] +
          (original[vertical] - drag.bounds.min[vertical]) * scaleVertical;
      }
    return (
      nextMin[horizontal] !== drag.bounds.min[horizontal] ||
      nextMax[horizontal] !== drag.bounds.max[horizontal] ||
      nextMin[vertical] !== drag.bounds.min[vertical] ||
      nextMax[vertical] !== drag.bounds.max[vertical]
    );
  }

  VP.prototype.brushIntersectsBox = function(brush, box) {
    const corners = [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
      ],
      boxEdges = corners.map((start, index) => [
        start,
        corners[(index + 1) % corners.length],
      ]);
    return brush.faces.some((face) => {
      const polygon = face.map((index) => this.screen(brush.vertices[index]));
      return (
        polygon.some((point) => insideRect(point, box)) ||
        corners.some((point) => pointInPolygon(point, polygon)) ||
        polygon.some((start, index) =>
          boxEdges.some(([a, b]) =>
            segmentsIntersect(
              start,
              polygon[(index + 1) % polygon.length],
              a,
              b,
            ),
          ),
        )
      );
    });
  }

}
