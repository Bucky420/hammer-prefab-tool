import { generateArch } from "./arch-generator.js";
import { box } from "./geometry-model.js";
import { roundToGrid } from "./grid.js";
import {
  generateCylinder,
  generateSphere,
  generateTorus,
} from "./primitive-generator.js";

const AXIS_NAMES = ["x", "y", "z"];

export function buildStagedBrushes({
  bounds,
  shape,
  settings,
  grid,
  selectedVertices = [],
  brushDepth = 64,
}) {
  const [horizontal, vertical, depth] = bounds.axes,
    min = { x: 0, y: 0, z: 0 },
    max = { x: 0, y: 0, z: 0 };
  min[horizontal] = Math.min(bounds.start[horizontal], bounds.end[horizontal]);
  max[horizontal] = Math.max(bounds.start[horizontal], bounds.end[horizontal]);
  min[vertical] = Math.min(bounds.start[vertical], bounds.end[vertical]);
  max[vertical] = Math.max(bounds.start[vertical], bounds.end[vertical]);
  if (selectedVertices.length) {
    min[depth] = Math.min(...selectedVertices.map((vertex) => vertex[depth]));
    max[depth] = Math.max(...selectedVertices.map((vertex) => vertex[depth]));
  } else {
    const depthSize =
      depth === "x"
        ? settings.width
        : depth === "y"
          ? brushDepth
          : settings.height;
    min[depth] = depth === "z" ? settings.addHeight : -depthSize / 2;
    max[depth] =
      depth === "z" ? settings.addHeight + depthSize : depthSize / 2;
  }
  for (const axis of AXIS_NAMES) {
    min[axis] = roundToGrid(min[axis], grid);
    max[axis] = roundToGrid(max[axis], grid);
  }
  if (AXIS_NAMES.some((axis) => min[axis] === max[axis]))
    return { brushes: [], error: "Brush creation collapsed on the current grid" };

  const width = max[horizontal] - min[horizontal],
    height = max[vertical] - min[vertical],
    depthSize = max[depth] - min[depth],
    center = {
      [horizontal]: (min[horizontal] + max[horizontal]) / 2,
      [vertical]: (min[vertical] + max[vertical]) / 2,
      [depth]: (min[depth] + max[depth]) / 2,
    },
    axisOrder = [horizontal, vertical, depth].map((axis) =>
      AXIS_NAMES.indexOf(axis),
    ),
    reversesWinding =
      ((axisOrder[0] > axisOrder[1] ? 1 : 0) +
        (axisOrder[0] > axisOrder[2] ? 1 : 0) +
        (axisOrder[1] > axisOrder[2] ? 1 : 0)) %
        2 ===
      1,
    placeVector = (vector) => {
      const placed = [0, 0, 0];
      placed[AXIS_NAMES.indexOf(horizontal)] = vector[0];
      placed[AXIS_NAMES.indexOf(vertical)] = vector[1];
      placed[AXIS_NAMES.indexOf(depth)] = vector[2];
      return placed;
    },
    placeLocalBrushes = (brushes, centerDepth = min[depth]) => {
      brushes.forEach((brush) => {
        brush.vertices.forEach((vertex) => {
          const local = { x: vertex.x, y: vertex.y, z: vertex.z };
          vertex[horizontal] = local.x + center[horizontal];
          vertex[vertical] = local.y + center[vertical];
          vertex[depth] = local.z + centerDepth;
        });
        if (reversesWinding)
          brush.faces = brush.faces.map((face) => [...face].reverse());
        if (brush.textureAxes)
          brush.textureAxes = brush.textureAxes.map((axes) => ({
            ...axes,
            u: placeVector(axes.u),
            v: placeVector(axes.v),
          }));
      });
      return brushes;
    };

  if (shape === "block") return { brushes: [box(min, max)] };
  if (shape === "arch") {
    const brushes = placeLocalBrushes(
      generateArch({
        width,
        height,
        depth: depthSize,
        wallWidth: settings.width,
        sides: settings.segments,
        startAngle: settings.startAngle,
        arc: settings.arc,
        addHeight: settings.addHeight,
        grid,
      }),
    );
    brushes.forEach((brush) => {
      brush.generator.extrusionCenter = { ...center, [depth]: min[depth] };
      brush.generator.extrusionAxes = [horizontal, vertical];
    });
    return { brushes };
  }

  const footprintRadius = roundToGrid(Math.min(width, height) / 2, grid);
  if (footprintRadius < grid)
    return { brushes: [], error: "Brush footprint collapsed on the current grid" };
  if (shape === "cylinder")
    return {
      brushes: placeLocalBrushes(
        generateCylinder({
          radius: footprintRadius,
          radiusX: width / 2,
          radiusY: height / 2,
          height: depthSize,
          segments: settings.segments,
          grid,
        }),
      ),
    };
  if (shape === "sphere")
    return {
      brushes: placeLocalBrushes(
        generateSphere({
          radius: footprintRadius,
          segments: settings.segments,
          rings: settings.rings,
          grid,
        }),
        center[depth],
      ),
    };
  if (shape === "torus") {
    const tubeWidth = Math.min(settings.width, footprintRadius - grid),
      radius = footprintRadius - tubeWidth / 2;
    if (tubeWidth < grid)
      return { brushes: [], error: "Torus footprint is too small for its width" };
    return {
      brushes: placeLocalBrushes(
        generateTorus({
          radius,
          width: tubeWidth,
          height: depthSize,
          segments: settings.segments,
          grid,
        }),
      ),
    };
  }
  return { brushes: [], error: `Unsupported brush shape: ${shape}` };
}

