import { distanceToSegment, pointInPolygon } from "./math.js";
import { connectedFaceIds, faceRole } from "./selection.js";
import { insideRect, segmentsIntersect } from "./viewport-constants.js";

/** @param {import("./viewport.js").Viewport} VP */
export function applyViewportFace(VP) {
  VP.prototype.faceNormal = function(brush, face) {
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

  VP.prototype.visibleFace = function(brush, face) {
    const depth = this.axes()[2],
      normal = this.faceNormal(brush, face),
      viewSign = this.kind === "side" ? -1 : 1;
    return normal[depth] * viewSign > 0.001;
  }

  VP.prototype.exposedEdges = function() {
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

  VP.prototype.faceLoopAt = function(x, y) {
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

  VP.prototype.radialFaceAt = function(x, y, operation = "replace") {
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

  VP.prototype.faceAt = function(x, y, operation = "replace") {
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

  VP.prototype.faceIntersectsBox = function(brush, face, box) {
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

  VP.prototype.faceInclination = function(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]),
      face = brush?.faces[Number(match?.[2])];
    if (!brush || !face) return null;
    const normal = this.faceNormal(brush, face),
      length = Math.hypot(normal.x, normal.y, normal.z);
    return length ? Math.acos(Math.min(1, Math.abs(normal.z) / length)) : null;
  }

  VP.prototype.faceGroup = function(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]);
    return brush ? brush.groupId || brush.id : null;
  }

  VP.prototype.faceSemanticRole = function(id) {
    const match = id.match(/^(.*):f:(\d+)$/),
      brush = match && this.state.brushes.find((item) => item.id === match[1]);
    return brush ? faceRole(brush, Number(match[2])) : null;
  }

  VP.prototype.compatibleFaceIds = function(ids, operation) {
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

  VP.prototype.faceTargets = function(id, operation = "replace") {
    return operation === "replace" && this.state.faceSelectionScope === "group"
      ? connectedFaceIds(this.state.brushes, id)
      : [id];
  }

  VP.prototype.adjacentFaceIds = function(id) {
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

}
