import { roundToGrid } from "./grid.js";
import { extrudeSelectedFaces, faceDirection, resolveExtrusion, solveSingleFaceExtrusion } from "./face-extrusion.js";
import { extrusionPolicyForMode, railWithinAngleLimit } from "./extrusion-policy.js";
import { dedupeFirst, isNoDrawMaterial, passesProbeValidation, projectedRailKey, chooseProjectedBoundaryFace, movingCornerTouchesRail, solvedEdgeMatchesRail, projectPointToSegment, availableForwardSegmentLength } from "./rail-acquisition.js";
import { faceRole } from "./selection.js";
import { segmentsIntersect, INFLUENCE_ACQUIRE_PX, INFLUENCE_RELEASE_PX } from "./viewport-constants.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportExtrusion(VP) {
  VP.prototype.groupedExtrusionGridAnchor = function(id, selection, pointer) {
    if (selection.size <= 1) return null;
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]),
      face = brush?.faces[Number(match?.[2])];
    if (!brush || !face) return null;
    const unitResult = extrudeSelectedFaces(
        this.state.brushes,
        selection,
        1,
        this.state.grid,
        selection,
        this.state.faceExtrusionMode,
      ),
      preview = unitResult.previewBrushes.find(
        (item) => item.generator?.sourceBrushId === brush.id,
      );
    if (!preview) return null;
    const nearest = face
      .map((vertexIndex, index) => ({
        index,
        source: brush.vertices[vertexIndex],
        screen: this.screen(brush.vertices[vertexIndex]),
      }))
      .sort(
        (a, b) =>
          Math.hypot(a.screen.x - pointer.x, a.screen.y - pointer.y) -
          Math.hypot(b.screen.x - pointer.x, b.screen.y - pointer.y),
      )[0];
    const cap = preview.vertices[face.length + nearest.index];
    if (!cap) return null;
    return {
      source: { ...nearest.source },
      direction: {
        x: cap.x - nearest.source.x,
        y: cap.y - nearest.source.y,
        z: cap.z - nearest.source.z,
      },
    };
  }

  VP.prototype.snapExtrusionDistance = function(distance) {
    if (!this.state.faceExtrusionGridSnap) return distance;
    const anchor = this.drag?.gridSnapAnchor;
    if (!anchor) return roundToGrid(distance, this.state.grid);
    const axis = this.axes()
      .slice(0, 2)
      .sort(
        (a, b) => Math.abs(anchor.direction[b]) - Math.abs(anchor.direction[a]),
      )[0];
    const movement = anchor.direction[axis];
    if (Math.abs(movement) < 0.000001)
      return roundToGrid(distance, this.state.grid);
    const target = roundToGrid(
      anchor.source[axis] + movement * distance,
      this.state.grid,
    );
    return Math.max(0, (target - anchor.source[axis]) / movement);
  }

  VP.prototype.faceExtrusionDistance = function(id, start, current) {
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
    const pointerDistance = Math.max(0, pixels / this.scale);
    const rawDistance = this.snapExtrusionDistance(pointerDistance);
    if (this.drag) {
      this.drag.maxRawDistance = Math.max(
        this.drag.maxRawDistance || 0,
        rawDistance,
      );
    }
    const endpointReleaseDistance = 18 / Math.max(this.scale, 0.0001);
    const endpointPairRetreat =
      this.drag?.startRailState === "paired" &&
      Object.values(this.drag.sideRailEndpointDistances || {}).some(
        (distance) =>
          Number.isFinite(distance) &&
          rawDistance < distance - endpointReleaseDistance,
      );
    if (this.drag) this.drag.endpointPairRetreat = endpointPairRetreat;
    if (this.drag && endpointPairRetreat) this.drag.sideRailEndpointLocks = {};
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

    const [axisX, axisY] = this.axes();

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
    const pointerStartWorld = this.world(start);
    const pointerCurrentWorld = this.world(current);
    const pointerTangentOffset =
      this.state.faceExtrusionMode === "snap"
        ? ((pointerCurrentWorld[axisX] - pointerStartWorld[axisX]) *
            srcDir2D.x +
            (pointerCurrentWorld[axisY] - pointerStartWorld[axisY]) *
              srcDir2D.y) /
          srcLen2D
        : 0;
    if (this.drag) this.drag.pointerTangentOffset = pointerTangentOffset;
    const closestPointOnSegment = (point, a, b) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        len2 = dx * dx + dy * dy;
      if (len2 < 1e-8) return { point: { x: a.x, y: a.y }, t: 0, rawT: 0 };
      const rawT = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
      const t = Math.max(0, Math.min(1, rawT));
      return { point: { x: a.x + dx * t, y: a.y + dy * t }, t, rawT };
    };

    const freeCapA2D = {
      x:
        baseA.x +
        extNormal.x * rawDistance +
        (srcDir2D.x / srcLen2D) * pointerTangentOffset,
      y:
        baseA.y +
        extNormal.y * rawDistance +
        (srcDir2D.y / srcLen2D) * pointerTangentOffset,
    };
    const freeCapB2D = {
      x:
        baseB.x +
        extNormal.x * rawDistance +
        (srcDir2D.x / srcLen2D) * pointerTangentOffset,
      y:
        baseB.y +
        extNormal.y * rawDistance +
        (srcDir2D.y / srcLen2D) * pointerTangentOffset,
    };

    // Corner-based snap acquisition.
    // Each cap corner finds the nearest target edge whose direction
    // matches the expected source base or outward-normal direction.
    // Perpendicular/wrong-direction edges are skipped.
    // This is the "corner slides along a target edge" model.

    if (!extrusionPolicy.externalSnap) {
      this.extrusionMatchDebug = [];
      this.extrusionSolvedDebug = null;
      this.extrusionAcquisitionDebug = null;
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
    const angleDifferenceDegrees = (first, second) => {
      const firstLength = Math.hypot(first.x, first.y);
      const secondLength = Math.hypot(second.x, second.y);
      if (firstLength < 0.000001 || secondLength < 0.000001) return null;
      const alignment = Math.max(
        -1,
        Math.min(
          1,
          Math.abs(
            (first.x * second.x + first.y * second.y) /
              (firstLength * secondLength),
          ),
        ),
      );
      return (Math.acos(alignment) * 180) / Math.PI;
    };
    const computeRailInfluencePx = (
      freeCap2D,
      capDir,
      lineOrigin,
      railDir,
      scale,
    ) => {
      const origin = lineOrigin || freeCap2D;
      const dx = freeCap2D.x - origin.x;
      const dy = freeCap2D.y - origin.y;
      const det = railDir.x * -capDir.y - railDir.y * -capDir.x;
      if (Math.abs(det) < 0.000001) return 0;
      const t = (dy * capDir.x - dx * capDir.y) / det;
      return (
        Math.hypot(
          origin.x + railDir.x * t - freeCap2D.x,
          origin.y + railDir.y * t - freeCap2D.y,
        ) * scale
      );
    };
    const isWeakNearParallelRail = (candidate, freeCap2D, capDir, scale) => {
      if (candidate.endpointSnapActive) return { weak: false };
      const localOrigin =
        candidate.source === "attached"
          ? candidate.lineOrigin
          : candidate.lineOrigin;
      const influence = computeRailInfluencePx(
        freeCap2D,
        capDir,
        localOrigin,
        candidate.railDirection,
        scale,
      );
      candidate.railInfluencePx = influence;
      if (influence >= INFLUENCE_ACQUIRE_PX) return { weak: false, influence };
      const nearestEndpointPx = candidate.nearestEndpointDistancePx;
      if (
        Number.isFinite(nearestEndpointPx) &&
        nearestEndpointPx <= RELEASE_RADIUS
      )
        return { weak: false, influence };
      return {
        weak: true,
        influence,
        releaseReason: "near-parallel-pointer-away",
      };
    };
    const adjacentSourceDirection = (group) => {
      const adjacent = brush.faces.find(
        (candidate, index) =>
          index !== faceIndex &&
          group.filter((vertexIndex) => candidate.includes(vertexIndex))
            .length >= 2,
      );
      const adjacentNormal = adjacent && faceDirection(brush, adjacent);
      if (!adjacentNormal) return sourceNormalDir;
      const direction = {
        x: -(adjacentNormal[axisY] || 0),
        y: adjacentNormal[axisX] || 0,
      };
      const directionLength = Math.hypot(direction.x, direction.y);
      return directionLength < 0.0001
        ? sourceNormalDir
        : {
            x: direction.x / directionLength,
            y: direction.y / directionLength,
          };
    };
    const sourceSideDirections = {
      sideA: adjacentSourceDirection(groupA),
      sideB: adjacentSourceDirection(groupB),
    };
    const adjacentSourceSegment = (group) => {
      const base = {
        x: brush.vertices[group[0]][axisX],
        y: brush.vertices[group[0]][axisY],
      };
      const adjacent = brush.faces.find(
        (candidate, index) =>
          index !== faceIndex &&
          group.filter((vertexIndex) => candidate.includes(vertexIndex))
            .length >= 2,
      );
      if (!adjacent) return null;
      const other = adjacent
        .map((vertexIndex) => ({
          x: brush.vertices[vertexIndex][axisX],
          y: brush.vertices[vertexIndex][axisY],
        }))
        .find(
          (point) => Math.hypot(point.x - base.x, point.y - base.y) > 0.0001,
        );
      return other ? { base, other } : null;
    };
    const sourceSideSegments = {
      sideA: adjacentSourceSegment(groupA),
      sideB: adjacentSourceSegment(groupB),
    };

    // Find the best target edge for the cap to lie on. The cap
    // is always parallel to the base, at some perpendicular offset.
    // The snap picks a target edge parallel to the base and provides
    // a direction constraint that makes the cap parallel to the base.
    const ACQUIRE_RADIUS = 12;
    const RELEASE_RADIUS = 18;
    // Stable key: identifies the target edge (brush, face, and
    // vertex index) so endpoint magnet state persists across frames.
    const edgeKey = (targetBrushId, fi, vi) => `${targetBrushId}:f:${fi}:${vi}`;
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
          if (!tfNormal) continue;
          const tfnX = tfNormal[axisX] || 0;
          const tfnY = tfNormal[axisY] || 0;
          const tfnLen = Math.hypot(tfnX, tfnY);
          if (tfnLen <= 0.0001) continue;
          const tfnDX = tfnX / tfnLen;
          const tfnDY = tfnY / tfnLen;
          const faceDot = tfnDX * sourceNormalDir.x + tfnDY * sourceNormalDir.y;
          if (faceDot > -0.3) continue;
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
              const tClamp =
                dx !== 0
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
              movingEdge: "cap",
              targetBrushId: targetBrush.id,
              targetFaceIndex: fi,
              targetStartWorld: { ...sW },
              targetEndWorld: { ...eW },
              direction: tDir,
              canonicalKey: `${targetBrush.id}:${projectedRailKey(sW, eW, axisX, axisY)}`,
              source: "magnetic",
              cornerSnap: { x: snapX, y: snapY },
              corridorSideScore: null,
              signedForwardDirection:
                (snapX - baseCorner.x) * sourceNormalDir.x +
                (snapY - baseCorner.y) * sourceNormalDir.y,
              sourceAngleDifferenceDegrees: angleDifferenceDegrees(
                tDir,
                sourceBaseDir,
              ),
              railAngleDifferenceDegrees: angleDifferenceDegrees(
                tDir,
                sourceBaseDir,
              ),
              finiteSegmentDistancePx: Math.hypot(
                cornerScr.x -
                  closestPointOnSegment(cornerScr, sScr, eScr).point.x,
                cornerScr.y -
                  closestPointOnSegment(cornerScr, sScr, eScr).point.y,
              ),
              infiniteLineDistancePx: dist,
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
    // Attached-edge snapping accepts direct contact or a collinear source-side
    // chain whose opposite endpoint touches the physical target segment.
    const EPSILON_ATTACH = 0.5;
    const SIDE_BASE_TOLERANCE = Math.max(
      EPSILON_ATTACH,
      (this.state.grid || 1) * 0.05,
    );
    const rejectedRailCandidates = [];
    const resolveProjectedRailCandidates = (
      movingEdge,
      baseCornerWorld,
      freeCapWorld2D,
      otherFreeCapWorld2D,
      freeCapScreen,
      source,
    ) => {
      const groups = new Map();
      const addProjectedEdge = (brush, faceIndex, face, edgeStart, edgeEnd) => {
        if (sourceBrushIds.has(brush.id)) return;
        const projectedKey = projectedRailKey(edgeStart, edgeEnd, axisX, axisY);
        const startKey = `${edgeStart[axisX].toFixed(5)},${edgeStart[axisY].toFixed(5)}`;
        const endKey = `${edgeEnd[axisX].toFixed(5)},${edgeEnd[axisY].toFixed(5)}`;
        const start = startKey <= endKey ? edgeStart : edgeEnd;
        const end = startKey <= endKey ? edgeEnd : edgeStart;
        if (
          Math.hypot(end[axisX] - start[axisX], end[axisY] - start[axisY]) <
          0.0001
        )
          return;
        const key = `${brush.id}:${projectedKey}`;
        const group = groups.get(key) || {
          key,
          brush,
          start,
          end,
          startScreen: this.screen(start),
          endScreen: this.screen(end),
          records: new Map(),
        };
        group.records.set(`${brush.id}:f:${faceIndex}`, {
          brush,
          faceIndex,
          face,
        });
        groups.set(key, group);
      };
      if (source === "attached") {
        for (const targetBrush of this.visibleBrushes()) {
          if (sourceBrushIds.has(targetBrush.id)) continue;
          for (
            let faceIndex = 0;
            faceIndex < targetBrush.faces.length;
            faceIndex++
          ) {
            const face = targetBrush.faces[faceIndex];
            for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex++)
              addProjectedEdge(
                targetBrush,
                faceIndex,
                face,
                targetBrush.vertices[face[edgeIndex]],
                targetBrush.vertices[face[(edgeIndex + 1) % face.length]],
              );
          }
        }
      } else {
        for (const edge of this.exposedEdges()) {
          const records = [...edge.faceIds]
            .map((id) => {
              const match = id.match(/^(.*):f:(\d+)$/);
              const brush =
                match &&
                this.state.brushes.find((item) => item.id === match[1]);
              const faceIndex = Number(match?.[2]);
              return brush?.faces[faceIndex]
                ? { brush, faceIndex, face: brush.faces[faceIndex] }
                : null;
            })
            .filter(Boolean);
          if (records.length !== 2) continue;
          if (sourceBrushIds.has(records[0].brush.id)) continue;
          if (
            records.every((record) =>
              isNoDrawMaterial(
                record.brush.faceMaterials?.[record.faceIndex] ||
                  record.brush.material,
              ),
            )
          )
            continue;
          for (const record of records)
            addProjectedEdge(
              record.brush,
              record.faceIndex,
              record.face,
              edge.start,
              edge.end,
            );
        }
      }
      const candidates = [];
      for (const group of groups.values()) {
        const start = { x: group.start[axisX], y: group.start[axisY] };
        const end = { x: group.end[axisX], y: group.end[axisY] };
        const railDirection = canonicalLineDirection(start, end);
        if (!railDirection) continue;
        const reference =
          movingEdge === "sideA"
            ? {
                x: (baseB.x + freeCapWorld2D.x) / 2,
                y: (baseB.y + freeCapWorld2D.y) / 2,
              }
            : {
                x: (baseA.x + freeCapWorld2D.x) / 2,
                y: (baseA.y + freeCapWorld2D.y) / 2,
              };
        const boundaryFace = chooseProjectedBoundaryFace(
          [...group.records.values()].map((record) => ({
            ...record,
            edgePoint: start,
          })),
          railDirection,
          reference,
          axisX,
          axisY,
          isNoDrawMaterial,
          faceDirection,
          source === "attached",
        );
        if (!boundaryFace) continue;
        const railAngleAllowed = railWithinAngleLimit(
          railDirection,
          sourceNormalDir,
          this.state.faceRailMaxAngle,
        );
        const forwardStart =
          (start.x - baseCornerWorld.x) * sourceNormalDir.x +
          (start.y - baseCornerWorld.y) * sourceNormalDir.y;
        const forwardEnd =
          (end.x - baseCornerWorld.x) * sourceNormalDir.x +
          (end.y - baseCornerWorld.y) * sourceNormalDir.y;
        const lineDistanceWorld = distancePointToLine(
          freeCapWorld2D,
          start,
          end,
        );
        const baseLineDistanceWorld = distancePointToLine(
          baseCornerWorld,
          start,
          end,
        );
        const closestWorld = closestPointOnSegment(freeCapWorld2D, start, end);
        const segmentDistanceWorld = Math.hypot(
          freeCapWorld2D.x - closestWorld.point.x,
          freeCapWorld2D.y - closestWorld.point.y,
        );
        const attach = projectPointToSegment(baseCornerWorld, start, end);
        let capProjectedT = closestWorld.t;
        const startEndpointDistance = Math.hypot(
          freeCapScreen.x - group.startScreen.x,
          freeCapScreen.y - group.startScreen.y,
        );
        const endEndpointDistance = Math.hypot(
          freeCapScreen.x - group.endScreen.x,
          freeCapScreen.y - group.endScreen.y,
        );
        const endpointDistance = Math.min(
          startEndpointDistance,
          endEndpointDistance,
        );
        const finiteSegmentLength = Math.hypot(
          end.x - start.x,
          end.y - start.y,
        );
        const endpointAlongDistance =
          Math.min(closestWorld.t, 1 - closestWorld.t) *
          finiteSegmentLength *
          this.scale;
        const pastFiniteEnd =
          (closestWorld.rawT < 0 || closestWorld.rawT > 1) &&
          segmentDistanceWorld * this.scale > RELEASE_RADIUS;
        const lockedKey = this.drag?.sideRailLocks?.[movingEdge];
        const endpointLocked =
          this.drag?.sideRailEndpointLocks?.[movingEdge] === group.key;
        const endpointLockDistance =
          this.drag?.sideRailEndpointDistances?.[movingEdge];
        const endpointReleasedBackward =
          endpointLocked &&
          Number.isFinite(endpointLockDistance) &&
          rawDistance <
            endpointLockDistance -
              RELEASE_RADIUS / Math.max(this.scale, 0.0001);
        const endpointReleased =
          lockedKey === group.key &&
          endpointLocked &&
          (pastFiniteEnd || endpointReleasedBackward);
        const endpointSnapActive =
          (source === "attached"
            ? endpointAlongDistance <= RELEASE_RADIUS
            : endpointDistance <= RELEASE_RADIUS) &&
          (closestWorld.t <= 0.05 || closestWorld.t >= 0.95) &&
          (source !== "attached" ||
            Math.abs(closestWorld.t - attach.t) > 0.5) &&
          !endpointReleased;
        const endpointAngleBypass =
          source === "magnetic" &&
          !railAngleAllowed &&
          endpointDistance <= RELEASE_RADIUS;
        if (!railAngleAllowed && source === "magnetic" && !endpointAngleBypass)
          continue;
        const finiteAttachDistance = Math.hypot(
          baseCornerWorld.x - attach.point.x,
          baseCornerWorld.y - attach.point.y,
        );
        const usableForwardLength = availableForwardSegmentLength(
          attach.point,
          start,
          end,
          extNormal,
        );
        let candidateAttachmentPoint = attach.point;
        let candidateRawSegmentT = attach.rawT;
        let candidateAvailableForwardLength = usableForwardLength;
        let distancePx;
        let attachmentKind;
        if (source === "attached") {
          if (finiteAttachDistance <= EPSILON_ATTACH) {
            attachmentKind = "direct";
          } else {
            const sourceSegment = sourceSideSegments[movingEdge];
            const sourceDirection = sourceSegment && {
              x: sourceSegment.other.x - sourceSegment.base.x,
              y: sourceSegment.other.y - sourceSegment.base.y,
            };
            const sourceLength =
              sourceDirection &&
              Math.hypot(sourceDirection.x, sourceDirection.y);
            const sourceAlignment = sourceLength
              ? Math.abs(
                  (sourceDirection.x * railDirection.x +
                    sourceDirection.y * railDirection.y) /
                    sourceLength,
                )
              : 0;
            const sourceEndpoint =
              sourceSegment &&
              closestPointOnSegment(sourceSegment.other, start, end);
            if (
              !sourceSegment ||
              baseLineDistanceWorld > EPSILON_ATTACH ||
              sourceAlignment < 0.9999 ||
              Math.hypot(
                sourceSegment.other.x - sourceEndpoint.point.x,
                sourceSegment.other.y - sourceEndpoint.point.y,
              ) > EPSILON_ATTACH
            ) {
              rejectedRailCandidates.push({
                movingEdge,
                targetBrushId: group.brush.id,
                targetFaceIndex: boundaryFace.faceIndex,
                canonicalKey: group.key,
                projectedRailKey: projectedRailKey(
                  group.start,
                  group.end,
                  axisX,
                  axisY,
                ),
                source,
                rejectionReason:
                  "base corner is outside the target segment and has no collinear source-side chain",
                attachmentPoint: attach.point,
                rawSegmentT: attach.rawT,
                availableForwardSegmentLength: usableForwardLength,
                capProjectedT,
                corridorSideScore: boundaryFace.corridorSide,
                signedForwardDirection: Math.max(forwardStart, forwardEnd),
                sourceAngleDifferenceDegrees: angleDifferenceDegrees(
                  railDirection,
                  sourceSideDirections[movingEdge],
                ),
                railAngleDifferenceDegrees: angleDifferenceDegrees(
                  railDirection,
                  sourceNormalDir,
                ),
                finiteSegmentDistancePx: segmentDistanceWorld * this.scale,
                infiniteLineDistancePx: lineDistanceWorld * this.scale,
              });
              continue;
            }
            attachmentKind = "source-chain";
          }
          if (usableForwardLength <= 0.01 && !endpointReleased) {
            rejectedRailCandidates.push({
              movingEdge,
              targetBrushId: group.brush.id,
              targetFaceIndex: boundaryFace.faceIndex,
              canonicalKey: group.key,
              projectedRailKey: projectedRailKey(
                group.start,
                group.end,
                axisX,
                axisY,
              ),
              source,
              rejectionReason: "segment-behind-source",
              attachmentPoint: attach.point,
              rawSegmentT: attach.rawT,
              availableForwardSegmentLength: usableForwardLength,
              capProjectedT,
              corridorSideScore: boundaryFace.corridorSide,
              signedForwardDirection: Math.max(forwardStart, forwardEnd),
              sourceAngleDifferenceDegrees: angleDifferenceDegrees(
                railDirection,
                sourceSideDirections[movingEdge],
              ),
              railAngleDifferenceDegrees: angleDifferenceDegrees(
                railDirection,
                sourceNormalDir,
              ),
              finiteSegmentDistancePx: segmentDistanceWorld * this.scale,
              infiniteLineDistancePx: lineDistanceWorld * this.scale,
            });
            continue;
          }
          if (endpointSnapActive) {
            const endpoint = closestWorld.t <= 0.5 ? group.start : group.end;
            group.cornerSnap = {
              x: endpoint[axisX],
              y: endpoint[axisY],
            };
            capProjectedT = closestWorld.t <= 0.5 ? 0 : 1;
          }
          group.endpointSnapActive = endpointSnapActive;
          group.endpointSnapReleased = endpointReleased;
          distancePx = lineDistanceWorld;
        } else {
          if (Math.max(forwardStart, forwardEnd) <= 0.05) continue;
          const capLineDistancePx = distancePointToLine(
            freeCapScreen,
            group.startScreen,
            group.endScreen,
          );
          const closest = closestPointOnSegment(
            freeCapScreen,
            group.startScreen,
            group.endScreen,
          );
          const closestWorld = closestPointOnSegment(
            freeCapWorld2D,
            start,
            end,
          );
          const segmentDistancePx = Math.hypot(
            freeCapScreen.x - closest.point.x,
            freeCapScreen.y - closest.point.y,
          );
          const candidateDistance = Math.min(
            capLineDistancePx,
            segmentDistancePx,
          );
          const touches = movingCornerTouchesRail(
            baseCornerWorld,
            freeCapWorld2D,
            start,
            end,
            0.01,
          );
          const capTouches = segmentsIntersect(
            freeCapWorld2D,
            otherFreeCapWorld2D,
            start,
            end,
          );
          const magneticUsableForwardLength = availableForwardSegmentLength(
            closestWorld.point,
            start,
            end,
            extNormal,
          );
          candidateAttachmentPoint = closestWorld.point;
          candidateRawSegmentT = closestWorld.rawT;
          candidateAvailableForwardLength = magneticUsableForwardLength;
          const retained = lockedKey === group.key && candidateDistance <= 18;
          if (
            (pastFiniteEnd && !endpointReleased) ||
            (magneticUsableForwardLength <= 0.01 && !endpointReleased) ||
            (!touches &&
              !capTouches &&
              candidateDistance > 12 &&
              !retained &&
              !endpointReleased)
          ) {
            if (magneticUsableForwardLength <= 0.01 && !endpointReleased)
              rejectedRailCandidates.push({
                movingEdge,
                targetBrushId: group.brush.id,
                targetFaceIndex: boundaryFace.faceIndex,
                canonicalKey: group.key,
                projectedRailKey: projectedRailKey(
                  group.start,
                  group.end,
                  axisX,
                  axisY,
                ),
                source,
                rejectionReason: "segment-behind-source",
                attachmentPoint: closestWorld.point,
                rawSegmentT: closestWorld.rawT,
                availableForwardSegmentLength: magneticUsableForwardLength,
                capProjectedT: closestWorld.t,
                corridorSideScore: boundaryFace.corridorSide,
                finiteSegmentDistancePx: segmentDistancePx,
                infiniteLineDistancePx: capLineDistancePx,
              });
            continue;
          }
          distancePx = Math.min(capLineDistancePx, segmentDistancePx);
          if (endpointDistance <= RELEASE_RADIUS && !endpointReleased) {
            const endpoint =
              startEndpointDistance <= endEndpointDistance
                ? group.start
                : group.end;
            group.cornerSnap = {
              x: endpoint[axisX],
              y: endpoint[axisY],
            };
            capProjectedT =
              startEndpointDistance <= endEndpointDistance ? 0 : 1;
          } else {
            group.cornerSnap = closestWorld.point;
          }
          if (endpointReleased) group.cornerSnap = undefined;
          group.endpointSnapActive =
            endpointDistance <= RELEASE_RADIUS && !endpointReleased;
          group.endpointSnapReleased = endpointReleased;
        }
        candidates.push({
          movingEdge,
          targetBrushId: group.brush.id,
          targetFaceIndex: boundaryFace.faceIndex,
          adjacentFaceIndices: [...group.records.values()].map(
            (record) => record.faceIndex,
          ),
          railDirection,
          lineOrigin: start,
          targetStartWorld: { ...group.start },
          targetEndWorld: { ...group.end },
          targetFaceNormal: boundaryFace.normal,
          projectedRailKey: projectedRailKey(
            group.start,
            group.end,
            axisX,
            axisY,
          ),
          canonicalKey: group.key,
          source,
          attachmentKind,
          baseContactDistance:
            source === "attached" ? baseLineDistanceWorld : undefined,
          attachmentPoint: candidateAttachmentPoint,
          rawSegmentT: candidateRawSegmentT,
          availableForwardSegmentLength: candidateAvailableForwardLength,
          capProjectedT,
          cornerSnap: group.cornerSnap,
          endpointSnapActive: Boolean(group.endpointSnapActive),
          endpointSnapReleased: Boolean(group.endpointSnapReleased),
          corridorSideScore: boundaryFace.corridorSide,
          signedForwardDirection: Math.max(forwardStart, forwardEnd),
          sourceAngleDifferenceDegrees: angleDifferenceDegrees(
            railDirection,
            sourceSideDirections[movingEdge],
          ),
          railAngleDifferenceDegrees: angleDifferenceDegrees(
            railDirection,
            sourceNormalDir,
          ),
          singleSideForwardFacing:
            Math.abs(
              railDirection.x * sourceNormalDir.x +
                railDirection.y * sourceNormalDir.y,
            ) >
            Math.abs(
              railDirection.x * sourceBaseDir.x +
                railDirection.y * sourceBaseDir.y,
            ),
          finiteSegmentDistancePx: segmentDistanceWorld * this.scale,
          infiniteLineDistancePx: lineDistanceWorld * this.scale,
          solvedEdgeToRailDistance: null,
          nearestEndpointDistancePx: endpointDistance,
          distancePx,
          lineDistancePx: distancePx,
        });
      }
      return candidates.sort(
        (a, b) =>
          a.distancePx - b.distancePx ||
          a.canonicalKey.localeCompare(b.canonicalKey),
      );
    };
    const findSideSnap = (
      movingEdge,
      baseCornerWorld,
      freeCapWorld2D,
      otherFreeCapWorld2D,
      freeCapScreen,
    ) =>
      resolveProjectedRailCandidates(
        movingEdge,
        baseCornerWorld,
        freeCapWorld2D,
        otherFreeCapWorld2D,
        freeCapScreen,
        "magnetic",
      );
    const findAttachedEdges = (movingEdge, baseCornerWorld, freeCapWorld2D) => {
      const freeCapWorld = { x: 0, y: 0, z: 0 };
      freeCapWorld[axisX] = freeCapWorld2D.x;
      freeCapWorld[axisY] = freeCapWorld2D.y;
      return resolveProjectedRailCandidates(
        movingEdge,
        baseCornerWorld,
        freeCapWorld2D,
        freeCapWorld2D,
        this.screen(freeCapWorld),
        "attached",
      );
    };

    const railSnappingEnabled = (this.drag?.selection?.size || 1) === 1;
    const sideRailSnappingEnabled =
      railSnappingEnabled && extrusionPolicy.sideSnap;
    // Discover cap and side candidates from both cap corners only for a
    // single active face. Grouped multi-face extrusion remains unconstrained.
    const capSnapsA = railSnappingEnabled
      ? findCapSnap(freeCapA2D, freeCapScrA, { x: baseA.x, y: baseA.y })
      : [];
    const capSnapsB = railSnappingEnabled
      ? findCapSnap(freeCapB2D, freeCapScrB, { x: baseB.x, y: baseB.y })
      : [];
    const capSnaps = [...capSnapsA, ...capSnapsB].sort(
      (a, b) => a.distance - b.distance,
    );
    const attachedACandidates = sideRailSnappingEnabled
      ? findAttachedEdges("sideA", { x: baseA.x, y: baseA.y }, freeCapA2D)
      : [];
    const attachedBCandidates = sideRailSnappingEnabled
      ? findAttachedEdges("sideB", { x: baseB.x, y: baseB.y }, freeCapB2D)
      : [];
    const hardAPool = dedupeFirst(attachedACandidates).slice(0, 6);
    const hardBPool = dedupeFirst(attachedBCandidates).slice(0, 6);
    // Attached and magnetic support-line candidates are both evaluated;
    // attached candidates are ordered first in each pool.
    const sideASnaps = sideRailSnappingEnabled
      ? findSideSnap(
          "sideA",
          { x: baseA.x, y: baseA.y },
          freeCapA2D,
          freeCapB2D,
          freeCapScrA,
        )
      : [];
    const sideBSnaps = sideRailSnappingEnabled
      ? findSideSnap(
          "sideB",
          { x: baseB.x, y: baseB.y },
          freeCapB2D,
          freeCapA2D,
          freeCapScrB,
        )
      : [];

    // Candidate pools: keep the nearest valid rails visible to the preview.
    // Hard attached rails remain in their separate pools for lock selection;
    // soft combinations must follow the pointer rather than brush order.
    const sortPreviewCandidates = (candidates) =>
      dedupeFirst(candidates)
        .sort(
          (a, b) =>
            a.distancePx - b.distancePx ||
            a.canonicalKey.localeCompare(b.canonicalKey),
        )
        .slice(0, 6);
    const sideAPool = sortPreviewCandidates([
      ...attachedACandidates,
      ...sideASnaps,
    ]);
    const sideBPool = sortPreviewCandidates([
      ...attachedBCandidates,
      ...sideBSnaps,
    ]);
    const singleRailAllowed = (candidate) =>
      candidate?.source !== "attached" || candidate.singleSideForwardFacing;
    // Weak near-parallel rail suppression
    const pointerRetreating = this.drag
      ? rawDistance < (this.drag.maxRawDistance || 0) - 1 / this.scale
      : false;
    const releasedRail = this.drag?.weakRailRelease;
    if (releasedRail && rawDistance > releasedRail.rawDistance + 1 / this.scale)
      this.drag.weakRailRelease = null;
    const weakRailReleaseActive = Boolean(
      this.drag?.weakRailRelease &&
      pointerRetreating &&
      rawDistance <= this.drag.weakRailRelease.rawDistance + 1 / this.scale,
    );
    const suppressWeakPoolEntries = (pool, freeCap2D) => {
      for (const candidate of pool) {
        if (candidate.source !== "magnetic") continue;
        if (candidate.weakRailSuppressed) continue;
        const check = isWeakNearParallelRail(
          candidate,
          freeCap2D,
          sourceBaseDir,
          this.scale,
        );
        if (check.weak && pointerRetreating) {
          candidate.weakRailSuppressed = true;
          candidate.releaseReason =
            check.releaseReason || "near-parallel-pointer-away";
        }
      }
      return pool.filter((c) => !c.weakRailSuppressed);
    };
    const sideAFiltered = suppressWeakPoolEntries(sideAPool, freeCapA2D);
    const sideBFiltered = suppressWeakPoolEntries(sideBPool, freeCapB2D);
    if (sideAPool.length !== sideAFiltered.length) {
      for (const c of sideAPool) {
        if (c.weakRailSuppressed)
          rejectedRailCandidates.push({
            ...c,
            rejectionReason: c.releaseReason || "near-parallel-pointer-away",
          });
      }
      sideAPool.splice(0, sideAPool.length, ...sideAFiltered);
    }
    if (sideBPool.length !== sideBFiltered.length) {
      for (const c of sideBPool) {
        if (c.weakRailSuppressed)
          rejectedRailCandidates.push({
            ...c,
            rejectionReason: c.releaseReason || "near-parallel-pointer-away",
          });
      }
      sideBPool.splice(0, sideBPool.length, ...sideBFiltered);
    }
    this.extrusionAcquisitionDebug = {
      cap: capSnaps,
      sideA: sideAPool,
      sideB: sideBPool,
      rejected: rejectedRailCandidates,
      pointerRetreating,
      maxRawDistance: this.drag?.maxRawDistance,
    };
    this.extrusionMatchDebug = [...sideAPool, ...sideBPool];
    const bestCap = capSnaps[0] || null;
    const allActiveAxes = this.axes();
    const freeSideAngleDegrees =
      this.state.faceExtrusionMode === "snap" ? 0 : undefined;
    const makeCapConstraint = (snap) => ({
      movingEdge: "cap",
      direction: snap.direction,
      origin: snap.cornerSnap,
      targetBrushId: snap.targetBrushId,
      targetFaceIndex: snap.targetFaceIndex,
      targetStart: {
        x: snap.targetStartWorld[axisX],
        y: snap.targetStartWorld[axisY],
      },
      targetEnd: {
        x: snap.targetEndWorld[axisX],
        y: snap.targetEndWorld[axisY],
      },
      targetStartWorld: snap.targetStartWorld,
      targetEndWorld: snap.targetEndWorld,
      source: snap.source,
      cornerSnap: snap.cornerSnap,
    });
    const makeSideConstraint = (snap) => ({
      movingEdge: snap.movingEdge,
      direction: snap.endpointSnapReleased ? extNormal : snap.railDirection,
      canonicalKey: snap.canonicalKey,
      lineOrigin: snap.lineOrigin,
      origin: {
        x: snap.movingEdge === "sideA" ? baseA.x : baseB.x,
        y: snap.movingEdge === "sideA" ? baseA.y : baseB.y,
      },
      targetBrushId: snap.targetBrushId,
      targetFaceIndex: snap.targetFaceIndex,
      targetStartWorld: snap.targetStartWorld,
      targetEndWorld: snap.targetEndWorld,
      source: snap.endpointSnapReleased ? "released" : snap.source,
      baseContactDistance: snap.baseContactDistance,
      attachmentPoint: snap.attachmentPoint,
      rawSegmentT: snap.rawSegmentT,
      availableForwardSegmentLength: snap.availableForwardSegmentLength,
      capProjectedT: snap.capProjectedT,
      cornerSnap: snap.endpointSnapReleased ? undefined : snap.cornerSnap,
      endpointSnapActive: Boolean(snap.endpointSnapActive),
      endpointSnapReleased: Boolean(snap.endpointSnapReleased),
    });
    const solvedEdgesMatchTargets = (solved, constraints) =>
      constraints.every((constraint) => {
        if (constraint.movingEdge === "cap") return true;
        if (constraint.endpointSnapReleased) return true;
        const edge = solved.solvedEdges?.[constraint.movingEdge];
        if (!edge || !constraint.targetStartWorld || !constraint.targetEndWorld)
          return false;
        const targetStart = {
          x: constraint.targetStartWorld[axisX],
          y: constraint.targetStartWorld[axisY],
        };
        const targetEnd = {
          x: constraint.targetEndWorld[axisX],
          y: constraint.targetEndWorld[axisY],
        };
        const constrainedEdge =
          constraint.source === "magnetic"
            ? [
                constraint.movingEdge === "sideA" ? edge[1] : edge[0],
                constraint.movingEdge === "sideA" ? edge[1] : edge[0],
              ]
            : edge;
        if (
          !solvedEdgeMatchesRail(
            constrainedEdge,
            targetStart,
            targetEnd,
            SIDE_BASE_TOLERANCE + 0.01,
          )
        )
          return false;
        if (constraint.source !== "attached" || constraint.endpointSnapReleased)
          return true;
        const capPoint = constraint.movingEdge === "sideA" ? edge[1] : edge[0];
        const capProjection = projectPointToSegment(
          capPoint,
          targetStart,
          targetEnd,
        );
        const endpointTolerance = 0.01;
        if (
          capProjection.rawT < -endpointTolerance ||
          capProjection.rawT > 1 + endpointTolerance
        ) {
          constraint.capProjectedT = capProjection.rawT;
          constraint.rejectionReason =
            capProjection.rawT < 0 ? "cap-before-start" : "cap-past-end";
          rejectedRailCandidates.push({
            ...constraint,
            rejectionReason: constraint.rejectionReason,
          });
          return false;
        }
        constraint.capProjectedT = capProjection.rawT;
        return true;
      });

    // Starting rail state upgrades monotonically from no rail, to one hard
    // rail, to a paired hard lock. Probe the distance the pointer actually
    // moved; a grid-sized probe makes short drags appear blocked until they
    // happen to reach the probe length.
    const screenDist = Math.hypot(current.x - start.x, current.y - start.y);
    const probeDistance = Math.max(rawDistance, 0.0001);
    if (this.drag) {
      this.drag.startRailState ||= "pending";
      if (this.drag.startRailState === "pending") {
        if (
          !weakRailReleaseActive &&
          screenDist > 3 &&
          (hardAPool.length || hardBPool.length)
        ) {
          let bestPair = null;
          let bestPairScore = Infinity;
          let bestSingle = null;
          let bestSingleScore = Infinity;
          const evalSet = [
            ...hardAPool
              .filter(singleRailAllowed)
              .flatMap((sA) =>
                hardBPool
                  .filter(singleRailAllowed)
                  .map((sB) => ({ sideA: sA, sideB: sB })),
              ),
            ...hardAPool
              .filter(singleRailAllowed)
              .map((sideA) => ({ sideA, sideB: null })),
            ...hardBPool
              .filter(singleRailAllowed)
              .map((sideB) => ({ sideA: null, sideB })),
          ];
          for (const pair of evalSet) {
            const cands = [];
            if (pair.sideA) cands.push(makeSideConstraint(pair.sideA));
            if (pair.sideB) cands.push(makeSideConstraint(pair.sideB));
            const sol = solveSingleFaceExtrusion({
              brush,
              faceIndex,
              distance: probeDistance,
              activeAxes: allActiveAxes,
              constraints: cands,
              followAdjacentSides: this.state.faceExtrusionMode === "snap",
              mirrorSingleSide:
                this.state.faceExtrusionMode === "snap" && cands.length > 1,
              maxSourceAngleDegrees: this.state.faceSourceMaxAngle,
              maxFreeSideAngleDegrees: freeSideAngleDegrees,
            });
            if (!sol?.cap || !solvedEdgesMatchTargets(sol, cands)) continue;
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
            const resolved = resolveExtrusion({
              sourceBrushes: this.state.brushes,
              selection,
              rawDistance: probeDistance,
              grid: this.state.grid,
              guideSelection: this.drag?.guideSelection || selection,
              mode: this.state.faceExtrusionMode,
              snapTarget,
              maxSourceAngleDegrees: this.state.faceSourceMaxAngle,
              maxFreeSideAngleDegrees: freeSideAngleDegrees,
            });
            if (
              resolved.blocked ||
              !passesProbeValidation(resolved.finalDistance, probeDistance)
            )
              continue;
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
            if (pair.sideA && pair.sideB) {
              if (score < bestPairScore) {
                bestPairScore = score;
                bestPair = pair;
              }
            } else if (score < bestSingleScore) {
              bestSingleScore = score;
              bestSingle = pair;
            }
          }
          const selected = bestPair || bestSingle;
          if (selected) {
            this.drag.startRailPair = selected;
            this.drag.startRailState = bestPair
              ? "paired"
              : selected.sideA
                ? "single-sideA"
                : "single-sideB";
            this.drag.geometryBlocked = false;
            this.drag.geometryBlockedReason = null;
          } else {
            this.drag.geometryBlocked = true;
            this.drag.geometryBlockedReason =
              hardAPool.length && hardBPool.length
                ? "invalid-pair"
                : "no valid hard rail at probe distance";
            rejectedRailCandidates.push({
              movingEdge: "sideA+sideB",
              source: "attached",
              rejectionReason:
                hardAPool.length && hardBPool.length
                  ? "invalid-pair"
                  : "no-valid-hard-rail",
              candidateKeys: [
                ...hardAPool.map((candidate) => candidate.canonicalKey),
                ...hardBPool.map((candidate) => candidate.canonicalKey),
              ],
            });
          }
          // Stay pending when no usable hard rail exists. The lock state only
          // advances; it never needs a terminal "none" state.
        }
      }
    }
    const hardPair = this.drag?.startRailPair || null;
    const refreshLockedRail = (rail, pool, movingEdge) => {
      if (!rail) return rail;
      if (
        !rail.endpointSnapActive &&
        this.drag &&
        (this.drag.startRailState === "single-sideA" ||
          this.drag.startRailState === "single-sideB")
      ) {
        const freeCap2D = movingEdge === "sideA" ? freeCapA2D : freeCapB2D;
        const railDir = rail.railDirection || extNormal;
        const origin = rail.lineOrigin || freeCap2D;
        const influence = computeRailInfluencePx(
          freeCap2D,
          sourceBaseDir,
          origin,
          railDir,
          this.scale,
        );
        if (
          influence < INFLUENCE_RELEASE_PX &&
          (rail.nearestEndpointDistancePx == null ||
            rail.nearestEndpointDistancePx > RELEASE_RADIUS) &&
          rawDistance < (this.drag.maxRawDistance || 0) - 1 / this.scale
        ) {
          rail.weakRailSuppressed = true;
          rail.releaseReason = "near-parallel-pointer-away";
          this.drag.startRailState = "pending";
          this.drag.startRailPair = null;
          this.drag.weakRailRelease = {
            movingEdge,
            canonicalKey: rail.canonicalKey,
            rawDistance,
          };
          releasedWeakRailThisFrame = true;
          if (this.drag.sideRailLocks)
            delete this.drag.sideRailLocks[movingEdge];
          if (this.drag.sideRailEndpointLocks)
            delete this.drag.sideRailEndpointLocks[movingEdge];
          if (this.drag.sideRailEndpointDistances)
            delete this.drag.sideRailEndpointDistances[movingEdge];
          rejectedRailCandidates.push({
            movingEdge,
            targetBrushId: rail.targetBrushId,
            targetFaceIndex: rail.targetFaceIndex,
            canonicalKey: rail.canonicalKey,
            source: rail.source,
            weakRailSuppressed: true,
            releaseReason: "near-parallel-pointer-away",
            rejectionReason: "near-parallel-pointer-away",
            railInfluencePx: influence,
          });
          return null;
        }
      }
      const current = pool.find(
        (candidate) => candidate.canonicalKey === rail.canonicalKey,
      );
      if (this.drag?.endpointPairRetreat && current) return current;
      const endpointLockDistance =
        this.drag?.sideRailEndpointDistances?.[movingEdge];
      if (
        (rail.endpointSnapActive || this.drag?.endpointPairRetreat) &&
        Number.isFinite(endpointLockDistance) &&
        rawDistance <
          endpointLockDistance - RELEASE_RADIUS / Math.max(this.scale, 0.0001)
      )
        return {
          ...rail,
          cornerSnap: undefined,
          endpointSnapActive: false,
          endpointSnapReleased: true,
        };
      if (!current) return rail;
      if (current.endpointSnapReleased) return current;
      if (rail.endpointSnapActive) return rail;
      return current;
    };
    let releasedWeakRailThisFrame = false;
    if (hardPair && this.drag) {
      const refreshedPair = {
        sideA: refreshLockedRail(hardPair.sideA, sideAPool, "sideA"),
        sideB: refreshLockedRail(hardPair.sideB, sideBPool, "sideB"),
      };
      if (
        !releasedWeakRailThisFrame &&
        (refreshedPair.sideA !== hardPair.sideA ||
          refreshedPair.sideB !== hardPair.sideB)
      )
        this.drag.startRailPair = refreshedPair;
    }
    const activeHardPair = releasedWeakRailThisFrame
      ? null
      : this.drag?.startRailPair || hardPair;
    let hardSideA = activeHardPair?.sideA || null;
    let hardSideB = activeHardPair?.sideB || null;

    const recordDuplicateProjectedRails = (candidates) => {
      const firstByRail = new Map();
      for (const candidate of candidates) {
        if (!candidate.projectedRailKey) continue;
        const first = firstByRail.get(candidate.projectedRailKey);
        if (first && first.canonicalKey !== candidate.canonicalKey)
          rejectedRailCandidates.push({
            ...candidate,
            rejectionReason: "duplicate-projected-rail",
          });
        else firstByRail.set(candidate.projectedRailKey, candidate);
      }
    };
    recordDuplicateProjectedRails(attachedACandidates);
    recordDuplicateProjectedRails(attachedBCandidates);
    this.extrusionAcquisitionDebug.rawDistance = rawDistance;
    this.extrusionAcquisitionDebug.probeDistance = probeDistance;
    this.extrusionAcquisitionDebug.pointerTangentOffset = pointerTangentOffset;
    this.extrusionAcquisitionDebug.lockState =
      this.drag?.startRailState || "pending";

    // Try constraint combinations in priority order (most→least constrained).
    const tryConstraints = (candidates) => {
      const sideConstraints = candidates.filter(
        (candidate) => candidate.movingEdge !== "cap",
      );
      if (
        sideConstraints.length === 2 &&
        sideConstraints[0].canonicalKey === sideConstraints[1].canonicalKey
      )
        return null;
      let sol = solveSingleFaceExtrusion({
        brush,
        faceIndex,
        distance: rawDistance,
        activeAxes: allActiveAxes,
        constraints: candidates,
        followAdjacentSides: this.state.faceExtrusionMode === "snap",
        mirrorSingleSide:
          this.state.faceExtrusionMode === "snap" && sideConstraints.length > 1,
        maxSourceAngleDegrees: this.state.faceSourceMaxAngle,
        maxFreeSideAngleDegrees: freeSideAngleDegrees,
      });
      if (sol?.cap) {
        let endpointUpgraded = false;
        for (const candidate of sideConstraints) {
          if (
            candidate.endpointSnapReleased ||
            !candidate.targetStartWorld ||
            !candidate.targetEndWorld
          )
            continue;
          const edge = sol.solvedEdges?.[candidate.movingEdge];
          if (!edge) continue;
          const capPoint = candidate.movingEdge === "sideA" ? edge[1] : edge[0];
          const targetStart = {
            x: candidate.targetStartWorld[axisX],
            y: candidate.targetStartWorld[axisY],
          };
          const targetEnd = {
            x: candidate.targetEndWorld[axisX],
            y: candidate.targetEndWorld[axisY],
          };
          const projection = projectPointToSegment(
            capPoint,
            targetStart,
            targetEnd,
          );
          const endpointT = projection.t <= 0.5 ? 0 : 1;
          const endpoint = endpointT === 0 ? targetStart : targetEnd;
          const endpointDistancePx =
            Math.hypot(capPoint.x - endpoint.x, capPoint.y - endpoint.y) *
            this.scale;
          const attachedAtOppositeEndpoint =
            candidate.source !== "attached" ||
            Math.abs(endpointT - (candidate.rawSegmentT || 0)) > 0.5;
          if (
            endpointDistancePx <= RELEASE_RADIUS &&
            attachedAtOppositeEndpoint
          ) {
            candidate.cornerSnap = endpoint;
            candidate.capProjectedT = endpointT;
            candidate.endpointSnapActive = true;
            endpointUpgraded = true;
          }
        }
        if (endpointUpgraded)
          sol = solveSingleFaceExtrusion({
            brush,
            faceIndex,
            distance: rawDistance,
            activeAxes: allActiveAxes,
            constraints: candidates,
            followAdjacentSides: this.state.faceExtrusionMode === "snap",
            mirrorSingleSide:
              this.state.faceExtrusionMode === "snap" &&
              sideConstraints.length > 1,
            maxSourceAngleDegrees: this.state.faceSourceMaxAngle,
            maxFreeSideAngleDegrees: freeSideAngleDegrees,
          });
      }
      if (!sol?.cap || !solvedEdgesMatchTargets(sol, candidates)) return null;
      for (const candidate of candidates) {
        const solvedEdge = sol.solvedEdges[candidate.movingEdge];
        if (
          !solvedEdge ||
          !candidate.targetStartWorld ||
          !candidate.targetEndWorld
        )
          continue;
        const targetStart = {
          x: candidate.targetStartWorld[axisX],
          y: candidate.targetStartWorld[axisY],
        };
        const targetEnd = {
          x: candidate.targetEndWorld[axisX],
          y: candidate.targetEndWorld[axisY],
        };
        candidate.solvedEdgeToRailDistance = Math.max(
          ...solvedEdge.map((point) =>
            distancePointToLine(point, targetStart, targetEnd),
          ),
        );
      }
      const selection = this.drag?.selection || new Set([id]);
      const snapTarget = {
        type: "cross-section-rails",
        activeAxes: allActiveAxes,
        conforming: candidates,
        finalCorners: {
          baseA: sol.baseA,
          baseB: sol.baseB,
          capA: sol.capA,
          capB: sol.capB,
        },
        targetBrushIds: [...new Set(candidates.map((c) => c.targetBrushId))],
        distance: rawDistance,
      };
      const resolved = resolveExtrusion({
        sourceBrushes: this.state.brushes,
        selection,
        rawDistance,
        grid: this.state.grid,
        guideSelection: this.drag?.guideSelection || selection,
        mode: this.state.faceExtrusionMode,
        snapTarget,
        maxSourceAngleDegrees: this.state.faceSourceMaxAngle,
      });
      if (resolved.blocked && !resolved.previewBrushes.length) return null;
      let widthInfluencePx = null;
      if (sideConstraints.length === 2 && sol) {
        const parallelWidth = Math.hypot(
          freeCapB2D.x - freeCapA2D.x,
          freeCapB2D.y - freeCapA2D.y,
        );
        const solvedWidth = Math.hypot(
          sol.capB.x - sol.capA.x,
          sol.capB.y - sol.capA.y,
        );
        widthInfluencePx = Math.abs(parallelWidth - solvedWidth) * this.scale;
      }
      let attractionScore = 0;
      for (const candidate of candidates) {
        if (candidate.movingEdge === "sideA") {
          const origin = candidate.lineOrigin || baseA;
          const end = {
            x: origin.x + candidate.direction.x,
            y: origin.y + candidate.direction.y,
          };
          attractionScore += distancePointToLine(freeCapA2D, origin, end);
        } else if (candidate.movingEdge === "sideB") {
          const origin = candidate.lineOrigin || baseB;
          const end = {
            x: origin.x + candidate.direction.x,
            y: origin.y + candidate.direction.y,
          };
          attractionScore += distancePointToLine(freeCapB2D, origin, end);
        }
      }
      return {
        finalCorners: resolved.finalCorners,
        solvedEdges: resolved.solvedEdges,
        safeDistance: resolved.finalDistance,
        attractionScore,
        widthInfluencePx,
        candidateKey:
          candidates
            .map(
              (candidate) =>
                candidate.canonicalKey || candidate.targetBrushId || "",
            )
            .join("|") || "",
        snapTarget,
        resolved,
        blocked: resolved.blocked,
      };
    };

    // A single hard rail may drive the preview while the opposite rail is
    // still outside magnetic range. Upgrade only when the exact pair solves
    // at the current pointer distance; never replace a paired lock with a
    // softer or unconstrained result.
    if (
      this.drag &&
      (this.drag.startRailState === "single-sideA" ||
        this.drag.startRailState === "single-sideB")
    ) {
      const fixed =
        this.drag.startRailState === "single-sideA" ? hardSideA : hardSideB;
      const oppositePool =
        this.drag.startRailState === "single-sideA" ? sideBPool : sideAPool;
      let upgrade = null;
      for (const candidate of oppositePool) {
        if (
          !candidate ||
          !singleRailAllowed(candidate) ||
          candidate.canonicalKey === fixed?.canonicalKey
        )
          continue;
        const fixedConstraint = makeSideConstraint(fixed);
        const oppositeConstraint = makeSideConstraint(candidate);
        const evaluated = tryConstraints([fixedConstraint, oppositeConstraint]);
        if (evaluated && !evaluated.blocked) {
          upgrade = { candidate, evaluated };
          break;
        }
      }
      if (upgrade) {
        const pair =
          this.drag.startRailState === "single-sideA"
            ? { sideA: fixed, sideB: upgrade.candidate }
            : { sideA: upgrade.candidate, sideB: fixed };
        this.drag.startRailPair = pair;
        this.drag.startRailState = "paired";
        hardSideA = pair.sideA;
        hardSideB = pair.sideB;
      }
    }
    this.extrusionAcquisitionDebug.lockState =
      this.drag?.startRailState || "pending";

    // Evaluate candidate combinations. Starting rails (hardSideA/B)
    // are mandatory for the entire drag and must appear in every
    // combination. Fallback cannot drop a hard rail.
    let result = null;
    const consider = (candidate) => {
      if (!candidate) return;
      if (!result) {
        result = candidate;
        return;
      }
      if (candidate.blocked !== result.blocked) {
        if (!candidate.blocked) result = candidate;
        return;
      }
      const safeA = candidate.safeDistance ?? 0;
      const safeB = result.safeDistance ?? 0;
      if (safeA !== safeB) {
        if (safeA > safeB) result = candidate;
        return;
      }
      const attrA = candidate.attractionScore ?? Infinity;
      const attrB = result.attractionScore ?? Infinity;
      if (attrA !== attrB) {
        if (attrA < attrB) result = candidate;
        return;
      }
      if ((candidate.candidateKey || "") < (result.candidateKey || ""))
        result = candidate;
    };
    const capCon = bestCap ? [makeCapConstraint(bestCap)] : [];

    if (releasedWeakRailThisFrame || weakRailReleaseActive) {
      consider(tryConstraints([]));
    } else if (hardSideA && hardSideB) {
      // Both hard rails exist: must include both.
      const cA = makeSideConstraint(hardSideA);
      const cB = makeSideConstraint(hardSideB);
      if (capCon.length) consider(tryConstraints([...capCon, cA, cB]));
      consider(tryConstraints([cA, cB]));
    } else if (hardSideA) {
      // Hard sideA exists: must include it. Try with each soft sideB.
      const cA = makeSideConstraint(hardSideA);
      for (const sB of sideBPool) {
        const cB = makeSideConstraint(sB);
        if (capCon.length) consider(tryConstraints([...capCon, cA, cB]));
        consider(tryConstraints([cA, cB]));
      }
      if (!sideBPool.length && capCon.length)
        consider(tryConstraints([...capCon, cA]));
      consider(tryConstraints([cA]));
    } else if (hardSideB) {
      // Hard sideB exists: must include it. Try with each soft sideA.
      const cB = makeSideConstraint(hardSideB);
      for (const sA of sideAPool) {
        const cA = makeSideConstraint(sA);
        if (capCon.length) consider(tryConstraints([...capCon, cA, cB]));
        consider(tryConstraints([cA, cB]));
      }
      if (!sideAPool.length && capCon.length)
        consider(tryConstraints([...capCon, cB]));
      consider(tryConstraints([cB]));
    } else {
      // No hard rails: free cross-product fallback.
      if (sideAPool.length && sideBPool.length) {
        for (const sA of sideAPool) {
          for (const sB of sideBPool) {
            const cA = [makeSideConstraint(sA)];
            const cB = [makeSideConstraint(sB)];
            consider(tryConstraints([...capCon, ...cA, ...cB]));
            consider(tryConstraints([...cA, ...cB]));
          }
        }
      }
      if (!sideBPool.length && capCon.length) {
        for (const sA of sideAPool) {
          if (!singleRailAllowed(sA)) continue;
          consider(tryConstraints([...capCon, makeSideConstraint(sA)]));
        }
      }
      if (!sideAPool.length && capCon.length) {
        for (const sB of sideBPool) {
          if (!singleRailAllowed(sB)) continue;
          consider(tryConstraints([...capCon, makeSideConstraint(sB)]));
        }
      }
      if (!sideBPool.length) {
        for (const sA of sideAPool) {
          if (!singleRailAllowed(sA)) continue;
          consider(tryConstraints([makeSideConstraint(sA)]));
        }
      }
      if (!sideAPool.length) {
        for (const sB of sideBPool) {
          if (!singleRailAllowed(sB)) continue;
          consider(tryConstraints([makeSideConstraint(sB)]));
        }
      }
      // An attached rail may produce a valid preview before the opposite
      // magnetic rail enters range. Do not let a distant magnetic candidate
      // suppress this single-side fallback.
      for (const sA of attachedACandidates)
        if (singleRailAllowed(sA))
          consider(tryConstraints([makeSideConstraint(sA)]));
      for (const sB of attachedBCandidates)
        if (singleRailAllowed(sB))
          consider(tryConstraints([makeSideConstraint(sB)]));
      if (capCon.length) consider(tryConstraints(capCon));
    }

    // Keep the rail lock through a temporary invalid distance. Only this
    // pointer frame is blocked, so moving back to valid geometry recovers.
    if (this.drag) {
      if (!result && hardSideA && hardSideB)
        rejectedRailCandidates.push({
          movingEdge: "sideA+sideB",
          source: "attached",
          rejectionReason: "invalid-pair",
          candidateKeys: [hardSideA.canonicalKey, hardSideB.canonicalKey],
        });
      this.drag.geometryBlocked =
        Boolean(result?.resolved.blocked) ||
        (!result && Boolean(hardSideA || hardSideB));
      this.drag.geometryBlockedReason = this.drag.geometryBlocked
        ? result?.resolved.blockedReason ||
          "locked support rails have no valid solution at this distance"
        : null;
    }

    this.extrusionCandidate = result
      ? {
          candidateType: "conforming",
          distance: result.safeDistance,
          matchCount: result.snapTarget.conforming.length,
          snapTarget: result.snapTarget,
          solvedEdges: result.solvedEdges,
          resolved: result.resolved,
        }
      : null;
    if (this.drag && result?.snapTarget?.conforming) {
      this.drag.sideRailLocks = Object.fromEntries(
        result.snapTarget.conforming
          .filter((constraint) => constraint.movingEdge !== "cap")
          .map((constraint) => [constraint.movingEdge, constraint.canonicalKey])
          .filter((entry) => entry[1]),
      );
      const endpointLocks = {
        ...(this.drag.sideRailEndpointLocks || {}),
      };
      const endpointDistances = {
        ...(this.drag.sideRailEndpointDistances || {}),
      };
      for (const constraint of result.snapTarget.conforming) {
        if (constraint.movingEdge === "cap") continue;
        if (
          (constraint.source === "magnetic" ||
            constraint.source === "attached") &&
          constraint.endpointSnapActive &&
          !constraint.endpointSnapReleased
        ) {
          if (
            endpointLocks[constraint.movingEdge] !== constraint.canonicalKey
          ) {
            endpointLocks[constraint.movingEdge] = constraint.canonicalKey;
            endpointDistances[constraint.movingEdge] = rawDistance;
          }
        } else if (constraint.endpointSnapReleased) {
          delete endpointLocks[constraint.movingEdge];
          delete endpointDistances[constraint.movingEdge];
        }
      }
      this.drag.sideRailEndpointLocks = endpointLocks;
      this.drag.sideRailEndpointDistances = endpointDistances;
    }
    if (this.drag) this.drag.extrusionCandidate = this.extrusionCandidate;
    if (result?.solvedEdges) {
      this.extrusionSolvedDebug = this.toScreenEdges(result.solvedEdges);
    } else {
      this.extrusionSolvedDebug = null;
    }

    return rawDistance;
  }

  VP.prototype.edgeViewForFace = function(id) {
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

}