export function stagedBrushHandles(bounds, settings, grid) {
  if (!bounds) return [];
  const { axes, start, end } = bounds,
    [horizontal, vertical] = axes,
    center = { x: 0, y: 0, z: 0 };
  for (const axis of AXIS_NAMES)
    center[axis] = ((start[axis] || 0) + (end[axis] || 0)) / 2;
  const radiusX = Math.abs(end[horizontal] - start[horizontal]) / 2,
    radiusY = Math.abs(end[vertical] - start[vertical]) / 2,
    shape = settings.shape || "block",
    handles = [{ type: "move", point: center, label: "Move" }];
  if (shape === "block") return handles;
  handles.push({
    type: "shape-size",
    point: { ...center, [vertical]: center[vertical] + radiusY },
    label: "Size",
  });
  if (shape === "arch" || shape === "torus") {
    const thickness = Math.max(grid, Number(settings.width) || grid);
    handles.push({
      type: "shape-thickness",
      point: {
        ...center,
        [horizontal]: center[horizontal] + Math.max(0, radiusX - thickness),
      },
      label: "Thickness",
    });
  }
  if (shape === "arch") {
    const angle =
      ((Number(settings.startAngle) || 0) + (Number(settings.arc) || 180)) *
      (Math.PI / 180);
    handles.push({
      type: "shape-arc",
      point: {
        ...center,
        [horizontal]: center[horizontal] + Math.cos(angle) * radiusX,
        [vertical]: center[vertical] + Math.sin(angle) * radiusY,
      },
      label: "Arc",
    });
  }
  return handles.map((handle) => ({
    ...handle,
    axes,
    start: { ...start },
    end: { ...end },
  }));
}

export function applyStagedBrushHandle({
  bounds,
  settings,
  handle,
  current,
  grid,
}) {
  const nextBounds = {
      ...bounds,
      start: { ...bounds.start },
      end: { ...bounds.end },
    },
    nextSettings = { ...settings },
    [horizontal, vertical] = bounds.axes,
    center = {
      [horizontal]: (handle.start[horizontal] + handle.end[horizontal]) / 2,
      [vertical]: (handle.start[vertical] + handle.end[vertical]) / 2,
    };
  if (handle.type === "shape-size") {
    const radius = Math.max(
      grid,
      roundToGrid(
        Math.hypot(
          current[horizontal] - center[horizontal],
          current[vertical] - center[vertical],
        ),
        grid,
      ),
    );
    nextBounds.start[horizontal] = center[horizontal] - radius;
    nextBounds.end[horizontal] = center[horizontal] + radius;
    nextBounds.start[vertical] = center[vertical] - radius;
    nextBounds.end[vertical] = center[vertical] + radius;
  } else if (handle.type === "shape-thickness") {
    const outerRadius =
        Math.abs(handle.end[horizontal] - handle.start[horizontal]) / 2,
      innerRadius = Math.abs(current[horizontal] - center[horizontal]);
    nextSettings.width = Math.max(
      grid,
      Math.min(
        outerRadius - grid,
        roundToGrid(outerRadius - innerRadius, grid),
      ),
    );
  } else if (handle.type === "shape-arc") {
    const radiusX =
        Math.abs(handle.end[horizontal] - handle.start[horizontal]) / 2 || 1,
      radiusY =
        Math.abs(handle.end[vertical] - handle.start[vertical]) / 2 || 1,
      angle =
        (Math.atan2(
          (current[vertical] - center[vertical]) / radiusY,
          (current[horizontal] - center[horizontal]) / radiusX,
        ) *
          180) /
        Math.PI,
      startAngle = Number(settings.startAngle) || 0,
      arc = ((angle - startAngle) % 360 + 360) % 360;
    nextSettings.arc = Math.max(1, Math.round(arc || 360));
  }
  return { bounds: nextBounds, settings: nextSettings };
}
