const policies = {
  parallel: {
    externalSnap: false,
    groupedRegion: true,
    forwardOnly: false,
  },
  snap: {
    externalSnap: true,
    groupedRegion: false,
    forwardOnly: false,
  },
  "forward-snap": {
    externalSnap: true,
    groupedRegion: false,
    forwardOnly: true,
  },
};

export function extrusionPolicyForMode(mode) {
  return policies[mode] || policies.snap;
}

export function isForwardTarget(targetPoint, basePoint, outward, epsilon = 0.01) {
  const deltaX = targetPoint.x - basePoint.x;
  const deltaY = targetPoint.y - basePoint.y;
  return deltaX * outward.x + deltaY * outward.y > epsilon;
}

export function bindExtrusionModeButtons(container, state, onChange = () => {}) {
  const buttons = [...container.querySelectorAll("[data-extrude-mode]")];
  const sync = () => {
    for (const button of buttons) {
      const active = button.dataset.extrudeMode === state.faceExtrusionMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };
  sync();
  for (const button of buttons) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.faceExtrusionMode = button.dataset.extrudeMode;
      sync();
      onChange(state.faceExtrusionMode);
    });
  }
  return sync;
}
