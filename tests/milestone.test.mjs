import assert from "node:assert/strict";
import { generateRing } from "../public/js/ring-generator.js";
import { generateArch } from "../public/js/arch-generator.js";
import { validateAll } from "../public/js/brush-validation.js";
import { roundToGrid } from "../public/js/grid.js";
import {
  applySelection,
  connectedFaceIds,
  faceRole,
  ringVertexIds,
  semanticFaceIds,
  selectByShape,
} from "../public/js/selection.js";
import { History } from "../public/js/history.js";
import {
  box,
  duplicateBrushes,
  moveBrushes,
  moveVertices,
} from "../public/js/geometry-model.js";
import { parseVMF } from "../public/js/vmf-parser.js";
import { writeVMF } from "../public/js/vmf-writer.js";
import {
  alignAllFacesToCenter,
  alignAllFacesToOuter,
} from "../public/js/texture-alignment.js";
import { applyNodrawToHiddenFaces } from "../public/js/nodraw.js";
import {
  extrudeSelectedFaces,
  limitExtrusionDistance,
  solveCapFromPlane,
} from "../public/js/face-extrusion.js";
import { fillSelectedLoop } from "../public/js/face-fill.js";
import {
  generateCylinder,
  generateSphere,
  generateTorus,
} from "../public/js/primitive-generator.js";
import { Viewport } from "../public/js/viewport.js";

