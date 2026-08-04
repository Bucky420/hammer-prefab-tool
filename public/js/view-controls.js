const VIEW_NAMES = ["top", "front", "side"];
const VIEW_LABELS = { top: "TOP / XY", front: "FRONT / YZ", side: "SIDE / XZ" };

export function bindViewControls({
  state,
  getActiveView,
  setActiveView,
  changed,
  redraw,
  setStatus,
  captureScreenshot,
}) {
  const selector = document.getElementById("view-selector");
  const funcDetail = document.getElementById("show-func-detail");
  const regular = document.getElementById("show-regular-brushes");

  const sync = () => {
    selector.textContent = VIEW_LABELS[getActiveView()];
    funcDetail.checked = state.showFuncDetailBrushes !== false;
    regular.checked = state.showRegularBrushes !== false;
  };
  for (const input of [funcDetail, regular]) {
    input.onchange = () => {
      state.showFuncDetailBrushes = funcDetail.checked;
      state.showRegularBrushes = regular.checked;
      changed("session");
      setStatus(
        `${input === funcDetail ? "func_detail" : "Regular"} brushes ${input.checked ? "shown" : "hidden"}`,
      );
    };
  }
  selector.onclick = () => {
    const current = getActiveView();
    const next =
      VIEW_NAMES[(VIEW_NAMES.indexOf(current) + 1) % VIEW_NAMES.length];
    setActiveView(next);
    sync();
    redraw();
    setStatus(`View: ${VIEW_LABELS[next]}`);
  };
  document.getElementById("grid-screenshot").onclick = () => {
    captureScreenshot().catch((error) =>
      setStatus(`Screenshot failed: ${error.message}`, true),
    );
  };
  document.getElementById("key-toggle").onclick = () => {
    const key = document.getElementById("editor-key");
    const toggle = document.getElementById("key-toggle");
    const open = !key.classList.contains("open");
    key.classList.toggle("open", open);
    key.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.title = open ? "Hide controls and key" : "Show controls and key";
  };

  sync();
  return { sync };
}
