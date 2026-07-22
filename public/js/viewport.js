import { moveBrushes, moveVertices } from "./geometry-model.js";
import {
  applySelection,
  connectedFaceIds,
  faceRole,
  selectByShape,
} from "./selection.js";
import { roundToGrid } from "./grid.js";
import { distanceToSegment, pointInPolygon } from "./math.js";
import {
  extrudeSelectedFaces,
  faceDirection,
  limitExtrusionDistance,
  solveCornerSnappedExtrusion,
  solveSingleFaceExtrusion,
  solveVertexSnappedExtrusion,
} from "./face-extrusion.js";
import {
  extrusionPolicyForMode,
} from "./extrusion-policy.js";
import { validateBrush } from "./brush-validation.js";
import { duplicateBrushes } from "./geometry-model.js";
import {
  dedupeFirst,
  isNoDrawMaterial,
  passesProbeValidation,
  retainLockedCandidate,
} from "./rail-acquisition.js";
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const orientOutward = (face, vertices) => {
  const a = vertices[face[0]],
    b = vertices[face[1]],
    c = vertices[face[2]],
    normal = cross(
      { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
      { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z },
    ),
    center = vertices.reduce(
      (sum, point) => ({
        x: sum.x + point.x / vertices.length,
        y: sum.y + point.y / vertices.length,
        z: sum.z + point.z / vertices.length,
      }),
      { x: 0, y: 0, z: 0 },
    ),
    faceCenter = face.reduce(
      (sum, index) => ({
        x: sum.x + vertices[index].x / face.length,
        y: sum.y + vertices[index].y / face.length,
        z: sum.z + vertices[index].z / face.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
  return normal.x * (faceCenter.x - center.x) +
    normal.y * (faceCenter.y - center.y) +
    normal.z * (faceCenter.z - center.z) <
    0
    ? [...face].reverse()
    : face;
};

const COLORS = {
  grid: "#4c4c4c",
  highlightedGrid: "#737373",
  grid1024: "#643205",
  line: "#ffffff",
  axis: "#006464",
  vertex: "#ffffff",
  selected: "#ffff00",
  active: "#66dde3",
  faceHover: "#ffc928",
  invalid: "#ff4055",
};
const ZOOM_MIN = 0.02125;
const ZOOM_MAX = 256;
const AXES = {
  top: ["x", "y", "z"],
  front: ["y", "z", "x"],
  side: ["x", "z", "y"],
};
const insideRect = (point, box) =>
  point.x >= box.minX &&
  point.x <= box.maxX &&
  point.y >= box.minY &&
  point.y <= box.maxY;
function segmentsIntersect(a, b, c, d) {
  const ab = { x: b.x - a.x, y: b.y - a.y },
    cd = { x: d.x - c.x, y: d.y - c.y },
    denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) < 0.000001) return false;
  const ac = { x: c.x - a.x, y: c.y - a.y },
    t = (ac.x * cd.y - ac.y * cd.x) / denominator,
    u = (ac.x * ab.y - ac.y * ab.x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export class Viewport {
  constructor(
    canvas,
    kind,
    state,
    onChange = () => {},
    onCreateBox = () => {},
    onExtrudeFaces = () => {},
    onBrushPreview = () => {},
  ) {
    this.canvas = canvas;
    this.canvas.tabIndex = 0;
    this.kind = kind;
    this.state = state;
    this.onChange = onChange;
    this.onCreateBox = onCreateBox;
    this.onExtrudeFaces = onExtrudeFaces;
    this.onBrushPreview = onBrushPreview;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.rect = canvas.getBoundingClientRect();
    this.scale = 1;
    this.offset = { x: 0, y: 0 };
    this.drag = null;
    this.creationBox = null;
    this.creationPreviewBrushes = [];
    this.previewBrushes = [];
    this.previewErrors = [];
    this.extrusionCandidate = null;
    this.extrusionMatchDebug = [];
    this.extrusionSolvedDebug = null;
    this.hoverFaceIds = new Set();
    this.hoverFillPolygon = null;
    this.drawFrame = 0;
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
  axes() {
    return AXES[this.kind];
  }
  requestDraw() {
    if (this.drawFrame) return;
    this.drawFrame = requestAnimationFrame(() => {
      this.drawFrame = 0;
      if (this.canvas.isConnected) this.draw();
    });
  }
  cancelInteraction() {
    if (!this.drag && !this.creationBox) return false;
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
    this.drag = null;
    this.creationBox = null;
    this.previewBrushes = [];
    this.creationPreviewBrushes = [];
    this.previewErrors = [];
    this.extrusionCandidate = null;
    this.extrusionMatchDebug = [];
    this.extrusionSolvedDebug = null;
    if (this.drag) {
      this.drag.geometryBlocked = false;
      this.drag.geometryBlockedReason = null;
      this.drag.startRailPair = null;
      this.drag.startRailState = "pending";
      this.drag.sideRailLocks = null;
    }
    this.requestDraw();
    return true;
  }
  commitCreation() {
    if (!this.creationBox) return false;
    const bounds = this.creationBox;
    this.creationBox = null;
    this.creationPreviewBrushes = [];
    this.onCreateBox(bounds);
    this.requestDraw();
    return true;
  }
  creationHandleAt(x, y) {
    if (!this.creationBox) return null;
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
  plane(vertex) {
    const [horizontal, vertical] = this.axes();
    return { x: vertex[horizontal], y: -vertex[vertical] };
  }
  world(point) {
    const rect = this.rect,
      axes = this.axes();
    return {
      [axes[0]]: (point.x - rect.width / 2 - this.offset.x) / this.scale,
      [axes[1]]: -(point.y - rect.height / 2 - this.offset.y) / this.scale,
    };
  }
  screen(vertex) {
    const point = this.plane(vertex),
      rect = this.rect;
    return {
      x: rect.width / 2 + point.x * this.scale + this.offset.x,
      y: rect.height / 2 + point.y * this.scale + this.offset.y,
    };
  }
  toScreenEdges(edges) {
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
  visibleBrushes() {
    return this.state.brushes.filter(
      (brush) => !this.state.hiddenBrushes?.has(brush.id),
    );
  }
  vertexPoints() {
    return this.visibleBrushes().flatMap((brush) =>
      brush.vertices.map((vertex, index) => ({
        ...this.screen(vertex),
        id: `${brush.id}:v:${index}`,
      })),
    );
  }
  brushAt(x, y) {
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
  faceNormal(brush, face) {
    const a = brush.vertices[face[0]],
      b = brush.vertices[face[1]],
      c = brush.vertices[face[2]];
    const normal = {
      x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    };
    const center = brush.vertices.reduce(
      (sum, vertex) => ({
        x: sum.x + vertex.x / brush.vertices.length,
        y: sum.y + vertex.y / brush.vertices.length,
        z: sum.z + vertex.z / brush.vertices.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    const faceCenter = face.reduce(
      (sum, index) => ({
        x: sum.x + brush.vertices[index].x / face.length,
        y: sum.y + brush.vertices[index].y / face.length,
        z: sum.z + brush.vertices[index].z / face.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    if (
      normal.x * (faceCenter.x - center.x) +
        normal.y * (faceCenter.y - center.y) +
        normal.z * (faceCenter.z - center.z) <
      0
    ) {
      normal.x *= -1;
      normal.y *= -1;
      normal.z *= -1;
    }
    return normal;
  }
  visibleFace(brush, face) {
    const depth = this.axes()[2],
      normal = this.faceNormal(brush, face),
      viewSign = this.kind === "side" ? -1 : 1;
    return normal[depth] * viewSign > 0.001;
  }
  exposedEdges() {
    const edges = new Map(),
      pointKey = (point) =>
        `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
    for (const brush of this.visibleBrushes())
      for (const [faceIndex, face] of brush.faces.entries()) {
        const role = faceRole(brush, faceIndex),
          faceId = `${brush.id}:f:${faceIndex}`;
        for (let index = 0; index < face.length; index++) {
          const start = brush.vertices[face[index]],
            end = brush.vertices[face[(index + 1) % face.length]],
            startKey = pointKey(start),
            endKey = pointKey(end),
            key =
              startKey < endKey
                ? `${startKey}|${endKey}`
                : `${endKey}|${startKey}`;
          const edge = edges.get(key) || {
            start,
            end,
            count: 0,
            faceIds: new Set(),
            roleFaceIds: new Map(),
          };
          edge.count++;
          edge.faceIds.add(faceId);
          if (role === "inner" || role === "outer")
            edge.roleFaceIds.set(role, faceId);
          edges.set(key, edge);
        }
      }
    return [...edges.values()]
      .filter((edge) => edge.count === 2)
      .map((edge) => ({
        ...edge,
        startScreen: this.screen(edge.start),
        endScreen: this.screen(edge.end),
      }));
  }
  faceLoopAt(x, y) {
    const point = { x, y },
      edges = this.exposedEdges(),
      nodes = new Map(),
      edgeMap = new Map();
    const pointKey = (vertex) =>
      `${vertex.x.toFixed(4)},${vertex.y.toFixed(4)},${vertex.z.toFixed(4)}`;
    for (const edge of edges) {
      const startKey = pointKey(edge.start),
        endKey = pointKey(edge.end),
        item = { ...edge, startKey, endKey };
      edgeMap.set(`${startKey}|${endKey}`, item);
      for (const [from, to] of [
        [startKey, endKey],
        [endKey, startKey],
      ]) {
        const list = nodes.get(from) || [];
        list.push({ to, edge: item });
        nodes.set(from, list);
      }
    }
    const loops = [],
      visited = new Set();
    for (const edge of edgeMap.values()) {
      const edgeKey = `${edge.startKey}|${edge.endKey}`;
      if (visited.has(edgeKey)) continue;
      const polygon = [],
        faceIds = new Set();
      let current = edge.startKey,
        previous = null,
        closed = false;
      while (current && polygon.length <= edgeMap.size + 1) {
        const choices = (nodes.get(current) || []).filter(
          (candidate) => candidate.to !== previous,
        );
        if (!choices.length) break;
        const next = choices[0],
          currentEdge = next.edge;
        visited.add(`${currentEdge.startKey}|${currentEdge.endKey}`);
        visited.add(`${currentEdge.endKey}|${currentEdge.startKey}`);
        polygon.push(
          this.screen(
            current === currentEdge.startKey
              ? currentEdge.start
              : currentEdge.end,
          ),
        );
        currentEdge.faceIds.forEach((id) => {
          const match = id.match(/^(.*):f:(\d+)$/),
            brush =
              match && this.state.brushes.find((item) => item.id === match[1]),
            face = brush?.faces[Number(match?.[2])];
          if (
            brush &&
            face &&
            Math.abs(this.faceNormal(brush, face)[this.axes()[2]]) < 0.05
          )
            faceIds.add(id);
        });
        previous = current;
        current = next.to;
        if (current === edge.startKey) {
          closed = true;
          break;
        }
      }
      if (!closed || polygon.length < 3 || !pointInPolygon(point, polygon))
        continue;
      const area = Math.abs(
        polygon.reduce((sum, vertex, index) => {
          const next = polygon[(index + 1) % polygon.length];
          return sum + vertex.x * next.y - next.x * vertex.y;
        }, 0),
      );
      loops.push({ polygon, faceIds, area });
    }
    return loops.sort((a, b) => a.area - b.area)[0] || null;
  }
  radialFaceAt(x, y, operation = "replace") {
    const point = { x, y };
    let best = null;
    for (const edge of this.exposedEdges()) {
      const distance = distanceToSegment(
        point,
        edge.startScreen,
        edge.endScreen,
      );
      if (distance > 18) continue;
      for (const id of edge.faceIds) {
        const match = id.match(/^(.*):f:(\d+)$/),
          brush =
            match && this.state.brushes.find((item) => item.id === match[1]),
          face = brush?.faces[Number(match?.[2])];
        if (!brush || !face) continue;
        const normal = this.faceNormal(brush, face),
          length = Math.hypot(normal.x, normal.y, normal.z),
          depth = this.axes()[2];
        if (!length || Math.abs(normal[depth]) / length > 0.05) continue;
        if (
          this.state.faceSelection.size &&
          !this.compatibleFaceIds([id], operation).length
        )
          continue;
        if (!best || distance < best.distance) best = { id, distance };
      }
    }
    return best;
  }
  faceAt(x, y, operation = "replace") {
    const radial = this.radialFaceAt(x, y, operation);
    if (radial) return radial;
    const point = { x, y };
    let backFacing = null,
      incompatible = null;
    for (const brush of [...this.visibleBrushes()].reverse()) {
      for (
        let faceIndex = brush.faces.length - 1;
        faceIndex >= 0;
        faceIndex--
      ) {
        const face = brush.faces[faceIndex];
        const normal = this.faceNormal(brush, face),
          nLen = Math.hypot(normal.x, normal.y, normal.z),
          depth = this.axes()[2];
        if (nLen && Math.abs(normal[depth]) / nLen > 0.05) continue;
        const polygon = face.map((index) => this.screen(brush.vertices[index]));
        if (
          pointInPolygon(point, polygon) ||
          polygon.some(
            (start, index) =>
              distanceToSegment(
                point,
                start,
                polygon[(index + 1) % polygon.length],
              ) <= 5,
          )
        ) {
          const result = { id: `${brush.id}:f:${faceIndex}`, brush, faceIndex };
          const compatible =
            !this.state.faceSelection.size ||
            this.compatibleFaceIds([result.id], operation).length;
          if (compatible && this.visibleFace(brush, face)) return result;
          if (compatible) backFacing ||= result;
          else incompatible ||= result;
        }
      }
    }
    return backFacing || incompatible;
  }
  faceIntersectsBox(brush, face, box) {
    const polygon = face.map((index) => this.screen(brush.vertices[index])),
      area =
        Math.abs(
          polygon.reduce(
            (sum, point, index) =>
              sum +
              point.x * polygon[(index + 1) % polygon.length].y -
              polygon[(index + 1) % polygon.length].x * point.y,
            0,
          ),
        ) / 2,
      corners = [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
      ],
      boxEdges = corners.map((start, index) => [
        start,
        corners[(index + 1) % corners.length],
      ]);
    if (area < 1) return false;
    return (
      polygon.some((point) => insideRect(point, box)) ||
      corners.some((point) => pointInPolygon(point, polygon)) ||
      polygon.some((start, index) =>
        boxEdges.some(([a, b]) =>
          segmentsIntersect(start, polygon[(index + 1) % polygon.length], a, b),
        ),
      )
    );
  }
  objectBounds() {
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
  objectHandleAt(x, y) {
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
  beginObjectTransform(handle, event) {
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
  applyObjectTransform(current) {
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
  faceInclination(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]),
      face = brush?.faces[Number(match?.[2])];
    if (!brush || !face) return null;
    const normal = this.faceNormal(brush, face),
      length = Math.hypot(normal.x, normal.y, normal.z);
    return length ? Math.acos(Math.min(1, Math.abs(normal.z) / length)) : null;
  }
  faceGroup(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]);
    return brush ? brush.groupId || brush.id : null;
  }
  faceSemanticRole(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]);
    return brush ? faceRole(brush, Number(match[2])) : null;
  }
  compatibleFaceIds(ids, operation) {
    if (operation === "remove") return ids;
    const anchorId =
        operation === "replace"
          ? ids[0]
          : [...this.state.faceSelection][0] || ids[0],
      anchor = anchorId && this.faceInclination(anchorId),
      anchorRole = anchorId && this.faceSemanticRole(anchorId);
    if (anchor == null) return [];
    return ids.filter((id) => {
      const inclination = this.faceInclination(id);
      return (
        (operation !== "replace" && this.state.faceSelection.has(id)) ||
        ((this.state.faceSelectionScope !== "group" ||
          !anchorRole ||
          this.faceSemanticRole(id) === anchorRole) &&
          inclination != null &&
          Math.abs(inclination - anchor) <= Math.PI / 90)
      );
    });
  }
  faceTargets(id, operation = "replace") {
    return operation === "replace" && this.state.faceSelectionScope === "group"
      ? connectedFaceIds(this.state.brushes, id)
      : [id];
  }
  adjacentFaceIds(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      source = match && this.state.brushes.find((item) => item.id === match[1]),
      sourceFace = source?.faces[Number(match?.[2])];
    if (!source || !sourceFace) return [];
    const pointKey = (point) =>
        `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`,
      sourceEdges = new Set(
        sourceFace.map((index, offset) => {
          const a = pointKey(source.vertices[index]),
            b = pointKey(
              source.vertices[sourceFace[(offset + 1) % sourceFace.length]],
            );
          return a < b ? `${a}|${b}` : `${b}|${a}`;
        }),
      ),
      group = source.groupId || source.id,
      role = faceRole(source, Number(match[2]));
    return this.state.brushes
      .filter((brush) => (brush.groupId || brush.id) === group)
      .flatMap((brush) =>
        brush.faces.flatMap((face, faceIndex) => {
          if (brush.id === source.id && faceIndex === Number(match[2]))
            return [];
          if (role && faceRole(brush, faceIndex) !== role) return [];
          const edges = new Set(
            face.map((index, offset) => {
              const a = pointKey(brush.vertices[index]),
                b = pointKey(brush.vertices[face[(offset + 1) % face.length]]);
              return a < b ? `${a}|${b}` : `${b}|${a}`;
            }),
          );
          return [...sourceEdges].some((edge) => edges.has(edge))
            ? [`${brush.id}:f:${faceIndex}`]
            : [];
        }),
      );
  }
  faceExtrusionDistance(id, start, current) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]),
      faceIndex = Number(match?.[2]),
      face = brush?.faces[faceIndex];
    if (!brush || !face) return 0;
    const center = face.reduce(
        (sum, index) => ({
          x: sum.x + brush.vertices[index].x / face.length,
          y: sum.y + brush.vertices[index].y / face.length,
          z: sum.z + brush.vertices[index].z / face.length,
        }),
        { x: 0, y: 0, z: 0 },
      ),
      role = faceRole(brush, faceIndex);
    let direction = this.faceNormal(brush, face),
      length = Math.hypot(direction.x, direction.y, direction.z);
    const originScreen = this.screen(center),
      directionScreen = this.screen({
        x: center.x + direction.x / length,
        y: center.y + direction.y / length,
        z: center.z + direction.z / length,
      });
    let dx = directionScreen.x - originScreen.x,
      dy = directionScreen.y - originScreen.y,
      screenLength = Math.hypot(dx, dy);
    if (screenLength < 0.001) {
      dx = 0;
      dy = -1;
      screenLength = 1;
    }
    const pixels =
      ((current.x - start.x) * dx + (current.y - start.y) * dy) / screenLength;
    const rawDistance = Math.max(0, pixels / this.scale);
    const sourceBrushIds = new Set(
      [...(this.drag?.selection || [])].map(
        (faceId) => faceId.match(/^(.*):f:\d+$/)?.[1],
      ),
    );
    const sourceNormal = this.faceNormal(brush, face);
    const sourceLen = Math.hypot(
      sourceNormal.x,
      sourceNormal.y,
      sourceNormal.z,
    );
    const sourceUnit =
      sourceLen > 0.000001
        ? {
            x: sourceNormal.x / sourceLen,
            y: sourceNormal.y / sourceLen,
            z: sourceNormal.z / sourceLen,
          }
        : { x: 0, y: 0, z: 1 };
    const extrusionPolicy = extrusionPolicyForMode(
      this.state.faceExtrusionMode,
    );

    const sourceBoundary = face.map((vertexIndex, offset) => ({
      start: this.screen(brush.vertices[vertexIndex]),
      end: this.screen(brush.vertices[face[(offset + 1) % face.length]]),
    }));

    const pointSegmentDistance = (point, startPoint, endPoint) => {
      const dx = endPoint.x - startPoint.x,
        dy = endPoint.y - startPoint.y,
        lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared)
        return Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - startPoint.x) * dx + (point.y - startPoint.y) * dy) /
            lengthSquared,
        ),
      );
      return Math.hypot(
        point.x - (startPoint.x + t * dx),
        point.y - (startPoint.y + t * dy),
      );
    };

    const segmentDistance = (aStart, aEnd, bStart, bEnd) => {
      if (segmentsIntersect(aStart, aEnd, bStart, bEnd)) return 0;
      return Math.min(
        pointSegmentDistance(aStart, bStart, bEnd),
        pointSegmentDistance(aEnd, bStart, bEnd),
        pointSegmentDistance(bStart, aStart, aEnd),
        pointSegmentDistance(bEnd, aStart, aEnd),
      );
    };

    const activeAxes = this.axes(),
      [axisX, axisY] = activeAxes;

    // Group face vertices into the two unique 2D endpoints (baseA, baseB)
    const pointKey2D = (i) =>
      `${brush.vertices[i][axisX].toFixed(8)},${brush.vertices[i][axisY].toFixed(8)}`;
    const xyMap = new Map();
    for (const i of face) {
      const k = pointKey2D(i);
      if (!xyMap.has(k)) xyMap.set(k, []);
      xyMap.get(k).push(i);
    }
    const xyKeys = [...xyMap.keys()];
    if (xyKeys.length !== 2) return rawDistance;

    const groupA = xyMap.get(xyKeys[0]),
      groupB = xyMap.get(xyKeys[1]);
    const baseA = {
        x: brush.vertices[groupA[0]][axisX],
        y: brush.vertices[groupA[0]][axisY],
      },
      baseB = {
        x: brush.vertices[groupB[0]][axisX],
        y: brush.vertices[groupB[0]][axisY],
      };
    const baseAWorld = {
        x: brush.vertices[groupA[0]].x,
        y: brush.vertices[groupA[0]].y,
        z: brush.vertices[groupA[0]].z,
      },
      baseBWorld = {
        x: brush.vertices[groupB[0]].x,
        y: brush.vertices[groupB[0]].y,
        z: brush.vertices[groupB[0]].z,
      };
    const baseAScreen = this.screen(baseAWorld),
      baseBScreen = this.screen(baseBWorld);

    // Compute free cap endpoints from drag distance with world coords
    const srcDir2D = { x: baseB.x - baseA.x, y: baseB.y - baseA.y },
      srcLen2D = Math.hypot(srcDir2D.x, srcDir2D.y);
    if (srcLen2D < 0.000001) return rawDistance;
    const extNormal = { x: -srcDir2D.y / srcLen2D, y: srcDir2D.x / srcLen2D };
    let outSign =
      extNormal.x * sourceUnit[axisX] + extNormal.y * sourceUnit[axisY];
    if (outSign < 0) {
      extNormal.x *= -1;
      extNormal.y *= -1;
    }
    const freeCapAWorld = {
      x: baseAWorld.x,
      y: baseAWorld.y,
      z: baseAWorld.z,
    };
    freeCapAWorld[axisX] += extNormal.x * rawDistance;
    freeCapAWorld[axisY] += extNormal.y * rawDistance;
    const freeCapBWorld = {
      x: baseBWorld.x,
      y: baseBWorld.y,
      z: baseBWorld.z,
    };
    freeCapBWorld[axisX] += extNormal.x * rawDistance;
    freeCapBWorld[axisY] += extNormal.y * rawDistance;
    const freeCapAScreen = this.screen(freeCapAWorld);
    const freeCapBScreen = this.screen(freeCapBWorld);

    const closestPointOnSegment = (point, a, b) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len2 = dx * dx + dy * dy;
      if (len2 < 1e-8) return { point: { x: a.x, y: a.y }, t: 0 };
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2),
      );
      return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
    };

    const freeCapA2D = {
      x: baseA.x + extNormal.x * rawDistance,
      y: baseA.y + extNormal.y * rawDistance,
    };
    const freeCapB2D = {
      x: baseB.x + extNormal.x * rawDistance,
      y: baseB.y + extNormal.y * rawDistance,
    };

    const projectedEdgeKey = (a, b) => {
      const p1 = `${a.x.toFixed(3)},${a.y.toFixed(3)}`,
        p2 = `${b.x.toFixed(3)},${b.y.toFixed(3)}`;
      return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
    };

    // Build moving edges with both world-space geometry and screen-space display coords.
    // Normals are derived from polygon winding, not from extNormal.
    const makeMovingEdge = (
      id,
      startW2D,
      endW2D,
      startScr,
      endScr,
      centroid2D,
    ) => {
      const dx = endW2D.x - startW2D.x,
        dy = endW2D.y - startW2D.y,
        len = Math.hypot(dx, dy);
      if (len < 0.000001) return null;
      // Outward normal: rotate tangent CCW, then flip if pointing toward centroid
      const n = { x: -dy / len, y: dx / len };
      const mid = {
        x: (startW2D.x + endW2D.x) / 2,
        y: (startW2D.y + endW2D.y) / 2,
      };
      const towardInside =
        n.x * (centroid2D.x - mid.x) + n.y * (centroid2D.y - mid.y);
      if (towardInside > 0) {
        n.x *= -1;
        n.y *= -1;
      }
      return {
        id,
        startWorld2D: startW2D,
        endWorld2D: endW2D,
        startScreen: startScr,
        endScreen: endScr,
        outwardNormal2D: n,
      };
    };

    // 2D centroid of [baseA, freeCapA, freeCapB, baseB]
    const centroid2D = {
      x: (baseA.x + freeCapA2D.x + freeCapB2D.x + baseB.x) / 4,
      y: (baseA.y + freeCapA2D.y + freeCapB2D.y + baseB.y) / 4,
    };

    const movingEdges = [
      makeMovingEdge(
        "sideA",
        baseA,
        freeCapA2D,
        baseAScreen,
        freeCapAScreen,
        centroid2D,
      ),
      makeMovingEdge(
        "cap",
        freeCapA2D,
        freeCapB2D,
        freeCapAScreen,
        freeCapBScreen,
        centroid2D,
      ),
      makeMovingEdge(
        "sideB",
        freeCapB2D,
        baseB,
        freeCapBScreen,
        baseBScreen,
        centroid2D,
      ),
    ].filter(Boolean);

    // Extracted geometry setup helper
    const buildExtrusionFrame = () => ({
      activeAxes,
      axisX,
      axisY,
      baseA,
      baseB,
      baseAWorld,
      baseBWorld,
      baseAScreen,
      baseBScreen,
      freeCapA2D,
      freeCapB2D,
      freeCapAScreen,
      freeCapBScreen,
      freeCapAWorld,
      freeCapBWorld,
      srcDir2D,
      extNormal,
      sourceBrushIds,
      sourceUnit,
      pointSegmentDistance,
      segmentDistance,
      closestPointOnSegment,
      projectedEdgeKey,
      movingEdges,
      pointKey2D,
      xyMap,
      xyKeys,
      groupA,
      groupB,
    });

    // Corner-based snap acquisition.
    // Each cap corner finds the nearest target edge whose direction
    // matches the expected source base or outward-normal direction.
    // Perpendicular/wrong-direction edges are skipped.
    // This is the "corner slides along a target edge" model.

    if (!extrusionPolicy.externalSnap) {
      this.extrusionMatchDebug = [];
      this.extrusionSolvedDebug = null;
      this.extrusionCandidate = null;
      if (this.drag) this.drag.extrusionCandidate = null;
      return rawDistance;
    }

    const normal2D = {
        x: sourceNormal[axisX],
        y: sourceNormal[axisY],
      },
      normalLen2D = Math.hypot(normal2D.x, normal2D.y);
    if (normalLen2D > 0.0001) {
      normal2D.x /= normalLen2D;
      normal2D.y /= normalLen2D;
    }

    const cornerRadius = 15;
    const freeCapScrA = (() => {
      const p = { x: 0, y: 0, z: 0 };
      p[axisX] = freeCapA2D.x;
      p[axisY] = freeCapA2D.y;
      return this.screen(p);
    })();
    const freeCapScrB = (() => {
      const p = { x: 0, y: 0, z: 0 };
      p[axisX] = freeCapB2D.x;
      p[axisY] = freeCapB2D.y;
      return this.screen(p);
    })();
    const sourceBaseDir = {
      x: baseB.x - baseA.x,
      y: baseB.y - baseA.y,
    };
    const srcBLen = Math.hypot(sourceBaseDir.x, sourceBaseDir.y);
    if (srcBLen > 0.0001) {
      sourceBaseDir.x /= srcBLen;
      sourceBaseDir.y /= srcBLen;
    }
    const sourceNormalDir = {
      x: -sourceBaseDir.y,
      y: sourceBaseDir.x,
    };
    if (sourceNormalDir.x * normal2D.x + sourceNormalDir.y * normal2D.y < 0) {
      sourceNormalDir.x *= -1;
      sourceNormalDir.y *= -1;
    }

    // Find the best target edge for the cap to lie on. The cap
    // is always parallel to the base, at some perpendicular offset.
    // The snap picks a target edge parallel to the base and provides
    // a direction constraint that makes the cap parallel to the base.
    const ACQUIRE_RADIUS = 12;
    const RELEASE_RADIUS = 18;
    // Stable key: identifies the target edge (brush, face, and
    // vertex index) so endpoint magnet state persists across frames.
    const edgeKey = (targetBrushId, fi, vi) =>
      `${targetBrushId}:f:${fi}:${vi}`;
    const findCapSnap = (corner2D, cornerScr, baseCorner) => {
      const tryEndpointSnap = (targetBrushId, fi, ei, sWorld, eWorld) => {
        const key = edgeKey(targetBrushId, fi, ei);
        const wasActive = this.drag?.capEndpointMagnet?.get(key) === true;
        const candidates = [sWorld, eWorld]
          .map((vertex) => {
            const worldPt = { x: 0, y: 0, z: 0 };
            worldPt[axisX] = vertex[axisX];
            worldPt[axisY] = vertex[axisY];
            const point = { x: vertex[axisX], y: vertex[axisY] };
            const forwardDistance =
              (point.x - baseCorner.x) * sourceNormalDir.x +
              (point.y - baseCorner.y) * sourceNormalDir.y;
            const screenPoint = this.screen(worldPt);
            const pointerDistance = Math.hypot(
              cornerScr.x - screenPoint.x,
              cornerScr.y - screenPoint.y,
            );
            return { point, forwardDistance, pointerDistance };
          })
          .filter((c) => c.forwardDistance > 0.01);
        const acquire = candidates.filter(
          (c) => c.pointerDistance <= ACQUIRE_RADIUS,
        );
        if (acquire.length) {
          if (this.drag) {
            this.drag.capEndpointMagnet ||= new Map();
            this.drag.capEndpointMagnet.set(key, true);
          }
          return true;
        }
        if (!wasActive) return false;
        const stillClose = candidates.some(
          (c) => c.pointerDistance <= RELEASE_RADIUS,
        );
        if (!stillClose && this.drag?.capEndpointMagnet) {
          this.drag.capEndpointMagnet.delete(key);
        }
        return stillClose;
      };
      const results = [];
      for (const targetBrush of this.visibleBrushes()) {
        if (sourceBrushIds.has(targetBrush.id)) continue;
        for (let fi = 0; fi < targetBrush.faces.length; fi++) {
          const tf = targetBrush.faces[fi];
          const tfNormal = faceDirection(targetBrush, tf);
          if (tfNormal) {
            var tfnX = tfNormal[axisX] || 0;
            var tfnY = tfNormal[axisY] || 0;
            var tfnLen = Math.hypot(tfnX, tfnY);
            if (tfnLen > 0.0001) {
              var tfnDX = tfnX / tfnLen;
              var tfnDY = tfnY / tfnLen;
              var faceDot =
                tfnDX * sourceNormalDir.x + tfnDY * sourceNormalDir.y;
              if (faceDot > -0.3) continue;
            }
          }
          for (let ei = 0; ei < tf.length; ei++) {
            const vi = tf[ei];
            const otherVi = tf[(ei + 1) % tf.length];
            const sW = targetBrush.vertices[vi];
            const eW = targetBrush.vertices[otherVi];
            const sScr = this.screen(sW);
            const eScr = this.screen(eW);
            const dx = eW[axisX] - sW[axisX];
            const dy = eW[axisY] - sW[axisY];
            const dL = Math.hypot(dx, dy);
            if (dL < 0.0001) continue;
            const tDir = { x: dx / dL, y: dy / dL };

            // The target edge must be parallel to the source base direction.
            const capDot = Math.abs(
              tDir.x * sourceBaseDir.x + tDir.y * sourceBaseDir.y,
            );
            if (capDot < 0.95) continue;

            // Project the free cap corner onto the target edge line.
            const det = dx * -sourceNormalDir.x - dy * -sourceNormalDir.y;
            const dAbs = Math.abs(det);
            let snapX, snapY;
            if (dAbs < 0.0001) {
              const tClamp = dx !== 0
                ? (corner2D.x - sW[axisX]) / dx
                : (corner2D.y - sW[axisY]) / dy;
              if (tClamp < 0 || tClamp > 1) {
                if (!tryEndpointSnap(targetBrush.id, fi, ei, sW, eW)) continue;
                snapX = sW[axisX] + dx * tClamp;
                snapY = sW[axisY] + dy * tClamp;
              } else {
                snapX = sW[axisX] + dx * tClamp;
                snapY = sW[axisY] + dy * tClamp;
              }
            } else {
              const fx = corner2D.x - sW[axisX];
              const fy = corner2D.y - sW[axisY];
              const tT =
                (fx * -sourceNormalDir.x - fy * -sourceNormalDir.y) / det;
              if (tT < 0 || tT > 1) {
                if (!tryEndpointSnap(targetBrush.id, fi, ei, sW, eW)) continue;
                snapX = sW[axisX] + dx * tT;
                snapY = sW[axisY] + dy * tT;
              } else {
                snapX = sW[axisX] + dx * tT;
                snapY = sW[axisY] + dy * tT;
              }
            }
            const worldSnapPt = { x: 0, y: 0, z: 0 };
            worldSnapPt[axisX] = snapX;
            worldSnapPt[axisY] = snapY;
            const dist = Math.hypot(
              cornerScr.x - this.screen(worldSnapPt).x,
              cornerScr.y - this.screen(worldSnapPt).y,
            );
            if (dist > cornerRadius * 3) continue;
            results.push({
              targetBrushId: targetBrush.id,
              targetFaceIndex: fi,
              startWorld: { ...sW },
              endWorld: { ...eW },
              direction: tDir,
              cornerSnap: { x: snapX, y: snapY },
              distance: dist,
            });
          }
        }
      }
      return results.sort((a, b) => a.distance - b.distance);
    };

    // Find side-snap candidates. Treats target edges as undirected
    // lines: orients each edge forward (toward the extrusion) then
    // accepts any forward-pointing direction. Collects all qualifying
    // edges, deduplicated by canonical world endpoint key.
    const canonicalEdgeKey = (a, b) => {
      const ka = `${a.x.toFixed(5)},${a.y.toFixed(5)},${a.z.toFixed(5)}`;
      const kb = `${b.x.toFixed(5)},${b.y.toFixed(5)},${b.z.toFixed(5)}`;
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };
    const distancePointToLine = (point, start, end) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      return length < 0.0001
        ? Infinity
        : Math.abs(dx * (point.y - start.y) - dy * (point.x - start.x)) /
            length;
    };
    const canonicalLineDirection = (start, end) => {
      const startKey = `${start.x.toFixed(5)},${start.y.toFixed(5)}`;
      const endKey = `${end.x.toFixed(5)},${end.y.toFixed(5)}`;
      const from = startKey <= endKey ? start : end;
      const to = startKey <= endKey ? end : start;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      return length < 0.0001 ? null : { x: dx / length, y: dy / length };
    };
    const findSideSnap = (
      movingEdge,
      baseCornerWorld,
      freeCapScreen,
    ) => {
      const results = [];
      const seenEdgeKeys = new Set();
      const acquireRadius = 12;
      const releaseRadius = 18;
      const baseToleranceWorld = Math.max(0.5, (this.state.grid || 1) * 0.05);
      const lockedKey = this.drag?.sideRailLocks?.[movingEdge];
      for (const edge of this.exposedEdges()) {
        const faceIds = [...edge.faceIds];
        if (faceIds.length !== 2) continue;
        const faceRecords = faceIds
          .map((id) => {
            const match = id.match(/^(.*):f:(\d+)$/);
            const brush = match && this.state.brushes.find((item) => item.id === match[1]);
            const faceIndex = Number(match?.[2]);
            return brush && brush.faces[faceIndex]
              ? { id, brush, faceIndex, face: brush.faces[faceIndex] }
              : null;
          })
          .filter(Boolean);
        if (!faceRecords.length) continue;
        if (faceRecords.every((record) => isNoDrawMaterial(record.brush.faceMaterials?.[record.faceIndex] || record.brush.material)))
          continue;
        const targetBrush = faceRecords[0].brush;
        if (sourceBrushIds.has(targetBrush.id)) continue;
        const key = `${targetBrush.id}:${canonicalEdgeKey(edge.start, edge.end)}`;
        if (seenEdgeKeys.has(key)) continue;
        seenEdgeKeys.add(key);
        const start = { x: edge.start[axisX], y: edge.start[axisY] };
        const end = { x: edge.end[axisX], y: edge.end[axisY] };
        const railDirection = canonicalLineDirection(start, end);
        if (!railDirection) continue;
        const forwardComponent = Math.abs(
          railDirection.x * sourceNormalDir.x +
            railDirection.y * sourceNormalDir.y,
        );
        if (forwardComponent < 0.05) continue;
        const forwardStart =
          (start.x - baseCornerWorld.x) * sourceNormalDir.x +
          (start.y - baseCornerWorld.y) * sourceNormalDir.y;
        const forwardEnd =
          (end.x - baseCornerWorld.x) * sourceNormalDir.x +
          (end.y - baseCornerWorld.y) * sourceNormalDir.y;
        if (Math.max(forwardStart, forwardEnd) <= 0.05) continue;
        const baseLineDistance = distancePointToLine(baseCornerWorld, start, end);
        if (baseLineDistance > baseToleranceWorld) continue;
        const capLineDistance = distancePointToLine(freeCapScreen, edge.startScreen, edge.endScreen);
        const closest = closestPointOnSegment(freeCapScreen, edge.startScreen, edge.endScreen);
        const segmentDistance = Math.hypot(
          freeCapScreen.x - closest.point.x,
          freeCapScreen.y - closest.point.y,
        );
        const acquired = capLineDistance <= acquireRadius || segmentDistance <= acquireRadius;
        const retained = key === lockedKey &&
          (capLineDistance <= releaseRadius || segmentDistance <= releaseRadius);
        if (!acquired && !retained) continue;
        results.push({
          movingEdge,
          targetBrushId: targetBrush.id,
          adjacentFaceIndices: faceRecords.map((record) => record.faceIndex),
          targetEdgeIndex: 0,
          railDirection,
          lineOrigin: { x: edge.start[axisX], y: edge.start[axisY] },
          targetStartWorld: { ...edge.start },
          targetEndWorld: { ...edge.end },
          distancePx: Math.min(capLineDistance, segmentDistance),
          lineDistancePx: capLineDistance,
          canonicalKey: key,
          source: acquired ? "attached" : "magnetic",
        });
      }
      const retained = retainLockedCandidate(results, lockedKey, releaseRadius);
      if (retained.length === 1 && retained[0] === results.find((candidate) => candidate.canonicalKey === lockedKey))
        return retained;
      return retained.sort(
        (a, b) => a.distancePx - b.distancePx || a.canonicalKey.localeCompare(b.canonicalKey),
      );
    };

    // Attached-edge snapping: returns all deduplicated candidates
    // whose target edges physically touch the source base corner.
    // Scored by perpendicular distance from the free cap corner to
    // the rail line, not by forwardDot (which biases toward straight).
    const EPSILON_ATTACH = 0.5;
    const findAttachedEdges = (movingEdge, baseCornerWorld, freeCap2D) => {
      const candidates = [];
      const seenEdgeKeys = new Set();
      for (const edge of this.exposedEdges()) {
        const faceIds = [...edge.faceIds];
        if (faceIds.length !== 2) continue;
        const faceRecords = faceIds
          .map((id) => {
            const match = id.match(/^(.*):f:(\d+)$/);
            const brush = match && this.state.brushes.find((item) => item.id === match[1]);
            const faceIndex = Number(match?.[2]);
            return brush && brush.faces[faceIndex]
              ? { id, brush, faceIndex, face: brush.faces[faceIndex] }
              : null;
          })
          .filter(Boolean);
        if (!faceRecords.length) continue;
        if (faceRecords.every((record) => isNoDrawMaterial(record.brush.faceMaterials?.[record.faceIndex] || record.brush.material)))
          continue;
        const targetBrush = faceRecords[0].brush;
        if (sourceBrushIds.has(targetBrush.id)) continue;
        const key = `${targetBrush.id}:${canonicalEdgeKey(edge.start, edge.end)}`;
        if (seenEdgeKeys.has(key)) continue;
        const start = { x: edge.start[axisX], y: edge.start[axisY] };
        const end = { x: edge.end[axisX], y: edge.end[axisY] };
        const railDirection = canonicalLineDirection(start, end);
        if (!railDirection) continue;
        const forwardComponent = Math.abs(
          railDirection.x * sourceNormalDir.x +
            railDirection.y * sourceNormalDir.y,
        );
        if (forwardComponent < 0.05) continue;
        const forwardStart =
          (start.x - baseCornerWorld.x) * sourceNormalDir.x +
          (start.y - baseCornerWorld.y) * sourceNormalDir.y;
        const forwardEnd =
          (end.x - baseCornerWorld.x) * sourceNormalDir.x +
          (end.y - baseCornerWorld.y) * sourceNormalDir.y;
        if (Math.max(forwardStart, forwardEnd) <= 0.05) continue;
        const attach = closestPointOnSegment(baseCornerWorld, start, end);
        if (
          Math.hypot(
            baseCornerWorld.x - attach.point.x,
            baseCornerWorld.y - attach.point.y,
          ) > EPSILON_ATTACH
        )
          continue;
        seenEdgeKeys.add(key);
        const distancePx = distancePointToLine(freeCap2D, edge.startScreen, edge.endScreen);
        candidates.push({
          movingEdge,
          targetBrushId: targetBrush.id,
          adjacentFaceIndices: faceRecords.map((record) => record.faceIndex),
          targetEdgeIndex: 0,
          railDirection,
          lineOrigin: { x: edge.start[axisX], y: edge.start[axisY] },
          targetStartWorld: { ...edge.start },
          targetEndWorld: { ...edge.end },
          distancePx,
          lineDistancePx: distancePx,
          canonicalKey: key,
          source: "attached",
        });
      }
      candidates.sort(
        (a, b) => a.distancePx - b.distancePx || a.canonicalKey.localeCompare(b.canonicalKey),
      );
      return candidates;
    };

    // Discover cap and side candidates from both cap corners.
    const capSnapsA = findCapSnap(
      freeCapA2D,
      freeCapScrA,
      { x: baseA.x, y: baseA.y },
    );
    const capSnapsB = findCapSnap(
      freeCapB2D,
      freeCapScrB,
      { x: baseB.x, y: baseB.y },
    );
    const capSnaps = [...capSnapsA, ...capSnapsB].sort(
      (a, b) => a.distance - b.distance,
    );
    const attachedACandidates = findAttachedEdges(
      "sideA",
      { x: baseA.x, y: baseA.y },
      freeCapA2D,
    );
    const attachedBCandidates = findAttachedEdges(
      "sideB",
      { x: baseB.x, y: baseB.y },
      freeCapB2D,
    );
    const hardAPool = dedupeFirst(attachedACandidates).slice(0, 6);
    const hardBPool = dedupeFirst(attachedBCandidates).slice(0, 6);
    // Attached and magnetic support-line candidates are both evaluated;
    // attached candidates are ordered first in each pool.
    const sideASnaps = baseAScreen
      ? findSideSnap("sideA", { x: baseA.x, y: baseA.y }, freeCapScrA)
      : [];
    const sideBSnaps = baseBScreen
      ? findSideSnap("sideB", { x: baseB.x, y: baseB.y }, freeCapScrB)
      : [];

    // Candidate pools: collect top candidates per side (attached first,
    // then magnetic). Use up to 6 per side to explore branch options.
    const sideAPool = dedupeFirst([
      ...attachedACandidates,
      ...sideASnaps,
    ]).slice(0, 6);
    const sideBPool = dedupeFirst([
      ...attachedBCandidates,
      ...sideBSnaps,
    ]).slice(0, 6);
    this.extrusionMatchDebug = [...sideAPool, ...sideBPool];
    const bestCap = capSnaps[0] || null;
    const allActiveAxes = this.axes();
    const makeCapConstraint = (snap) => ({
      movingEdge: "cap",
      direction: snap.direction,
      origin: snap.cornerSnap,
      targetBrushId: snap.targetBrushId,
      targetFaceIndex: snap.targetFaceIndex,
    });
    const makeSideConstraint = (snap) => ({
      movingEdge: snap.movingEdge,
      direction: snap.railDirection,
      canonicalKey: snap.canonicalKey,
      lineOrigin: snap.lineOrigin,
      origin: {
        x: snap.movingEdge === "sideA" ? baseA.x : baseB.x,
        y: snap.movingEdge === "sideA" ? baseA.y : baseB.y,
      },
      targetBrushId: snap.targetBrushId,
      targetFaceIndex: snap.targetFaceIndex,
    });

    // Starting rail state: evaluates cross-product of attached
    // candidates after the drag moves a few pixels, locks the best
    // valid pair together. Once locked, hard rails are mandatory.
    const screenDist = Math.hypot(current.x - start.x, current.y - start.y);
    if (this.drag) {
      this.drag.startRailState ||= "pending";
      if (this.drag.startRailState === "pending") {
        const probeDistance = Math.max(
          this.state.grid || 1,
          8 / Math.max(this.scale, 0.0001),
        );
        if (screenDist > 3 && (hardAPool.length || hardBPool.length)) {
          // Evaluate cross-product first, then fall back to a single hard rail.
          let bestPair = null;
          let bestScore = Infinity;
          const evalSet = hardAPool.length && hardBPool.length
            ? hardAPool.flatMap((sA) =>
                hardBPool.map((sB) => ({ sideA: sA, sideB: sB })),
              )
            : [];
          if (!evalSet.length) {
            for (const sA of hardAPool) evalSet.push({ sideA: sA, sideB: null });
            for (const sB of hardBPool) evalSet.push({ sideA: null, sideB: sB });
          }
          for (const pair of evalSet) {
            const cands = [];
            if (pair.sideA) cands.push(makeSideConstraint(pair.sideA));
            if (pair.sideB) cands.push(makeSideConstraint(pair.sideB));
            const sol = solveSingleFaceExtrusion({
              brush, faceIndex, distance: probeDistance,
              activeAxes: allActiveAxes, constraints: cands,
            });
            if (!sol?.cap) continue;
            const snapTarget = {
              type: "cross-section-rails",
              activeAxes: allActiveAxes,
              conforming: cands,
              finalCorners: {
                baseA: sol.baseA,
                baseB: sol.baseB,
                capA: sol.capA,
                capB: sol.capB,
              },
              distance: rawDistance,
            };
            const selection = this.drag?.selection || new Set([id]);
            const preview = extrudeSelectedFaces(
              JSON.parse(JSON.stringify(this.state.brushes)),
              selection,
              probeDistance,
              this.state.grid,
              this.drag?.guideSelection || selection,
              this.state.faceExtrusionMode,
              snapTarget,
            );
            if (!preview.previewBrushes.length || preview.errors.length) continue;
            const safeDistance = limitExtrusionDistance(
              this.state.brushes,
              selection,
              probeDistance,
              this.state.grid,
              this.drag?.guideSelection || selection,
              this.state.faceExtrusionMode,
              snapTarget,
            );
            if (!passesProbeValidation(safeDistance, probeDistance)) continue;
            // Score: perpendicular distance from each free cap to its rail
            let score = 0;
            if (pair.sideA) {
              const origin = pair.sideA.lineOrigin || baseA;
              const end = {
                x: origin.x + pair.sideA.railDirection.x,
                y: origin.y + pair.sideA.railDirection.y,
              };
              const d = distancePointToLine(freeCapA2D, origin, end);
              score += d;
            }
            if (pair.sideB) {
              const origin = pair.sideB.lineOrigin || baseB;
              const end = {
                x: origin.x + pair.sideB.railDirection.x,
                y: origin.y + pair.sideB.railDirection.y,
              };
              const d = distancePointToLine(freeCapB2D, origin, end);
              score += d;
            }
            if (score < bestScore) {
              bestScore = score;
              bestPair = pair;
            }
          }
          if (!bestPair) {
            for (const pair of [
              ...hardAPool.map((sA) => ({ sideA: sA, sideB: null })),
              ...hardBPool.map((sB) => ({ sideA: null, sideB: sB })),
            ]) {
              const cands = [];
              if (pair.sideA) cands.push(makeSideConstraint(pair.sideA));
              if (pair.sideB) cands.push(makeSideConstraint(pair.sideB));
              const sol = solveSingleFaceExtrusion({
                brush, faceIndex, distance: probeDistance,
                activeAxes: allActiveAxes, constraints: cands,
              });
              if (!sol?.cap) continue;
              const snapTarget = {
                type: "cross-section-rails",
                activeAxes: allActiveAxes,
                conforming: cands,
                finalCorners: {
                  baseA: sol.baseA,
                  baseB: sol.baseB,
                  capA: sol.capA,
                  capB: sol.capB,
                },
                distance: probeDistance,
              };
              const selection = this.drag?.selection || new Set([id]);
              const preview = extrudeSelectedFaces(
                JSON.parse(JSON.stringify(this.state.brushes)),
                selection,
                probeDistance,
                this.state.grid,
                this.drag?.guideSelection || selection,
                this.state.faceExtrusionMode,
                snapTarget,
              );
              if (!preview.previewBrushes.length || preview.errors.length) continue;
              const safeDistance = limitExtrusionDistance(
                this.state.brushes,
                selection,
                probeDistance,
                this.state.grid,
                this.drag?.guideSelection || selection,
                this.state.faceExtrusionMode,
                snapTarget,
              );
              if (!passesProbeValidation(safeDistance, probeDistance)) continue;
              bestPair = pair;
              break;
            }
          }
          if (bestPair) {
            this.drag.startRailPair = bestPair;
            this.drag.startRailState = "locked";
          } else if (!hardAPool.length && !hardBPool.length) {
            this.drag.startRailState = "none";
          }
        }
      }
    }
    const hardPair = this.drag?.startRailPair || null;
    const hardSideA = hardPair?.sideA || null;
    const hardSideB = hardPair?.sideB || null;

    // Try constraint combinations in priority order (most→least constrained).
    const tryConstraints = (candidates) => {
      const sol = solveSingleFaceExtrusion({
        brush, faceIndex, distance: rawDistance,
        activeAxes: allActiveAxes,
        constraints: candidates,
      });
      if (!sol?.cap) return null;
      const finalCorners = {
        baseA: sol.baseA, baseB: sol.baseB,
        capA: sol.capA, capB: sol.capB,
      };
      return {
        finalCorners,
        solvedEdges: sol.solvedEdges,
        snapTarget: {
          type: "cross-section-rails",
          activeAxes: allActiveAxes,
          conforming: candidates,
          finalCorners,
          targetBrushIds: [...new Set(candidates.map((c) => c.targetBrushId))],
          distance: rawDistance,
        },
      };
    };

    // Evaluate candidate combinations. Starting rails (hardSideA/B)
    // are mandatory for the entire drag and must appear in every
    // combination. Fallback cannot drop a hard rail.
    let result = null;
    const capCon = bestCap ? [makeCapConstraint(bestCap)] : [];

    if (hardSideA && hardSideB) {
      // Both hard rails exist: must include both.
      const cA = makeSideConstraint(hardSideA);
      const cB = makeSideConstraint(hardSideB);
      if (capCon.length) result = tryConstraints([...capCon, cA, cB]);
      if (!result) result = tryConstraints([cA, cB]);
    } else if (hardSideA) {
      // Hard sideA exists: must include it. Try with each soft sideB.
      const cA = makeSideConstraint(hardSideA);
      for (const sB of sideBPool) {
        const cB = makeSideConstraint(sB);
        if (capCon.length) result = tryConstraints([...capCon, cA, cB]);
        if (!result) result = tryConstraints([cA, cB]);
        if (result) break;
      }
      if (!result && !sideBPool.length && capCon.length)
        result = tryConstraints([...capCon, cA]);
      if (!result && !sideBPool.length) result = tryConstraints([cA]);
    } else if (hardSideB) {
      // Hard sideB exists: must include it. Try with each soft sideA.
      const cB = makeSideConstraint(hardSideB);
      for (const sA of sideAPool) {
        const cA = makeSideConstraint(sA);
        if (capCon.length) result = tryConstraints([...capCon, cA, cB]);
        if (!result) result = tryConstraints([cA, cB]);
        if (result) break;
      }
      if (!result && !sideAPool.length && capCon.length)
        result = tryConstraints([...capCon, cB]);
      if (!result && !sideAPool.length) result = tryConstraints([cB]);
    } else {
      // No hard rails: free cross-product fallback.
      if (sideAPool.length && sideBPool.length) {
        for (const sA of sideAPool) {
          for (const sB of sideBPool) {
            const cA = [makeSideConstraint(sA)];
            const cB = [makeSideConstraint(sB)];
            result = tryConstraints([...capCon, ...cA, ...cB]);
            if (result) break;
            result = tryConstraints([...cA, ...cB]);
            if (result) break;
          }
          if (result) break;
        }
      }
      if (!result && !sideBPool.length && capCon.length) {
        for (const sA of sideAPool) {
          result = tryConstraints([...capCon, makeSideConstraint(sA)]);
          if (result) break;
        }
      }
      if (!result && !sideAPool.length && capCon.length) {
        for (const sB of sideBPool) {
          result = tryConstraints([...capCon, makeSideConstraint(sB)]);
          if (result) break;
        }
      }
      if (!result && !sideBPool.length) {
        for (const sA of sideAPool) {
          result = tryConstraints([makeSideConstraint(sA)]);
          if (result) break;
        }
      }
      if (!result && !sideAPool.length) {
        for (const sB of sideBPool) {
          result = tryConstraints([makeSideConstraint(sB)]);
          if (result) break;
        }
      }
      if (!result && capCon.length) result = tryConstraints(capCon);
    }

    // Keep the rail lock through a temporary invalid distance. Only this
    // pointer frame is blocked, so moving back to valid geometry recovers.
    if (this.drag) {
      this.drag.geometryBlocked = !result && Boolean(hardSideA || hardSideB);
      this.drag.geometryBlockedReason = this.drag.geometryBlocked
        ? "locked support rails have no valid solution at this distance"
        : null;
      if (result && this.drag.startRailPair)
        this.drag.startRailState = "locked";
    }

    this.extrusionCandidate = result
      ? {
          candidateType: "conforming",
          distance: rawDistance,
          matchCount: result.snapTarget.conforming.length,
          snapTarget: result.snapTarget,
          solvedEdges: result.solvedEdges,
        }
      : null;
    if (this.drag && result?.snapTarget?.conforming) {
      this.drag.sideRailLocks = Object.fromEntries(
        result.snapTarget.conforming
          .filter((constraint) => constraint.movingEdge !== "cap")
          .map((constraint) => [constraint.movingEdge, constraint.canonicalKey])
          .filter((entry) => entry[1]),
      );
    }
    if (this.drag) this.drag.extrusionCandidate = this.extrusionCandidate;
    if (result?.solvedEdges) {
      this.extrusionSolvedDebug = this.toScreenEdges(result.solvedEdges);
    } else {
      this.extrusionSolvedDebug = null;
    }

    return rawDistance;
  }
  edgeViewForFace(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]),
      face = brush?.faces[Number(match?.[2])];
    if (!brush || !face) return this.kind;
    const normal = this.faceNormal(brush, face),
      candidates = [
        ["top", Math.abs(normal.z)],
        ["front", Math.abs(normal.x)],
        ["side", Math.abs(normal.y)],
      ];
    candidates.sort((a, b) => a[1] - b[1]);
    return candidates[0][0];
  }
  brushIntersectsBox(brush, box) {
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
  selectionOperation(event) {
    if (this.state.mode === "face")
      return event.ctrlKey || event.metaKey ? "toggle" : "replace";
    return event.altKey
      ? "remove"
      : event.ctrlKey || event.metaKey
        ? "toggle"
        : event.shiftKey
          ? "add"
          : "replace";
  }
  bindPaintSelection() {
    this.canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (this.state.mode !== "vertex" || event.button !== 0) return;
        const nearest = this.vertexPoints().find(
          (point) =>
            Math.hypot(point.x - event.offsetX, point.y - event.offsetY) <= 9,
        );
        if (
          !nearest ||
          (!event.altKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            this.state.selection.has(nearest.id))
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.canvas.setPointerCapture(event.pointerId);
        this.drag = {
          type: "paint",
          radius: 14,
          operation: this.selectionOperation(event),
          painted: new Set([nearest.id]),
          originalSelection: new Set(this.state.selection),
        };
        this.state.selection = applySelection(
          this.state.selection,
          [nearest.id],
          this.drag.operation,
        );
        this.requestDraw();
      },
      true,
    );
    this.canvas.addEventListener(
      "pointermove",
      (event) => {
        if (this.drag?.type !== "paint") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const selected = selectByShape(
          this.vertexPoints(),
          { x: event.offsetX, y: event.offsetY, r: this.drag.radius },
          "circle",
        ).filter((point) => !this.drag.painted.has(point.id));
        selected.forEach((point) => this.drag.painted.add(point.id));
        this.state.selection = applySelection(
          this.state.selection,
          selected.map((point) => point.id),
          this.drag.operation,
        );
        this.requestDraw();
      },
      true,
    );
    this.canvas.addEventListener(
      "pointerup",
      (event) => {
        if (this.drag?.type !== "paint") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.drag = null;
        this.onChange("selection-commit");
      },
      true,
    );
  }
  bind() {
    this.canvas.addEventListener("pointerdown", () =>
      this.canvas.focus({ preventScroll: true }),
    );
    this.canvas.addEventListener("pointerdown", (event) => {
      if (
        event.button === 1 ||
        (event.button === 0 && this.state.tool === "pan")
      ) {
        this.canvas.setPointerCapture(event.pointerId);
        this.drag = {
          type: "pan",
          startX: event.clientX,
          startY: event.clientY,
          offsetX: this.offset.x,
          offsetY: this.offset.y,
        };
        return;
      }
      if (event.button !== 0) return;
      if (this.state.mode === "brush" && this.creationBox) {
        const handle = this.creationHandleAt(event.offsetX, event.offsetY);
        if (handle) {
          this.canvas.setPointerCapture(event.pointerId);
          this.drag = {
            type: "creation-transform",
            handle: handle.type,
            original: handle,
            start: { x: event.offsetX, y: event.offsetY },
          };
          return;
        }
      }
      if (this.state.mode === "selection") {
        const handle = this.objectHandleAt(event.offsetX, event.offsetY);
        if (handle) {
          this.beginObjectTransform(handle, event);
          this.onChange(true);
          return;
        }
      }
      if (this.state.mode === "face") {
        const operation = this.selectionOperation(event),
          fillLoop =
            this.state.faceToolMode === "fill"
              ? this.faceLoopAt(event.offsetX, event.offsetY)
              : null,
          hit = this.faceAt(event.offsetX, event.offsetY, operation);
        if (fillLoop) {
          this.state.faceSelection = new Set(fillLoop.faceIds);
          this.hoverFillPolygon = fillLoop.polygon;
          this.onChange("selection-commit");
          return;
        }
        if (hit) {
          const originalSelection = new Set(this.state.faceSelection),
            selected = this.compatibleFaceIds(
              this.faceTargets(hit.id, operation),
              operation,
            );
          this.state.faceSelection = applySelection(
            this.state.faceSelection,
            selected,
            operation,
          );
          if (operation === "toggle") {
            this.canvas.setPointerCapture(event.pointerId);
            this.drag = {
              type: "face-paint",
              operation,
              painted: new Set([hit.id]),
              group: this.faceGroup(hit.id),
              inclination: this.faceInclination(hit.id),
            };
            this.onChange(true);
            return;
          }
          if (selected.length && this.state.faceToolMode === "extrude") {
            this.canvas.setPointerCapture(event.pointerId);
            this.drag = {
              type: "face-extrude",
              faceId: hit.id,
              selection: new Set(this.state.faceSelection),
              guideSelection: new Set(this.state.faceSelection),
              originalSelection,
              start: { x: event.offsetX, y: event.offsetY },
              current: { x: event.offsetX, y: event.offsetY },
              distance: 0,
            };
            this.onChange(true);
          } else if (selected.length) this.onChange("selection-commit");
          else this.onChange("face-incompatible");
          return;
        }
      }
      const nearest =
          this.state.mode === "vertex"
            ? this.vertexPoints().find(
                (point) =>
                  Math.hypot(
                    point.x - event.offsetX,
                    point.y - event.offsetY,
                  ) <= 9,
              )
            : null,
        brush = this.brushAt(event.offsetX, event.offsetY);
      if (
        (this.state.mode === "vertex" &&
          nearest &&
          this.state.selection.has(nearest.id)) ||
        (this.state.mode === "selection" && brush)
      ) {
        const original = new Map();
        let movingBrushes = new Set(),
          cloneDrag = false;
        if (this.state.mode === "selection") {
          cloneDrag = event.shiftKey && this.state.brushSelection.has(brush.id);
          const target =
            this.state.selectionScope === "group"
              ? this.state.brushes
                  .filter(
                    (item) =>
                      (item.groupId || item.id) === (brush.groupId || brush.id),
                  )
                  .map((item) => item.id)
              : [brush.id];
          const operation = cloneDrag
            ? "replace"
            : this.selectionOperation(event);
          const keepCurrent =
            operation === "replace" && this.state.brushSelection.has(brush.id);
          this.state.brushSelection =
            cloneDrag || keepCurrent
              ? new Set(this.state.brushSelection)
              : applySelection(this.state.brushSelection, target, operation);
          movingBrushes = new Set(this.state.brushSelection);
          this.onChange(true);
          if (operation !== "replace") {
            this.onChange("selection-commit");
            return;
          }
          if (!movingBrushes.has(brush.id)) {
            this.onChange("selection-commit");
            return;
          }
        }
        for (const item of this.state.brushes)
          item.vertices.forEach((vertex, index) => {
            const id = `${item.id}:v:${index}`;
            if (
              this.state.mode === "vertex"
                ? this.state.selection.has(id)
                : movingBrushes.has(item.id)
            )
              original.set(id, { ...vertex });
          });
        this.canvas.setPointerCapture(event.pointerId);
        this.drag = {
          type: "move",
          start: { x: event.offsetX, y: event.offsetY },
          original,
          moved: false,
          clonePending: cloneDrag,
          cloned: false,
          sourceBrushIds: new Set(movingBrushes),
        };
        return;
      }
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = {
        type: "box",
        x: event.offsetX,
        y: event.offsetY,
        currentX: event.offsetX,
        currentY: event.offsetY,
        operation: this.selectionOperation(event),
        dragged: false,
      };
      this.draw();
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.drag) {
        const operation = this.selectionOperation(event);
        const fillLoop =
          this.state.mode === "face" && this.state.faceToolMode === "fill"
            ? this.faceLoopAt(event.offsetX, event.offsetY)
            : null;
        const face =
          this.state.mode === "face"
            ? this.faceAt(event.offsetX, event.offsetY, operation)
            : null;
        this.hoverFillPolygon = fillLoop?.polygon || null;
        this.hoverFaceIds = new Set(
          fillLoop
            ? fillLoop.faceIds
            : face
              ? this.compatibleFaceIds(
                  this.faceTargets(face.id, operation),
                  operation,
                )
              : [],
        );
        this.requestDraw();
        return;
      }
      if (this.drag.type === "face-paint") {
        const hit = this.faceAt(event.offsetX, event.offsetY, "toggle");
        if (
          hit &&
          !this.drag.painted.has(hit.id) &&
          Math.abs(this.faceInclination(hit.id) - this.drag.inclination) <=
            Math.PI / 90
        ) {
          this.drag.painted.add(hit.id);
          this.state.faceSelection = applySelection(
            this.state.faceSelection,
            [hit.id],
            "toggle",
          );
          this.requestDraw();
        }
        return;
      }
      if (this.drag.type === "face-extrude") {
        this.drag.current = { x: event.offsetX, y: event.offsetY };
        this.drag.distance = this.faceExtrusionDistance(
          this.drag.faceId,
          this.drag.start,
          this.drag.current,
        );
        this.drag.snapTarget = this.drag.extrusionCandidate?.snapTarget || null;
        // A failed solve blocks only this pointer frame; the locked pair is
        // retained and retried as the pointer moves.
        if (this.drag.geometryBlocked) {
          this.drag.distance = 0;
        }
        if (this.drag.forwardSnapBlocked) this.drag.distance = 0;
        this.drag.distance = limitExtrusionDistance(
          this.state.brushes,
          this.drag.selection,
          this.drag.distance,
          this.state.grid,
          this.drag.guideSelection,
          this.state.faceExtrusionMode,
          this.drag.snapTarget,
        );
        // Mark as resolved: pointerup must commit the exact preview
        // result without re-running collision limiting.
        this.drag.extrusionResolved = true;
        // When the collision limiter reduced distance for snapped
        // geometry, convert to corner-snap with interpolated corners.
        if (
          this.drag.snapTarget?.finalCorners &&
          this.drag.distance < this.drag.snapTarget.distance
        ) {
          const alpha =
            this.drag.snapTarget.distance > 0
              ? this.drag.distance / this.drag.snapTarget.distance
              : 0;
          const { baseA, baseB, capA, capB } =
            this.drag.snapTarget.finalCorners;
          this.drag.snapTarget = {
            type: "corner-snap",
            activeAxes: this.drag.snapTarget.activeAxes,
            snapA: {
              x: baseA.x + (capA.x - baseA.x) * alpha,
              y: baseA.y + (capA.y - baseA.y) * alpha,
            },
            snapB: {
              x: baseB.x + (capB.x - baseB.x) * alpha,
              y: baseB.y + (capB.y - baseB.y) * alpha,
            },
            brushes: this.state.brushes,
            distance: this.drag.distance,
          };
        }
        if (this.drag.distance > 0) {
          const previewSource = JSON.parse(JSON.stringify(this.state.brushes));
          const preview = extrudeSelectedFaces(
            previewSource,
            this.drag.selection,
            this.drag.distance,
            this.state.grid,
            this.drag.guideSelection,
            this.state.faceExtrusionMode,
            this.drag.snapTarget,
          );
          this.previewBrushes = preview.previewBrushes || preview.brushes;
          this.previewErrors = preview.errors;
          const limitedTarget = this.drag.snapTarget;
          const limitedFaceMatch = this.drag.faceId?.match(/^(.*):f:(\d+)$/);
          const limitedBrush =
            limitedFaceMatch &&
            this.state.brushes.find((item) => item.id === limitedFaceMatch[1]);
          const limitedFaceIndex = Number(limitedFaceMatch?.[2]);
          const limitedSolved =
            limitedTarget?.type === "corner-snap" && limitedBrush
              ? solveCornerSnappedExtrusion({
                  brush: limitedBrush,
                  faceIndex: limitedFaceIndex,
                  distance: this.drag.distance,
                  activeAxes: limitedTarget.activeAxes,
                  snapA: limitedTarget.snapA,
                  snapB: limitedTarget.snapB,
                })?.solvedEdges
              : null;
          const candidateSolved =
            limitedSolved ||
            this.drag.extrusionCandidate?.solvedEdges ||
            this.drag.extrusionCandidate?.snapTarget?.solvedEdges;
          if (candidateSolved) {
            this.extrusionSolvedDebug = this.toScreenEdges(candidateSolved);
          } else {
            this.extrusionSolvedDebug = null;
          }
        } else {
          this.previewBrushes = [];
          this.previewErrors = [];
          this.extrusionSolvedDebug = null;
        }
        this.requestDraw();
        return;
      }
      if (this.drag.type === "pan") {
        this.offset.x = this.drag.offsetX + event.clientX - this.drag.startX;
        this.offset.y = this.drag.offsetY + event.clientY - this.drag.startY;
        this.requestDraw();
        return;
      }
      if (this.drag.type === "move") {
        const start = this.world(this.drag.start),
          after = this.world({ x: event.offsetX, y: event.offsetY }),
          axes = this.axes(),
          delta = { x: 0, y: 0, z: 0 };
        delta[axes[0]] = roundToGrid(
          after[axes[0]] - start[axes[0]],
          this.state.grid,
        );
        delta[axes[1]] = roundToGrid(
          after[axes[1]] - start[axes[1]],
          this.state.grid,
        );
        if (
          this.drag.clonePending &&
          !this.drag.cloned &&
          (delta[axes[0]] !== 0 || delta[axes[1]] !== 0)
        ) {
          const copies = duplicateBrushes(
            this.state.brushes,
            this.drag.sourceBrushIds,
          );
          copies.forEach((brush) =>
            brush.vertices.forEach((vertex, index) =>
              this.drag.original.set(`${brush.id}:v:${index}`, { ...vertex }),
            ),
          );
          this.state.brushes.push(...copies);
          this.state.brushSelection = new Set(copies.map((brush) => brush.id));
          this.drag.cloned = true;
        }
        for (const brush of this.state.brushes)
          brush.vertices.forEach((vertex, index) => {
            const original = this.drag.original.get(`${brush.id}:v:${index}`);
            if (original) Object.assign(vertex, original);
          });
        if (this.state.mode === "vertex")
          moveVertices(
            this.state.brushes,
            this.state.selection,
            delta,
            this.state.grid,
            false,
          );
        else
          moveBrushes(
            this.state.brushes,
            this.state.brushSelection,
            delta,
            this.state.grid,
            false,
          );
        this.drag.moved = delta[axes[0]] !== 0 || delta[axes[1]] !== 0;
        this.requestDraw();
        return;
      }
      if (this.drag.type === "object-transform") {
        for (const brush of this.state.brushes)
          brush.vertices.forEach((vertex, index) => {
            const original = this.drag.original.get(`${brush.id}:v:${index}`);
            if (original) Object.assign(vertex, original);
          });
        this.drag.moved = this.applyObjectTransform({
          x: event.offsetX,
          y: event.offsetY,
        });
        this.requestDraw();
        return;
      }
      if (this.drag.type === "creation-transform") {
        const axes = this.creationBox.axes,
          start = { ...this.drag.original.start },
          end = { ...this.drag.original.end },
          before = this.world(this.drag.start),
          current = this.world({ x: event.offsetX, y: event.offsetY });
        const [horizontal, vertical] = axes;
        if (this.drag.handle === "move") {
          const dx = roundToGrid(
              current[horizontal] - before[horizontal],
              this.state.grid,
            ),
            dy = roundToGrid(
              current[vertical] - before[vertical],
              this.state.grid,
            );
          start[horizontal] += dx;
          end[horizontal] += dx;
          start[vertical] += dy;
          end[vertical] += dy;
        } else {
          const min = {
              [horizontal]: Math.min(start[horizontal], end[horizontal]),
              [vertical]: Math.min(start[vertical], end[vertical]),
            },
            max = {
              [horizontal]: Math.max(start[horizontal], end[horizontal]),
              [vertical]: Math.max(start[vertical], end[vertical]),
            };
          if (this.drag.handle.includes("w"))
            min[horizontal] = Math.min(
              max[horizontal] - this.state.grid,
              roundToGrid(current[horizontal], this.state.grid),
            );
          if (this.drag.handle.includes("e"))
            max[horizontal] = Math.max(
              min[horizontal] + this.state.grid,
              roundToGrid(current[horizontal], this.state.grid),
            );
          // Screen Y is inverted by world(), so north moves the world max
          // and south moves the world min.
          if (this.drag.handle.includes("n"))
            max[vertical] = Math.max(
              min[vertical] + this.state.grid,
              roundToGrid(current[vertical], this.state.grid),
            );
          if (this.drag.handle.includes("s"))
            min[vertical] = Math.min(
              max[vertical] - this.state.grid,
              roundToGrid(current[vertical], this.state.grid),
            );
          start[horizontal] = min[horizontal];
          end[horizontal] = max[horizontal];
          start[vertical] = min[vertical];
          end[vertical] = max[vertical];
        }
        if (this.state.squareBox) {
          const [axX, axY] = axes;
          const w = end[axX] - start[axX];
          const h = end[axY] - start[axY];
          const size = Math.max(Math.abs(w), Math.abs(h));
          end[axX] = start[axX] + (w >= 0 ? size : -size);
          end[axY] = start[axY] + (h >= 0 ? size : -size);
        }
        this.creationBox = { ...this.creationBox, start, end };
        this.onBrushPreview(this.creationBox);
        this.requestDraw();
        return;
      }
      this.drag.currentX = event.offsetX;
      this.drag.currentY = event.offsetY;
      if (this.state.squareBox && this.drag.type === "box") {
        const dx = this.drag.currentX - this.drag.x;
        const dy = this.drag.currentY - this.drag.y;
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        this.drag.currentX = this.drag.x + (dx >= 0 ? size : -size);
        this.drag.currentY = this.drag.y + (dy >= 0 ? size : -size);
      }
      if (
        !this.drag.dragged &&
        Math.hypot(
          this.drag.currentX - this.drag.x,
          this.drag.currentY - this.drag.y,
        ) < 3
      )
        return;
      this.drag.dragged = true;
      if (this.drag.type === "face-extrude")
        this.canvas.style.cursor = "grabbing";
      else if (this.drag.type === "pan")
        this.canvas.style.cursor = "move";
      else
        this.canvas.style.cursor = "crosshair";
      this.requestDraw();
    });
    this.canvas.addEventListener("pointerup", () => {
      if (!this.drag) return;
      if (this.drag.type === "face-paint") {
        this.drag = null;
        this.onChange("selection-commit");
        this.requestDraw();
        return;
      }
      if (this.drag.type === "face-extrude") {
        const { selection, guideSelection, distance, faceId, snapTarget,
          extrusionResolved } = this.drag;
        this.previewBrushes = [];
        this.previewErrors = [];
        if (distance > 0)
          this.onExtrudeFaces(
            selection,
            distance,
            guideSelection,
            this.state.faceExtrusionMode,
            snapTarget,
            extrusionResolved,
          );
        this.drag = null;
        this.extrusionCandidate = null;
        this.extrusionMatchDebug = [];
        this.extrusionSolvedDebug = null;
        this.extrusionLocks = null;
        this.requestDraw();
        return;
      }
      if (this.drag.type === "object-transform") {
        const { moved } = this.drag;
        this.drag = null;
        // Positive scale and rotation are affine transforms. They preserve a
        // brush's convexity, so do not reject a resize for pre-existing map
        // validation issues outside this interaction.
        if (moved) this.onChange();
        else this.requestDraw();
        return;
      }
      if (this.drag.type === "creation-transform") {
        this.drag = null;
        this.onChange("brush-preview");
        return;
      }
      if (this.drag.type === "box") {
        if (this.state.mode === "brush" && this.drag.dragged) {
          const start = this.world({ x: this.drag.x, y: this.drag.y }),
            end = this.world({ x: this.drag.currentX, y: this.drag.currentY }),
            axes = this.axes();
          for (const axis of axes.slice(0, 2)) {
            start[axis] = roundToGrid(start[axis], this.state.grid);
            end[axis] = roundToGrid(end[axis], this.state.grid);
          }
          this.creationBox = { start, end, axes };
          this.onBrushPreview(this.creationBox);
          this.onChange("brush-preview");
        } else if (
          this.state.mode === "vertex" ||
          this.state.mode === "face" ||
          this.state.mode === "selection"
        ) {
          const minX = Math.min(this.drag.x, this.drag.currentX),
            maxX = Math.max(this.drag.x, this.drag.currentX),
            minY = Math.min(this.drag.y, this.drag.currentY),
            maxY = Math.max(this.drag.y, this.drag.currentY);
          if (this.state.mode === "vertex") {
            const selected = this.drag.dragged
              ? selectByShape(
                  this.vertexPoints(),
                  {
                    x: this.drag.x,
                    y: this.drag.y,
                    w: this.drag.currentX - this.drag.x,
                    h: this.drag.currentY - this.drag.y,
                  },
                  "box",
                )
              : [];
            this.state.selection = applySelection(
              this.state.selection,
              selected.map((point) => point.id),
              this.drag.operation,
            );
          } else if (this.state.mode === "face") {
            const selected = this.drag.dragged
              ? this.visibleBrushes().flatMap((brush) =>
                  brush.faces
                    .map((face, faceIndex) =>
                      this.faceIntersectsBox(brush, face, {
                        minX,
                        maxX,
                        minY,
                        maxY,
                      })
                        ? `${brush.id}:f:${faceIndex}`
                        : null,
                    )
                    .filter(Boolean),
                )
              : [];
            const targets =
              this.drag.operation === "replace" &&
              this.state.faceSelectionScope === "group"
                ? [
                    ...new Set(
                      selected.flatMap((id) =>
                        this.faceTargets(id, this.drag.operation),
                      ),
                    ),
                  ]
                : selected;
            const compatible = this.compatibleFaceIds(
              targets,
              this.drag.operation,
            );
            this.state.faceSelection = applySelection(
              this.state.faceSelection,
              compatible,
              this.drag.operation,
            );
          } else if (this.state.mode === "selection") {
            const hit = this.drag.dragged
              ? this.visibleBrushes().filter((brush) =>
                  this.brushIntersectsBox(brush, { minX, maxX, minY, maxY }),
                )
              : [];
            const groups =
              this.state.selectionScope === "group"
                ? new Set(hit.map((brush) => brush.groupId || brush.id))
                : null;
            const selected = groups
              ? this.visibleBrushes()
                  .filter((brush) => groups.has(brush.groupId || brush.id))
                  .map((brush) => brush.id)
              : hit.map((brush) => brush.id);
            this.state.brushSelection = applySelection(
              this.state.brushSelection,
              selected,
              this.drag.operation,
            );
          }
          this.onChange("selection-commit");
        }
      } else if (this.drag.type === "move")
        this.onChange(
          this.drag.cloned
            ? "duplicate-commit"
            : this.drag.moved
              ? false
              : "selection-commit",
        );
      this.drag = null;
      this.requestDraw();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverFaceIds.clear();
      this.canvas.style.cursor = "";
      this.requestDraw();
    });
    this.canvas.addEventListener("dragstart", (e) => e.preventDefault());
    this.canvas.addEventListener("pointercancel", () =>
      this.cancelInteraction(),
    );
    this.canvas.addEventListener("lostpointercapture", () => {
      if (this.drag) this.cancelInteraction();
      this.canvas.style.cursor = "";
    });
    window.addEventListener("blur", () => {
      if (this.drag) this.cancelInteraction();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.drag) this.cancelInteraction();
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoomAt(
          event.offsetX,
          event.offsetY,
          event.deltaY > 0 ? 1 / 1.2 : 1.2,
        );
      },
      { passive: false },
    );
  }
  zoomAt(x, y, factor) {
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
  focus() {
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
  centerWorld() {
    this.offset = { x: 0, y: 0 };
    this.draw();
  }
  drawGrid(context, width, height) {
    let spacing = this.state.grid;
    const minX = (-width / 2 - this.offset.x) / this.scale,
      maxX = (width / 2 - this.offset.x) / this.scale,
      minY = (-height / 2 + this.offset.y) / this.scale,
      maxY = (height / 2 + this.offset.y) / this.scale;
    while (spacing * this.scale < 2) spacing *= 2;
    const hideSmallGrid = spacing * this.scale < 4,
      firstX = Math.floor(minX / spacing),
      lastX = Math.ceil(maxX / spacing),
      firstY = Math.floor(minY / spacing),
      lastY = Math.ceil(maxY / spacing);
    context.lineWidth = 0.75;
    for (let index = firstX; index <= lastX; index++) {
      const x = index * spacing,
        screenX = width / 2 + x * this.scale + this.offset.x,
        is1024 = x !== 0 && Math.abs(x % 1024) < 0.000001,
        highlighted =
          x !== 0 && (Math.abs(x % 64) < 0.000001 || index % 8 === 0);
      if (hideSmallGrid && !is1024 && !highlighted) continue;
      context.strokeStyle = is1024
        ? COLORS.grid1024
        : highlighted
          ? COLORS.highlightedGrid
          : COLORS.grid;
      context.lineWidth = is1024 || highlighted ? 1 : 0.6;
      context.beginPath();
      context.moveTo(screenX, 0);
      context.lineTo(screenX, height);
      context.stroke();
    }
    for (let index = firstY; index <= lastY; index++) {
      const y = index * spacing,
        screenY = height / 2 - y * this.scale + this.offset.y,
        is1024 = y !== 0 && Math.abs(y % 1024) < 0.000001,
        highlighted =
          y !== 0 && (Math.abs(y % 64) < 0.000001 || index % 8 === 0);
      if (hideSmallGrid && !is1024 && !highlighted) continue;
      context.strokeStyle = is1024
        ? COLORS.grid1024
        : highlighted
          ? COLORS.highlightedGrid
          : COLORS.grid;
      context.lineWidth = is1024 || highlighted ? 1 : 0.6;
      context.beginPath();
      context.moveTo(0, screenY);
      context.lineTo(width, screenY);
      context.stroke();
    }
    context.lineWidth = 1;
  }
  drawTextureAxes(context) {
    const [horizontal, vertical, depth] = this.axes(),
      component = { x: 0, y: 1, z: 2 },
      selected = new Set(this.state.brushSelection);
    this.state.selection.forEach((id) => selected.add(id.split(":v:")[0]));
    const brushes = selected.size
      ? this.visibleBrushes().filter((brush) => selected.has(brush.id))
      : this.visibleBrushes();
    const drawAxis = (origin, vector, color, label) => {
      const dx = vector[component[horizontal]],
        dy = -vector[component[vertical]],
        magnitude = Math.hypot(dx, dy);
      if (magnitude < 0.001) return;
      const end = {
        x: origin.x + (dx / magnitude) * 18,
        y: origin.y + (dy / magnitude) * 18,
      };
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(origin.x, origin.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.beginPath();
      context.arc(end.x, end.y, 2.5, 0, Math.PI * 2);
      context.fill();
      context.font = "9px Tahoma";
      context.fillText(label, end.x + 4, end.y - 3);
    };
    const viewSign = this.kind === "side" ? -1 : 1;
    for (const brush of brushes) {
      const brushCenter = brush.vertices.reduce(
        (sum, vertex) => ({
          x: sum.x + vertex.x / brush.vertices.length,
          y: sum.y + vertex.y / brush.vertices.length,
          z: sum.z + vertex.z / brush.vertices.length,
        }),
        { x: 0, y: 0, z: 0 },
      );
      brush.faces.forEach((face, faceIndex) => {
        const center = face.reduce(
            (sum, vertexIndex) => ({
              x: sum.x + brush.vertices[vertexIndex].x / face.length,
              y: sum.y + brush.vertices[vertexIndex].y / face.length,
              z: sum.z + brush.vertices[vertexIndex].z / face.length,
            }),
            { x: 0, y: 0, z: 0 },
          ),
          a = brush.vertices[face[0]],
          b = brush.vertices[face[1]],
          c = brush.vertices[face[2]],
          normal = {
            x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
            y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
            z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
          },
          outward = {
            x: center.x - brushCenter.x,
            y: center.y - brushCenter.y,
            z: center.z - brushCenter.z,
          };
        if (
          normal.x * outward.x + normal.y * outward.y + normal.z * outward.z <
          0
        ) {
          normal.x *= -1;
          normal.y *= -1;
          normal.z *= -1;
        }
        const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
        if ((normal[depth] * viewSign) / length <= 0.001) return;
        const textureAxes = brush.textureAxes?.[faceIndex] || {
            u: [1, 0, 0],
            v: [0, -1, 0],
          },
          origin = this.screen(center);
        drawAxis(origin, textureAxes.u || [1, 0, 0], "#ff6b6b", "U");
        drawAxis(origin, textureAxes.v || [0, -1, 0], "#6bff8b", "V");
      });
    }
  }
  draw() {
    const context = this.ctx,
      rect = this.rect,
      width = Math.max(1, Math.round(rect.width)),
      height = Math.max(1, Math.round(rect.height));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    context.fillStyle = "#111824";
    context.fillRect(0, 0, width, height);
    context.lineWidth = 1;
    this.drawGrid(context, width, height);
    const origin = this.screen({ x: 0, y: 0, z: 0 });
    context.strokeStyle = COLORS.axis;
    context.beginPath();
    context.moveTo(0, origin.y);
    context.lineTo(width, origin.y);
    context.moveTo(origin.x, 0);
    context.lineTo(origin.x, height);
    context.stroke();
    if (
      this.state.mode === "face" &&
      this.state.faceToolMode === "fill" &&
      this.hoverFillPolygon?.length
    ) {
      context.fillStyle = "#ffc92833";
      context.strokeStyle = COLORS.faceHover;
      context.lineWidth = 3;
      context.beginPath();
      this.hoverFillPolygon.forEach((point, index) =>
        index
          ? context.lineTo(point.x, point.y)
          : context.moveTo(point.x, point.y),
      );
      context.closePath();
      context.fill();
      context.stroke();
      context.lineWidth = 1;
    }
    const previewIds = new Set([
      ...this.previewBrushes.map((brush) => brush.id),
      ...this.creationPreviewBrushes.map((brush) => brush.id),
    ]);
    for (const brush of [
      ...this.visibleBrushes(),
      ...this.previewBrushes,
      ...this.creationPreviewBrushes,
    ])
      for (const [faceIndex, face] of brush.faces.entries()) {
        const id = `${brush.id}:f:${faceIndex}`,
          selectedFace = this.state.faceSelection?.has(id);
        context.beginPath();
        face.forEach((index, faceIndex) => {
          const point = this.screen(brush.vertices[index]);
          faceIndex
            ? context.lineTo(point.x, point.y)
            : context.moveTo(point.x, point.y);
        });
        context.closePath();
        if (previewIds.has(brush.id)) {
          context.fillStyle = this.previewErrors.length
            ? "#ff405544"
            : "#ffc92822";
          context.fill();
        }
        if (selectedFace) {
          context.fillStyle = "#ffff0033";
          context.fill();
        }
        context.strokeStyle =
          previewIds.has(brush.id) && this.previewErrors.length
            ? COLORS.invalid
            : this.state.brushSelection?.has(brush.id) || selectedFace
              ? COLORS.selected
              : COLORS.line;
        context.lineWidth = 1;
        context.stroke();
      }
    if (
      this.state.mode === "face" &&
      (this.drag?.type === "face-extrude" ||
        (this.extrusionMatchDebug && this.extrusionMatchDebug.length > 0))
    ) {
      // Multi-color debug overlay. Each line gets a distinct color so the
      // user can tell at a glance which solved/target/moving/base line
      // is which.
      const SOLVED = {
        sideA: "#ff4266",
        cap: "#19d97a",
        sideB: "#4dabf7",
        base: "#19d97a",
      };

      // Draw solved CAP, SIDE, and BASE edges with black outline.
      // Cap (the edge the mouse is dragging) and base (the source
      // edge) are both green; base is dashed, cap is solid.
      const solved = this.extrusionSolvedDebug || {};
      for (const key of ["sideA", "sideB", "cap", "base"]) {
        const pair = solved[key];
        if (!pair) continue;
        const dx = pair[1].x - pair[0].x;
        const dy = pair[1].y - pair[0].y;
        if (dx * dx + dy * dy < 1) continue;
        const color = SOLVED[key] || "#ffffff";
        context.strokeStyle = "#000000";
        context.lineWidth = 12;
        context.lineCap = "round";
        context.setLineDash(key === "base" ? [3, 3] : []);
        context.beginPath();
        context.moveTo(pair[0].x, pair[0].y);
        context.lineTo(pair[1].x, pair[1].y);
        context.stroke();
        context.strokeStyle = color;
        context.lineWidth = 8;
        context.beginPath();
        context.moveTo(pair[0].x, pair[0].y);
        context.lineTo(pair[1].x, pair[1].y);
        context.stroke();
        context.setLineDash([]);
      }

      // Draw candidate support lines separately from their finite target
      // segments. This makes continuation beyond a reversed endpoint visible.
      const [debugAxisX, debugAxisY] = this.axes();
      for (const rail of this.extrusionMatchDebug || []) {
        if (!rail.lineOrigin || !rail.railDirection) continue;
        const length = 4096;
        const lineA = { x: 0, y: 0, z: 0 };
        const lineB = { x: 0, y: 0, z: 0 };
        lineA[debugAxisX] = rail.lineOrigin.x - rail.railDirection.x * length;
        lineA[debugAxisY] = rail.lineOrigin.y - rail.railDirection.y * length;
        lineB[debugAxisX] = rail.lineOrigin.x + rail.railDirection.x * length;
        lineB[debugAxisY] = rail.lineOrigin.y + rail.railDirection.y * length;
        const supportA = this.screen(lineA);
        const supportB = this.screen(lineB);
        const targetA = this.screen(rail.targetStartWorld);
        const targetB = this.screen(rail.targetEndWorld);
        const color = rail.movingEdge === "sideA" ? "#ff4266" : "#4dabf7";
        context.strokeStyle = `${color}99`;
        context.lineWidth = 1;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(supportA.x, supportA.y);
        context.lineTo(supportB.x, supportB.y);
        context.stroke();
        context.strokeStyle = color;
        context.lineWidth = 4;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(targetA.x, targetA.y);
        context.lineTo(targetB.x, targetB.y);
        context.stroke();
      }

      // Draw persistent start rail target edges when hard rails
      // exist and the solver didn't already draw them.
      const [axX, axY] = this.axes();
      for (const rail of [
        this.drag?.startRailPair?.sideA,
        this.drag?.startRailPair?.sideB,
      ]) {
        if (!rail) continue;
        const color = rail.movingEdge === "sideA" ? "#ff426680" : "#4dabf780";
        const aPt = { x: 0, y: 0, z: 0 };
        aPt[axX] = rail.targetStartWorld[axX];
        aPt[axY] = rail.targetStartWorld[axY];
        const bPt = { x: 0, y: 0, z: 0 };
        bPt[axX] = rail.targetEndWorld[axX];
        bPt[axY] = rail.targetEndWorld[axY];
        const s0 = this.screen(aPt);
        const s1 = this.screen(bPt);
        context.strokeStyle = "#000000";
        context.lineWidth = 12; context.lineCap = "round"; context.setLineDash([]);
        context.beginPath(); context.moveTo(s0.x, s0.y); context.lineTo(s1.x, s1.y); context.stroke();
        context.strokeStyle = color;
        context.lineWidth = 8;
        context.beginPath(); context.moveTo(s0.x, s0.y); context.lineTo(s1.x, s1.y); context.stroke();
      }

      // 4) Legend
      context.font = "12px monospace";
      context.textBaseline = "top";
      const legend = [
        ["SIDE A", SOLVED.sideA],
        ["SIDE B", SOLVED.sideB],
        ["CAP", SOLVED.cap],
        ["BASE", SOLVED.base],
      ];
      let legendY = 10;
      for (const [label, color] of legend) {
        context.fillStyle = color;
        context.fillRect(12, legendY, 10, 10);
        context.fillStyle = "#ffffff";
        context.fillText(label, 26, legendY);
        legendY += 14;
      }

      // Extrusion length readout (like Hammer's info bar)
      if (this.drag?.distance > 0) {
        context.font = "14px monospace";
        context.fillStyle = "#ffffff";
        context.textBaseline = "top";
        const grid = this.state.grid || 1;
        const rounded = Math.round(this.drag.distance / grid) * grid;
        const decimals = grid >= 1 ? 0 : grid >= 0.125 ? 3 : 4;
        context.fillText(`L: ${rounded.toFixed(decimals)}`, 12, legendY + 4);
      }
    }
    if (this.state.mode === "selection") {
      const bounds = this.objectBounds();
      if (bounds) {
        const centerX = (bounds.minX + bounds.maxX) / 2,
          centerY = (bounds.minY + bounds.maxY) / 2;
        context.strokeStyle = COLORS.selected;
        context.setLineDash([5, 3]);
        context.strokeRect(
          bounds.minX,
          bounds.minY,
          bounds.maxX - bounds.minX,
          bounds.maxY - bounds.minY,
        );
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(centerX, bounds.minY);
        context.lineTo(centerX, bounds.minY - 28);
        context.stroke();
        for (const [x, y, rotate] of [
          [bounds.minX, bounds.minY],
          [centerX, bounds.minY],
          [bounds.maxX, bounds.minY],
          [bounds.maxX, centerY],
          [bounds.maxX, bounds.maxY],
          [centerX, bounds.maxY],
          [bounds.minX, bounds.maxY],
          [bounds.minX, centerY],
          [centerX, bounds.minY - 28, true],
        ]) {
          context.fillStyle = rotate ? COLORS.active : COLORS.selected;
          if (rotate) {
            context.beginPath();
            context.arc(x, y, 5, 0, Math.PI * 2);
            context.fill();
          } else context.fillRect(x - 4, y - 4, 8, 8);
        }
      }
    }
    if (this.state.mode === "face")
      for (const edge of this.exposedEdges()) {
        const hovered = [...edge.faceIds].some((id) =>
            this.hoverFaceIds.has(id),
          ),
          selected = [...edge.faceIds].some((id) =>
            this.state.faceSelection.has(id),
          );
        context.strokeStyle = hovered
          ? COLORS.faceHover
          : selected
            ? COLORS.selected
            : COLORS.line;
        context.lineWidth = hovered ? 4 : 3;
        context.beginPath();
        context.moveTo(edge.startScreen.x, edge.startScreen.y);
        context.lineTo(edge.endScreen.x, edge.endScreen.y);
        context.stroke();
      }
    if (this.state.mode === "face" && this.state.faceSelection.size) {
      context.strokeStyle = COLORS.selected;
      context.lineWidth = 4;
      const drawn = new Set();
      for (const id of this.state.faceSelection) {
        const match = id.match(/^(.*):f:(\d+)$/),
          brush =
            match && this.state.brushes.find((item) => item.id === match[1]),
          face = brush?.faces[Number(match?.[2])];
        if (!brush || !face) continue;
        for (let index = 0; index < face.length; index++) {
          const a = brush.vertices[face[index]],
            b = brush.vertices[face[(index + 1) % face.length]],
            key = [`${a.x},${a.y},${a.z}`, `${b.x},${b.y},${b.z}`]
              .sort()
              .join("|");
          if (drawn.has(key)) continue;
          drawn.add(key);
          const start = this.screen(a),
            end = this.screen(b);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.stroke();
        }
      }
    }
    context.lineWidth = 1;
    if (this.state.showTextureAxes) this.drawTextureAxes(context);
    if (this.state.mode === "vertex")
      for (const point of this.vertexPoints()) {
        context.fillStyle = this.state.selection.has(point.id)
          ? COLORS.selected
          : COLORS.vertex;
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          this.state.selection.has(point.id) ? 4 : 2.5,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    if ((this.drag?.type === "box" && this.drag.dragged) || this.creationBox) {
      let start, end;
      if (this.creationBox) {
        start = this.screen({ x: 0, y: 0, z: 0, ...this.creationBox.start });
        end = this.screen({ x: 0, y: 0, z: 0, ...this.creationBox.end });
      } else {
        start = { x: this.drag.x, y: this.drag.y };
        end = { x: this.drag.currentX, y: this.drag.currentY };
      }
      if (this.state.mode === "brush" && !this.creationBox) {
        const axes = this.axes(),
          startWorld = this.world(start),
          endWorld = this.world(end);
        for (const axis of axes.slice(0, 2)) {
          startWorld[axis] = roundToGrid(startWorld[axis], this.state.grid);
          endWorld[axis] = roundToGrid(endWorld[axis], this.state.grid);
        }
        start = this.screen({ x: 0, y: 0, z: 0, ...startWorld });
        end = this.screen({ x: 0, y: 0, z: 0, ...endWorld });
      }
      const x = Math.min(start.x, end.x),
        y = Math.min(start.y, end.y),
        boxWidth = Math.abs(end.x - start.x),
        boxHeight = Math.abs(end.y - start.y);
      context.fillStyle = "#66dde322";
      context.fillRect(x, y, boxWidth, boxHeight);
      context.strokeStyle = COLORS.active;
      context.setLineDash([5, 3]);
      context.strokeRect(x, y, boxWidth, boxHeight);
      context.setLineDash([]);
      // Dimension labels (like Hammer) — world-space width / height
      let dimW = 0, dimH = 0;
      if (this.creationBox) {
        const { start: cs, end: ce, axes: cAxes } = this.creationBox;
        const [axX, axY] = cAxes || this.axes();
        dimW = Math.abs((ce[axX] || 0) - (cs[axX] || 0));
        dimH = Math.abs((ce[axY] || 0) - (cs[axY] || 0));
      } else if (this.drag?.type === "box") {
        const sw = this.world(start),
          ew = this.world(end);
        const [axX, axY] = this.axes();
        dimW = Math.abs(ew[axX] - sw[axX]);
        dimH = Math.abs(ew[axY] - sw[axY]);
      }
      if (dimW > 0 || dimH > 0) {
        const grid = this.state.grid || 1;
        dimW = Math.round(dimW / grid) * grid;
        dimH = Math.round(dimH / grid) * grid;
        const dec = grid >= 1 ? 0 : 3;
        context.font = "11px monospace";
        context.fillStyle = "#ffc928";
        context.textBaseline = "bottom";
        context.fillText(`${dimW.toFixed(dec)}`, x + boxWidth / 2, y - 6);
        context.textBaseline = "top";
        context.fillText(`${dimH.toFixed(dec)}`, x + boxWidth + 6, y + boxHeight / 2);
      }
      context.fillStyle = COLORS.selected;
      for (const [handleX, handleY] of [
        [x, y],
        [x + boxWidth / 2, y],
        [x + boxWidth, y],
        [x + boxWidth, y + boxHeight / 2],
        [x + boxWidth, y + boxHeight],
        [x + boxWidth / 2, y + boxHeight],
        [x, y + boxHeight],
        [x, y + boxHeight / 2],
      ])
        context.fillRect(handleX - 4, handleY - 4, 8, 8);
    }
    if (this.drag?.type === "circle") {
      context.strokeStyle = COLORS.active;
      context.setLineDash([4, 3]);
      context.beginPath();
      context.arc(
        this.drag.x,
        this.drag.y,
        Math.hypot(
          this.drag.currentX - this.drag.x,
          this.drag.currentY - this.drag.y,
        ),
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.setLineDash([]);
    }
  }
}