const ring = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
for (const [name, brushes] of [
  [
    "cylinder",
    generateCylinder({ radius: 128, height: 128, segments: 16, grid: 16 }),
  ],
  ["sphere", generateSphere({ radius: 128, segments: 16, rings: 8, grid: 16 })],
  [
    "torus",
    generateTorus({
      radius: 256,
      width: 64,
      height: 64,
      segments: 16,
      grid: 16,
    }),
  ],
]) {
  assert.ok(brushes.length > 0, `${name} generator must create brushes`);
  assert.equal(
    validateAll(brushes).length,
    0,
    `${name} generator must create valid convex brushes`,
  );
}
assert.equal(
  validateAll(ring).length,
  0,
  "generated ring must contain valid convex solids",
);
const arch = generateArch({
  width: 538,
  height: 502,
  depth: 64,
  wallWidth: 166,
  sides: 32,
  arc: 360,
  grid: 16,
});
const archSideExtrusion = extrudeSelectedFaces(
  arch,
  new Set([`${arch[0].id}:f:2`]),
  64,
  16,
);
assert.equal(
  archSideExtrusion.errors.length,
  0,
  "Arch side extrusion must use the Arch bounding-box normal, not world-origin radial expansion",
);
const duplicateSource = [box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 })];
const collisionSource = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
const collisionObstacle = box({ x: 96, y: 0, z: 0 }, { x: 160, y: 64, z: 64 });
const safeDistance = limitExtrusionDistance(
  [collisionSource, collisionObstacle],
  new Set([`${collisionSource.id}:f:3`]),
  128,
  16,
);
assert.ok(
  safeDistance <= 32.001,
  "extrusion must stop at the first blocking brush instead of passing through it",
);
duplicateSource[0].groupId = "duplicate-source";
const duplicated = duplicateBrushes(
  duplicateSource,
  new Set([duplicateSource[0].id]),
);
assert.equal(
  duplicated.length,
  1,
  "Shift duplication must create one copy per selected brush",
);
assert.notEqual(
  duplicated[0].id,
  duplicateSource[0].id,
  "duplicated brushes require unique IDs",
);
assert.notEqual(
  duplicated[0].groupId,
  duplicateSource[0].groupId,
  "duplicated groups require a new shared group ID",
);
moveBrushes(
  duplicated,
  new Set([duplicated[0].id]),
  { x: 64, y: 0, z: 0 },
  16,
  false,
);
assert.equal(
  duplicateSource[0].vertices[0].x,
  0,
  "Shift-drag must leave the original brush in place",
);
assert.equal(
  duplicated[0].vertices[0].x,
  64,
  "Shift-drag duplicate must move independently",
);
const beveledArch = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  startAngle: 0,
  endAngle: 180,
  bevel: 16,
  grid: 16,
});
assert.equal(
  validateAll(beveledArch).length,
  0,
  "beveled arches must contain valid convex solids",
);
assert.ok(
  beveledArch.length > 8 && beveledArch.every((brush) => brush.generator.bevel),
  "beveled arches must decompose each segment into convex chamfer pieces",
);
const topExtrusionSource = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
const topExtrusion = extrudeSelectedFaces(
  topExtrusionSource,
  new Set([
    `${topExtrusionSource[0].id}:f:1`,
    `${topExtrusionSource[4].id}:f:1`,
  ]),
  32,
  16,
);
const unsnappedTopExtrusion = extrudeSelectedFaces(
  topExtrusionSource,
  new Set([`${topExtrusionSource[0].id}:f:1`]),
  13.5,
  16,
);
assert.equal(
  Math.max(
    ...unsnappedTopExtrusion.brushes[0].vertices.map((vertex) => vertex.z),
  ),
  141.5,
  "face extrusion must preserve fractional distances instead of snapping to grid",
);
assert.equal(
  topExtrusion.brushes.length,
  2,
  "disconnected top faces must extrude independently",
);
assert.equal(
  validateAll(topExtrusion.brushes).length,
  0,
  "top-face extrusions must remain valid convex solids",
);
assert.ok(
  topExtrusion.brushes.every(
    (brush) => Math.max(...brush.vertices.map((vertex) => vertex.z)) === 160,
  ),
  "top faces on opposite sides must extrude upward",
);
const radialSource = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
const radialExtrusion = extrudeSelectedFaces(
  radialSource,
  new Set([`${radialSource[0].id}:f:2`, `${radialSource[4].id}:f:2`]),
  32,
  16,
  new Set([`${radialSource[0].id}:f:2`, `${radialSource[4].id}:f:2`]),
  "normal",
);
assert.equal(
  validateAll(radialExtrusion.brushes).length,
  0,
  "opposite radial extrusions must remain valid convex solids",
);
assert.ok(
  radialExtrusion.brushes.every(
    (brush) =>
      Math.max(
        ...brush.vertices
          .slice(4)
          .map((vertex) => Math.hypot(vertex.x, vertex.y)),
      ) >
      Math.max(
        ...brush.vertices
          .slice(0, 4)
          .map((vertex) => Math.hypot(vertex.x, vertex.y)),
      ),
  ),
  "outer faces on opposite sides must both move away from the ring center",
);
assert.ok(
  radialSource[0].faceMaterials.includes("tools/toolsnodraw") &&
    radialSource[4].faceMaterials.includes("tools/toolsnodraw"),
  "source interfaces must receive nodraw after extrusion",
);
const fillSource = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
const fill = fillSelectedLoop(
  fillSource,
  new Set(fillSource.map((brush) => `${brush.id}:f:4`)),
);
assert.equal(
  fill.errors.length,
  0,
  "a closed inner wall loop must fill without errors",
);
assert.equal(
  validateAll(fill.brushes).length,
  0,
  "planar fill must decompose its hole into valid convex prisms",
);
assert.equal(
  fill.brushes.length,
  8,
  "a convex octagonal hole must fill as one symmetric center wedge per boundary edge",
);
assert.equal(
  fillSelectedLoop(fillSource, new Set([`${fillSource[0].id}:f:4`])).brushes
    .length,
  0,
  "an open boundary must never produce a partial fill",
);
const denseFillSource = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 32,
  grid: 16,
});
const denseFill = fillSelectedLoop(
  denseFillSource,
  new Set(denseFillSource.map((brush) => `${brush.id}:f:4`)),
);
assert.equal(
  denseFill.errors.length,
  0,
  "grid-snapped stepped loops must still fill with valid convex prisms",
);
assert.equal(
  denseFill.brushes.length,
  30,
  "a 32-sided stepped loop must decompose into n - 2 convex fill prisms",
);
const loopSource = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
loopSource.forEach((brush) => {
  brush.groupId = "loop-extrusion";
});
const loopExtrusion = extrudeSelectedFaces(
  loopSource,
  new Set(loopSource.map((brush) => `${brush.id}:f:2`)),
  32,
  16,
  new Set(loopSource.map((brush) => `${brush.id}:f:2`)),
  "normal",
);
assert.equal(
  loopExtrusion.errors.length,
  0,
  "connected side-loop extrusion must not reject valid ring faces",
);
assert.equal(
  validateAll(loopExtrusion.brushes).length,
  0,
  "per-face-normal side extrusion must produce valid convex brushes",
);
const halfArch = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 16,
  startAngle: 0,
  endAngle: 180,
  grid: 16,
});
const halfArchExtrusion = extrudeSelectedFaces(
  halfArch,
  new Set(halfArch.map((brush) => `${brush.id}:f:2`)),
  64,
  16,
  new Set(halfArch.map((brush) => `${brush.id}:f:2`)),
  "normal",
);
assert.equal(
  halfArchExtrusion.errors.length,
  0,
  "open half-arch side loops must allow snapped miter endpoints without false self-intersection rejection",
);
assert.equal(
  validateAll(halfArchExtrusion.brushes).length,
  0,
  "half-arch region extrusion must remain valid convex Source geometry",
);
const invertedLoopSource = generateRing({
    radius: 256,
    width: 64,
    height: 128,
    segments: 8,
    grid: 16,
  }),
  invertedLoop = extrudeSelectedFaces(
    invertedLoopSource,
    new Set(invertedLoopSource.map((brush) => `${brush.id}:f:4`)),
    320,
    16,
  );
