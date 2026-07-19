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
  limitExtrusionDistance,
  solveCapFromPlane,
  adjacentFaceForEdge,
  planeForFace,
} from "./face-extrusion.js";
import { validateBrush } from "./brush-validation.js";
import { duplicateBrushes } from "./geometry-model.js";
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

    const segmentDistance = (aStart, aEnd, bStart, bEnd) =>
      Math.min(
        pointSegmentDistance(aStart, bStart, bEnd),
        pointSegmentDistance(aEnd, bStart, bEnd),
        pointSegmentDistance(bStart, aStart, aEnd),
        pointSegmentDistance(bEnd, aStart, aEnd),
      );

    const snapCandidates = [],
      acquireRadius = 10,
      activeAxes = this.axes(),
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
    const baseAScreen = this.screen({
      x: 0,
      y: 0,
      z: 0,
    });
    baseAScreen.x = baseA.x;
    baseAScreen.y = baseA.y;
    const baseBScreen = {
      x: baseB.x,
      y: baseB.y,
    };

    const candidateRailsA = [],
      candidateRailsB = [];

    for (const targetBrush of this.visibleBrushes()) {
      if (sourceBrushIds.has(targetBrush.id)) continue;
      for (const [vi, vertex] of targetBrush.vertices.entries()) {
        const tv = this.screen(vertex);
        const distA = Math.hypot(tv.x - baseAScreen.x, tv.y - baseAScreen.y);
        const distB = Math.hypot(tv.x - baseBScreen.x, tv.y - baseBScreen.y);

        if (distA <= acquireRadius || distB <= acquireRadius) {
          // Collect target edges incident to this vertex
          const incidentEdges = [];
          for (let fi = 0; fi < targetBrush.faces.length; fi++) {
            const tf = targetBrush.faces[fi];
            const viPos = tf.indexOf(vi);
            if (viPos < 0) continue;
            const prevVi = tf[(viPos + tf.length - 1) % tf.length];
            const nextVi = tf[(viPos + 1) % tf.length];
            for (const otherVi of [prevVi, nextVi]) {
              const other = targetBrush.vertices[otherVi];
              const dir = {
                x: other[axisX] - vertex[axisX],
                y: other[axisY] - vertex[axisY],
              };
              const drLen = Math.hypot(dir.x, dir.y);
              if (drLen < 0.0001) continue;
              dir.x /= drLen;
              dir.y /= drLen;
              const edgeScreen = {
                start: tv,
                end: this.screen(other),
              };
              const md = pointSegmentDistance(
                current,
                edgeScreen.start,
                edgeScreen.end,
              );
              incidentEdges.push({
                direction: dir,
                mouseDistance: md,
                targetBrushId: targetBrush.id,
                targetFaceIndex: fi,
                targetVertex: vertex,
              });
            }
          }
          if (!incidentEdges.length) continue;

          // Pick best edge (closest to mouse direction)
          incidentEdges.sort((a, b) => a.mouseDistance - b.mouseDistance);
          const best = incidentEdges[0];
          const rail = {
            direction: best.direction,
            targetBrushId: best.targetBrushId,
            targetFaceIndex: best.targetFaceIndex,
          };

          if (distA <= acquireRadius) candidateRailsA.push(rail);
          if (distB <= acquireRadius) candidateRailsB.push(rail);
        }
      }
    }

    // Combine independent A/B rails
    const allCombinations = [];
    const tryPush = (railA, railB, distOverride) => {
      const st = {
        type: "cross-section-rails",
        activeAxes,
        railA,
        railB,
        distance: distOverride ?? rawDistance,
      };
      const solvedCap = true
        ? (() => {
            // Use the cross-section solver with rawDistance
            const axes = activeAxes;
            const [ax, ay] = axes;
            const srcDir = { x: baseB.x - baseA.x, y: baseB.y - baseA.y };
            const srcLen = Math.hypot(srcDir.x, srcDir.y);
            if (srcLen < 0.000001) return null;
            const srcNormal = { x: -srcDir.y / srcLen, y: srcDir.x / srcLen };
            const normal = this.faceNormal(brush, face);
            let outSign = srcNormal.x * normal[ax] + srcNormal.y * normal[ay];
            if (outSign < 0) {
              srcNormal.x *= -1;
              srcNormal.y *= -1;
            }
            const d = distOverride ?? rawDistance;
            const capLine = {
              origin: {
                x: baseA.x + srcNormal.x * d,
                y: baseA.y + srcNormal.y * d,
              },
              direction: srcDir,
            };
            const railForEndpoint = (endpoint, snapKey) => {
              if (st[snapKey])
                return {
                  origin: { x: endpoint.x, y: endpoint.y },
                  direction: st[snapKey].direction,
                };
              const idx = endpoint === baseA ? groupA[0] : groupB[0];
              const prev =
                face[(face.indexOf(idx) + face.length - 1) % face.length];
              const adj = adjacentFaceForEdge(brush, faceIndex, prev, idx);
              if (adj < 0) return null;
              const adjN = this.faceNormal(brush, brush.faces[adj]);
              if (!adjN) return null;
              const adjD = {
                x: -adjN[ay] || srcDir.x,
                y: adjN[ax] || srcDir.y,
              };
              const adjL = Math.hypot(adjD.x, adjD.y);
              if (adjL < 0.000001) return null;
              return {
                origin: { x: endpoint.x, y: endpoint.y },
                direction: { x: adjD.x / adjL, y: adjD.y / adjL },
              };
            };
            const rA = railForEndpoint(baseA, "railA");
            const rB = railForEndpoint(baseB, "railB");
            if (!rA || !rB) return null;
            const intersect = (ox, oy, dx, dy, rx, ry, rdx, rdy) => {
              const den =
                (ox - (ox + dx)) * (ry - (ry + rdy)) -
                (oy - (oy + dy)) * (rx - (rx + rdx));
              if (Math.abs(den) < 0.000001) return null;
              const t =
                ((ox - rx) * (ry - (ry + rdy)) -
                  (oy - ry) * (rx - (rx + rdx))) /
                den;
              return { x: ox + t * dx, y: oy + t * dy };
            };
            const cA = intersect(
              capLine.origin.x,
              capLine.origin.y,
              capLine.direction.x,
              capLine.direction.y,
              rA.origin.x,
              rA.origin.y,
              rA.direction.x,
              rA.direction.y,
            );
            const cB = intersect(
              capLine.origin.x,
              capLine.origin.y,
              capLine.direction.x,
              capLine.direction.y,
              rB.origin.x,
              rB.origin.y,
              rB.direction.x,
              rB.direction.y,
            );
            if (!cA || !cB) return null;
            if (!Number.isFinite(cA.x) || !Number.isFinite(cB.x)) return null;
            if (
              Math.hypot(cA.x - baseA.x, cA.y - baseA.y) * srcNormal.x +
                (cA.x - baseA.x) * 0 <=
              0.0001
            )
              return null;
            return { capA: cA, capB: cB };
          })()
        : null;
      if (!solvedCap) return;
      allCombinations.push({
        railA,
        railB,
        snapTarget: st,
        mouseDistance: acquireRadius,
      });
    };

    if (!candidateRailsA.length && !candidateRailsB.length) {
      tryPush(undefined, undefined, rawDistance);
    } else {
      const aList = candidateRailsA.length ? candidateRailsA : [undefined];
      const bList = candidateRailsB.length ? candidateRailsB : [undefined];
      for (const ra of aList)
        for (const rb of bList) tryPush(ra, rb, rawDistance);
    }

    // Build final snapCandidates from allCombinations
    for (const combo of allCombinations) {
      snapCandidates.push({
        distance: rawDistance,
        edge: combo.railA ||
          combo.railB || {
            startScreen: { x: 0, y: 0 },
            endScreen: { x: 0, y: 0 },
          },
        edgeKey: `${combo.snapTarget.railA?.targetBrushId ?? "none"}:${combo.snapTarget.railB?.targetBrushId ?? "none"}`,
        edges: [],
        mouseDistance: acquireRadius,
        snapTarget: combo.snapTarget,
      });
    }

    snapCandidates.sort((a, b) => {
      const sa = a.snapTarget;
      const sb = b.snapTarget;
      if (sa.finiteSeparation !== sb.finiteSeparation)
        return sa.finiteSeparation - sb.finiteSeparation;
      if (a.mouseDistance !== b.mouseDistance)
        return a.mouseDistance - b.mouseDistance;
      return a.distance - b.distance;
    });

    const releaseRadius = 14,
      locked = this.drag?.extrusionCandidate;
    const bestCandidate = snapCandidates[0] || null;
    const lockedCandidate = locked
      ? snapCandidates.find((item) => item.edgeKey === locked.edgeKey)
      : null;
    let candidate = bestCandidate;
    if (
      lockedCandidate &&
      (bestCandidate == null ||
        bestCandidate.edgeKey === lockedCandidate.edgeKey ||
        bestCandidate.mouseDistance + 4 >= lockedCandidate.mouseDistance)
    )
      candidate = lockedCandidate;
    if (
      candidate &&
      candidate.mouseDistance > releaseRadius &&
      !snapCandidates.some(
        (item) => item !== candidate && item.mouseDistance <= acquireRadius,
      )
    )
      candidate = null;
    if (this.drag) this.drag.extrusionCandidate = candidate;
    if (candidate)
      candidate.edges = snapCandidates
        .filter(
          (item) =>
            item.snapTarget?.targetBrushId ===
              candidate.snapTarget?.targetBrushId &&
            item.snapTarget?.targetFaceIndex ===
              candidate.snapTarget?.targetFaceIndex,
        )
        .flatMap((item) => item.edges);
    this.extrusionCandidate = candidate;
    return candidate?.distance ?? rawDistance;
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
        this.drag.distance = limitExtrusionDistance(
          this.state.brushes,
          this.drag.selection,
          this.drag.distance,
          this.state.grid,
          this.drag.guideSelection,
          this.state.faceExtrusionMode,
          this.drag.snapTarget,
        );
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
        } else {
          this.previewBrushes = [];
          this.previewErrors = [];
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
        this.creationBox = { ...this.creationBox, start, end };
        this.onBrushPreview(this.creationBox);
        this.requestDraw();
        return;
      }
      this.drag.currentX = event.offsetX;
      this.drag.currentY = event.offsetY;
      if (
        !this.drag.dragged &&
        Math.hypot(
          this.drag.currentX - this.drag.x,
          this.drag.currentY - this.drag.y,
        ) < 3
      )
        return;
      this.drag.dragged = true;
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
        const { selection, guideSelection, distance, faceId, snapTarget } =
            this.drag,
          error = this.previewErrors[0];
        this.previewBrushes = [];
        this.previewErrors = [];
        if (error) this.onChange(`extrusion-invalid:${error}`);
        else if (distance > 0)
          this.onExtrudeFaces(
            selection,
            distance,
            guideSelection,
            this.state.faceExtrusionMode,
            snapTarget,
          );
        else this.onChange(`face-selected:${this.edgeViewForFace(faceId)}`);
        this.drag = null;
        this.extrusionCandidate = null;
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
      this.requestDraw();
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
        if (this.state.mode === "face" && this.hoverFaceIds.has(id)) {
          context.fillStyle = "#ffc92844";
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
    if (this.state.mode === "face" && this.extrusionCandidate?.edge) {
      context.strokeStyle = "#43e8ff";
      context.lineWidth = 5;
      for (const edge of this.extrusionCandidate.edges || [
        this.extrusionCandidate.edge,
      ]) {
        context.beginPath();
        context.moveTo(edge.startScreen.x, edge.startScreen.y);
        context.lineTo(edge.endScreen.x, edge.endScreen.y);
        context.stroke();
      }
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
