import { roundToGrid } from "./grid.js";

export function createPathPanel(grid) {
  const panel = document.createElement("aside");
  panel.className = "brush-panel path-panel";
  panel.hidden = true;
  panel.innerHTML = `<header><strong>PATH TOOLS</strong></header><label>Type <select data-path-type><option value="hallway">Hallway</option></select></label><label>Next <select data-path-segment-mode><option value="spline">Spline</option><option value="straight">Straight</option></select></label><label>Node <select data-path-node-mode><option value="auto">Auto</option><option value="smooth">Smooth</option><option value="corner">Corner</option></select></label><div class="path-actions"><button type="button" data-path-close>Close Path</button><button type="button" data-path-detach>Detach Start</button></div><label>Inside width <input type="number" data-path-setting="interiorWidth" min="1" max="8192" step="${grid}"></label><label>Height <input type="number" data-path-setting="interiorHeight" min="1" max="8192" step="${grid}"></label><label>Wall <input type="number" data-path-setting="wallThickness" min="1" max="1024" step="${grid}"></label><label>Floor <input type="number" data-path-setting="floorThickness" min="1" max="1024" step="${grid}"></label><label>Ceiling <input type="number" data-path-setting="ceilingThickness" min="1" max="1024" step="${grid}"></label><label>Elevation <input type="number" data-path-setting="baseElevation" min="-32768" max="32768" step="${grid}"></label><label>Max angle <input type="number" data-path-setting="maxAngleDegrees" min="1" max="90" step="1"></label><label>Max length <input type="number" data-path-setting="maxSegmentLength" min="1" max="1024" step="${grid}"></label><label>Curve error <input type="number" data-path-setting="chordError" min="0.125" max="64" step="0.125"></label><label>Flare <input type="number" data-path-setting="flare" min="0" max="4096" step="${grid}"></label><label>Blend length <input type="number" data-path-setting="blendLength" min="1" max="8192" step="${grid}"></label><label>Margin <input type="number" data-path-setting="routeMargin" min="0" max="4096" step="${grid}"></label><label class="check-row"><input type="checkbox" data-path-avoid> Avoid shapes</label><label class="check-row"><input type="checkbox" data-path-snap> Snap ends</label><section class="path-materials"><strong>MATERIALS</strong><label>Floor <input type="text" data-path-material="floor"></label><label>Walls <input type="text" data-path-material="wall"></label><label>Ceiling <input type="text" data-path-material="ceiling"></label></section><p class="panel-note">Select one or two floor solids before Path to match the starting mouth. New spans automatically bend around visible shapes using the margin. Drag cyan handles to edit width, height, and tangents. Enter commits.</p>`;
  return panel;
}