assert.equal(
  invertedLoop.brushes.length,
  0,
  "collapsed or inverted offset loops must never be committable",
);
assert.ok(
  invertedLoop.previewBrushes.length > 0,
  "rejected extrusion must retain candidate geometry for the red preview",
);
assert.ok(
  invertedLoop.errors.some((error) =>
    /intersects|collapsed|inverted|non-convex|not parallel/.test(error),
  ),
  "invalid offset loops must report the region or convexity failure",
);
assert.ok(
  invertedLoopSource.every((brush) => !brush.faceMaterials),
  "rejected extrusion must not mutate source face materials",
);
assert.equal(
  validateAll(parseVMF(writeVMF(radialExtrusion.brushes))).length,
  0,
  "face extrusions must remain valid through VMF export and import",
);
assert.equal(
  validateAll(parseVMF(writeVMF(loopExtrusion.brushes))).length,
  0,
  "mitered loop extrusions must remain valid through VMF export and import",
);
for (const brush of ring) {
  const center = brush.faces[1].reduce(
      (sum, index) => ({
        x: sum.x + brush.vertices[index].x / brush.faces[1].length,
        y: sum.y + brush.vertices[index].y / brush.faces[1].length,
      }),
      { x: 0, y: 0 },
    ),
    v = brush.textureAxes[1].v;
  assert.ok(
    center.x * v[0] + center.y * v[1] < 0,
    "generated top-face V axes must point inward",
  );
}
const reversedRing = JSON.parse(JSON.stringify(ring));
reversedRing.forEach((brush) => {
  brush.faces = brush.faces.map((face) => [...face].reverse());
});
alignAllFacesToCenter(reversedRing);
for (const brush of reversedRing) {
  const center = brush.faces[1].reduce(
      (sum, index) => ({
        x: sum.x + brush.vertices[index].x / brush.faces[1].length,
        y: sum.y + brush.vertices[index].y / brush.faces[1].length,
      }),
      { x: 0, y: 0 },
    ),
    v = brush.textureAxes[1].v;
  assert.ok(
    center.x * v[0] + center.y * v[1] < 0,
    "center alignment must point top-face V inward regardless of face winding",
  );
}
alignAllFacesToOuter(reversedRing);
for (const brush of reversedRing) {
  const center = brush.faces[1].reduce(
      (sum, index) => ({
        x: sum.x + brush.vertices[index].x / brush.faces[1].length,
        y: sum.y + brush.vertices[index].y / brush.faces[1].length,
      }),
      { x: 0, y: 0 },
    ),
    v = brush.textureAxes[1].v;
  assert.ok(
    center.x * v[0] + center.y * v[1] > 0,
    "outer alignment must point top-face V outward regardless of face winding",
  );
}
assert.equal(
  roundToGrid(1.1, 0.125),
  1.125,
  "grid rounding must use the shared Hammer rule",
);
assert.equal(
  selectByShape(
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ],
    { x: 0, y: 0, r: 1 },
    "circle",
  ).length,
  1,
  "circle selection must use circular distance",
);
const inner = ringVertexIds(ring, "inner");
const outer = ringVertexIds(ring, "outer");
ring.forEach((brush) => {
  brush.groupId = "semantic-ring";
});
assert.equal(faceRole(ring[0], 0), "bottom");
assert.equal(faceRole(ring[0], 1), "top");
assert.equal(faceRole(ring[0], 2), "outer");
assert.equal(faceRole(ring[0], 4), "inner");
assert.equal(
  semanticFaceIds(ring, `${ring[0].id}:f:1`).length,
  8,
  "grouped top-face selection must cover the complete ring",
);
assert.equal(
  semanticFaceIds(ring, `${ring[0].id}:f:2`).length,
  8,
  "grouped outer-face selection must cover the complete ring",
);
assert.equal(
  semanticFaceIds(ring, `${ring[0].id}:f:4`).length,
  8,
  "grouped inner-face selection must cover the complete ring",
);
assert.equal(inner.length, 32);
assert.equal(outer.length, 32);
assert.equal(new Set(inner).size, inner.length);
assert.equal(applySelection(new Set(), inner.slice(0, 2), "replace").size, 2);
assert.equal(
  applySelection(new Set(inner), inner.slice(0, 2), "remove").size,
  30,
);
const faceSelectionViewport = Object.create(Viewport.prototype);
faceSelectionViewport.state = {
  brushes: ring,
  faceSelection: new Set([`${ring[0].id}:f:1`]),
};
assert.equal(
  faceSelectionViewport.compatibleFaceIds([`${ring[4].id}:f:1`], "add").length,
  1,
  "opposite horizontal ring faces must be compatible",
);
assert.equal(
  faceSelectionViewport.compatibleFaceIds([`${ring[0].id}:f:2`], "add").length,
  0,
  "vertical faces must not mix with horizontal face selections",
);
faceSelectionViewport.state.faceSelection = new Set([`${ring[0].id}:f:2`]);
assert.equal(
  faceSelectionViewport.compatibleFaceIds([`${ring[4].id}:f:2`], "add").length,
  1,
  "opposite vertical ring faces must be compatible despite opposite normals",
);
faceSelectionViewport.state.faceSelectionScope = "object";
assert.equal(
  faceSelectionViewport.faceTargets(`${ring[0].id}:f:2`, "replace").length,
  1,
  "single Face scope must target only the face under the cursor",
);
faceSelectionViewport.state.faceSelectionScope = "group";
assert.equal(
  faceSelectionViewport.faceTargets(`${ring[0].id}:f:2`, "replace").length,
  8,
  "grouped Face scope must target the complete semantic face group",
);
assert.deepEqual(
  faceSelectionViewport.compatibleFaceIds(
    [`${ring[0].id}:f:1`, `${ring[0].id}:f:0`, `${ring[0].id}:f:2`],
    "replace",
  ),
  [`${ring[0].id}:f:1`],
  "grouped Face scope must never mix top, bottom, inner, or outer roles",
);
assert.equal(
  faceSelectionViewport.faceTargets(`${ring[0].id}:f:2`, "toggle").length,
  1,
  "Ctrl face selection must target one face at a time",
);
faceSelectionViewport.state.faceSelectionScope = "object";
const otherRing = generateRing({
  radius: 512,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
otherRing.forEach((brush) => {
  brush.groupId = "other-ring";
});
faceSelectionViewport.state.brushes = [...ring, ...otherRing];
assert.equal(
  faceSelectionViewport.compatibleFaceIds([`${otherRing[0].id}:f:2`], "toggle")
    .length,
  1,
  "face multi-selection must allow compatible faces from another group",
);
faceSelectionViewport.state.brushes = ring;
faceSelectionViewport.state.faceSelection = new Set();
faceSelectionViewport.screen = (vertex) => ({ x: vertex.x, y: vertex.y });
faceSelectionViewport.kind = "top";
faceSelectionViewport.axes = () => ["x", "y", "z"];
const innerLoop = faceSelectionViewport.faceLoopAt(0, 0);
assert.ok(
  innerLoop,
  "Fill hover must detect the enclosed inner area from live brush boundaries",
);
assert.equal(
  innerLoop.faceIds.size,
  8,
  "Fill hover must select only the inner boundary faces, not the outer ring",
);
assert.ok(
  innerLoop.polygon.every((point) => Math.hypot(point.x, point.y) < 240),
  "Fill hover polygon must describe the inner opening",
);
const exposedRingEdges = faceSelectionViewport.exposedEdges();
assert.equal(
  exposedRingEdges.length,
  32,
  "face mode must exclude every face-to-face ring seam from its thick boundary overlay",
);
assert.ok(
  exposedRingEdges.every(
    (edge) => edge.roleFaceIds.has("inner") || edge.roleFaceIds.has("outer"),
  ),
  "a closed ring's exposed edges must belong only to its inner or outer boundaries",
);
const outerFace = ring[0].faces[2].map((index) => ring[0].vertices[index]);
const outerMidpoint = outerFace.reduce(
  (sum, vertex) => ({
    x: sum.x + vertex.x / outerFace.length,
    y: sum.y + vertex.y / outerFace.length,
  }),
  { x: 0, y: 0 },
);
const outerBoundaryHit = faceSelectionViewport.radialFaceAt(
  outerMidpoint.x,
  outerMidpoint.y,
);
assert.equal(
  faceRole(
    ring.find((brush) => outerBoundaryHit.id.startsWith(`${brush.id}:`)),
    Number(outerBoundaryHit.id.split(":f:")[1]),
  ),
  "outer",
  "outer boundary hover must resolve to the outer face instead of the top face",
);
const innerFace = ring[0].faces[4].map((index) => ring[0].vertices[index]);
const innerMidpoint = innerFace.reduce(
  (sum, vertex) => ({
    x: sum.x + vertex.x / innerFace.length,
    y: sum.y + vertex.y / innerFace.length,
  }),
  { x: 0, y: 0 },
);
const radialLength = Math.hypot(outerMidpoint.x, outerMidpoint.y),
  radialUnit = {
    x: outerMidpoint.x / radialLength,
    y: outerMidpoint.y / radialLength,
  };
const innerZoneHit = faceSelectionViewport.radialFaceAt(
  innerMidpoint.x + radialUnit.x * 10,
  innerMidpoint.y + radialUnit.y * 10,
);
assert.equal(
  faceRole(
    ring.find((brush) => innerZoneHit.id.startsWith(`${brush.id}:`)),
    Number(innerZoneHit.id.split(":f:")[1]),
  ),
  "inner",
  "the inner third of a ring band must resolve to its inner face group",
);
const bandCenterHit = faceSelectionViewport.radialFaceAt(
  (innerMidpoint.x + outerMidpoint.x) / 2,
  (innerMidpoint.y + outerMidpoint.y) / 2,
);
assert.equal(
  bandCenterHit,
  null,
  "the middle of a ring band must remain available for top-face selection",
);
const movedRing = structuredClone(ring);
movedRing.forEach((brush) =>
  brush.vertices.forEach((vertex) => {
    vertex.x += 640;
    vertex.y -= 320;
  }),
);
faceSelectionViewport.state.brushes = movedRing;
const movedOuter = movedRing[0].faces[2]
  .map((index) => movedRing[0].vertices[index])
  .reduce(
    (sum, vertex, _, points) => ({
      x: sum.x + vertex.x / points.length,
      y: sum.y + vertex.y / points.length,
    }),
    { x: 0, y: 0 },
  );
assert.ok(
  faceSelectionViewport.radialFaceAt(movedOuter.x, movedOuter.y),
  "boundary picking must use live translated geometry instead of the original generator center",
);
const importedLikeRing = structuredClone(ring);
importedLikeRing.forEach((brush) => {
  delete brush.generator;
  delete brush.vertexRoles;
});
faceSelectionViewport.state.brushes = importedLikeRing;
const importedInner = importedLikeRing[0].faces[4]
  .map((index) => importedLikeRing[0].vertices[index])
  .reduce(
    (sum, vertex, _, points) => ({
      x: sum.x + vertex.x / points.length,
      y: sum.y + vertex.y / points.length,
    }),
    { x: 0, y: 0 },
  );
const importedInnerHit = faceSelectionViewport.radialFaceAt(
  importedInner.x,
  importedInner.y,
);
assert.ok(
  importedInnerHit,
  "edge-on boundary picking must work without generator metadata or vertex roles",
);
assert.equal(
  connectedFaceIds(importedLikeRing, importedInnerHit.id).length,
  8,
  "topology grouping must follow one imported ring boundary loop without crossing to the other loop",
);
const importedLoopSelection = new Set(
    connectedFaceIds(importedLikeRing, importedInnerHit.id),
  ),
  importedLoopExtrusion = extrudeSelectedFaces(
    structuredClone(importedLikeRing),
    importedLoopSelection,
    16,
    16,
    importedLoopSelection,
    "normal",
  );
assert.equal(
  importedLoopExtrusion.errors.length,
  0,
  "imported side loops must extrude without generator metadata",
);
assert.equal(
  validateAll(importedLoopExtrusion.brushes).length,
  0,
  "imported side-loop extrusion must remain valid convex Source geometry",
);
const joinedBoxes = [
  box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }),
  box({ x: 64, y: 0, z: 0 }, { x: 128, y: 64, z: 64 }),
];
joinedBoxes.forEach((brush) => {
  brush.groupId = "joined-boxes";
});
assert.equal(
  connectedFaceIds(joinedBoxes, `${joinedBoxes[0].id}:f:1`).length,
  2,
  "topology grouping must support connected noncircular grouped geometry",
);
faceSelectionViewport.state.brushes = joinedBoxes;
const joinedBoundaryHit = faceSelectionViewport.radialFaceAt(0, 32);
assert.ok(
  joinedBoundaryHit,
  "projected boundary picking must detect edge-on faces on noncircular grouped geometry",
);
assert.notEqual(
  faceRole(
    joinedBoxes.find((brush) =>
      joinedBoundaryHit.id.startsWith(`${brush.id}:`),
    ),
    Number(joinedBoundaryHit.id.split(":f:")[1]),
  ),
  "top",
  "boundary hover must win over the visible top polygon on arbitrary geometry",
);
const boxLoopSelection = new Set(
    connectedFaceIds(joinedBoxes, joinedBoundaryHit.id),
  ),
  boxLoopExtrusion = extrudeSelectedFaces(
    structuredClone(joinedBoxes),
    boxLoopSelection,
    16,
    16,
    boxLoopSelection,
    "normal",
  );
