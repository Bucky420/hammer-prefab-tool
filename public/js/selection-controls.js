export function bindSelectionControls({
  state,
  changed,
  redraw,
  setStatus,
  activateObjectMode,
}) {
  const faceScope = document.getElementById("selection-scope-toggle");
  const objectScope = document.getElementById("selection-mode-toggle");
  const textureAxes = document.getElementById("texture-axes-toggle");
  const scopes = ["solid", "object", "group"];
  const labels = { solid: "Solids", object: "Objects", group: "Groups" };

  const sync = () => {
    const faceMode = state.mode === "face";
    faceScope.hidden = !faceMode;
    objectScope.hidden = faceMode;
    objectScope.dataset.scope = state.selectionScope;
    const index = scopes.indexOf(state.selectionScope);
    const next = scopes[(index + 1) % scopes.length];
    const title = `${labels[state.selectionScope]} selection; click for ${labels[next]}`;
    objectScope.title = title;
    objectScope.setAttribute("aria-label", title);
    faceScope.dataset.scope = state.faceSelectionScope;
    faceScope.title = `${state.faceSelectionScope === "group" ? "Grouped semantic faces" : "Single face"} selection`;
    textureAxes.classList.toggle("active", state.showTextureAxes);
    textureAxes.setAttribute("aria-pressed", String(state.showTextureAxes));
    textureAxes.title = `${state.showTextureAxes ? "Hide" : "Show"} texture alignment`;
  };

  faceScope.onclick = () => {
    state.faceSelectionScope =
      state.faceSelectionScope === "group" ? "object" : "group";
    state.faceSelection.clear();
    sync();
    setStatus(
      `${state.faceSelectionScope === "group" ? "Grouped inner, outer, top, or bottom faces" : "Single-face"} selection active`,
    );
    changed("session");
  };
  objectScope.onclick = () => {
    const index = scopes.indexOf(state.selectionScope);
    state.selectionScope = scopes[(index + 1) % scopes.length];
    activateObjectMode();
    redraw();
    setStatus(`${labels[state.selectionScope]} selection active`);
  };
  textureAxes.onclick = () => {
    state.showTextureAxes = !state.showTextureAxes;
    sync();
    redraw();
    setStatus(
      `Texture alignment ${state.showTextureAxes ? "shown" : "hidden"}`,
    );
  };

  sync();
  return { sync };
}
