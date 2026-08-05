import { roundToGrid } from "./grid.js";
import { distanceToSegment } from "./math.js";
import { normalizePath, PATH_VERSION, samplePath } from "./path-spline.js";
import { pathClearsObstacles } from "./path-routing.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportPath(VP) {
  VP.prototype.requestPathPreview = function() {
    if (this.pathPreviewFrame) return;
    this.pathPreviewFrame = requestAnimationFrame(() => {
      this.pathPreviewFrame = 0;
      if (this.canvas.isConnected) this.refreshPathPreview();
    });
  }

  VP.prototype.schedulePathReroute = function() {
    if (
      this.state.pathSettings?.avoidShapes === false ||
      this.pathModel.closed
    )
      return;
    if (this.pathRerouteTimer) return;
    this.pathRerouteTimer = requestAnimationFrame(() => {
      this.pathRerouteTimer = null;
      if (!this.canvas.isConnected) return;
      const draggedIndex = this.drag?.type === "path-node"
        ? this.drag.index
        : null;
      const draggedPoint = draggedIndex != null
        ? this.pathPoints[draggedIndex]
        : null;
      const snapshot = this.pathPoints.map((p) => structuredClone(p));
      const snapshotModes = this.pathModel.segmentModes.slice();
      if (this.reroutePathAroundShapes()) {
        if (draggedPoint && this.drag?.type === "path-node") {
          const newIndex = this.pathPoints.findIndex(
            (p) =>
              Math.abs(p.x - draggedPoint.x) < 1e-4 &&
              Math.abs(p.y - draggedPoint.y) < 1e-4,
          );
          if (newIndex >= 0) this.drag.index = newIndex;
        }
        this.refreshPathPreview();
        this.requestDraw();
      } else {
        this.pathPoints = snapshot;
        this.pathModel.nodes = snapshot;
        this.pathModel.segmentModes = snapshotModes;
        this.refreshPathPreview();
      }
    });
  }

  VP.prototype.interpolateGeneratedPathValue = function(name) {
    if (this.pathModel.closed) return;
    const anchors = this.pathPoints
      .map((point, index) => (point.routeGenerated ? null : index))
      .filter((index) => index !== null);
    for (let anchor = 0; anchor < anchors.length - 1; anchor++) {
      const start = anchors[anchor];
      const end = anchors[anchor + 1];
      const distances = [0];
      for (let index = start + 1; index <= end; index++) {
        const previous = this.pathPoints[index - 1];
        const point = this.pathPoints[index];
        distances.push(
          distances.at(-1) + Math.hypot(point.x - previous.x, point.y - previous.y),
        );
      }
      const total = distances.at(-1) || 1;
      for (let index = start + 1; index < end; index++) {
        const alpha = distances[index - start] / total;
        this.pathPoints[index][name] =
          this.pathPoints[start][name] * (1 - alpha) +
          this.pathPoints[end][name] * alpha;
      }
    }
  }

  VP.prototype.computeGhostRoute = function(mouseWorld) {
    this.pathGhostLine = null;
    if (this.kind !== "top") return;
    if (!mouseWorld || !Number.isFinite(mouseWorld.x) || !Number.isFinite(mouseWorld.y))
      return;
    if (this.pathPoints.length) return;
    if (
      !this.pathSourceAttachment &&
      !this.pathSourceBrushIds.length &&
      !this.pathGhostSource
    )
      return;
    const sourceNode = this.pathGhostSource?.node;
    if (!sourceNode && !this.pathSourceBrushIds.length) return;
    if (sourceNode) {
      const defaultWidth =
        Number(this.state.pathSettings?.interiorWidth || 128) +
        2 * Number(this.state.pathSettings?.wallThickness || 16);
      const defaultHeight = Number(
        this.state.pathSettings?.interiorHeight || 128,
      );
      const snapped = {
        x: roundToGrid(mouseWorld.x, this.state.grid),
        y: roundToGrid(mouseWorld.y, this.state.grid),
      };
      const endNode = {
        ...snapped,
        z: sourceNode.z || 0,
        width: sourceNode.width || defaultWidth,
        height: sourceNode.height || defaultHeight,
        tangentMode: "auto",
      };
      const distance = Math.max(
        this.state.grid * 2,
        Math.hypot(snapped.x - sourceNode.x, snapped.y - sourceNode.y),
      );
      if (distance < this.state.grid * 2) return;
      const brushIds = this.pathGhostSource.brushIds || [];
      const routed = this.routePathPoints(
        sourceNode,
        endNode,
        Math.max(sourceNode.width || defaultWidth, endNode.width),
        Math.max(sourceNode.height || defaultHeight, endNode.height),
        brushIds,
      );
      if (routed.errors?.length || routed.points.length < 2) return;
      this.pathGhostLine = routed.points;
    }
  }

  VP.prototype.setPath = function(path, assemblyId, options = {}) {
    const fallbackWidth =
      Number(this.state.pathSettings?.interiorWidth || 128) +
      2 * Number(this.state.pathSettings?.wallThickness || 16);
    const fallbackHeight = Number(this.state.pathSettings?.interiorHeight || 128);
    if (Array.isArray(path) && path.length >= 2) {
      this.pathModel = normalizePath(path, {
        defaults: { width: fallbackWidth, height: fallbackHeight },
      });
    } else if (path?.nodes?.length >= (path.closed ? 3 : 2)) {
      this.pathModel = normalizePath(path, {
        defaults: { width: fallbackWidth, height: fallbackHeight },
      });
    } else {
      this.pathModel = {
        version: PATH_VERSION,
        nodes: [],
        segmentModes: [],
        closed: false,
        detail: {
          maxAngleDegrees:
            Number(this.state.pathSettings?.maxAngleDegrees) || 10,
          maxSegmentLength:
            Number(this.state.pathSettings?.maxSegmentLength) || 64,
          chordError: Number(this.state.pathSettings?.chordError) || 1,
        },
      };
    }
    this.pathPoints = this.pathModel.nodes;
    this.pathAssemblyId = assemblyId || null;
    this.pathGhostLine = null;
    this.pathSourceBrushIds = [...(options.sourceBrushIds || [])];
    this.pathSourceAttachment = options.sourceAttachment
      ? structuredClone(options.sourceAttachment)
      : null;
    this.pathGhostSource = null;
    this.pathSourceCandidate = null;
    this.pathEndAttachment = options.endAttachment
      ? structuredClone(options.endAttachment)
      : null;
    this.pathEndCandidate = null;
    this.selectedPathNode = this.pathPoints.length ? 0 : null;
    this.selectedPathSegment = null;
    this.refreshPathPreview();
    this.requestDraw();
  }

  VP.prototype.pathData = function() {
    return {
      ...this.pathModel,
      nodes: this.pathPoints.map((point) => ({ ...point })),
      segmentModes: [...this.pathModel.segmentModes],
      detail: { ...this.pathModel.detail },
      sourceAttachment: this.pathSourceAttachment
        ? structuredClone(this.pathSourceAttachment)
        : undefined,
      endAttachment: this.pathEndAttachment
        ? structuredClone(this.pathEndAttachment)
        : undefined,
    };
  }

  VP.prototype.refreshPathPreview = function() {
    if (this.pathPoints.length < 2) {
      this.pathPreviewBrushes = [];
      this.pathPreviewErrors = [];
      this.pathStations = [];
      this.requestDraw();
      return { brushes: [], errors: [] };
    }
    const result =
      this.onPathPreview(
        this.pathData(),
        this.pathAssemblyId,
        this.pathSourceAttachment,
        this.pathEndAttachment,
      ) || {
      brushes: [],
      errors: ["Path preview failed"],
    };
    this.pathPreviewBrushes = result.brushes || [];
    this.pathPreviewErrors = result.errors || [];
    this.pathStations = result.stations || [];
    if (result.path?.nodes) {
      this.pathModel = result.path;
      this.pathPoints = this.pathModel.nodes;
    }
    this.requestDraw();
    return result;
  }

  VP.prototype.commitPath = function() {
    if (this.pathPoints.length < 2) return false;
    const result = this.refreshPathPreview();
    if (result.errors.length || !result.brushes.length) return false;
    this.onPathCommit({
      path: this.pathData(),
      assemblyId: this.pathAssemblyId,
      brushes: result.brushes,
      sourceAttachment: this.pathSourceAttachment,
      endAttachment: this.pathEndAttachment,
    });
    return true;
  }

  VP.prototype.removeLastPathPoint = function() {
    if (!this.pathPoints.length) return false;
    this.pathPoints.pop();
    this.pathModel.nodes = this.pathPoints;
    this.pathModel.closed = false;
    this.pathModel.segmentModes.length = Math.max(
      0,
      this.pathPoints.length - 1,
    );
    this.pathEndAttachment = null;
    this.selectedPathNode = this.pathPoints.length - 1;
    this.refreshPathPreview();
    return true;
  }

  VP.prototype.removeSelectedPathNode = function() {
    const index = this.selectedPathNode;
    if (
      !Number.isInteger(index) ||
      this.pathPoints.length < 3 ||
      index === 0 ||
      index === this.pathPoints.length - 1
    )
      return this.removeLastPathPoint();
    this.pathPoints.splice(index, 1);
    this.pathModel.nodes = this.pathPoints;
    if (this.pathModel.segmentModes.length > index - 1)
      this.pathModel.segmentModes.splice(index - 1, 1);
    else if (this.pathModel.segmentModes.length)
      this.pathModel.segmentModes.pop();
    this.selectedPathNode = Math.min(index, this.pathPoints.length - 1);
    this.reroutePathAroundShapes();
    return true;
  }

  VP.prototype.togglePathClosed = function() {
    if (this.pathPoints.length < 3) return false;
    this.pathModel.closed = !this.pathModel.closed;
    const segmentCount = this.pathModel.closed
      ? this.pathPoints.length
      : this.pathPoints.length - 1;
    while (this.pathModel.segmentModes.length < segmentCount)
      this.pathModel.segmentModes.push(
        this.state.pathSettings?.segmentMode || "spline",
      );
    this.pathModel.segmentModes.length = segmentCount;
    if (this.pathModel.closed) {
      this.pathSourceAttachment = null;
      this.pathSourceBrushIds = [];
      this.pathGhostSource = null;
      this.pathEndAttachment = null;
    }
    this.refreshPathPreview();
    return true;
  }

  VP.prototype.setSelectedPathSegmentMode = function(mode) {
    if (!Number.isInteger(this.selectedPathSegment)) return false;
    if (!["spline", "straight"].includes(mode)) return false;
    this.pathModel.segmentModes[this.selectedPathSegment] = mode;
    this.refreshPathPreview();
    return true;
  }

  VP.prototype.setSelectedPathNodeMode = function(mode) {
    if (!Number.isInteger(this.selectedPathNode)) return false;
    if (!["auto", "smooth", "corner"].includes(mode)) return false;
    this.pathPoints[this.selectedPathNode].tangentMode = mode;
    if (mode === "auto") {
      delete this.pathPoints[this.selectedPathNode].tangentIn;
      delete this.pathPoints[this.selectedPathNode].tangentOut;
    }
    this.refreshPathPreview();
    return true;
  }

  VP.prototype.routePathPoints = function(start, end, outsideWidth, height, excludeBrushIds = []) {
    if (this.state.pathSettings?.avoidShapes === false)
      return { points: [start, end], obstacles: [], errors: [] };
    return this.onPathRoute({
      start,
      end,
      outsideWidth,
      height,
      floorZ: start.z,
      excludeBrushIds,
    });
  }

  VP.prototype.appendRoutedPathNodes = function(
    startNode,
    endNode,
    excludeBrushIds = [],
    reportError = true,
  ) {
    const currentBrushIds = this.state.brushes
      .filter((brush) => brush.assemblyId === this.pathAssemblyId)
      .map((brush) => brush.id);
    const routed = this.routePathPoints(
      startNode,
      endNode,
      Math.max(startNode.width, endNode.width),
      Math.max(startNode.height, endNode.height),
      [...new Set([...excludeBrushIds, ...currentBrushIds])],
    );
    if (routed.errors?.length || routed.points.length < 2) {
      if (reportError)
        this.onChange(
          `path-route-invalid:${routed.errors?.[0] || "No clear route exists"}`,
        );
      return false;
    }
    let routePoints = routed.points;
    let routedSegmentMode = "straight";
    let routedSegmentModes = null;
    let routedNodes = null;
    if (routed.points.length > 2) {
      const smoothingPadding = Math.max(
        this.state.grid * 2,
        Math.max(startNode.width, endNode.width) * 0.4,
      );
      const smoothedRoute = this.routePathPoints(
        startNode,
        endNode,
        Math.max(startNode.width, endNode.width) + 2 * smoothingPadding,
        Math.max(startNode.height, endNode.height),
        [...new Set([...excludeBrushIds, ...currentBrushIds])],
      );
      if (!smoothedRoute.errors?.length && smoothedRoute.points.length > 2) {
        const smoothLengths = [0];
        for (let index = 1; index < smoothedRoute.points.length; index++)
          smoothLengths.push(
            smoothLengths[index - 1] +
              Math.hypot(
                smoothedRoute.points[index].x -
                  smoothedRoute.points[index - 1].x,
                smoothedRoute.points[index].y -
                  smoothedRoute.points[index - 1].y,
              ),
          );
        const smoothTotal = smoothLengths.at(-1) || 1;
        const smoothNodes = smoothedRoute.points.map((point, index) => {
          const amount = smoothLengths[index] / smoothTotal;
          if (index === 0) return { ...startNode, ...point };
          if (index === smoothedRoute.points.length - 1)
            return { ...endNode, ...point };
          return {
            ...point,
            z: startNode.z + (endNode.z - startNode.z) * amount,
            width:
              startNode.width + (endNode.width - startNode.width) * amount,
            height:
              startNode.height + (endNode.height - startNode.height) * amount,
            tangentMode: "smooth",
            routeGenerated: true,
          };
        });
        for (let index = 0; index < smoothNodes.length; index++) {
          const node = smoothNodes[index];
          const previous = smoothNodes[index - 1];
          const next = smoothNodes[index + 1];
          if (previous && next) {
            const previousLength = Math.hypot(
              node.x - previous.x,
              node.y - previous.y,
              node.z - previous.z,
            );
            const nextLength = Math.hypot(
              next.x - node.x,
              next.y - node.y,
              next.z - node.z,
            );
            const direction = {
              x: next.x - previous.x,
              y: next.y - previous.y,
              z: next.z - previous.z,
            };
            const directionLength =
              Math.hypot(direction.x, direction.y, direction.z) || 1;
            const tangentLength =
              Math.min(previousLength, nextLength) * 0.5;
            const tangent = {
              x: (direction.x / directionLength) * tangentLength,
              y: (direction.y / directionLength) * tangentLength,
              z: (direction.z / directionLength) * tangentLength,
            };
            node.tangentIn = tangent;
            node.tangentOut = { ...tangent };
          } else if (next) {
            const adjacent = {
              x: next.x - node.x,
              y: next.y - node.y,
              z: next.z - node.z,
            };
            const supplied = node.tangentOut || adjacent;
            const suppliedLength =
              Math.hypot(supplied.x, supplied.y, supplied.z) || 1;
            const tangentLength = Math.min(
              suppliedLength,
              Math.hypot(adjacent.x, adjacent.y, adjacent.z) * 0.5,
            );
            node.tangentOut = {
              x: (supplied.x / suppliedLength) * tangentLength,
              y: (supplied.y / suppliedLength) * tangentLength,
              z: (supplied.z / suppliedLength) * tangentLength,
            };
          } else if (previous) {
            const adjacent = {
              x: node.x - previous.x,
              y: node.y - previous.y,
              z: node.z - previous.z,
            };
            const supplied = node.tangentIn || adjacent;
            const suppliedLength =
              Math.hypot(supplied.x, supplied.y, supplied.z) || 1;
            const tangentLength = Math.min(
              suppliedLength,
              Math.hypot(adjacent.x, adjacent.y, adjacent.z) * 0.5,
            );
            node.tangentIn = {
              x: (supplied.x / suppliedLength) * tangentLength,
              y: (supplied.y / suppliedLength) * tangentLength,
              z: (supplied.z / suppliedLength) * tangentLength,
            };
          }
        }
        try {
          const smoothModes = Array(smoothNodes.length - 1).fill("spline");
          if (
            this.pathSourceAttachment &&
            this.pathPoints.length === 1 &&
            this.pathPoints[0] === startNode
          )
            smoothModes[0] = "straight";
          const sampled = samplePath({
            version: PATH_VERSION,
            nodes: smoothNodes,
            segmentModes: smoothModes,
            closed: false,
            detail: this.pathModel.detail,
          });
          if (pathClearsObstacles(sampled.stations, routed.obstacles)) {
            routePoints = smoothedRoute.points;
            routedSegmentMode = "spline";
            routedSegmentModes = smoothModes;
            routedNodes = smoothNodes;
          }
        } catch {
          // Keep the validated polygonal route when spline sampling fails.
        }
      }
    }
    const lengths = [0];
    for (let index = 1; index < routePoints.length; index++)
      lengths.push(
        lengths[index - 1] +
          Math.hypot(
            routePoints[index].x - routePoints[index - 1].x,
            routePoints[index].y - routePoints[index - 1].y,
          ),
      );
    const total = lengths.at(-1) || 1;
    const routedAroundShape = routePoints.length > 2;
    for (let index = 1; index < routePoints.length; index++) {
      const amount = lengths[index] / total;
      const final = index === routePoints.length - 1;
      this.pathPoints.push(
        routedNodes
          ? { ...routedNodes[index] }
          : final
          ? { ...endNode, ...routePoints[index] }
          : {
              ...routePoints[index],
              z: startNode.z + (endNode.z - startNode.z) * amount,
              width:
                startNode.width + (endNode.width - startNode.width) * amount,
              height:
                startNode.height +
                (endNode.height - startNode.height) * amount,
              tangentMode:
                routedSegmentMode === "spline" ? "smooth" : "corner",
              routeGenerated: true,
            },
      );
      this.pathModel.segmentModes.push(
        routedAroundShape
          ? routedSegmentModes?.[index - 1] || routedSegmentMode
          : this.state.pathSettings?.segmentMode || "spline",
      );
    }
    this.pathModel.nodes = this.pathPoints;
    return true;
  }

  VP.prototype.reroutePathAroundShapes = function() {
    if (this.pathModel.closed) return false;
    const first = this.pathPoints[0];
    const last = this.pathPoints[this.pathPoints.length - 1];
    if (!first || !last) return false;
    const anchors = [
      structuredClone(first),
      structuredClone(last),
    ];
    const originalPoints = this.pathPoints;
    const originalModes = this.pathModel.segmentModes.slice();
    this.pathPoints = [anchors[0]];
    this.pathModel.nodes = this.pathPoints;
    this.pathModel.segmentModes = [];
    const excluded = [
      ...this.pathSourceBrushIds,
      ...(this.pathEndAttachment?.sourceBrushIds || []),
    ];
    if (
      !this.appendRoutedPathNodes(
        this.pathPoints.at(-1),
        anchors[1],
        excluded,
      )
    ) {
      this.pathPoints = originalPoints;
      this.pathModel.nodes = originalPoints;
      this.pathModel.segmentModes = originalModes;
      this.refreshPathPreview();
      return false;
    }
    this.selectedPathNode = this.pathPoints.length - 1;
    this.selectedPathSegment = null;
    this.refreshPathPreview();
    return true;
  }

  VP.prototype.snapMovedPathEnd = function(index, pointer) {
    if (
      this.kind !== "top" ||
      index !== this.pathPoints.length - 1 ||
      this.state.pathSettings?.snapEnds === false
    )
      return false;
    const target = this.onPathEndSnap(
      pointer,
      this.pathSourceBrushIds,
      this.pathAssemblyId,
    );
    if (!target || target.errors?.length) return false;
    const point = this.pathPoints[index];
    const previous = this.pathPoints[index - 1];
    const distance = Math.max(
      this.state.grid * 2,
      Math.hypot(target.center.x - previous.x, target.center.y - previous.y),
    );
    const direction = { x: -target.direction.x, y: -target.direction.y };
    const slope = target.floorPlane?.normal?.z
      ? -(
          target.floorPlane.normal.x * direction.x +
          target.floorPlane.normal.y * direction.y
        ) / target.floorPlane.normal.z
      : 0;
    point.x = target.center.x;
    point.y = target.center.y;
    point.z = roundToGrid(target.elevation ?? point.z, this.state.grid);
    point.width = target.outsideWidth || point.width;
    point.tangentMode = "smooth";
    point.tangentIn = {
      x: -target.direction.x * distance,
      y: -target.direction.y * distance,
      z: slope * distance,
    };
    this.pathEndAttachment = {
      ...structuredClone(target),
      flare: Number(this.state.pathSettings?.flare) || 0,
      blendLength: Number(this.state.pathSettings?.blendLength) || 128,
    };
    this.pathEndCandidate = target;
    return true;
  }

  VP.prototype.pathNodeAt = function(x, y) {
    let best = null;
    const entries = [...this.pathPoints.entries()].sort(([first], [second]) =>
      first === this.selectedPathNode
        ? -1
        : second === this.selectedPathNode
          ? 1
          : 0,
    );
    for (const [index, point] of entries) {
      const screen = this.screen(point);
      const distance = Math.hypot(x - screen.x, y - screen.y);
      if (distance <= 9 && (!best || distance < best.distance))
        best = { index, distance };
    }
    return best;
  }

  VP.prototype.pathNodeDirection = function(index) {
    const node = this.pathPoints[index];
    if (!node) return { x: 1, y: 0, z: 0 };
    const supplied = node.tangentOut || node.tangentIn;
    let direction = supplied ? { ...supplied } : null;
    if (!direction) {
      const previous =
        this.pathPoints[
          (index - 1 + this.pathPoints.length) % this.pathPoints.length
        ];
      const next = this.pathPoints[(index + 1) % this.pathPoints.length];
      if (!this.pathModel.closed && index === 0 && next)
        direction = {
          x: next.x - node.x,
          y: next.y - node.y,
          z: next.z - node.z,
        };
      else if (!this.pathModel.closed && index === this.pathPoints.length - 1)
        direction = {
          x: node.x - previous.x,
          y: node.y - previous.y,
          z: node.z - previous.z,
        };
      else if (previous && next)
        direction = {
          x: (next.x - previous.x) / 2,
          y: (next.y - previous.y) / 2,
          z: (next.z - previous.z) / 2,
        };
    }
    direction ||= { x: 1, y: 0, z: 0 };
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    return {
      x: direction.x / length,
      y: direction.y / length,
      z: direction.z / length,
    };
  }

  VP.prototype.pathControlHandles = function() {
    if (
      this.pathPoints.length < 2 ||
      !Number.isInteger(this.selectedPathNode)
    )
      return [];
    const index = this.selectedPathNode;
    const node = this.pathPoints[index];
    if (!node) return [];
    const handles = [];
    if (this.kind === "top") {
      const direction = this.pathNodeDirection(index);
      const normal = { x: -direction.y, y: direction.x };
      for (const side of [-1, 1]) {
        const point = {
          ...node,
          x: node.x + normal.x * (node.width / 2) * side,
          y: node.y + normal.y * (node.width / 2) * side,
        };
        handles.push({ type: "path-width", index, side, point });
      }
      const tangentLength = Math.max(
        this.state.grid * 2,
        Math.min(
          128,
          Math.hypot(
            node.tangentOut?.x || 0,
            node.tangentOut?.y || 0,
          ) / 3 || 48,
        ),
      );
      for (const side of [-1, 1]) {
        handles.push({
          type: "path-tangent",
          index,
          side,
          point: {
            ...node,
            x: node.x + direction.x * tangentLength * side,
            y: node.y + direction.y * tangentLength * side,
          },
        });
      }
    } else {
      handles.push({
        type: "path-height",
        index,
        point: { ...node, z: node.z + node.height },
      });
    }
    return handles;
  }

  VP.prototype.pathControlAt = function(x, y) {
    return this.pathControlHandles().find((handle) => {
      const screen = this.screen(handle.point);
      return Math.hypot(x - screen.x, y - screen.y) <= 9;
    });
  }

  VP.prototype.pathSegmentAt = function(x, y) {
    const stations = this.pathStations.length
      ? this.pathStations
      : this.pathPoints.map((point, index) => ({
          ...point,
          sourceSegment: Math.max(0, index - 1),
        }));
    const count = this.pathModel.closed ? stations.length : stations.length - 1;
    let best = null;
    for (let index = 0; index < count; index++) {
      const start = this.screen(stations[index]);
      const end = this.screen(stations[(index + 1) % stations.length]);
      const distance = distanceToSegment({ x, y }, start, end);
      if (distance <= 7 && (!best || distance < best.distance))
        best = {
          index:
            stations[index].sourceSegment ?? Math.min(index, this.pathPoints.length - 2),
          distance,
        };
    }
    return best;
  }

}