assert.equal(
  boxLoopExtrusion.errors.length,
  0,
  "noncircular grouped side loops must support region extrusion",
);
assert.equal(
  validateAll(boxLoopExtrusion.brushes).length,
  0,
  "noncircular side-loop extrusion must remain valid convex Source geometry",
);
const resizeViewport = Object.create(Viewport.prototype);
const resizeBrushes = [
  box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }),
  box({ x: 64, y: 0, z: 0 }, { x: 128, y: 64, z: 64 }),
];
resizeViewport.state = {
  brushes: resizeBrushes,
  brushSelection: new Set(resizeBrushes.map((brush) => brush.id)),
  grid: 16,
};
resizeViewport.kind = "top";
resizeViewport.world = (point) => ({ x: point.x, y: point.y, z: 0 });
resizeViewport.drag = {
  handle: "e",
  bounds: { min: { x: 0, y: 0 }, max: { x: 128, y: 64 } },
  center: { x: 64, y: 32 },
  start: { x: 128, y: 32 },
  original: new Map(
    resizeBrushes.flatMap((brush) =>
      brush.vertices.map((vertex, index) => [
        `${brush.id}:v:${index}`,
        { ...vertex },
      ]),
    ),
  ),
};
assert.equal(resizeViewport.applyObjectTransform({ x: 190, y: 32 }), true);
assert.equal(
  Math.max(
    ...resizeBrushes.flatMap((brush) =>
      brush.vertices.map((vertex) => vertex.x),
    ),
  ),
  192,
  "SDK-style handle resize must snap the dragged bound before applying its group transform",
);
assert.equal(
  Math.min(
    ...resizeBrushes.flatMap((brush) =>
      brush.vertices.map((vertex) => vertex.x),
    ),
  ),
  0,
  "SDK-style handle resize must keep the opposite bound fixed",
);
resizeViewport.drag.original = new Map(
  resizeBrushes.flatMap((brush) =>
    brush.vertices.map((vertex, index) => [
      `${brush.id}:v:${index}`,
      { ...vertex },
    ]),
  ),
);
const groupedRing = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 32,
  grid: 16,
});
const groupedRingSelection = new Set(
  groupedRing.map((brush) => `${brush.id}:f:2`),
);
const groupedRingExtrusion = extrudeSelectedFaces(
  groupedRing,
  groupedRingSelection,
  16,
  16,
  groupedRingSelection,
  "normal",
);
assert.equal(
  groupedRingExtrusion.errors.length,
  0,
  "grouped Face normal extrusion must allow nonparallel ring faces",
);
assert.equal(
  groupedRingExtrusion.brushes.length,
  32,
  "grouped Face normal extrusion must extrude every selected ring face",
);
groupedRingExtrusion.brushes.forEach((brush, index) => {
  const source = groupedRing[index],
    sourceFace = source.faces[2],
    resultBase = brush.vertices.slice(0, sourceFace.length),
    resultCap = brush.vertices.slice(sourceFace.length);
  for (let edge = 0; edge < sourceFace.length; edge++) {
    const next = (edge + 1) % sourceFace.length,
      sourceA = resultBase[edge],
      sourceB = resultBase[next],
      capA = resultCap[edge],
      capB = resultCap[next],
      sx = sourceB.x - sourceA.x,
      sy = sourceB.y - sourceA.y,
      cx = capB.x - capA.x,
      cy = capB.y - capA.y,
      sourceLength = Math.hypot(sx, sy);
    if (sourceLength > 0.000001)
      assert.ok(
        Math.abs(sx * cy - sy * cx) / sourceLength < 0.0001,
        "every grouped destination edge must remain parallel to its source edge",
      );
  }
});
for (const source of [
  generateRing({ radius: 256, width: 64, height: 128, segments: 8, grid: 16 }),
  generateArch({
    width: 538,
    height: 502,
    depth: 64,
    wallWidth: 166,
    sides: 8,
    arc: 180,
    grid: 16,
  }),
]) {
  const id = `${source[0].id}:f:2`,
    result = extrudeSelectedFaces(
      source,
      new Set([id]),
      16,
      16,
      new Set([id]),
      "parallel",
    );
  assert.equal(
    result.errors.length,
    0,
    "single parallel wedge offset must remain valid",
  );
  assert.equal(
    result.brushes.length,
    1,
    "single parallel wedge offset must commit one brush",
  );
  assert.equal(
    validateAll(result.brushes).length,
    0,
    "parallel wedge offset must remain convex",
  );
}
const arcSnapSource = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 8,
  grid: 16,
});
const arcSnapId = `${arcSnapSource[0].id}:f:5`;
const arcSnapExtrusion = extrudeSelectedFaces(
  arcSnapSource,
  new Set([arcSnapId]),
  64,
  16,
  new Set([arcSnapId]),
  "normal",
  {
    type: "arc-angle",
    center: { x: 0, y: 0 },
    targetAngle: Math.PI / 4,
    deltaAngle: Math.PI / 4,
    distance: 64,
  },
);
assert.equal(
  arcSnapExtrusion.errors.length,
  0,
  "arc-angle snap must build a valid ring wedge",
);
assert.equal(
  validateAll(arcSnapExtrusion.brushes).length,
  0,
  "arc-angle snap must preserve convex brush geometry",
);
const radialRing = generateRing({
  radius: 256,
  width: 64,
  height: 128,
  segments: 32,
  grid: 16,
});
const radialPlaneSource = radialRing[0],
  radialFaceIndex = 5,
  radialAngle = (Math.PI * 5) / 16,
  radialPlane = {
    normal: { x: -Math.sin(radialAngle), y: Math.cos(radialAngle), z: 0 },
    distance: 0,
  },
  radialCap = solveCapFromPlane(
    radialPlaneSource,
    radialFaceIndex,
    radialPlane,
  );
