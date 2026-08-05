import { roundToGrid } from "./grid.js";
import { COLORS } from "./viewport-constants.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportDraw(VP) {
  VP.prototype.drawGrid = function(context, width, height) {
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

  VP.prototype.drawTextureAxes = function(context) {
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

  VP.prototype.draw = function() {
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
      ...this.pathPreviewBrushes.map((brush) => brush.id),
    ]);
    for (const brush of [
      ...this.visibleBrushes(),
      ...this.previewBrushes,
      ...this.creationPreviewBrushes,
      ...this.pathPreviewBrushes,
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
          context.fillStyle =
            this.previewErrors.length || this.pathPreviewErrors.length
              ? "#ff405544"
              : "#ffc92822";
          context.fill();
        }
        if (selectedFace) {
          context.fillStyle = "#ffff0033";
          context.fill();
        }
        context.strokeStyle =
          previewIds.has(brush.id) &&
          (this.previewErrors.length || this.pathPreviewErrors.length)
            ? COLORS.invalid
            : this.state.brushSelection?.has(brush.id) || selectedFace
              ? COLORS.selected
              : COLORS.line;
        context.lineWidth = 1;
        context.stroke();
      }
    if (
      this.state.mode === "path" &&
      !this.pathPoints.length &&
      this.pathSourceCandidate?.boundary?.length
    ) {
      context.strokeStyle = COLORS.faceHover;
      context.lineWidth = 4;
      context.beginPath();
      this.pathSourceCandidate.boundary.forEach((point, index) => {
        const screen = this.screen(point);
        if (index) context.lineTo(screen.x, screen.y);
        else context.moveTo(screen.x, screen.y);
      });
      context.stroke();
      const center = this.screen(this.pathSourceCandidate.center);
      context.fillStyle = COLORS.faceHover;
      context.fillRect(center.x - 5, center.y - 5, 10, 10);
      context.lineWidth = 1;
    }
    if (
      this.state.mode === "path" &&
      !this.pathPoints.length &&
      this.pathGhostLine?.length >= 2
    ) {
      context.strokeStyle = "#66dde3";
      context.lineWidth = 2;
      context.setLineDash([8, 6]);
      context.beginPath();
      this.pathGhostLine.forEach((point, index) => {
        const screen = this.screen(point);
        if (index) context.lineTo(screen.x, screen.y);
        else context.moveTo(screen.x, screen.y);
      });
      context.stroke();
      context.setLineDash([]);
      for (const point of this.pathGhostLine) {
        const screen = this.screen(point);
        context.fillStyle = "#66dde3";
        context.beginPath();
        context.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        context.fill();
      }
      context.lineWidth = 1;
    }
    if (this.state.mode === "path" && this.pathPoints.length) {
      context.strokeStyle = this.pathPreviewErrors.length
        ? COLORS.invalid
        : COLORS.active;
      context.lineWidth = 2;
      context.beginPath();
      const centerline = this.pathStations.length
        ? this.pathStations
        : this.pathPoints;
      centerline.forEach((point, index) => {
        const screen = this.screen(point);
        if (index) context.lineTo(screen.x, screen.y);
        else context.moveTo(screen.x, screen.y);
      });
      if (this.pathModel.closed && centerline.length > 2) context.closePath();
      context.stroke();
      if (this.pathSourceAttachment?.boundary?.length) {
        context.strokeStyle = COLORS.faceHover;
        context.lineWidth = 4;
        context.beginPath();
        this.pathSourceAttachment.boundary.forEach((point, index) => {
          const screen = this.screen(point);
          if (index) context.lineTo(screen.x, screen.y);
          else context.moveTo(screen.x, screen.y);
        });
        context.stroke();
      }
      if (this.pathEndCandidate?.boundary?.length) {
        context.strokeStyle = "#66dde3";
        context.lineWidth = 4;
        context.beginPath();
        this.pathEndCandidate.boundary.forEach((point, index) => {
          const screen = this.screen(point);
          if (index) context.lineTo(screen.x, screen.y);
          else context.moveTo(screen.x, screen.y);
        });
        context.stroke();
      }
      for (const [index, point] of this.pathPoints.entries()) {
        const screen = this.screen(point);
        context.fillStyle =
          index === this.selectedPathNode
            ? COLORS.faceHover
            : index === 0
              ? COLORS.active
              : COLORS.selected;
        context.fillRect(screen.x - 5, screen.y - 5, 10, 10);
      }
      for (const handle of this.pathControlHandles()) {
        const node = this.pathPoints[handle.index];
        const start = this.screen(node);
        const end = this.screen(handle.point);
        context.strokeStyle =
          handle.type === "path-tangent" ? "#7cc7ff" : "#66dde3";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.fillStyle = context.strokeStyle;
        context.beginPath();
        context.arc(end.x, end.y, 4, 0, Math.PI * 2);
        context.fill();
      }
      context.lineWidth = 1;
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

      // Purple identifies the exact finite target edges selected by the
      // current solved candidate, distinct from all red/blue candidates.
      let selectedTargetRails =
        this.drag?.extrusionCandidate?.snapTarget?.conforming?.filter(
          (constraint) => constraint.movingEdge !== "cap",
        ) || [];
      if (!selectedTargetRails.length)
        selectedTargetRails = [
          this.drag?.startRailPair?.sideA,
          this.drag?.startRailPair?.sideB,
        ].filter(Boolean);
      for (const constraint of selectedTargetRails) {
        if (
          constraint.movingEdge === "cap" ||
          !constraint.targetStartWorld ||
          !constraint.targetEndWorld
        )
          continue;
        const targetA = this.screen(constraint.targetStartWorld);
        const targetB = this.screen(constraint.targetEndWorld);
        context.strokeStyle = "#c86cff";
        context.lineWidth = 6;
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
        context.lineWidth = 12;
        context.lineCap = "round";
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(s0.x, s0.y);
        context.lineTo(s1.x, s1.y);
        context.stroke();
        context.strokeStyle = color;
        context.lineWidth = 8;
        context.beginPath();
        context.moveTo(s0.x, s0.y);
        context.lineTo(s1.x, s1.y);
        context.stroke();
      }

      // 4) Legend
      context.font = "12px monospace";
      context.textBaseline = "top";
      const legend = [
        ["MATCH", "#c86cff"],
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
      if (this.drag?.type === "box" && this.drag.dragged) {
        start = { x: this.drag.x, y: this.drag.y };
        end = { x: this.drag.currentX, y: this.drag.currentY };
      } else {
        start = this.screen({ x: 0, y: 0, z: 0, ...this.creationBox.start });
        end = this.screen({ x: 0, y: 0, z: 0, ...this.creationBox.end });
      }
      if (
        this.state.mode === "brush" &&
        this.drag?.type === "box" &&
        this.drag.dragged
      ) {
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
      let dimW = 0,
        dimH = 0;
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
        context.fillText(
          `${dimH.toFixed(dec)}`,
          x + boxWidth + 6,
          y + boxHeight / 2,
        );
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
      if (this.creationBox) {
        context.font = "10px Tahoma";
        context.textBaseline = "middle";
        for (const handle of this.creationShapeHandles()) {
          const { x: handleX, y: handleY } = handle.point;
          context.fillStyle =
            handle.type === "move"
              ? COLORS.active
              : handle.type === "shape-thickness"
                ? "#ff66cc"
                : handle.type === "shape-arc"
                  ? "#ff9f43"
                  : COLORS.selected;
          context.strokeStyle = "#111824";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(handleX, handleY, 6, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.fillStyle = "#dce9f7";
          context.fillText(handle.label, handleX + 9, handleY);
        }
        context.lineWidth = 1;
      }
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
    if (this.drag?.type === "face-extrude") {
      const drawDebugEdge = (pair, color, width = 7, screenSpace = false) => {
        if (!pair) return;
        const start = screenSpace ? pair[0] : this.screen(pair[0]);
        const end = screenSpace ? pair[1] : this.screen(pair[1]);
        context.lineCap = "round";
        context.setLineDash([]);
        context.strokeStyle = "#000000";
        context.lineWidth = width + 4;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.strokeStyle = color;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      };
      let targetRails =
        this.drag.extrusionCandidate?.snapTarget?.conforming?.filter(
          (constraint) => constraint.movingEdge !== "cap",
        ) || [];
      if (!targetRails.length)
        targetRails = ["sideA", "sideB"]
          .map(
            (movingEdge) =>
              this.drag.startRailPair?.[movingEdge] ||
              this.extrusionMatchDebug.find(
                (candidate) => candidate.movingEdge === movingEdge,
              ),
          )
          .filter(Boolean);
      for (const rail of targetRails) {
        if (!rail.targetStartWorld || !rail.targetEndWorld) continue;
        drawDebugEdge(
          [rail.targetStartWorld, rail.targetEndWorld],
          "#c86cff",
          8,
        );
      }
      const solved = this.extrusionSolvedDebug || {};
      drawDebugEdge(solved.sideA, "#ff4266", 7, true);
      drawDebugEdge(solved.sideB, "#4dabf7", 7, true);
      drawDebugEdge(solved.cap, "#19d97a", 7, true);
      drawDebugEdge(solved.base, "#19d97a", 7, true);
      if (this.drag.current) {
        const { x, y } = this.drag.current;
        context.fillStyle = "#ffffff";
        context.strokeStyle = "#000000";
        context.lineWidth = 2;
        context.lineJoin = "round";
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 1, y + 18);
        context.lineTo(x + 5, y + 14);
        context.lineTo(x + 10, y + 22);
        context.lineTo(x + 14, y + 20);
        context.lineTo(x + 9, y + 12);
        context.lineTo(x + 16, y + 12);
        context.closePath();
        context.fill();
        context.stroke();
      }
      context.lineWidth = 1;
      context.lineCap = "butt";
    }
  }
}
