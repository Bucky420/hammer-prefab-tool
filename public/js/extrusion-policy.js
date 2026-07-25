const policies = {
  straight: {
    externalSnap: true,
    sideSnap: false,
    groupedRegion: false,
  },
  parallel: {
    externalSnap: false,
    sideSnap: false,
    groupedRegion: true,
  },
  snap: {
    externalSnap: true,
    sideSnap: true,
    groupedRegion: false,
  },
};

export function extrusionPolicyForMode(mode) {
  return policies[mode] || policies.straight;
}

export function isForwardTarget(targetPoint, basePoint, outward, epsilon = 0.01) {
  const deltaX = targetPoint.x - basePoint.x;
  const deltaY = targetPoint.y - basePoint.y;
  return deltaX * outward.x + deltaY * outward.y > epsilon;
}

/**
 * @param {{x: number, y: number}} railDirection
 * @param {{x: number, y: number}} outward
 * @param {number} [maxAngleDegrees]
 * @returns {boolean}
 */
export function railWithinAngleLimit(
  railDirection,
  outward,
  maxAngleDegrees = 89,
) {
  const railLength = Math.hypot(railDirection.x, railDirection.y);
  const outwardLength = Math.hypot(outward.x, outward.y);
  if (railLength < 0.000001 || outwardLength < 0.000001) return false;
  const angle = Math.max(0, Math.min(89, Number(maxAngleDegrees) || 89));
  const alignment = Math.abs(
    (railDirection.x * outward.x + railDirection.y * outward.y) /
      (railLength * outwardLength),
  );
  return alignment >= Math.max(0.05, Math.cos((angle * Math.PI) / 180));
}

export function bindExtrusionModeButtons(container, state, onChange = () => {}) {
  const buttons = [...container.querySelectorAll("[data-extrude-mode]")];
  if (buttons.length !== 2)
    throw new Error("Face extrusion controls are incomplete");
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
      state.faceExtrusionMode =
        state.faceExtrusionMode === button.dataset.extrudeMode
          ? "straight"
          : button.dataset.extrudeMode;
      sync();
      onChange(state.faceExtrusionMode);
    });
  }
  return sync;
}