assert.ok(
  radialCap.every(Boolean),
  "radial cap must have bounded intersections",
);
radialCap.forEach((point, index) => {
  assert.ok(
    Math.abs(radialPlane.normal.x * point.x + radialPlane.normal.y * point.y) <
      0.0001,
    "radial cap vertices must lie on the center-pivoted target plane",
  );
  assert.ok(
    Math.abs(
      point.z -
        radialPlaneSource.vertices[
          radialPlaneSource.faces[radialFaceIndex][index]
        ].z,
    ) < 0.0001,
    "radial cap must preserve top and bottom coordinates",
  );
});
resizeViewport.drag.bounds = { min: { x: 0, y: 0 }, max: { x: 192, y: 64 } };
resizeViewport.drag.handle = "w";
resizeViewport.applyObjectTransform({ x: 400, y: 32 });
assert.equal(
  Math.min(
    ...resizeBrushes.flatMap((brush) =>
      brush.vertices.map((vertex) => vertex.x),
    ),
  ),
  176,
  "SDK-style resize must prevent the dragged bound crossing its fixed opposite bound by one grid unit",
);
const snapSource = box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 });
const snapTarget = box({ x: 120, y: 0, z: 0 }, { x: 184, y: 64, z: 64 });
const snapViewport = Object.create(Viewport.prototype);
snapViewport.state = {
  brushes: [snapSource, snapTarget],
  grid: 16,
};
snapViewport.drag = { selection: new Set([`${snapSource.id}:f:3`]) };
snapViewport.kind = "top";
snapViewport.scale = 1;
snapViewport.screen = (vertex) => ({ x: vertex.x, y: vertex.y });
snapViewport.world = (point) => ({ x: point.x, y: point.y, z: 0 });
assert.equal(
  snapViewport.faceExtrusionDistance(
    `${snapSource.id}:f:3`,
    { x: 64, y: 32 },
    { x: 126, y: 32 },
  ),
  56,
  "an extrusion tip near another brush edge must snap exactly to that edge instead of the nearest grid point",
);
const opposingCandidate = snapViewport.extrusionCandidate;
assert.ok(opposingCandidate, "opposing face must produce a snap candidate");
assert.equal(
  opposingCandidate.snapTarget?.type,
  "cross-section-rails",
  "snap target must be cross-section-rails type",
);
assert.ok(
  opposingCandidate.snapTarget.normalDot <= -0.9,
  "snap normal dot must be <= -0.9",
);
assert.ok(
  Number.isFinite(opposingCandidate.snapTarget.finiteSeparation),
  "candidate must carry finite boundary separation",
);
assert.ok(
  opposingCandidate.snapTarget.activeAxes,
  "candidate must carry active axes for cross-section solving",
);
assert.ok(
  opposingCandidate.snapTarget.targetBrushId,
  "candidate must carry the target brush ID",
);
assert.ok(
  typeof opposingCandidate.snapTarget.targetFaceIndex === "number",
  "candidate must carry the target face index",
);
assert.ok(
  opposingCandidate.edges.every((edge) => edge.startScreen && edge.endScreen),
  "candidate edges must carry screen-space coordinates for highlighting",
);
const zoomViewport = Object.create(Viewport.prototype);
zoomViewport.canvas = {
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
};
zoomViewport.rect = { width: 800, height: 600 };
zoomViewport.offset = { x: 40, y: -30 };
zoomViewport.scale = 1;
zoomViewport.kind = "top";
zoomViewport.draw = () => {};
const zoomAnchor = { x: 530, y: 260 },
  worldBeforeZoom = zoomViewport.world(zoomAnchor);
