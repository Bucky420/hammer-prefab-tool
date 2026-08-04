import { GRID_VALUES } from "./grid.js";

export function bindGridControls({ state, changed }) {
  const input = document.getElementById("grid");
  const note = document.querySelector(".menu-note");
  const footer = document.getElementById("footer-grid");

  const sync = () => {
    input.value = String(state.grid);
    note.textContent = `Current grid: ${state.grid}. Use [ and ] to change.`;
    footer.textContent = `Grid: ${state.grid}`;
  };
  const setDelta = (delta) => {
    const index = Math.max(
      0,
      Math.min(GRID_VALUES.length - 1, GRID_VALUES.indexOf(state.grid) + delta),
    );
    state.grid = GRID_VALUES[index];
    sync();
    changed("document", false);
  };
  input.onchange = () => {
    state.grid = Number(input.value);
    sync();
    changed("document", false);
  };

  sync();
  return { setDelta, sync };
}
