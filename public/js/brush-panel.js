import { roundToGrid } from "./grid.js";

export function createBrushPanel(grid) {
  const panel = document.createElement("aside");
  panel.className = "brush-panel generator-panel";
  panel.hidden = false;
  panel.innerHTML = `<header><strong>BRUSH TOOLS</strong></header><label>Shape <select data-shape><option value="block">Block</option><option value="arch">Arch</option><option value="cylinder">Cylinder</option><option value="sphere">Sphere</option><option value="torus">Torus</option></select></label><label>Width <input type="number" data-setting="width" min="1" max="4096" step="${grid}" value="64"><output data-output="width">64</output></label><label>Depth <input type="number" data-setting="depth" min="1" max="4096" step="${grid}" value="64"><output data-output="depth">64</output></label><label>Height <input type="number" data-setting="height" min="1" max="4096" step="${grid}" value="128"><output data-output="height">128</output></label><label>Radius <input type="number" data-setting="radius" min="8" max="4096" step="${grid}" value="256"><output data-output="radius">256</output></label><label>Sides <input type="number" data-setting="segments" min="3" max="128" step="1" value="32"><output data-output="segments">32</output></label><label>Rings <input type="number" data-setting="rings" min="2" max="64" step="1" value="12"><output data-output="rings">12</output></label><label>Arc <input type="number" data-setting="arc" min="1" max="360" step="1" value="180"><output data-output="arc">180</output></label><label class="check-row"><input type="checkbox" data-square> Square</label><label class="advanced-setting">Elevation <input type="number" data-setting="addHeight" min="-4096" max="4096" step="${grid}" value="0"><output data-output="addHeight">0</output></label><section class="prefab-settings"><strong>PREFAB</strong><label>Ownership <select data-prefab-ownership><option value="func_detail">func_detail per group</option><option value="group">Hammer groups</option><option value="world">World brushes</option></select></label><label>Structural backing <select data-prefab-backing><option value="none">None</option><option value="floor">Floor</option><option value="ceiling">Ceiling</option><option value="both">Floor and ceiling</option></select></label></section>`;
  return panel;
}