zoomViewport.zoomAt(zoomAnchor.x, zoomAnchor.y, 1.2);
assert.deepEqual(
  zoomViewport.world(zoomAnchor),
  worldBeforeZoom,
  "zoom must keep the world point under the current cursor fixed",
);
const hiddenViewport = Object.create(Viewport.prototype);
hiddenViewport.state = {
  brushes: [snapSource, snapTarget],
  hiddenBrushes: new Set([snapTarget.id]),
};
assert.deepEqual(
  hiddenViewport.visibleBrushes().map((brush) => brush.id),
  [snapSource.id],
  "temporary hiding must remove unselected brushes from viewport rendering and picking",
);
faceSelectionViewport.state.brushes = ring;
const history = new History();
history.push({ value: 1 });
history.push({ value: 2 });
assert.deepEqual(history.undo(), { value: 1 });
assert.deepEqual(history.redo(), { value: 2 });
const selectionHistory = new History();
selectionHistory.push({ selection: [], brushSelection: [] });
selectionHistory.push({ selection: ["brush:v:0"], brushSelection: [] });
assert.deepEqual(
  selectionHistory.undo(),
  { selection: [], brushSelection: [] },
  "undo must restore vertex selections",
);
assert.deepEqual(
  selectionHistory.redo(),
  { selection: ["brush:v:0"], brushSelection: [] },
  "redo must restore vertex selections",
);
const imported = { id: "imported", vertices: [{ x: 0.25, y: 0, z: 0 }] };
moveVertices(
  [imported],
  new Set(["imported:v:0"]),
  { x: 1, y: 0, z: 0 },
  1,
  false,
);
assert.equal(
  imported.vertices[0].x,
  1.25,
  "drag snapping must preserve imported vertex offsets",
);
const object = {
  id: "object",
  vertices: [
    { x: 0.25, y: 2, z: 3 },
    { x: 4.25, y: 5, z: 6 },
  ],
};
moveBrushes([object], new Set(["object"]), { x: 8, y: -4, z: 0 }, 1, false);
assert.deepEqual(
  object.vertices,
  [
    { x: 8.25, y: -2, z: 3 },
    { x: 12.25, y: 1, z: 6 },
  ],
  "object movement must translate every brush vertex while preserving imported offsets",
);
const grouped = [
  box(),
  box({ x: 128, y: -64, z: 0 }, { x: 256, y: 64, z: 128 }),
];
grouped.forEach((brush) => {
  brush.groupId = "ring-group";
});
const groupedRoundTrip = parseVMF(writeVMF(grouped));
assert.equal(
  groupedRoundTrip.length,
  2,
  "grouped brushes must survive VMF export and import",
);
assert.ok(groupedRoundTrip[0].groupId, "Hammer group ID must be imported");
assert.equal(
  groupedRoundTrip[0].groupId,
  groupedRoundTrip[1].groupId,
  "brushes in one Hammer group must retain a shared group ID",
);
const touching = [
  box({ x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 64 }, "brick/brickwall001a"),
  box({ x: 64, y: 0, z: 0 }, { x: 128, y: 64, z: 64 }, "brick/brickwall001a"),
];
assert.equal(
  applyNodrawToHiddenFaces(touching),
  2,
  "both faces at a sealed brush seam must receive nodraw",
);
const nodrawRoundTrip = parseVMF(writeVMF(touching));
assert.equal(
  nodrawRoundTrip
    .flatMap((brush) => brush.faceMaterials)
    .filter((material) => material === "tools/toolsnodraw").length,
  2,
  "per-face nodraw must survive VMF export and import",
);
console.log("milestone tests passed");