export function bindPathPanel({ panel, state, view, redraw, setStatus }) {
  const pathInputs = new Map(
    [...panel.querySelectorAll("[data-path-setting]")].map((input) => [
      input.dataset.pathSetting,
      input,
    ]),
  );
  const materialInputs = new Map(
    [...panel.querySelectorAll("[data-path-material]")].map((input) => [
      input.dataset.pathMaterial,
      input,
    ]),
  );
  const segmentModeInput = panel.querySelector("[data-path-segment-mode]");
  const nodeModeInput = panel.querySelector("[data-path-node-mode]");
  const closeButton = panel.querySelector("[data-path-close]");
  const detachButton = panel.querySelector("[data-path-detach]");
  const snapInput = panel.querySelector("[data-path-snap]");
  const avoidInput = panel.querySelector("[data-path-avoid]");
  if (
    !segmentModeInput ||
    !nodeModeInput ||
    !closeButton ||
    !detachButton ||
    !snapInput ||
    !avoidInput
  )
    throw new Error("Path panel markup is incomplete");

  const updateControls = () => {
    const selectedNode = view.pathPoints[view.selectedPathNode];
    for (const [name, input] of pathInputs) {
      let value = state.pathSettings[name];
      if (selectedNode && name === "interiorWidth")
        value = selectedNode.width - 2 * state.pathSettings.wallThickness;
      if (selectedNode && name === "interiorHeight")
        value = selectedNode.height;
      if (selectedNode && name === "baseElevation") value = selectedNode.z;
      input.value = String(value);
    }
    for (const [name, input] of materialInputs)
      input.value = state.pathSettings.materials[name];
    segmentModeInput.value = Number.isInteger(view.selectedPathSegment)
      ? view.pathModel.segmentModes[view.selectedPathSegment]
      : state.pathSettings.segmentMode;
    nodeModeInput.value = selectedNode?.tangentMode || "auto";
    closeButton.textContent = view.pathModel.closed
      ? "Open Path"
      : "Close Path";
    detachButton.disabled = !view.pathSourceAttachment;
    snapInput.checked = state.pathSettings.snapEnds !== false;
    avoidInput.checked = state.pathSettings.avoidShapes !== false;
  };

  for (const [name, input] of pathInputs) {
    input.onchange = () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        updateControls();
        return;
      }
      const selectedNode = view.pathPoints[view.selectedPathNode];
      if (selectedNode && name === "interiorWidth")
        selectedNode.width =
          value + 2 * Number(state.pathSettings.wallThickness);
      else if (selectedNode && name === "interiorHeight")
        selectedNode.height = value;
      else if (selectedNode && name === "baseElevation") selectedNode.z = value;
      else if (name === "baseElevation" && view.pathPoints.length) {
        const delta = value - state.pathSettings.baseElevation;
        view.pathPoints.forEach((point) => {
          point.z = roundToGrid(point.z + delta, state.grid);
        });
      } else if (name === "interiorWidth" && view.pathPoints.length)
        view.pathPoints.forEach((point) => {
          point.width = value + 2 * Number(state.pathSettings.wallThickness);
        });
      else if (name === "interiorHeight" && view.pathPoints.length)
        view.pathPoints.forEach((point) => {
          point.height = value;
        });
      if (["maxAngleDegrees", "maxSegmentLength", "chordError"].includes(name))
        view.pathModel.detail[name] = value;
      if (name === "flare") {
        if (view.pathSourceAttachment) view.pathSourceAttachment.flare = value;
        if (view.pathEndAttachment) view.pathEndAttachment.flare = value;
      }
      if (name === "blendLength") {
        if (view.pathSourceAttachment)
          view.pathSourceAttachment.blendLength = value;
        if (view.pathEndAttachment) view.pathEndAttachment.blendLength = value;
      }
      state.pathSettings[name] = value;
      updateControls();
      if (state.mode === "path") {
        view.refreshPathPreview();
        redraw();
      }
    };
  }

  segmentModeInput.onchange = (event) => {
    state.pathSettings.segmentMode = event.target.value;
    view.setSelectedPathSegmentMode(event.target.value);
    updateControls();
    redraw();
  };
  nodeModeInput.onchange = (event) => {
    view.setSelectedPathNodeMode(event.target.value);
    updateControls();
    redraw();
  };
  closeButton.onclick = () => {
    if (!view.togglePathClosed())
      return setStatus("Closing a path requires at least three nodes", true);
    updateControls();
    redraw();
    setStatus(
      view.pathModel.closed ? "Hallway path closed" : "Hallway path opened",
    );
  };
  detachButton.onclick = () => {
    view.pathSourceAttachment = null;
    view.pathSourceBrushIds = [];
    view.refreshPathPreview();
    updateControls();
    setStatus("Hallway start detached from source floor");
  };
  snapInput.onchange = (event) => {
    state.pathSettings.snapEnds = event.target.checked;
    if (!event.target.checked) view.pathEndAttachment = null;
    view.refreshPathPreview();
  };
  avoidInput.onchange = (event) => {
    state.pathSettings.avoidShapes = event.target.checked;
  };
  for (const [name, input] of materialInputs) {
    input.onchange = () => {
      state.pathSettings.materials[name] = input.value.trim();
      if (state.mode === "path") {
        view.refreshPathPreview();
        redraw();
      }
    };
  }

  updateControls();
  return { updateControls };
}