export function bindBrushPanel({ panel, state, view }) {
  let brushDepth = 64;
  const segmentLimits = {
      block: 128,
      arch: 128,
      cylinder: 32,
      sphere: 16,
      torus: 128,
    },
    segmentDefaults = {
      block: 32,
      arch: 32,
      cylinder: 32,
      sphere: 8,
      torus: 24,
    };
  state.generator.segmentCounts ||= {};
  let activeShape = state.generator.shape || "block";
  state.generator.segmentCounts[activeShape] ??= state.generator.segments;
  const shapeSelect = panel.querySelector("[data-shape]"),
    footer = panel.querySelector(".prefab-settings"),
    squareInput = panel.querySelector("[data-square]"),
    startAngleLabel = document.createElement("label"),
    arcLabel = panel.querySelector('[data-setting="arc"]').closest("label");

  startAngleLabel.innerHTML =
    'Start Angle <input type="number" data-setting="startAngle" min="0" max="360" step="1" value="0"><output data-output="startAngle">0</output>';
  shapeSelect.closest("label").after(startAngleLabel);

  squareInput.checked = localStorage.getItem("squareBox") === "1";
  state.squareBox = squareInput.checked;
  squareInput.onchange = () => {
    state.squareBox = squareInput.checked;
    localStorage.setItem("squareBox", squareInput.checked ? "1" : "0");
  };

  const syncStagedSettings = () => {
    if (!view.creationBox) return;
    const shape = state.generator.shape;
    if (["cylinder", "sphere", "torus"].includes(shape)) {
      const [horizontal, vertical] = view.creationBox.axes,
        width = Math.abs(
          view.creationBox.end[horizontal] - view.creationBox.start[horizontal],
        ),
        height = Math.abs(
          view.creationBox.end[vertical] - view.creationBox.start[vertical],
        ),
        outerRadius = roundToGrid(Math.min(width, height) / 2, state.grid);
      state.generator.radius =
        shape === "torus"
          ? Math.max(state.grid, outerRadius - state.generator.width / 2)
          : outerRadius;
    }
    for (const setting of ["radius", "width", "arc"]) {
      const input = panel.querySelector(`[data-setting="${setting}"]`);
      input.value = String(state.generator[setting]);
    }
  };

  const resizeRadialFootprint = () => {
    const shape = state.generator.shape;
    if (
      !view.creationBox ||
      !["cylinder", "sphere", "torus"].includes(shape)
    )
      return;
    const [horizontal, vertical] = view.creationBox.axes,
      outerRadius =
        state.generator.radius +
        (shape === "torus" ? state.generator.width / 2 : 0);
    for (const axis of [horizontal, vertical]) {
      const center =
        (view.creationBox.start[axis] + view.creationBox.end[axis]) / 2;
      view.creationBox.start[axis] = roundToGrid(
        center - outerRadius,
        state.grid,
      );
      view.creationBox.end[axis] = roundToGrid(
        center + outerRadius,
        state.grid,
      );
    }
  };

  const updateShape = () => {
    const shape = shapeSelect.value;
    if (shape !== activeShape) {
      state.generator.segmentCounts[activeShape] = state.generator.segments;
      state.generator.segments =
        state.generator.segmentCounts[shape] ?? segmentDefaults[shape];
      activeShape = shape;
    }
    state.generator.shape = shape;
    const visibleSettings = {
      block: ["height"],
      arch: ["width", "segments", "startAngle", "arc", "addHeight"],
      cylinder: ["height", "segments", "addHeight"],
      sphere: ["segments", "rings"],
      torus: ["width", "height", "segments"],
    }[shape];
    panel.querySelectorAll("[data-setting]").forEach((input) => {
      input.closest("label").hidden = !visibleSettings.includes(
        input.dataset.setting,
      );
    });
    const widthInput = panel.querySelector('[data-setting="width"]'),
      sidesInput = panel.querySelector('[data-setting="segments"]'),
      elevationInput = panel.querySelector('[data-setting="addHeight"]');
    widthInput.closest("label").firstChild.textContent =
      shape === "arch" ? "Wall width " : "Width ";
    widthInput.min = shape === "arch" ? 2 : 1;
    sidesInput.closest("label").firstChild.textContent = "Sides ";
    sidesInput.max = segmentLimits[shape];
    state.generator.segments = Math.min(
      Number(sidesInput.max),
      Math.max(3, Math.floor(state.generator.segments)),
    );
    state.generator.segmentCounts[shape] = state.generator.segments;
    sidesInput.value = String(state.generator.segments);
    startAngleLabel.hidden = shape !== "arch";
    squareInput.closest("label").hidden = shape !== "block";
    const elevationLabel = elevationInput.closest("label");
    elevationLabel.classList.toggle(
      "enabled",
      ["arch", "cylinder"].includes(shape),
    );
    elevationLabel.firstChild.textContent =
      shape === "arch" ? "Add height " : "Elevation ";
    if (shape === "arch") {
      for (const control of [
        widthInput.closest("label"),
        sidesInput.closest("label"),
        startAngleLabel,
        arcLabel,
        elevationLabel,
      ])
        panel.insertBefore(control, footer);
    } else panel.insertBefore(arcLabel, footer);
    if (view.creationBox) {
      syncStagedSettings();
      view.onBrushPreview(view.creationBox);
    }
  };

  shapeSelect.value = state.generator.shape || "block";
  shapeSelect.onchange = updateShape;
  panel.querySelectorAll("[data-setting]").forEach((input) => {
    if (input.dataset.setting in state.generator)
      input.value = String(state.generator[input.dataset.setting]);
    input.oninput = () => {
      const value =
        input.type === "checkbox" ? input.checked : Number(input.value);
      if (input.dataset.setting === "depth") brushDepth = value;
      if (input.dataset.setting in state.generator)
        state.generator[input.dataset.setting] = value;
      if (input.dataset.setting === "segments")
        state.generator.segmentCounts[activeShape] = value;
      input.value = String(value);
      if (
        view.creationBox &&
        ["radius", "width"].includes(input.dataset.setting) &&
        ["cylinder", "sphere", "torus"].includes(state.generator.shape)
      )
        resizeRadialFootprint();
      const output = panel.querySelector(
        `[data-output="${input.dataset.setting}"]`,
      );
      if (output) output.value = String(value);
      if (view.creationBox) view.onBrushPreview(view.creationBox);
    };
    input.onchange = input.oninput;
  });
  updateShape();

  return {
    get brushDepth() {
      return brushDepth;
    },
    syncStagedSettings,
  };
}
