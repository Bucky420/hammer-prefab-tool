import { moveBrushes, moveVertices, duplicateBrushes } from "./geometry-model.js";
import { applySelection, selectByShape, selectionKey, selectionTargets } from "./selection.js";
import { roundToGrid } from "./grid.js";
import { resolveExtrusion } from "./face-extrusion.js";
import { applyStagedBrushHandle } from "./brush-tool.js";
import { INFLUENCE_ACQUIRE_PX, INFLUENCE_RELEASE_PX } from "./viewport-constants.js";
import { distanceToSegment } from "./math.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportInteraction(VP) {
  VP.prototype.selectionOperation = function(event) {
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

  VP.prototype.bindPaintSelection = function() {
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

  VP.prototype.bind = function() {
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
      if (
        event.button === 2 &&
        this.state.mode === "path" &&
        this.pathPoints.length >= 2 &&
        this.kind === "top"
      ) {
        event.preventDefault();
        const world = this.world({ x: event.offsetX, y: event.offsetY });
        const snapped = {
          x: roundToGrid(world.x, this.state.grid),
          y: roundToGrid(world.y, this.state.grid),
        };
        let nearestSegment = 0;
        let nearestDistance = Infinity;
        for (let i = 0; i < this.pathPoints.length - 1; i++) {
          const d = distanceToSegment(
            snapped,
            this.pathPoints[i],
            this.pathPoints[i + 1],
          );
          if (d < nearestDistance) {
            nearestDistance = d;
            nearestSegment = i;
          }
        }
        let anchorBefore = nearestSegment;
        let anchorAfter = nearestSegment + 1;
        while (
          anchorBefore > 0 &&
          this.pathPoints[anchorBefore].routeGenerated
        )
          anchorBefore--;
        while (
          anchorAfter < this.pathPoints.length - 1 &&
          this.pathPoints[anchorAfter].routeGenerated
        )
          anchorAfter++;
        const beforeNode = this.pathPoints[anchorBefore];
        const afterNode = this.pathPoints[anchorAfter];
        this.pathPoints.splice(
          anchorBefore + 1,
          anchorAfter - anchorBefore - 1,
        );
        this.pathModel.segmentModes.splice(
          anchorBefore + 1,
          Math.max(0, anchorAfter - anchorBefore - 1),
        );
        const newNode = {
          ...snapped,
          z: roundToGrid(
            beforeNode.z +
              (afterNode.z - beforeNode.z) *
                (nearestSegment - anchorBefore + 1) /
                Math.max(1, anchorAfter - anchorBefore),
            this.state.grid,
          ),
          width: beforeNode.width + (afterNode.width - beforeNode.width) * 0.5,
          height: beforeNode.height + (afterNode.height - beforeNode.height) * 0.5,
          tangentMode: "smooth",
        };
        this.pathModel.nodes = this.pathPoints;
        this.pathPoints.splice(anchorBefore + 1, 0, newNode);
        this.appendRoutedPathNodes(beforeNode, newNode, [
          ...this.pathSourceBrushIds,
        ]);
        let newNodeIndex = this.pathPoints.findIndex(
          (p) =>
            Math.abs(p.x - newNode.x) < 1e-4 &&
            Math.abs(p.y - newNode.y) < 1e-4,
        );
        if (newNodeIndex < 0) newNodeIndex = anchorBefore + 1;
        this.appendRoutedPathNodes(
          this.pathPoints[newNodeIndex],
          afterNode,
          [...this.pathSourceBrushIds],
        );
        this.selectedPathNode = newNodeIndex;
        this.refreshPathPreview();
        this.onChange("path-preview");
        return;
      }
      if (event.button !== 0) return;
      if (this.state.mode === "path") {
        const control = this.pathControlAt(event.offsetX, event.offsetY);
        if (control) {
          this.canvas.setPointerCapture(event.pointerId);
          this.drag = {
            ...control,
            start: { x: event.offsetX, y: event.offsetY },
            originalPath: this.pathPoints.map((point) => structuredClone(point)),
          };
          return;
        }
        const node = this.pathNodeAt(event.offsetX, event.offsetY);
        if (node) {
          if (
            node.index === 0 &&
            this.pathPoints.length >= 3 &&
            this.selectedPathNode === this.pathPoints.length - 1 &&
            !this.pathModel.closed
          ) {
            this.togglePathClosed();
            this.onChange("path-preview");
            return;
          }
          this.selectedPathNode = node.index;
          this.selectedPathSegment = null;
          this.canvas.setPointerCapture(event.pointerId);
          this.drag = {
            type: "path-node",
            index: node.index,
            originalPath: this.pathPoints.map((point) => structuredClone(point)),
          };
          this.onChange("path-control-selected");
          return;
        }
        const segment = this.pathSegmentAt(event.offsetX, event.offsetY);
        if (segment) {
          this.selectedPathNode = null;
          this.selectedPathSegment = segment.index;
          this.canvas.setPointerCapture(event.pointerId);
          this.drag = {
            type: "path-move",
            start: { x: event.offsetX, y: event.offsetY },
            originalPath: this.pathPoints.map((point) => structuredClone(point)),
          };
          this.onChange("path-control-selected");
          return;
        }
        if (this.kind !== "top") {
          this.onChange("path-top-view-required");
          return;
        }
        let clickedFace =
          !this.pathPoints.length &&
          this.faceAt(event.offsetX, event.offsetY, "replace");
        if (!clickedFace && !this.pathPoints.length) {
          const hitBrush = this.brushAt(
            event.offsetX,
            event.offsetY,
          );
          if (hitBrush) {
            let bestFi = -1;
            let bestNz = -Infinity;
            for (let fi = 0; fi < hitBrush.faces.length; fi++) {
              const fn = this.faceNormal(hitBrush, hitBrush.faces[fi]);
              const fnLen = Math.hypot(fn.x, fn.y, fn.z);
              if (fnLen && fn.z / fnLen > bestNz) {
                bestNz = fn.z / fnLen;
                bestFi = fi;
              }
            }
            if (bestFi >= 0 && !this.isNoDrawFace(hitBrush, bestFi))
              clickedFace = {
                id: `${hitBrush.id}:f:${bestFi}`,
                brush: hitBrush,
                faceIndex: bestFi,
              };
          }
        }
        if (clickedFace) {
          const match = clickedFace.id.match(/^(.*):f:(\d+)$/);
          const brush = match && this.state.brushes.find((b) => b.id === match[1]);
          const face = brush?.faces[Number(match?.[2])];
          if (brush && face && !this.isNoDrawFace(brush, Number(match?.[2]))) {
            const normal = this.faceNormal(brush, face);
            const points = face.map((i) => brush.vertices[i]);
            const faceCenter = {
              x: points.reduce((s, p) => s + p.x, 0) / points.length,
              y: points.reduce((s, p) => s + p.y, 0) / points.length,
              z: points.reduce((s, p) => s + p.z, 0) / points.length,
            };
            const normal2D = { x: normal.x, y: normal.y };
            const normLen = Math.hypot(normal2D.x, normal2D.y);
            const direction =
              normLen > 0.001
                ? { x: normal2D.x / normLen, y: normal2D.y / normLen }
                : { x: 1, y: 0 };
            const defaultWidth =
              Number(this.state.pathSettings?.interiorWidth || 128) +
              2 * Number(this.state.pathSettings?.wallThickness || 16);
            const faceHeight = Number(
              this.state.pathSettings?.interiorHeight || 128,
            );
            const xs = points.map((p) => p.x);
            const ys = points.map((p) => p.y);
            const faceWidth = Math.max(
              this.state.grid * 2,
              Math.max(...xs) - Math.min(...xs),
              Math.max(...ys) - Math.min(...ys),
            );
            const node = {
              x: faceCenter.x + direction.x * faceWidth * 0.5,
              y: faceCenter.y + direction.y * faceWidth * 0.5,
              z: faceCenter.z,
              width: faceWidth,
              height: faceHeight,
              tangentMode: "smooth",
              tangentOut: {
                x: direction.x * faceWidth,
                y: direction.y * faceWidth,
                z: 0,
              },
            };
            if (this.pathGhostSource) {
              const ghostNode = this.pathGhostSource.node;
              const ghostBrushIds = this.pathGhostSource.brushIds || [];
              const allBrushIds = [
                ...new Set([...ghostBrushIds, brush.id]),
              ];
              this.pathPoints.push(ghostNode);
              this.pathModel.nodes = this.pathPoints;
              this.pathSourceBrushIds = allBrushIds;
              this.pathGhostSource = null;
              this.pathGhostLine = null;
              if (!this.appendRoutedPathNodes(ghostNode, node, allBrushIds))
                return;
              this.selectedPathNode = this.pathPoints.length - 1;
              this.refreshPathPreview();
              this.onChange("path-preview");
            } else {
              this.pathGhostSource = { node, brushIds: [brush.id] };
              this.pathSourceCandidate = null;
              const ghostMouseWorld = this.world({
                x: event.offsetX,
                y: event.offsetY,
              });
              this.computeGhostRoute({
                x: ghostMouseWorld.x,
                y: ghostMouseWorld.y,
              });
              this.onChange("path-preview");
            }
          }
          return;
        }
        const world = this.world({ x: event.offsetX, y: event.offsetY });
        const snapped = {
          x: roundToGrid(world.x, this.state.grid),
          y: roundToGrid(world.y, this.state.grid),
        };
        const defaultWidth =
          Number(this.state.pathSettings?.interiorWidth || 128) +
          2 * Number(this.state.pathSettings?.wallThickness || 16);
        const defaultHeight = Number(
          this.state.pathSettings?.interiorHeight || 128,
        );
        if (!this.pathPoints.length && this.pathSourceBrushIds.length) {
          const source = this.onPathSource(
            { x: world.x, y: world.y },
            this.pathSourceBrushIds,
          );
          if (!source || source.errors?.length) {
            this.onChange(
              `path-source-invalid:${source?.errors?.[0] || "No usable selected floor boundary"}`,
            );
            return;
          }
          const plane = source.floorPlane;
          const elevationAt = (point) =>
            plane?.normal?.z
              ? (plane.distance -
                  plane.normal.x * point.x -
                  plane.normal.y * point.y) /
                plane.normal.z
              : source.elevation;
          const distance = Math.max(
            this.state.grid * 2,
            Math.hypot(
              snapped.x - source.center.x,
              snapped.y - source.center.y,
            ),
          );
          const sourceSlope = source.floorPlane?.normal?.z
            ? -(
                source.floorPlane.normal.x * source.direction.x +
                source.floorPlane.normal.y * source.direction.y
              ) / source.floorPlane.normal.z
            : 0;
          this.pathSourceAttachment = {
            ...structuredClone(source),
            flare: Number(this.state.pathSettings?.flare) || 0,
            blendLength:
              Number(this.state.pathSettings?.blendLength) || distance,
          };
          const startNode = {
            ...source.center,
            width: source.outsideWidth,
            height: defaultHeight,
            tangentMode: "smooth",
            tangentOut: {
              x: source.direction.x * distance,
              y: source.direction.y * distance,
              z: sourceSlope * distance,
            },
          };
          const endNode = {
            ...snapped,
            z: roundToGrid(elevationAt(snapped), this.state.grid),
            width: source.outsideWidth,
            height: defaultHeight,
            tangentMode: "auto",
          };
          this.pathPoints.push(startNode);
          if (
            !this.appendRoutedPathNodes(
              startNode,
              endNode,
              source.sourceBrushIds,
              false,
            )
          ) {
            this.pathModel.nodes = this.pathPoints;
            this.selectedPathNode = 0;
            this.onChange("path-source-acquired");
            return;
          }
          this.selectedPathNode = this.pathPoints.length - 1;
          this.onChange("path-source-acquired");
        } else if (
          this.pathGhostSource &&
          !this.pathPoints.length
        ) {
          const ghostNode = this.pathGhostSource.node;
          const ghostBrushIds = this.pathGhostSource.brushIds || [];
          const snapped = {
            x: roundToGrid(world.x, this.state.grid),
            y: roundToGrid(world.y, this.state.grid),
          };
          const defaultWidth =
            Number(this.state.pathSettings?.interiorWidth || 128) +
            2 * Number(this.state.pathSettings?.wallThickness || 16);
          const defaultHeight = Number(
            this.state.pathSettings?.interiorHeight || 128,
          );
          const endNode = {
            ...snapped,
            z: ghostNode.z || 0,
            width: ghostNode.width || defaultWidth,
            height: ghostNode.height || defaultHeight,
            tangentMode: "auto",
          };
          this.pathPoints.push(ghostNode);
          this.pathModel.nodes = this.pathPoints;
          if (
            !this.appendRoutedPathNodes(ghostNode, endNode, ghostBrushIds)
          )
            return;
          this.pathSourceBrushIds = ghostBrushIds;
          this.pathGhostSource = null;
          this.pathGhostLine = null;
          this.selectedPathNode = this.pathPoints.length - 1;
          this.onChange("path-source-acquired");
        } else {
          let attachment = null;
          if (
            this.pathPoints.length &&
            this.state.pathSettings?.snapEnds !== false
          )
            attachment = this.onPathEndSnap(
              { x: world.x, y: world.y },
              this.pathSourceBrushIds,
              this.pathAssemblyId,
            );
          const target = attachment?.errors?.length ? null : attachment;
          const previous = this.pathPoints.at(-1);
          const targetDistance = target?.center
            ? Math.max(
                this.state.grid * 2,
                Math.hypot(
                  target.center.x - previous.x,
                  target.center.y - previous.y,
                ),
              )
            : 0;
          const endDirection = target
            ? { x: -target.direction.x, y: -target.direction.y }
            : null;
          const endSlope = target?.floorPlane?.normal?.z
            ? -(
                target.floorPlane.normal.x * endDirection.x +
                target.floorPlane.normal.y * endDirection.y
              ) / target.floorPlane.normal.z
            : 0;
          const endNode = {
            x: target?.center?.x ?? snapped.x,
            y: target?.center?.y ?? snapped.y,
            z: roundToGrid(
              target?.elevation ??
                (Number(this.state.pathSettings?.baseElevation) || 0),
              this.state.grid,
            ),
            width: target?.outsideWidth || defaultWidth,
            height: defaultHeight,
            tangentMode: target ? "smooth" : "auto",
            ...(target
              ? {
                  tangentIn: {
                    x: -target.direction.x * targetDistance,
                    y: -target.direction.y * targetDistance,
                    z: endSlope * targetDistance,
                  },
                }
              : {}),
          };
          if (previous) {
            if (this.pathPoints.length >= 4) return;
            if (
              !this.appendRoutedPathNodes(previous, endNode, [
                ...this.pathSourceBrushIds,
                ...(target?.sourceBrushIds || []),
              ])
            )
              return;
          } else {
            this.pathPoints.push(endNode);
            this.pathModel.nodes = this.pathPoints;
          }
          this.pathEndAttachment = target
            ? {
                ...structuredClone(target),
                flare: Number(this.state.pathSettings?.flare) || 0,
                blendLength:
                  Number(this.state.pathSettings?.blendLength) || 128,
              }
            : null;
          this.pathEndCandidate = null;
          this.selectedPathNode = this.pathPoints.length - 1;
        }
        this.refreshPathPreview();
        this.onChange("path-preview");
        return;
      }
      if (this.state.mode === "brush" && this.creationBox) {
        const handle = this.creationHandleAt(event.offsetX, event.offsetY);
        if (handle) {
          this.canvas.setPointerCapture(event.pointerId);
          this.drag = {
            type: handle.type.startsWith("shape-")
              ? "creation-shape-transform"
              : "creation-transform",
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
              gridSnapAnchor: this.groupedExtrusionGridAnchor(
                hit.id,
                new Set(this.state.faceSelection),
                { x: event.offsetX, y: event.offsetY },
              ),
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
          const target = selectionTargets(
            this.state.brushes,
            brush,
            this.state.selectionScope,
          );
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
        if (
          this.state.mode === "path" &&
          this.kind === "top" &&
          !this.pathPoints.length &&
          this.pathSourceBrushIds.length
        ) {
          const world = this.world({ x: event.offsetX, y: event.offsetY });
          this.pathSourceCandidate = this.onPathSource(
            { x: world.x, y: world.y },
            this.pathSourceBrushIds,
          );
          if (this.pathSourceCandidate?.errors?.length)
            this.pathSourceCandidate = null;
          this.computeGhostRoute({ x: world.x, y: world.y });
        } else if (
          this.state.mode === "path" &&
          this.kind === "top" &&
          !this.pathPoints.length &&
          this.pathGhostSource
        ) {
          const world = this.world({ x: event.offsetX, y: event.offsetY });
          this.computeGhostRoute({ x: world.x, y: world.y });
        } else if (
          this.state.mode === "path" &&
          this.kind === "top" &&
          this.pathPoints.length &&
          !this.pathModel.closed &&
          this.state.pathSettings?.snapEnds !== false
        ) {
          const world = this.world({ x: event.offsetX, y: event.offsetY });
          this.pathEndCandidate = this.onPathEndSnap(
            { x: world.x, y: world.y },
            this.pathSourceBrushIds,
            this.pathAssemblyId,
          );
        }
        if (
          this.state.mode === "path" &&
          this.pathPoints.length &&
          this.pathGhostLine
        )
          this.pathGhostLine = null;
        const operation = this.selectionOperation(event);
        const fillLoop =
          (this.state.mode === "face" || this.state.mode === "path") &&
          this.state.faceToolMode === "fill"
            ? this.faceLoopAt(event.offsetX, event.offsetY)
            : null;
        const face =
          this.state.mode === "face" || this.state.mode === "path"
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
      if (this.drag.type === "path-width") {
        const current = this.world({ x: event.offsetX, y: event.offsetY });
        const node = this.pathPoints[this.drag.index];
        const width = roundToGrid(
          2 * Math.hypot(current.x - node.x, current.y - node.y),
          this.state.grid,
        );
        node.width = Math.max(
          2 * Number(this.state.pathSettings?.wallThickness || 16) +
            this.state.grid,
          width,
        );
        delete node.routeGenerated;
        this.interpolateGeneratedPathValue("width");
        this.requestPathPreview();
        this.schedulePathReroute();
        return;
      }
      if (this.drag.type === "path-height") {
        const current = this.world({ x: event.offsetX, y: event.offsetY });
        const node = this.pathPoints[this.drag.index];
        node.height = Math.max(
          this.state.grid,
          roundToGrid(current.z - node.z, this.state.grid),
        );
        delete node.routeGenerated;
        this.interpolateGeneratedPathValue("height");
        this.requestPathPreview();
        this.schedulePathReroute();
        return;
      }
      if (this.drag.type === "path-tangent") {
        const current = this.world({ x: event.offsetX, y: event.offsetY });
        const node = this.pathPoints[this.drag.index];
        const sign = this.drag.side > 0 ? 1 : -1;
        const tangent = {
          x: (current.x - node.x) * 3 * sign,
          y: (current.y - node.y) * 3 * sign,
          z:
            (this.drag.side > 0
              ? node.tangentOut?.z
              : node.tangentIn?.z) || 0,
        };
        node.tangentMode = node.tangentMode === "corner" ? "corner" : "smooth";
        if (this.drag.side > 0) node.tangentOut = tangent;
        else node.tangentIn = tangent;
        if (node.tangentMode === "smooth") {
          node.tangentIn = { ...tangent };
          node.tangentOut = { ...tangent };
        }
        this.refreshPathPreview();
        return;
      }
      if (this.drag.type === "path-move") {
        const before = this.world(this.drag.start);
        const current = this.world({ x: event.offsetX, y: event.offsetY });
        const axes = this.axes();
        const delta = {
          [axes[0]]: roundToGrid(
            current[axes[0]] - before[axes[0]],
            this.state.grid,
          ),
          [axes[1]]: roundToGrid(
            current[axes[1]] - before[axes[1]],
            this.state.grid,
          ),
        };
        this.pathPoints.forEach((point, index) => {
          const original = this.drag.originalPath[index];
          if (index === 0 && this.pathSourceAttachment) return;
          point[axes[0]] = original[axes[0]] + delta[axes[0]];
          point[axes[1]] = original[axes[1]] + delta[axes[1]];
        });
        this.pathEndAttachment = null;
        const anchorNodes = this.pathPoints.filter(
          (p) => !p.routeGenerated,
        );
        this.pathPoints = anchorNodes;
        this.pathModel.nodes = anchorNodes;
        this.pathModel.segmentModes = this.pathModel.segmentModes.slice(
          0,
          anchorNodes.length - 1,
        );
        this.schedulePathReroute();
        return;
      }
      if (this.drag.type === "path-node") {
        const current = this.world({ x: event.offsetX, y: event.offsetY });
        const [horizontal, vertical] = this.axes();
        const point = this.pathPoints[this.drag.index];
        if (this.drag.index === 0 && this.pathSourceAttachment) return;
        if (
          this.snapMovedPathEnd(this.drag.index, {
            x: current[horizontal],
            y: current[vertical],
          })
        ) {
          const snapAnchors = this.pathPoints.filter(
            (p) => !p.routeGenerated,
          );
          this.pathPoints = snapAnchors;
          this.pathModel.nodes = snapAnchors;
          this.pathModel.segmentModes = this.pathModel.segmentModes.slice(
            0,
            snapAnchors.length - 1,
          );
          this.schedulePathReroute();
          return;
        }
        point[horizontal] = roundToGrid(current[horizontal], this.state.grid);
        point[vertical] = roundToGrid(current[vertical], this.state.grid);
        if (this.drag.index === this.pathPoints.length - 1)
          this.pathEndAttachment = null;
        const moveAnchors = this.pathPoints.filter(
          (p) => !p.routeGenerated,
        );
        this.pathPoints = moveAnchors;
        this.pathModel.nodes = moveAnchors;
        this.pathModel.segmentModes = this.pathModel.segmentModes.slice(
          0,
          moveAnchors.length - 1,
        );
        this.schedulePathReroute();
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
        const rawDistance = this.faceExtrusionDistance(
          this.drag.faceId,
          this.drag.start,
          this.drag.current,
        );
        const resolved =
          this.drag.extrusionCandidate?.resolved ||
          (this.drag.geometryBlocked
            ? null
            : resolveExtrusion({
                sourceBrushes: this.state.brushes,
                selection: this.drag.selection,
                rawDistance,
                grid: this.state.grid,
                guideSelection: this.drag.guideSelection,
                mode: this.state.faceExtrusionMode,
                snapTarget: null,
                maxSourceAngleDegrees: this.state.faceSourceMaxAngle,
                maxFreeSideAngleDegrees:
                  this.state.faceExtrusionMode === "snap" ? 0 : undefined,
              }));
        this.drag.resolvedExtrusion = resolved;
        this.drag.distance = resolved?.finalDistance || 0;
        this.previewBrushes = resolved?.previewBrushes || [];
        this.previewErrors = resolved?.errors?.length
          ? resolved.errors
          : resolved?.blockedReason
            ? [resolved.blockedReason]
            : [];
        this.extrusionSolvedDebug = resolved?.solvedEdges
          ? this.toScreenEdges(resolved.solvedEdges)
          : null;
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
      if (this.drag.type === "creation-shape-transform") {
        const result = applyStagedBrushHandle({
          bounds: this.creationBox,
          settings: this.state.generator,
          handle: this.drag.original,
          current: this.world({ x: event.offsetX, y: event.offsetY }),
          grid: this.state.grid,
        });
        this.creationBox = result.bounds;
        Object.assign(this.state.generator, result.settings);
        this.onBrushPreview(this.creationBox);
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
      else if (this.drag.type === "pan") this.canvas.style.cursor = "move";
      else this.canvas.style.cursor = "crosshair";
      if (this.state.mode === "brush" && this.drag.type === "box")
        this.onBrushPreview(this.creationBoundsFromDrag());
      this.requestDraw();
    });
    this.canvas.addEventListener("pointerup", () => {
      if (!this.drag) return;
      if (this.drag.type.startsWith("path-")) {
        const pathDrag = this.drag;
        this.drag = null;
        if (this.pathPreviewFrame) {
          cancelAnimationFrame(this.pathPreviewFrame);
          this.pathPreviewFrame = 0;
        }
        if (this.pathRerouteTimer) {
          cancelAnimationFrame(this.pathRerouteTimer);
          this.pathRerouteTimer = null;
        }
        const shouldReroute =
          ["path-node", "path-move", "path-width", "path-height"].includes(
            pathDrag.type,
          ) &&
          this.state.pathSettings?.avoidShapes !== false &&
          !this.pathModel.closed;
        if (shouldReroute) {
          const releaseSnapshot = this.pathPoints.map((p) =>
            structuredClone(p),
          );
          const releaseModes = this.pathModel.segmentModes.slice();
          if (!this.reroutePathAroundShapes()) {
            this.pathPoints = releaseSnapshot;
            this.pathModel.nodes = this.pathPoints;
            this.pathModel.segmentModes = releaseModes;
            this.refreshPathPreview();
          }
        } else if (["path-width", "path-height"].includes(pathDrag.type)) {
          this.refreshPathPreview();
        }
        this.onChange("path-preview");
        this.requestDraw();
        return;
      }
      if (this.drag.type === "face-paint") {
        this.drag = null;
        this.onChange("selection-commit");
        this.requestDraw();
        return;
      }
      if (this.drag.type === "face-extrude") {
        const { resolvedExtrusion } = this.drag;
        this.previewBrushes = [];
        this.previewErrors = [];
        if (
          resolvedExtrusion &&
          !resolvedExtrusion.blocked &&
          resolvedExtrusion.finalDistance > 0.01 &&
          resolvedExtrusion.previewBrushes.length
        )
          this.onExtrudeFaces(resolvedExtrusion);
        this.drag = null;
        this.extrusionCandidate = null;
        this.extrusionMatchDebug = [];
        this.extrusionSolvedDebug = null;
        this.extrusionAcquisitionDebug = null;
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
      if (
        this.drag.type === "creation-transform" ||
        this.drag.type === "creation-shape-transform"
      ) {
        this.drag = null;
        this.onChange("brush-preview");
        return;
      }
      if (this.drag.type === "box") {
        if (this.state.mode === "brush" && this.drag.dragged) {
          this.creationBox = this.creationBoundsFromDrag();
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
            const keys = new Set(
              hit.map((brush) =>
                selectionKey(brush, this.state.selectionScope),
              ),
            );
            const selected = this.visibleBrushes()
              .filter((brush) =>
                keys.has(selectionKey(brush, this.state.selectionScope)),
              )
              .map((brush) => brush.id);
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

}
