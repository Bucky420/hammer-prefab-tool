import { bindExtrusionModeButtons } from "./extrusion-policy.js";

export function createFacePanel() {
  const panel = document.createElement("aside");
  panel.className = "brush-panel";
  panel.hidden = true;
  panel.innerHTML = `<header><strong>FACE TOOLS</strong></header><label>Mode <select data-face-mode><option value="extrude">Extrude</option><option value="fill">Planar Fill</option></select></label><label>Side material <select data-face-side-material><option value="dev/dev_measuregeneric01">Orange</option><option value="dev/dev_measuregeneric01b">Gray</option></select></label><label>Top material <select data-face-top-material><option value="dev/dev_measuregeneric01b">Gray</option><option value="dev/dev_measuregeneric01">Orange</option></select></label><label title="Maximum angle between an external rail and the extrusion normal">Max rail angle <input type="number" data-face-rail-angle min="15" max="89" step="1" value="89"> deg</label><label title="Signed source-side angle; 135 degrees is a 45-degree undirected line deviation">Max source angle <input type="number" data-face-source-angle min="90" max="179" step="1" value="135"> deg</label><label class="check-row" title="Snap the grabbed extrusion distance to the active grid"><input type="checkbox" data-face-grid-snap> Grid snap</label><div class="extrusion-toggles"><button type="button" class="extrusion-toggle" data-extrude-mode="parallel" aria-pressed="false" title="Keep the dragged cap parallel to the selected face while following adjacent source sides">Parallel</button><button type="button" class="extrusion-toggle" data-extrude-mode="snap" aria-pressed="false">Snap</button></div>`;
  return panel;
}

export function bindFacePanel({ panel, state, changed, redraw, setStatus }) {
  const modeSelect = panel.querySelector("[data-face-mode]");
  const sideMaterialSelect = panel.querySelector("[data-face-side-material]");
  const topMaterialSelect = panel.querySelector("[data-face-top-material]");
  const railAngleInput = panel.querySelector("[data-face-rail-angle]");
  const sourceAngleInput = panel.querySelector("[data-face-source-angle]");
  const gridSnapInput = panel.querySelector("[data-face-grid-snap]");
  const modeButtons = panel.querySelectorAll("[data-extrude-mode]");
  if (
    !modeSelect ||
    !sideMaterialSelect ||
    !topMaterialSelect ||
    !railAngleInput ||
    !sourceAngleInput ||
    !gridSnapInput ||
    modeButtons.length !== 2
  )
    throw new Error("Face panel markup is incomplete");

  bindExtrusionModeButtons(panel, state, (mode) => {
    changed("document", false);
    redraw();
    setStatus(
      mode === "parallel"
        ? "Parallel extrusion: following adjacent source sides"
        : mode === "straight"
          ? "Straight extrusion: forward-cap snapping active"
          : "Snap extrusion: forward cap and external side rails active",
    );
  });

  const syncControls = () => {
    modeSelect.value = state.faceToolMode;
    railAngleInput.value = String(state.faceRailMaxAngle);
    sourceAngleInput.value = String(state.faceSourceMaxAngle);
    gridSnapInput.checked = state.faceExtrusionGridSnap;
  };

  railAngleInput.onchange = () => {
    state.faceRailMaxAngle = Math.max(
      15,
      Math.min(89, Number(railAngleInput.value) || 89),
    );
    railAngleInput.value = String(state.faceRailMaxAngle);
    try {
      localStorage.setItem("faceRailMaxAngle", String(state.faceRailMaxAngle));
    } catch {}
    changed("document", false);
    setStatus(`Maximum rail angle: ${state.faceRailMaxAngle} deg`);
  };
  sourceAngleInput.onchange = () => {
    state.faceSourceMaxAngle = Math.max(
      90,
      Math.min(179, Number(sourceAngleInput.value) || 135),
    );
    sourceAngleInput.value = String(state.faceSourceMaxAngle);
    try {
      localStorage.setItem(
        "faceSourceMaxAngle",
        String(state.faceSourceMaxAngle),
      );
    } catch {}
    changed("document", false);
    setStatus(`Maximum source-side angle: ${state.faceSourceMaxAngle} deg`);
  };
  gridSnapInput.onchange = () => {
    state.faceExtrusionGridSnap = gridSnapInput.checked;
    try {
      localStorage.setItem(
        "faceExtrusionGridSnap",
        String(state.faceExtrusionGridSnap),
      );
    } catch {}
    changed("document", false);
    setStatus(
      `Extrusion grid snap ${state.faceExtrusionGridSnap ? "enabled" : "disabled"}`,
    );
  };

  const setFaceToolMode = (event) => {
    event?.stopPropagation();
    const mode = event?.currentTarget?.value || modeSelect.value;
    if (mode === state.faceToolMode) return;
    state.faceToolMode = mode;
    setStatus(
      mode === "fill"
        ? "Planar Fill: select a closed vertical boundary loop, then press E"
        : "Extrude: drag selected faces outward",
    );
    changed("session");
  };
  modeSelect.addEventListener("input", setFaceToolMode);
  modeSelect.addEventListener("change", setFaceToolMode);
  modeSelect.addEventListener("pointerdown", (event) =>
    event.stopPropagation(),
  );

  const applyFaceMaterials = () => {
    if (!state.faceSelection.size)
      return setStatus("Select one or more faces first", true);
    const sideMaterial = sideMaterialSelect.value;
    const topMaterial = topMaterialSelect.value;
    let applied = 0;
    for (const id of state.faceSelection) {
      const match = id.match(/^(.*):f:(\d+)$/);
      const brush = match && state.brushes.find((item) => item.id === match[1]);
      const faceIndex = Number(match?.[2]);
      if (!brush || !brush.faces[faceIndex]) continue;
      brush.faceMaterials ||= brush.faces.map(
        () => brush.material || "tools/toolsnodraw",
      );
      const face = brush.faces[faceIndex];
      const a = brush.vertices[face[0]];
      const b = brush.vertices[face[1]];
      const c = brush.vertices[face[2]];
      const normal = {
        x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
        y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
        z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      };
      brush.faceMaterials[faceIndex] =
        Math.abs(normal.z) > Math.max(Math.abs(normal.x), Math.abs(normal.y))
          ? topMaterial
          : sideMaterial;
      applied++;
    }
    if (!applied) return setStatus("Selected faces no longer exist", true);
    changed();
    setStatus(`Applied materials to ${applied} faces`);
  };
  sideMaterialSelect.addEventListener("change", applyFaceMaterials);
  topMaterialSelect.addEventListener("change", applyFaceMaterials);

  syncControls();
  return { syncControls };
}
